'use strict';

// Real extension-host contract tests. These load the extension inside VS Code and
// assert the parts of the contract the public API can observe: activation, the
// registered command surface, the manifest contribution set, the cvolo language id,
// and that the host accepts decoration work on a cvolo document.
//
// VS Code deliberately exposes no API for reading back applied decorations, so the
// exact painted ranges of the syntax/brace colorizers cannot be asserted here; that
// half stays pinned by the pure runtime scanner tests in test/syntax-colorizer-runtime.test.js
// and test/brace-colorizer-runtime.test.js, and by test/colorizer-performance.test.js.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vscode = require('vscode');

const EXTENSION_ID = 'cvololang.cvolo-language';
const root = path.resolve(__dirname, '..', '..');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Waits for the language client to reach a running state and returns it.
async function runningClient() {
    const extension = vscode.extensions.getExtension(EXTENSION_ID);
    const api = await extension.activate();
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
        const client = api.getClient();
        if (client && client.isRunning()) {
            return client;
        }
        await delay(250);
    }
    throw new Error('the language client must reach a running state');
}

// Flattens the Hover[] result of the executeHoverProvider command into plain text.
function hoverText(hovers) {
    const parts = [];
    for (const hover of hovers || []) {
        const contents = Array.isArray(hover.contents) ? hover.contents : [hover.contents];
        for (const entry of contents) {
            if (typeof entry === 'string') {
                parts.push(entry);
            } else if (entry && typeof entry.value === 'string') {
                parts.push(entry.value);
            }
        }
    }
    return parts.join('\n');
}

function completionLabels(list) {
    return (list.items || []).map(item => (typeof item.label === 'string' ? item.label : item.label.label));
}

suite('Cvolo extension host contract', () => {
    test('the extension is present and activates inside VS Code', async () => {
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        assert.ok(extension, `extension ${EXTENSION_ID} must be installed in the host`);
        await extension.activate();
        assert.equal(extension.isActive, true);
    });

    test('brings the language client up to a running state', async () => {
        // Regression guard: the anchored-lens capability is contributed as a registered
        // feature. If that feature is not a complete Feature (initialize/clear/dispose),
        // LanguageClient.start() throws and the client never runs — a failure the other
        // host tests, which only assert activation and the command surface, cannot see.
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        const api = await extension.activate();
        assert.equal(typeof api.getClient, 'function', 'the extension must expose getClient for the host contract');

        const deadline = Date.now() + 45000;
        let client;
        while (Date.now() < deadline) {
            client = api.getClient();
            if (client && client.isRunning()) {
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 250));
        }

        assert.ok(client, 'a language client must be created during activation');
        assert.equal(client.isRunning(), true, 'the language client must reach a running state after start()');
        assert.ok(client.initializeResult, 'the client must complete the initialize handshake');
    });

    test('registers the restart, layout, anchored-lens and diagnostic-log commands', async () => {
        const commands = await vscode.commands.getCommands(true);
        for (const id of ['cvolo.restartLanguageServer', 'cvolo.showTypeLayout', 'cvolo.executeAnchoredLens', 'cvolo.openDiagnosticLog']) {
            assert.ok(commands.includes(id), `command ${id} must be registered in the host`);
        }
    });

    test('contributes only the restart, layout and diagnostic-log commands, never the legacy references command', () => {
        const contributed = (packageJson.contributes.commands || []).map(entry => entry.command).sort();
        assert.deepEqual(contributed, ['cvolo.openDiagnosticLog', 'cvolo.restartLanguageServer', 'cvolo.showTypeLayout']);
        assert.ok(!contributed.includes('cvolo.showReferences'),
            'cvolo.showReferences must never be a palette command');
    });

    test('the anchored lens command leaves malformed payloads inert without throwing', async () => {
        // The handler must fail closed: it must not throw, must not navigate, and
        // must not fall back to the legacy positional reference path.
        await vscode.commands.executeCommand('cvolo.executeAnchoredLens', 42);
        await vscode.commands.executeCommand('cvolo.executeAnchoredLens', {
            schemaVersion: 2,
            lensToken: 'stale',
            wireUri: 'file:///does-not-exist.cvl'
        });
    });

    test('opens a workspace document with the contributed cvolo language id', async () => {
        const file = path.join(__dirname, '..', 'fixtures', 'workspace', 'sample.cvl');
        const document = await vscode.workspace.openTextDocument(file);
        assert.equal(document.languageId, 'cvolo');
        assert.ok(document.getText().includes('struct Header'));
    });

    test('accepts decoration ranges on a cvolo document', async () => {
        const file = path.join(__dirname, '..', 'fixtures', 'workspace', 'sample.cvl');
        const document = await vscode.workspace.openTextDocument(file);
        const editor = await vscode.window.showTextDocument(document);
        assert.equal(editor.document.languageId, 'cvolo');

        const decorationType = vscode.window.createTextEditorDecorationType({ color: '#abcdef' });
        try {
            const ranges = [new vscode.Range(0, 0, 0, Math.min(6, document.lineAt(0).text.length))];
            editor.setDecorations(decorationType, ranges);
            assert.ok(vscode.window.visibleTextEditors.some(
                candidate => candidate.document.uri.toString() === document.uri.toString()),
                'the cvolo editor must be visible in the host');
        } finally {
            decorationType.dispose();
        }
    });

    test('normal typing surfaces no request-failure notifications', async () => {
        // Regression guard for INC 3 (Stable Editor Intelligence): a stale semantic-token
        // result must be answered with LSP ContentModified (-32801), which the language
        // client treats as a silent cancellation. A RequestFailed (-32803) instead writes
        // `[Error …] Request textDocument/semanticTokens/full failed.` to the client output
        // channel and pops a user-visible error notification. Normal typing must produce neither.
        const extension = vscode.extensions.getExtension(EXTENSION_ID);
        const api = await extension.activate();
        const client = api.getClient();
        assert.ok(client && client.isRunning(), 'the language client must be running before typing');

        const logged = [];
        const channel = client.outputChannel;
        const originalAppend = channel && typeof channel.appendLine === 'function'
            ? channel.appendLine.bind(channel)
            : undefined;
        if (originalAppend) {
            channel.appendLine = value => {
                logged.push(String(value));
                return originalAppend(value);
            };
        }

        const notified = [];
        let restoreShowError = () => {};
        try {
            const originalShowError = vscode.window.showErrorMessage;
            vscode.window.showErrorMessage = message => {
                notified.push(String(message));
                return Promise.resolve(undefined);
            };
            restoreShowError = () => { vscode.window.showErrorMessage = originalShowError; };
        } catch {
            // Not writable in this host build; the output-channel capture above still covers the log line.
        }

        try {
            const file = path.join(__dirname, '..', 'fixtures', 'workspace', 'sample.cvl');
            const document = await vscode.workspace.openTextDocument(file);
            const editor = await vscode.window.showTextDocument(document);

            // A rapid burst of edits widens the window in which an in-flight semantic-token
            // request is superseded by newer input — exactly the path that used to surface
            // a -32803 notification.
            for (let i = 0; i < 8; i++) {
                await editor.edit(builder => builder.insert(new vscode.Position(0, 0), ' '));
                await new Promise(resolve => setTimeout(resolve, 25));
            }
            // Let the server answer the trailing requests against the latest version.
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Leave the on-disk fixture untouched (the document was never saved).
            for (let i = 0; i < 20 && document.isDirty; i++) {
                await vscode.commands.executeCommand('undo');
            }
        } finally {
            if (originalAppend) {
                channel.appendLine = originalAppend;
            }
            restoreShowError();
        }

        const loggedFailures = logged.filter(line => /Request .* failed|semanticTokens.*fail/i.test(line));
        assert.deepEqual(loggedFailures, [],
            `normal typing must not log request failures (full log: ${JSON.stringify(logged)})`);
        assert.deepEqual(notified, [],
            `normal typing must not raise error notifications: ${JSON.stringify(notified)}`);
    });

    test('negotiates the initializer trigger characters on the running server', async () => {
        // WIRE-017 / INIT-026: the running server must advertise field-completion triggers
        // for the initializer context; the host reads them from the real initialize result.
        const client = await runningClient();
        const triggerCharacters = (client.initializeResult.capabilities.completionProvider || {}).triggerCharacters || [];
        for (const trigger of ['{', ',', '.']) {
            assert.ok(triggerCharacters.includes(trigger),
                `the server must advertise '${trigger}' as a completion trigger (got ${JSON.stringify(triggerCharacters)})`);
        }
    });

    test('hover reports the typed local and its type for an incomplete initializer', async () => {
        // HOV-002/HOV-003 host evidence: `Window windo` must render the type and the local
        // distinctly, and the local must not be displayed as a parameter or a bare `int`.
        const file = path.join(__dirname, '..', 'fixtures', 'workspace', 'window-initializer.cvl');
        const document = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(document);
        await runningClient();
        await delay(2000);

        const text = document.getText();
        const localPosition = document.positionAt(text.indexOf('windo') + 1);
        const localHovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, localPosition);
        const localText = hoverText(localHovers);
        assert.match(localText, /Window windo/,
            `hover on the local must report 'Window windo' (got ${JSON.stringify(localText)})`);
        assert.ok(!/\bint windo\b/.test(localText),
            `hover on the local must never report 'int windo' (got ${JSON.stringify(localText)})`);

        const typePosition = document.positionAt(text.indexOf('Window') + 1);
        const typeHovers = await vscode.commands.executeCommand('vscode.executeHoverProvider', document.uri, typePosition);
        const typeText = hoverText(typeHovers);
        assert.match(typeText, /struct Window/,
            `hover on the type must report 'struct Window' (got ${JSON.stringify(typeText)})`);
    });

    test('completion inside an aggregate literal lists the struct fields', async () => {
        // INIT-021/WIRE-010 host evidence: an incomplete `Window {` still offers the
        // resolved struct's fields and never an unrelated free function.
        const file = path.join(__dirname, '..', 'fixtures', 'workspace', 'window-initializer.cvl');
        const document = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(document);
        await runningClient();
        await delay(2000);

        const text = document.getText();
        const brace = text.indexOf('{', text.indexOf('Window windo'));
        const innerIndex = text.indexOf('\n\n', brace) + 1;
        const position = document.positionAt(innerIndex);

        const list = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider', document.uri, position);
        const labels = completionLabels(list);
        assert.ok(labels.includes('Ptr'),
            `the field 'Ptr' must be offered (got ${JSON.stringify(labels)})`);
        assert.ok(labels.includes('Width'),
            `the field 'Width' must be offered (got ${JSON.stringify(labels)})`);
        assert.ok(!labels.includes('getchar'),
            `unrelated free functions must never be offered (got ${JSON.stringify(labels)})`);
    });

    test('built-in type names are offered while typing a declaration', async () => {
        const file = path.join(__dirname, '..', 'fixtures', 'workspace', 'type-completion.cvl');
        const document = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(document);
        await runningClient();
        await delay(2000);

        const text = document.getText();
        const at = text.indexOf('i\n') + 1;
        const position = document.positionAt(at);

        const list = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider', document.uri, position);
        const labels = completionLabels(list);
        assert.ok(labels.includes('int'),
            `the built-in type 'int' must be offered (got ${JSON.stringify(labels)})`);
        assert.ok(labels.includes('if'),
            `the keyword 'if' must still be offered (got ${JSON.stringify(labels)})`);
        assert.ok(!labels.includes('getchar'),
            `unrelated free functions must never be offered (got ${JSON.stringify(labels)})`);
    });

    test('a generic type argument offers type names and not statement keywords', async () => {
        const file = path.join(__dirname, '..', 'fixtures', 'workspace', 'generic-type-completion.cvl');
        const document = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(document);
        await runningClient();
        await delay(2000);

        const text = document.getText();
        const marker = 'Option<i';
        const at = text.indexOf(marker) + marker.length;
        const position = document.positionAt(at);

        const list = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider', document.uri, position);
        const labels = completionLabels(list);
        assert.ok(labels.includes('int'),
            `the type 'int' must be offered inside a generic argument (got ${JSON.stringify(labels)})`);
        assert.ok(!labels.includes('if'),
            `statement keywords must not leak into a generic argument (got ${JSON.stringify(labels)})`);
    });

    test('a typed prefix offers only compiler items and never a bare document word', async () => {
        // Word-based suggestions would inject the raw word (here the lone `i`, which the
        // fixture comments and code contain) into the completion list. The contributed
        // [cvolo] defaults must keep the list compiler-owned.
        const file = path.join(__dirname, '..', 'fixtures', 'workspace', 'type-completion.cvl');
        const document = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(document);
        await runningClient();
        await delay(2000);

        const text = document.getText();
        const at = text.indexOf('i\n') + 1;
        const position = document.positionAt(at);

        const list = await vscode.commands.executeCommand(
            'vscode.executeCompletionItemProvider', document.uri, position);
        const labels = completionLabels(list);
        const wordItems = (list.items || [])
            .filter(item => item.kind === vscode.CompletionItemKind.Text)
            .map(item => (typeof item.label === 'string' ? item.label : item.label.label));
        assert.deepEqual(wordItems, [],
            `word-based suggestions must never reach the suggestion list (got ${JSON.stringify(wordItems)})`);
        assert.ok(!labels.includes('i'),
            `a bare 'i' item must never be offered (got ${JSON.stringify(labels)})`);
        assert.ok(labels.includes('int') && labels.includes('if'),
            `compiler items must still be offered (got ${JSON.stringify(labels)})`);
    });

    test('the effective Cvolo editor defaults keep completion and semantic tokens enabled', async () => {
        const file = path.join(__dirname, '..', 'fixtures', 'workspace', 'type-completion.cvl');
        const document = await vscode.workspace.openTextDocument(file);
        const editor = vscode.workspace.getConfiguration('editor', { languageId: 'cvolo', uri: document.uri });
        assert.equal(editor.get('wordBasedSuggestions'), 'off',
            'word-based suggestions must be off for cvolo documents');
        assert.equal(editor.get('suggest')?.showWords, false,
            'word items must be hidden for cvolo documents');
        assert.equal(editor.get('semanticHighlighting')?.enabled, true,
            'semantic highlighting must not defer to the active theme for cvolo documents');
        const rules = editor.get('semanticTokenColorCustomizations')?.rules || {};
        assert.equal(rules['function.cvoloExternFunction:cvolo'], '#D7A0FF',
            'imported extern functions must resolve to the light-violet accent without the bundled theme');
        assert.equal(rules['variable.cvoloConstant:cvolo'], '#4FC1FF',
            'compiler-proven constants must resolve to the constant accent without the bundled theme');
    });

    test('the running server marks imported extern functions and their calls', async () => {
        // End-to-end guard for the extern presentation: the legend the real client received
        // must carry the compiler modifier, and the tokens the real server returns for a
        // standalone variadic extern declaration and its call sites must set that modifier
        // (the declaration also carries `declaration`; an ordinary function carries neither).
        const client = await runningClient();
        const legend = client.initializeResult.capabilities.semanticTokensProvider.legend;
        const externBit = legend.tokenModifiers.indexOf('cvoloExternFunction');
        assert.ok(externBit >= 0,
            `the negotiated legend must carry cvoloExternFunction (got ${JSON.stringify(legend.tokenModifiers)})`);

        const file = path.join(__dirname, '..', 'fixtures', 'workspace', 'extern-colour.cvl');
        const document = await vscode.workspace.openTextDocument(file);
        await vscode.window.showTextDocument(document);
        await delay(2000);

        const result = await client.sendRequest('textDocument/semanticTokens/full', {
            textDocument: { uri: document.uri.toString() }
        });
        const text = document.getText();
        const decoded = [];
        let line = 0;
        let start = 0;
        const raw = (result && result.data) || [];
        for (let index = 0; index + 4 < raw.length; index += 5) {
            line += raw[index];
            start = raw[index] === 0 ? start + raw[index + 1] : raw[index + 1];
            const range = new vscode.Range(line, start, line, start + raw[index + 2]);
            decoded.push({
                text: text.slice(document.offsetAt(range.start), document.offsetAt(range.end)),
                type: legend.tokenTypes[raw[index + 3]],
                modifiers: raw[index + 4],
                declaration: (raw[index + 4] & (1 << legend.tokenModifiers.indexOf('declaration'))) !== 0
            });
        }

        const externMask = 1 << externBit;
        const printf = decoded.filter(entry => entry.text === 'printf');
        const getchar = decoded.filter(entry => entry.text === 'getchar');
        assert.equal(printf.length, 2, `printf must be classified at its declaration and call (got ${JSON.stringify(decoded)})`);
        assert.equal(getchar.length, 2, `getchar must be classified at its declaration and call (got ${JSON.stringify(decoded)})`);
        assert.ok(printf.every(entry => entry.type === 'function') && getchar.every(entry => entry.type === 'function'),
            `extern semantic tokens must be functions (got ${JSON.stringify({printf, getchar})})`);
        assert.ok(printf.every(entry => (entry.modifiers & externMask) !== 0),
            `both printf sites must carry cvoloExternFunction (got ${JSON.stringify(printf)})`);
        assert.ok(getchar.every(entry => (entry.modifiers & externMask) !== 0),
            `both getchar sites must carry cvoloExternFunction (got ${JSON.stringify(getchar)})`);
        assert.ok(printf.some(entry => entry.declaration) && getchar.some(entry => entry.declaration),
            'the extern declarations must still be marked as declarations');
        const main = decoded.filter(entry => entry.text === 'main');
        assert.ok(main.length > 0 && main.every(entry => (entry.modifiers & externMask) === 0),
            `an ordinary function must never carry the extern modifier (got ${JSON.stringify(main)})`);
    });
});
