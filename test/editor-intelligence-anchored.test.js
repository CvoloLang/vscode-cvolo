'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../editor-intelligence-runtime');

const root = path.resolve(__dirname, '..');

const LAYOUT = {
  typeDisplay: 'Header',
  targetDisplay: 'x86_64-pc-windows-msvc',
  size: 8,
  alignment: 4,
  members: [
    { name: 'Kind', typeDisplay: 'int', offset: 0, size: 4, alignment: 4 }
  ],
  padding: []
};

test('the anchored wire names are pinned on the client side', () => {
  // These literals are the client half of the wire contract; the server half asserts the same names.
  assert.equal(runtime.EXECUTE_ANCHORED_LENS_COMMAND, 'cvolo.executeAnchoredLens');
  assert.equal(runtime.RESOLVE_ANCHORED_LENS_REQUEST, 'cvolo.resolveAnchoredLens.v3');
  assert.equal(runtime.VALIDATE_ANCHORED_ACTION_REQUEST, 'cvolo/validateAnchoredAction.v3');
  assert.equal(runtime.ANCHORED_LENS_SCHEMA_VERSION, 3);
  assert.equal(runtime.ANCHORED_ACTION_KIND_SHOW_REFERENCES, 'ShowReferences');
  assert.equal(runtime.ANCHORED_ACTION_KIND_SHOW_LAYOUT, 'ShowLayout');
  assert.equal(runtime.ANCHORED_ACTION_KIND_UNAVAILABLE, 'Unavailable');
});

test('a lens payload is forwarded verbatim as an opaque v3 token', () => {
  const request = runtime.anchoredLensRequest([
    { schemaVersion: 3, lensToken: 'abc123', wireUri: 'file:///a.cvl' }
  ]);

  assert.deepEqual(request, {
    schemaVersion: 3,
    lensToken: 'abc123',
    wireUri: 'file:///a.cvl'
  });
});

test('a lens payload may arrive unwrapped and still be accepted', () => {
  const request = runtime.anchoredLensRequest({ schemaVersion: 3, lensToken: 'abc123', wireUri: 'file:///a.cvl' });
  assert.equal(request.lensToken, 'abc123');
});

test('a lens payload that is not exactly v3 is refused, never guessed at', () => {
  assert.equal(runtime.anchoredLensRequest([{ schemaVersion: 2, lensToken: 'abc', wireUri: 'file:///a.cvl' }]), null);
  assert.equal(runtime.anchoredLensRequest([{ schemaVersion: 3, lensToken: '', wireUri: 'file:///a.cvl' }]), null);
  assert.equal(runtime.anchoredLensRequest([{ schemaVersion: 3, lensToken: 'abc' }]), null);
  assert.equal(runtime.anchoredLensRequest([]), null);
  assert.equal(runtime.anchoredLensRequest(null), null);
});

test('a lens payload strips any field the wire contract does not name', () => {
  const request = runtime.anchoredLensRequest([
    { schemaVersion: 3, lensToken: 'abc', wireUri: 'file:///a.cvl', line: 1, character: 2 }
  ]);

  assert.deepEqual(request, { schemaVersion: 3, lensToken: 'abc', wireUri: 'file:///a.cvl' });
});

test('a Windows path used as a lens wire URI becomes an openable file URI', () => {
  const request = runtime.anchoredLensRequest([
    { schemaVersion: 3, lensToken: 'abc', wireUri: 'C:\\ws\\a.cvl' }
  ]);
  assert.equal(request.wireUri, 'file:///C:/ws/a.cvl');
});

test('a resolved references action carries validated locations, an anchor and a single-use token', () => {
  const action = runtime.normalizeAnchoredResult({
    schemaVersion: 3,
    kind: 'ShowReferences',
    actionToken: 'action-1',
    wireUri: 'file:///a.cvl',
    anchor: { line: 3, character: 4 },
    locations: [
      { uri: 'file:///a.cvl', range: { start: { line: 3, character: 4 }, end: { line: 3, character: 8 } } }
    ]
  });

  assert.equal(action.kind, 'ShowReferences');
  assert.equal(action.actionToken, 'action-1');
  assert.equal(action.wireUri, 'file:///a.cvl');
  assert.deepEqual(action.anchor, { line: 3, character: 4 });
  assert.deepEqual(action.locations, [
    { uri: 'file:///a.cvl', position: { line: 3, character: 4 } }
  ]);
});

test('a resolved layout action carries the compiler layout and no locations', () => {
  const action = runtime.normalizeAnchoredResult({
    schemaVersion: 3,
    kind: 'ShowLayout',
    actionToken: 'action-2',
    wireUri: 'file:///a.cvl',
    layout: LAYOUT
  });

  assert.equal(action.kind, 'ShowLayout');
  assert.equal(action.actionToken, 'action-2');
  assert.equal(action.locations.length, 0);
  assert.equal(action.layout.typeDisplay, 'Header');
});

test('an Unavailable action carries no token to act on', () => {
  const action = runtime.normalizeAnchoredResult({ schemaVersion: 3, kind: 'Unavailable', reason: 'SemanticPending' });

  assert.equal(action.kind, 'Unavailable');
  assert.equal(action.actionToken, null);
  assert.equal(action.reason, 'SemanticPending');
});

test('an action with no token, or an unknown kind, is refused', () => {
  assert.equal(runtime.normalizeAnchoredResult({ schemaVersion: 3, kind: 'ShowReferences', wireUri: 'file:///a.cvl' }), null);
  assert.equal(runtime.normalizeAnchoredResult({ schemaVersion: 3, kind: 'Teleport', actionToken: 'x' }), null);
  assert.equal(runtime.normalizeAnchoredResult(null), null);
});

test('the extension advertises the anchored capability and registers the anchored command', () => {
  const extensionSource = fs.readFileSync(path.join(root, 'extension.js'), 'utf8');
  const editorIntelligenceSource = fs.readFileSync(path.join(root, 'editor-intelligence.js'), 'utf8');

  assert.match(extensionSource, /registerFeature\(\{[\s\S]*fillClientCapabilities\(capabilities\)/);
  assert.match(extensionSource, /cvoloAnchoredLens\s*=\s*\{\s*version:\s*3,\s*validateAction:\s*true\s*\}/);

  assert.match(editorIntelligenceSource, /registerCommand\(EXECUTE_ANCHORED_LENS_COMMAND/);
  assert.match(editorIntelligenceSource, /sendRequest\('workspace\/executeCommand'/);
  assert.match(editorIntelligenceSource, /command:\s*RESOLVE_ANCHORED_LENS_REQUEST/);
  assert.match(editorIntelligenceSource, /sendRequest\(VALIDATE_ANCHORED_ACTION_REQUEST/);
  // A lens action must never re-query the reference provider with a stale position.
  assert.doesNotMatch(
    editorIntelligenceSource,
    /executeAnchoredLens[\s\S]*executeCommand\(REFERENCE_PROVIDER_COMMAND/
  );
});
