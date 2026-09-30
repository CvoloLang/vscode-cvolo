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

test('the extension advertises no semantic-token contributions', () => {
  assert.equal(pkg.contributes.semanticTokenScopes, undefined);
});

test('the theme keeps TextMate lexical colours and enables no semantic highlighting', () => {
  assert.equal(theme.semanticHighlighting, undefined);
  assert.equal(theme.semanticTokenColors, undefined);
  assert.ok(Array.isArray(theme.tokenColors) && theme.tokenColors.length > 0,
    'TextMate tokenColors must remain the theme colouring mechanism');
});

test('the theme colours the XML scopes emitted by the cvolo-project grammar', () => {
  const scopes = theme.tokenColors
    .flatMap(entry => (Array.isArray(entry.scope) ? entry.scope : [entry.scope]))
    .filter(scope => typeof scope === 'string');
  const covers = prefix => scopes.some(scope => scope === prefix || scope.startsWith(`${prefix}.`));
  assert.ok(covers('entity.name.tag'), 'XML tag names must be coloured for .cvlproj files');
  assert.ok(covers('entity.other.attribute-name'), 'XML attribute names must be coloured for .cvlproj files');
});

test('Marketplace-facing text makes no semantic-token claim', () => {
  assert.ok(!/semantic tokens?/i.test(readme),
    'README.md must not claim semantic-token support: the bundled Language Server does not advertise it');
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
