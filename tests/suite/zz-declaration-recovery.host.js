'use strict';

// End-to-end matrix: real VS Code documents, LanguageClient, LSP diagnostics and tokens.
// The Tooling matrix alone cannot exercise this path.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'cvololang.cvolo-language';
const fixtures = path.resolve(__dirname, '..', 'fixtures', 'workspace');
const header = [
    'public struct Widget { public int Value; }',
    'public struct Box<T> { public T Value; }',
    'int GetValue() { return 2; }',
    'void Touch() { }'
].join('\n') + '\n';
const followIf = 'if (ready) { y = y + 1; }';
const prefix = [
    'bool ready = true;',
    'int y = 1;',
    'double reused = 0;',
    'Widget widget = Widget { Value: 1 };'
].join('\n') + '\n';

function makeSource(before, next, context = 'function', separator = '\n', newline = '\n') {
    const body = prefix + before + separator + next + '\n'
        + 'int afterProbe = 7;\nreturn afterProbe;\n';
    let source;
    switch (context) {
        case 'function':
            source = header + 'int main() {\n' + body + '}\n';
            break;
        case 'namespace':
            source = 'namespace RecoveryE2E {\n' + header + 'int main() {\n' + body + '}\n}\n';
            break;
        case 'extension':
            source = header + 'public extension Widget {\npublic int Recover() {\n' + body
                + '}\n}\nint main() { return 0; }\n';
            break;
        case 'inner_if':
            source = header + 'int main() {\nif (true) {\n' + body + '}\nreturn 0;\n}\n';
            break;
        case 'inner_while':
            source = header + 'int main() {\nwhile (false) {\n' + body + '}\nreturn 0;\n}\n';
            break;
        case 'inner_for':
            source = header + 'int main() {\nfor (int i = 0; i < 1; i = i + 1) {\n' + body
                + '}\nreturn 0;\n}\n';
            break;
        case 'inner_block':
            source = header + 'int main() {\n{\n' + body + '}\nreturn 0;\n}\n';
            break;
        default:
            throw new Error('Unknown scope: ' + context);
    }
    return newline === '\n' ? source : source.replace(/\n/g, newline);
}

function diagnosticCode(diagnostic) {
    const code = diagnostic.code;
    return String(typeof code === 'object' && code !== null ? code.value : code ?? '');
}

function isSyntaxDiagnostic(diagnostic) {
    return /^CVL417[345]$|^CVL0000$/.test(diagnosticCode(diagnostic))
        || /no viable alternative|missing ';'|unexpected token|extraneous input/i.test(diagnostic.message);
}

function describe(diagnostics) {
    return diagnostics.map(diagnostic =>
        diagnosticCode(diagnostic) + '@'
        + (diagnostic.range.start.line + 1) + ':' + (diagnostic.range.start.character + 1)
        + ' ' + diagnostic.message
    ).join('\n');
}

async function runningClient() {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    assert.ok(extension, 'Missing extension ' + EXTENSION_ID);
    const api = await extension.activate();
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
        const client = api.getClient();
        if (client?.isRunning()) return client;
        await new Promise(resolve => setTimeout(resolve, 200));
    }
    throw new Error('Cvolo Language Server did not start');
}

async function openAndAwaitDiagnostics(uri) {
    // Subscribe before didOpen: valid programs are expected to publish [].
    let subscription;
    let timeout;
    const published = new Promise((resolve, reject) => {
        subscription = vscode.languages.onDidChangeDiagnostics(event => {
            if (event.uris.some(changed => changed.toString() === uri.toString())) resolve();
        });
        timeout = setTimeout(() => reject(new Error(
            'LSP did not publish diagnostics for ' + uri.fsPath
        )), 15000);
    });
    try {
        const document = await vscode.workspace.openTextDocument(uri);
        assert.equal(document.languageId, 'cvolo');
        await vscode.window.showTextDocument(document, { preview: true });
        await published;
        return { document, diagnostics: vscode.languages.getDiagnostics(uri) };
    } finally {
        clearTimeout(timeout);
        subscription.dispose();
    }
}

function tokenTexts(document, result) {
    const texts = [];
    let line = 0;
    let character = 0;
    const data = result?.data || [];
    for (let i = 0; i + 4 < data.length; i += 5) {
        line += data[i];
        character = data[i] === 0 ? character + data[i + 1] : data[i + 1];
        const start = document.offsetAt(new vscode.Position(line, character));
        const end = document.offsetAt(new vscode.Position(line, character + data[i + 2]));
        texts.push(document.getText().slice(start, end));
    }
    return texts;
}

// The reviewed recovery matrix. Valid multi-line continuations are negative
// controls: recovery must not split or reject them merely for containing a newline.
const statementCases = [
    [1, 'double', followIf, true],
    [2, 'double x', followIf, true],
    [3, 'double x =', followIf, true],
    [4, 'double x = 0', followIf, true],
    [5, 'double', 'while (false) { y = y + 1; }', true],
    [6, 'double x', 'for (int k = 0; k < 0; k = k + 1) { y = y + 1; }', true],
    [7, 'double x =', 'foreach (val item in items) { y = y + 1; }', true],
    [8, 'double', 'return 1;', true],
    [9, 'double x', 'break;', true],
    [10, 'double x =', 'continue;', true],
    [11, 'double', 'switch (y) { default: y = y + 1; }', true],
    [12, 'double x', 'try { y = y + 1; } finally { y = y + 1; }', true],
    [13, 'double x =', 'defer Touch();', true],
    [14, 'double', 'unsafe { y = y + 1; }', true],
    [15, 'double', 'val later = 1;', true],
    [16, 'double x', 'var later = 1;', true],
    [17, 'double x =', '{ 1, 2 };', false],
    [18, 'double', 'split = 1;', false],
    [19, 'double x =', 'reused = 1;', false],
    [20, 'double x', 'reused = 1;', true],
    [21, 'double x = 0', 'reused = 1;', true],
    [22, 'double x;', followIf, false],
    [23, 'double', 'split = 1;', false],
    [24, 'double', 'split;', false],
    [25, 'double x =', '1.5;', false],
    [26, 'double x =', 'GetValue();', false],
    [27, 'double x = 1', '+ 2;', false],
    [28, 'double x = (', '1 + 2 );', false],
    [29, 'double x =', 'ready ? 1 : 2;', false],
    [30, 'Widget', 'value = Widget { Value: 1 };', false],
    [31, 'Widget*', 'ptr = null;', false],
    [32, 'Widget?', 'optional;', false],
    [33, 'Widget[]', 'values;', false],
    [34, 'Box<int>', 'item;', false],
    [35, 'ref Widget', 'borrowed;', false],
    [36, 'if', '(ready) { y = y + 1; }', false],
    [37, 'while', '(false) { y = y + 1; }', false],
    [38, 'widget.', 'Value = 5;', false],
    [39, 'if', 'return 0;', true],
    [40, 'while', followIf, true],
    [41, 'GetValue(', followIf, true],
    [42, 'y =', followIf, true],
    [43, 'return', followIf, true],
    [44, 'widget.Val', followIf, true],
    [45, 'var x =', 'while (false) { y = y + 1; }', true],
    [46, 'Widget other', 'return 0;', true],
    [47, 'y = 1 +', '2;', false],
    [48, 'GetValue(', 'y );', false],
    [57, 'double x;', followIf, false, ' '],
    [59, 'double // a comment', followIf, true]
];
const builtins = [
    'int', 'uint', 'long', 'ulong', 'short', 'ushort', 'byte', 'sbyte',
    'nint', 'nuint', 'float', 'double', 'bool', 'string', 'char', 'void'
];
const customTypes = ['Widget', 'Widget*', 'Widget?', 'Widget[]', 'Box<int>', 'ref Widget'];
const contexts = ['function', 'extension', 'namespace', 'inner_if', 'inner_while', 'inner_block', 'inner_for'];

suite('Cvolo parser recovery in real VS Code (E2E)', () => {
    let scratch;
    let client;
    let counter = 0;

    suiteSetup(async () => {
        scratch = fs.mkdtempSync(path.join(fixtures, '.recovery-e2e-'));
        client = await runningClient();
        const expected = process.env.CVOLO_E2E_SERVER;
        assert.ok(expected && path.isAbsolute(expected),
            'Recovery E2E requires CVOLO_E2E_SERVER to be an absolute freshly-built LSP path');
        const selected = vscode.workspace.getConfiguration('cvolo').get('server.path', '');
        assert.equal(path.resolve(selected), path.resolve(expected),
            'Host must run CVOLO_E2E_SERVER, not a stale bundled/PATH server');
    });

    suiteTeardown(async () => {
        if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
    });

    async function checkCase(label, before, next, invalid, context = 'function',
        separator = '\n', newline = '\n') {
        const source = makeSource(before, next, context, separator, newline);
        const filename = path.join(scratch, 'recovery-' + String(++counter).padStart(4, '0') + '.cvl');
        fs.writeFileSync(filename, source, 'utf8');
        const uri = vscode.Uri.file(filename);
        const { document, diagnostics } = await openAndAwaitDiagnostics(uri);
        const syntax = diagnostics.filter(isSyntaxDiagnostic);
        const nextStart = source.lastIndexOf(next);
        const fragmentStart = source.lastIndexOf(before, nextStart);
        const probe = source.indexOf('int afterProbe = 7;', nextStart);
        assert.ok(fragmentStart >= 0 && nextStart > fragmentStart && probe > nextStart,
            label + ': bad E2E fixture');
        const position = d => document.offsetAt(d.range.start);
        const roots = syntax.filter(d => position(d) >= fragmentStart && position(d) < nextStart);
        assert.equal(roots.length > 0, invalid,
            label + ': wrong diagnostics before the next statement\n' + describe(diagnostics));
        const cascades = syntax.filter(d => position(d) >= nextStart);
        assert.equal(cascades.length, 0,
            label + ': parser poisoned the following statement or trailing code\n' + describe(diagnostics));

        const tokens = await client.sendRequest('textDocument/semanticTokens/full', {
            textDocument: { uri: uri.toString() }
        });
        assert.ok(tokenTexts(document, tokens).includes('afterProbe'),
            label + ': the running LSP lost semantic tokens for the next local');
    }

    for (const [n, before, next, invalid, separator = '\n'] of statementCases) {
        test('matrix #' + n + ': ' + before + ' / ' + next, async () => {
            await checkCase('matrix #' + n, before, next, invalid, 'function', separator);
        });
    }

    for (const type of builtins) {
        for (const [suffix, invalid] of [['', true], [' x', true], [' x =', true], [' x = 1;', false]]) {
            const before = type + suffix;
            test('builtin ' + type + ': ' + JSON.stringify(before) + ' before if', async () => {
                await checkCase(type + suffix, before, followIf, invalid);
            });
        }
    }

    for (const type of customTypes) {
        for (const [suffix, invalid] of [['', true], [' x', true], [' x =', true], [' x;', false]]) {
            const before = type + suffix;
            test('custom ' + type + ': ' + JSON.stringify(before) + ' before if', async () => {
                await checkCase(type + suffix, before, followIf, invalid);
            });
        }
    }

    for (const context of contexts) {
        for (const [before, invalid] of [
            ['double', true], ['double x', true], ['double x =', true], ['double x = 2;', false]
        ]) {
            test('scope ' + context + ': ' + before + ' before if', async () => {
                await checkCase(context + '/' + before, before, followIf, invalid, context);
            });
        }
    }

    for (const newline of ['\n', '\r\n']) {
        test('line ending ' + JSON.stringify(newline) + ' retains recovery', async () => {
            await checkCase('line ending', 'double', followIf, true, 'function', '\n', newline);
        });
    }

    test('two independent malformed declarations do not collapse into one', async () => {
        const before = 'double\nif (ready) { y = y + 1; }\ndouble x =';
        const next = 'while (false) { y = y + 1; }';
        await checkCase('two roots', before, next, true);
    });

    for (const before of ['int', 'int x', 'int x =', 'int x = 1',
        'double', 'double x', 'double x =', 'double x = 1']) {
        test('destructor: ' + before + ' before if has exactly one syntax root', async () => {
            const source = [
                'public struct Widget { public int Value; }',
                'public extension Widget {',
                '    [UnsafeBody]',
                '    public ~Widget() {',
                '        ' + before,
                '        if (Value != 0) {',
                '            Value = 0;',
                '        }',
                '    }',
                '}'
            ].join('\n') + '\n';
            const filename = path.join(scratch, 'destructor-' + String(++counter) + '.cvl');
            fs.writeFileSync(filename, source, 'utf8');
            const uri = vscode.Uri.file(filename);
            const { document, diagnostics } = await openAndAwaitDiagnostics(uri);
            const from = source.indexOf('        ' + before + '\n');
            const until = source.indexOf('        if (Value', from);
            const syntax = diagnostics.filter(isSyntaxDiagnostic);
            const root = syntax.filter(d => {
                const at = document.offsetAt(d.range.start);
                return at >= from && at < until;
            });
            assert.equal(root.length, 1,
                before + ': expected one syntax diagnostic on unfinished declaration.\n'
                + describe(diagnostics));
            assert.ok(!/before '(if|while)'/i.test(root[0].message),
                before + ': error should describe the broken declaration, not the next keyword');
            const expectedOffset = before.endsWith('=')
                ? from + 8 + before.length - 1
                : before.includes(' = ')
                    ? from + 8 + before.lastIndexOf(' ') + 1
                    : before.endsWith(' x')
                        ? from + 8 + before.length - 1
                        : from + 8;
            const actualOffset = document.offsetAt(root[0].range.start);
            if (!before.includes(' = ')) {
                assert.equal(actualOffset, expectedOffset,
                    before + ': underline should point to the broken declaration');
            } else {
                assert.ok(actualOffset >= from + 8 && actualOffset <= from + 8 + before.length,
                    before + ': underline must stay inside the declaration');
            }

            assert.equal(syntax.filter(d => document.offsetAt(d.range.start) >= until).length, 0,
                before + ': unrelated if/next statements must not be damaged.\n'
                + describe(diagnostics));
        });
    }

    for (const keyword of ['while', 'if']) {
        test('destructor: empty ' + keyword + ' condition does not poison the next if', async () => {
            const source = [
                'public struct Widget { public int Value; }',
                'public extension Widget {',
                '    [UnsafeBody]',
                '    public ~Widget() {',
                '        ' + keyword + '() {}',
                '        if (Value != 0) {',
                '            Value = 0;',
                '        }',
                '    }',
                '}'
            ].join('\n') + '\n';
            const filename = path.join(scratch, 'empty-condition-' + keyword + '.cvl');
            fs.writeFileSync(filename, source, 'utf8');
            const uri = vscode.Uri.file(filename);
            const { document, diagnostics } = await openAndAwaitDiagnostics(uri);
            const condition = source.indexOf(keyword + '()');
            const next = source.indexOf('if (Value != 0)', condition);
            const syntax = diagnostics.filter(isSyntaxDiagnostic);
            const roots = syntax.filter(d => {
                const offset = document.offsetAt(d.range.start);
                return offset >= condition && offset < next;
            });
            assert.equal(roots.length, 1,
                keyword + '(): expected exactly one condition error, got: ' + describe(diagnostics));
            assert.match(roots[0].message, /condition/i);
            assert.equal(document.offsetAt(roots[0].range.start), condition + keyword.length + 1);
            assert.equal(syntax.filter(d => document.offsetAt(d.range.start) >= next).length, 0,
                keyword + '(): next if should not inherit errors: ' + describe(diagnostics));
        });
    }

    for (const keyword of ['if', 'while']) {
        for (const [body, following] of [
            ['', 'while (false) {}'],
            [' {}', 'while (false) {}'],
            ['', 'if (true) {}'],
            ['', 'return;']
        ]) {
            test('control recovery: ' + keyword + '()' + body + ' / ' + following, async () => {
                const source = 'void Go() {\n    ' + keyword + '()' + body
                    + '\n    ' + following + '\n}\n';
                const filename = path.join(scratch, 'control-' + String(++counter) + '.cvl');
                fs.writeFileSync(filename, source, 'utf8');
                const uri = vscode.Uri.file(filename);
                const { document, diagnostics } = await openAndAwaitDiagnostics(uri);
                const start = source.indexOf(keyword + '()');
                const next = source.indexOf(following, start + keyword.length + 2);
                const syntax = diagnostics.filter(isSyntaxDiagnostic);
                const before = syntax.filter(d => {
                    const offset = document.offsetAt(d.range.start);
                    return offset >= start && offset < next;
                });
                assert.equal(before.length, 1,
                    keyword + '(): expected a single localized diagnostic\n' + describe(diagnostics));
                assert.match(before[0].message, /condition/i);
                assert.equal(document.offsetAt(before[0].range.start), start + keyword.length + 1);
                assert.equal(syntax.filter(d => document.offsetAt(d.range.start) >= next).length, 0,
                    keyword + '(): the following statement must be preserved\n' + describe(diagnostics));
            });
        }
    }

    for (const keyword of ['if', 'while']) {
        test('unterminated header ' + keyword + '( before while', async () => {
            const source = 'void Go() {\n    ' + keyword + '(\n    while (false) {}\n}\n';
            const filename = path.join(scratch, 'unterminated-' + String(++counter) + '.cvl');
            fs.writeFileSync(filename, source, 'utf8');
            const uri = vscode.Uri.file(filename);
            const { document, diagnostics } = await openAndAwaitDiagnostics(uri);
            const start = source.indexOf(keyword + '(');
            const next = source.indexOf('while (false)', start + keyword.length + 1);
            const syntax = diagnostics.filter(isSyntaxDiagnostic);
            const roots = syntax.filter(d => {
                const offset = document.offsetAt(d.range.start);
                return offset >= start && offset < next;
            });
            assert.equal(roots.length, 1, keyword + '(: expected one syntax error\n' + describe(diagnostics));
            assert.match(roots[0].message, /condition/i);
            assert.equal(syntax.filter(d => document.offsetAt(d.range.start) >= next).length, 0,
                keyword + '(: following while must stay valid\n' + describe(diagnostics));
        });
    }

    for (const [fragment, known] of [
        ['Widget', true], ['Widget x', true], ['Widget x =', true],
        ['Widget* x =', true], ['Widget? x =', true], ['Widget[] x =', true],
        ['NonexistentWidget x =', false]
    ]) {
        test('semantic token on recovered type head: ' + fragment, async () => {
            const source = 'public struct Widget { public int Value; }\nvoid Go() {\n    '
                + fragment + '\n    while (false) {}\n}\n';
            const filename = path.join(scratch, 'recover-type-' + String(++counter) + '.cvl');
            fs.writeFileSync(filename, source, 'utf8');
            const uri = vscode.Uri.file(filename);
            const { document } = await openAndAwaitDiagnostics(uri);
            const raw = await client.sendRequest('textDocument/semanticTokens/full', {
                textDocument: { uri: uri.toString() }
            });
            const start = source.indexOf('    ' + fragment) + 4;
            const typeText = fragment.split(/[ *?\[]/)[0];
            let line = 0, column = 0, found = false;
            for (let i = 0; i + 4 < (raw?.data?.length || 0); i += 5) {
                const deltaLine = raw.data[i];
                line += deltaLine;
                column = deltaLine ? raw.data[i + 1] : column + raw.data[i + 1];
                const at = document.offsetAt(new vscode.Position(line, column));
                if (at === start && document.getText().slice(at, at + raw.data[i + 2]) === typeText) {
                    // Types must not be downgraded to variable/function token kinds.
                    const tokenType = client.initializeResult?.capabilities?.semanticTokensProvider
                        ?.legend?.tokenTypes?.[raw.data[i + 3]];
                    found = ['class', 'struct', 'interface', 'enum', 'type', 'typeParameter'].includes(tokenType);
                }
            }
            assert.equal(found, known, fragment + ': expected real compiler-backed type semantic token');
        });
    }

    test('incomplete local at EOF yields a bounded diagnostic', async () => {
        const source = 'int main() {\n double';
        const filename = path.join(scratch, 'recovery-eof.cvl');
        fs.writeFileSync(filename, source, 'utf8');
        const uri = vscode.Uri.file(filename);
        const { document, diagnostics } = await openAndAwaitDiagnostics(uri);
        assert.ok(diagnostics.some(isSyntaxDiagnostic),
            'An unfinished declaration must be diagnosed: ' + describe(diagnostics));
        assert.ok(diagnostics.every(d => document.offsetAt(d.range.end) <= source.length),
            'A diagnostic must never extend past EOF: ' + describe(diagnostics));
    });

    test('missing field terminator keeps subsequent struct field', async () => {
        const source = 'struct Fields {\n double missing\n int afterProbe;\n}\nint main() { return 0; }\n';
        const filename = path.join(scratch, 'recovery-fields.cvl');
        fs.writeFileSync(filename, source, 'utf8');
        const uri = vscode.Uri.file(filename);
        const { document, diagnostics } = await openAndAwaitDiagnostics(uri);
        assert.ok(diagnostics.some(isSyntaxDiagnostic),
            'Expected missing field terminator: ' + describe(diagnostics));
        const tokens = await client.sendRequest('textDocument/semanticTokens/full', {
            textDocument: { uri: uri.toString() }
        });
        assert.ok(tokenTexts(document, tokens).includes('afterProbe'),
            'Malformed field must not hide the next field: ' + describe(diagnostics));
    });
});
