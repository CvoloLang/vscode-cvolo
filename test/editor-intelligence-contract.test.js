'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const extensionSource = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
const runtimeSource = fs.readFileSync(path.join(root, 'extension-runtime.js'), 'utf8');
const editorIntelligenceSource = fs.readFileSync(path.join(root, 'editor-intelligence.js'), 'utf8');

const decorationDefaults = {
  'cvolo.codeLens.references': true,
  'cvolo.codeLens.layout': true,
  'cvolo.codeLens.fields': false,
  'cvolo.codeLens.fieldReferences': true,
  'cvolo.codeLens.fieldLayout': true,
  'cvolo.codeLens.nativeInterop': true,
  'cvolo.inlayHints.types': true,
  'cvolo.inlayHints.parameters': true,
  'cvolo.inlayHints.receiverMutability': true,
  'cvolo.inlayHints.layout': false,
  'cvolo.inlayHints.enumValues': false,
  'cvolo.inlayHints.genericArguments': false
};

const layoutViewDefaults = {
  'cvolo.layout.showPaddingPercentage': false,
  'cvolo.layout.autoRefresh': true
};

test('every documented decoration setting is contributed with its default', () => {
  const properties = pkg.contributes.configuration.properties;

  for (const [key, expected] of Object.entries(decorationDefaults)) {
    assert.equal(properties[key]?.type, 'boolean', key);
    assert.equal(properties[key]?.default, expected, key);
    assert.equal(properties[key]?.scope, 'window', key);
    assert.ok(properties[key]?.description.trim().length > 0, key);
  }
});

test('the earlier per-member setting is replaced by the field master gate and its two sub-settings', () => {
  const properties = pkg.contributes.configuration.properties;

  assert.equal('cvolo.codeLens.members' in properties, false);
  assert.equal(properties['cvolo.codeLens.fields'].default, false);
  assert.match(properties['cvolo.codeLens.fields'].description, /master switch/i);
  assert.match(properties['cvolo.codeLens.fieldReferences'].description, /cvolo\.codeLens\.fields/);
  assert.match(properties['cvolo.codeLens.fieldLayout'].description, /cvolo\.codeLens\.fields/);
});

test('the offset notation is a three-valued choice, not a boolean', () => {
  const setting = pkg.contributes.configuration.properties['cvolo.layout.offsetFormat'];

  assert.equal(setting.type, 'string');
  assert.equal(setting.default, 'decimal');
  assert.deepEqual(setting.enum, ['decimal', 'hex', 'decimalAndHex']);
  assert.equal(setting.scope, 'window');
  assert.ok(setting.description.trim().length > 0);
});

test('every documented layout view setting is contributed with its default', () => {
  const properties = pkg.contributes.configuration.properties;

  for (const [key, expected] of Object.entries(layoutViewDefaults)) {
    assert.equal(properties[key]?.type, 'boolean', key);
    assert.equal(properties[key]?.default, expected, key);
    assert.equal(properties[key]?.scope, 'window', key);
    assert.ok(properties[key]?.description.trim().length > 0, key);
  }
});

test('decoration settings are synchronized so a change needs no restart', () => {
  assert.match(extensionSource, /synchronize:\s*\{\s*configurationSection:\s*'cvolo'\s*\}/s);
  assert.equal((extensionSource.match(/affectsConfiguration\(/g) || []).length, 2);
});

test('the reference lens bridge stays a CodeLens command', () => {
  const commands = pkg.contributes.commands.map(command => command.command);
  assert.ok(commands.includes('cvolo.showTypeLayout'));
  assert.equal(commands.includes('cvolo.showReferences'), false);

  const palette = pkg.contributes.menus.commandPalette.map(entry => entry.command);
  assert.deepEqual(palette, ['cvolo.showTypeLayout']);
  assert.equal(palette.includes('cvolo.showReferences'), false);

  assert.match(editorIntelligenceSource, /registerCommand\(SHOW_REFERENCES_COMMAND/);
  assert.match(editorIntelligenceSource, /executeCommand\(REFERENCE_PROVIDER_COMMAND, uri, position\)/);
  assert.match(editorIntelligenceSource, /executeCommand\(SHOW_REFERENCES_EDITOR_COMMAND, uri, position, results\)/);
});

test('Show Type Layout is reachable from the palette, the lens and the editor context menu', () => {
  const command = pkg.contributes.commands.find(item => item.command === 'cvolo.showTypeLayout');
  assert.equal(command.title, 'Cvolo: Show Type Layout');

  const palette = pkg.contributes.menus.commandPalette.find(item => item.command === 'cvolo.showTypeLayout');
  assert.equal(palette.when, 'editorLangId == cvolo');

  const context = pkg.contributes.menus['editor/context'].find(item => item.command === 'cvolo.showTypeLayout');
  assert.equal(context.when, 'editorLangId == cvolo');

  assert.match(editorIntelligenceSource, /registerCommand\(SHOW_TYPE_LAYOUT_COMMAND/);
  assert.match(editorIntelligenceSource, /sendRequest\(TYPE_LAYOUT_REQUEST, typeLayoutRequestParams\(target\)\)/);
});

test('the layout view is a read-only virtual document owned by the extension', () => {
  assert.match(editorIntelligenceSource, /registerTextDocumentContentProvider\(LAYOUT_SCHEME/);
  assert.match(editorIntelligenceSource, /documents\.set\(uri\.toString\(\), formatTypeLayout\(layout\)\)/);
  assert.match(editorIntelligenceSource, /vscode\.ViewColumn\.Beside/);
});

test('the layout view renders compiler facts and never computes them', () => {
  const runtime = require('../editor-intelligence-runtime');
  const layout = runtime.normalizeTypeLayout({
    typeDisplay: 'Value',
    targetDisplay: 'x86_64-pc-windows-msvc',
    size: 24,
    alignment: 8,
    payloadSize: 13,
    paddingSize: 11,
    stride: null,
    elementCount: null,
    elementSize: null,
    elementAlignment: null,
    members: [{ name: 'Kind', typeDisplay: 'int', offset: 0, size: 4, alignment: 4 }],
    padding: [{ offset: 4, size: 4, kind: 'internal' }]
  });

  const text = runtime.formatTypeLayout(layout);
  assert.match(text, /^Value$/m);
  assert.match(text, /^Target: x86_64-pc-windows-msvc$/m);
  assert.ok(text.split('\n').includes('4       4     -      <padding>'));
  assert.doesNotMatch(editorIntelligenceSource, /payloadSize\s*[-+*/]/);
  assert.doesNotMatch(editorIntelligenceSource, /\bsize\s*[-+*/]/);
});

test('the editor bridge reaches the running language client', () => {
  assert.match(extensionSource, /registerEditorIntelligence\(context/);
  assert.match(extensionSource, /getClient:\s*\(\)\s*=>\s*lifecycle\?\.client/);
  assert.match(runtimeSource, /get client\(\)\s*\{\s*return this\._client;/);
});
