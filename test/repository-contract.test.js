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
  assert.match(extensionSource, /new LanguageClient\(\s*['"]cvolo['"]/s);
  assert.match(extensionSource, /documentSelector:\s*\[\{\s*scheme:\s*['"]file['"],\s*language:\s*['"]cvolo['"]\s*\}\]/s);
  assert.match(extensionSource, /connectionOptions:\s*\{\s*maxRestartCount:\s*0\s*\}/s);
  assert.match(extensionSource, /cvolo\.restartLanguageServer/);
});

test('server path and loose library path configuration changes schedule a restart', () => {
  assert.match(extensionSource, /affectsConfiguration\(['"]cvolo\.server\.path['"]\)/);
  assert.match(extensionSource, /affectsConfiguration\(['"]cvolo\.libraryPaths['"]\)/);
  assert.equal((extensionSource.match(/affectsConfiguration\(/g) || []).length, 2);
});