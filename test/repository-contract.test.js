'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extensionSource = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');

test('manifest uses canonical trace key and workspace-host contract', () => {
  const properties = pkg.contributes.configuration.properties;
  assert.ok(properties['cvolo.trace.server']);
  assert.deepEqual(properties['cvolo.trace.server'].enum, ['off', 'messages', 'verbose']);
  assert.equal(properties['cvolo.trace.server'].default, 'off');
  assert.equal(properties['cvolo.server.trace'], undefined);
  assert.deepEqual(pkg.extensionKind, ['workspace']);
  assert.equal(pkg.capabilities.virtualWorkspaces.supported, false);
  assert.ok(pkg.capabilities.virtualWorkspaces.description.trim());
});

test('extension keeps trace handling in vscode-languageclient', () => {
  assert.doesNotMatch(extensionSource, /setTrace\s*\(/);
  assert.doesNotMatch(extensionSource, /cvolo\.trace\.server/);
  assert.doesNotMatch(extensionSource, /cvolo\.server\.trace/);
  assert.doesNotMatch(extensionSource, /--verbose/);
});

test('LanguageClient id, selector, crash policy and restart command are canonical', () => {
  assert.match(extensionSource, /new (?:Cvolo)?LanguageClient\(\s*['"]cvolo['"]/s);
  assert.match(extensionSource, /documentSelector:\s*\[\{\s*scheme:\s*['"]file['"],\s*language:\s*['"]cvolo['"]\s*\}\]/s);
  assert.match(extensionSource, /connectionOptions:\s*\{\s*maxRestartCount:\s*0\s*\}/s);
  assert.match(extensionSource, /cvolo\.restartLanguageServer/);
});

test('server path and loose library path configuration changes schedule a restart', () => {
  assert.match(extensionSource, /affectsConfiguration\(['"]cvolo\.server\.path['"]\)/);
  assert.match(extensionSource, /affectsConfiguration\(['"]cvolo\.libraryPaths['"]\)/);
  assert.equal((extensionSource.match(/affectsConfiguration\(/g) || []).length, 2);
});

test('extracted package sources are marked read-only', () => {
  const readonlyInclude = pkg.contributes.configurationDefaults?.['files.readonlyInclude'];
  assert.equal(readonlyInclude?.['**/.cvolo/build/**'], true);
});

test('word-based suggestions are disabled for Cvolo so only compiler-owned items appear', () => {
  const languageDefaults = pkg.contributes.configurationDefaults?.['[cvolo]'];
  assert.equal(languageDefaults?.['editor.wordBasedSuggestions'], 'off');
  assert.equal(languageDefaults?.['editor.suggest.showWords'], false);
});

test('semantic tokens are applied for Cvolo without selecting the bundled theme', () => {
  // The workbench only applies a document semantic tokens provider when
  // editor.semanticHighlighting.enabled is a boolean; "configuredByTheme" defers to the
  // active theme, and a theme without "semanticHighlighting": true paints nothing.
  const languageDefaults = pkg.contributes.configurationDefaults?.['[cvolo]'];
  assert.equal(languageDefaults?.['editor.semanticHighlighting.enabled'], true);
});

test('custom semantic token modifiers stay legible without selecting the bundled theme', () => {
  const rules = pkg.contributes.configurationDefaults?.['editor.semanticTokenColorCustomizations']?.rules;
  assert.equal(rules?.['function.cvoloExternFunction:cvolo'], '#D7A0FF');
  assert.equal(rules?.['variable.cvoloConstant:cvolo'], '#4FC1FF');
});

test('qualified call highlighting separates member dots from namespace identifiers', () => {
  const syntax = JSON.parse(fs.readFileSync(path.join(root, 'syntaxes', 'cvolo.tmLanguage.json'), 'utf8'));
  const entry = syntax.repository['qualified-function-calls'].patterns[0];
  assert.equal(entry.name, 'entity.name.namespace.cvolo');
  const regex = new RegExp(entry.match, 'g');
  const source = 'window.IsInit() + System.Math.Float.Cos(value)';
  const matches = [...source.matchAll(regex)].map(match => match[0]);
  assert.deepEqual(matches, ['window', 'System', 'Math', 'Float']);
  assert.ok(matches.every(name => !name.includes('.')));
});

test('Cvolo keeps automatic parameter hints and language-defined closing pairs enabled', () => {
  const defaults = pkg.contributes.configurationDefaults['[cvolo]'];
  const configuration = JSON.parse(fs.readFileSync(path.join(root, 'language-configuration.json'), 'utf8'));
  assert.equal(defaults['editor.parameterHints.enabled'], true);
  assert.equal(defaults['editor.autoClosingBrackets'], 'languageDefined');
  assert.equal(defaults['editor.autoClosingQuotes'], 'languageDefined');
  for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}'], ['"', '"']]) {
    assert.ok(configuration.autoClosingPairs.some(pair => pair.open === open && pair.close === close),
      `Cvolo must auto-close ${open} with ${close}`);
  }
});
