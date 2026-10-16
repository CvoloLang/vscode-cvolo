'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const theme = JSON.parse(fs.readFileSync(path.join(root, 'themes', 'cvolo-vs2019-dark.json'), 'utf8'));
const readme = fs.readFileSync(path.join(root, 'README.md'), 'utf8');

test('publisher, name and version are the frozen Marketplace identity', () => {
  assert.equal(pkg.publisher, 'cvololang');
  assert.equal(pkg.name, 'cvolo-language');
  assert.equal(pkg.version, '0.1.2');
  assert.equal(pkg.engines.vscode, '^1.82.0');
});

test('the extension does not need a static semantic-scope map because the server supplies the legend', () => {
  assert.equal(pkg.contributes.semanticTokenScopes, undefined);
});

test('the theme enables semantic highlighting for the language-server token types', () => {
  assert.equal(theme.semanticHighlighting, true,
    'semantic highlighting must be on so the language server can refine TextMate colours');
  assert.equal(typeof theme.semanticTokenColors, 'object');
  assert.ok(theme.semanticTokenColors !== null);
  for (const tokenType of ['namespace', 'typeParameter', 'parameter', 'variable', 'property', 'enumMember', 'function', 'method', 'operator', 'keyword']) {
    assert.ok(Object.prototype.hasOwnProperty.call(theme.semanticTokenColors, tokenType),
      `semanticTokenColors must colour the '${tokenType}' token type`);
  }
});

test('the theme distinguishes compiler-proven constants from ordinary variables', () => {
  const colours = theme.semanticTokenColors;
  assert.ok(Object.prototype.hasOwnProperty.call(colours, 'variable:readonly:static'),
    'the theme must colour immutable globals (variable:readonly:static) as constants for standards-only clients');
  assert.ok(Object.prototype.hasOwnProperty.call(colours, 'variable:cvoloConstant'),
    'the theme must colour the negotiated cvoloConstant modifier where a client advertises it');
});

test('the theme colours imported extern functions without recolouring the extern keyword', () => {
  const colours = theme.semanticTokenColors;
  assert.ok(Object.prototype.hasOwnProperty.call(colours, 'function:cvoloExternFunction'),
    'the theme must colour the negotiated cvoloExternFunction modifier where a client advertises it');
  assert.equal(colours['function:cvoloExternFunction'], '#D7A0FF',
    'imported extern functions must render in the light-violet accent');
  assert.equal(colours.function, '#DCDCAA',
    'ordinary functions must keep the yellow accent');
  assert.equal(colours.keyword, '#569CD6',
    'the extern keyword must keep its ordinary blue keyword colour');
});

test('the theme keeps TextMate lexical colours as a grammar-based fallback', () => {
  assert.ok(Array.isArray(theme.tokenColors) && theme.tokenColors.length > 0,
    'TextMate tokenColors remain the fallback colouring mechanism without the language server');
});

test('the theme colours the XML scopes emitted by the cvolo-project grammar', () => {
  const scopes = theme.tokenColors
    .flatMap(entry => (Array.isArray(entry.scope) ? entry.scope : [entry.scope]))
    .filter(scope => typeof scope === 'string');
  const covers = prefix => scopes.some(scope => scope === prefix || scope.startsWith(`${prefix}.`));
  assert.ok(covers('entity.name.tag'), 'XML tag names must be coloured for .cvlproj files');
  assert.ok(covers('entity.other.attribute-name'), 'XML attribute names must be coloured for .cvlproj files');
});

test('the theme and the extension agree that the language server owns semantic classification', () => {
  // The server advertises textDocument/semanticTokens/full backed by the compiler
  // semantic model, so the README may describe semantic highlighting truthfully.
  assert.equal(theme.semanticHighlighting, true);
});

test('the extension is presented as an early pre-release', () => {
  assert.match(pkg.description, /pre-?release/i);
  assert.match(readme, /pre-?release/i);
});

test('repository metadata points at the vscode-cvolo repository', () => {
  assert.equal(pkg.repository.type, 'git');
  assert.match(pkg.repository.url, /github\.com\/CvoloLang\/vscode-cvolo/);
});

test('the cvolo language contributes bundled light and dark file icons', () => {
  const language = pkg.contributes.languages.find(item => item.id === 'cvolo');
  assert.ok(language?.icon, 'cvolo language must contribute an icon');
  assert.equal(pkg.contributes.iconThemes, undefined,
    'a default language icon must not introduce a custom file icon theme');
  for (const variant of ['light', 'dark']) {
    const rel = language.icon[variant];
    assert.equal(typeof rel, 'string');
    assert.match(rel, /^\.\/images\//, `${variant} icon must live under images/`);
    assert.ok(fs.existsSync(path.join(root, rel)), `${variant} icon file must exist: ${rel}`);
  }
});

test('the cvolo-project language contributes a distinct icon and an XML grammar', () => {
  const language = pkg.contributes.languages.find(item => item.id === 'cvolo-project');
  assert.ok(language, 'cvolo-project language must be contributed');
  assert.deepEqual(language.extensions, ['.cvlproj']);
  assert.ok(language.icon, 'cvolo-project must contribute an icon');
  for (const variant of ['light', 'dark']) {
    const rel = language.icon[variant];
    assert.match(rel, /^\.\/images\//, `${variant} icon must live under images/`);
    assert.ok(fs.existsSync(path.join(root, rel)), `${variant} icon file must exist: ${rel}`);
  }
  const grammar = pkg.contributes.grammars.find(item => item.language === 'cvolo-project');
  assert.ok(grammar, 'cvolo-project grammar must be contributed');
  assert.equal(grammar.scopeName, 'source.cvolo-project');
  const source = fs.readFileSync(path.join(root, grammar.path.replace(/^\.\//, '')), 'utf8');
  assert.match(source, /text\.xml/, 'cvolo-project grammar must defer to the built-in XML grammar');
});

test('the cvolo-layout language contributes a distinct icon', () => {
  const language = pkg.contributes.languages.find(item => item.id === 'cvolo-layout');
  assert.ok(language, 'cvolo-layout language must be contributed');
  assert.deepEqual(language.extensions, ['.cvlayout']);
  assert.ok(language.icon, 'cvolo-layout must contribute an icon');
  for (const variant of ['light', 'dark']) {
    const rel = language.icon[variant];
    assert.match(rel, /^\.\/images\//, `${variant} icon must live under images/`);
    assert.ok(fs.existsSync(path.join(root, rel)), `${variant} icon file must exist: ${rel}`);
  }
});
