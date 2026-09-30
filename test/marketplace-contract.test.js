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
  assert.equal(pkg.version, '0.1.1');
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
