'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');
const extensionSource = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

test('library paths are contributed and forwarded during initialize', () => {
  const setting = packageJson.contributes.configuration.properties['cvolo.libraryPaths'];
  assert.equal(setting.type, 'array');
  assert.equal(setting.items.type, 'string');
  assert.deepEqual(setting.default, []);
  assert.equal(setting.scope, 'window');
  assert.match(setting.description, /loose Cvolo workspaces only/);
  assert.match(setting.description, /top-level \.cvlib files/);
  assert.match(setting.description, /ignored for manifest-backed \.cvlproj projects/);
  assert.match(extensionSource, /initializationOptions:\s*\{\s*libraryPaths:\s*configuredLibraryPaths\(\)/s);
});

test('changing library paths restarts the language server', () => {
  assert.match(extensionSource, /affectsConfiguration\(['"]cvolo\.libraryPaths['"]\)/);
  assert.match(extensionSource, /cvolo\.libraryPaths changed/);
});
