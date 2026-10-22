'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');
const {
  METHODS, recordingCapability, createPrivateTracePath,
  validatePrivateArchive, TelemetryController
} = require('../telemetry-runtime');

function mockClient(handlers, { supported = true } = {}) {
  const calls = [];
  const client = {
    initializeResult: { capabilities: { experimental: supported ? {
      cvoloObservability: {
        version: 1, setRecording: METHODS.setRecording,
        getStatus: METHODS.status, getCheckpoint: METHODS.checkpoint,
        export: METHODS.export
      }
    } : {} } },
    isRunning: () => true,
    calls,
    async sendRequest(method, params) {
      calls.push({ method, params });
      if (!handlers[method]) throw new Error('Unexpected RPC: ' + method);
      return handlers[method](params);
    }
  };
  return client;
}

test('old bundled servers are detected by advertised capabilities, not guessed version', async () => {
  const old = mockClient({}, { supported: false });
  assert.equal(recordingCapability(old), null);
  await assert.rejects(new TelemetryController(() => old).status(), /does not support diagnostic recording/);
  assert.deepEqual(old.calls, []);
});

test('start/stop use explicit policy ACKs and never request source capture', async () => {
  let epoch = 0;
  const client = mockClient({
    [METHODS.setRecording]: request => {
      assert.deepEqual(request, { protocolVersion: 1, mode: request.mode });
      return {
        status: 'applied', effectiveMode: request.mode,
        recordingEpoch: ++epoch, serverInstanceId: 'server-1'
      };
    }
  });
  const ctl = new TelemetryController(() => client);
  const start = await ctl.setMode('detailed');
  const stop = await ctl.setMode('off');
  assert.equal(start.recordingEpoch, 1);
  assert.equal(stop.recordingEpoch, 2);
  assert.equal(stop.effectiveMode, 'off');
  assert.equal(client.calls.length, 2);
  await assert.rejects(ctl.setMode('repro'), /Unsupported/);
  assert.equal(client.calls.length, 2);
});

test('partial stop cannot be treated as full drain', async () => {
  const client = mockClient({
    [METHODS.setRecording]: () => ({
      status: 'partially_applied', reason: 'drain_timeout',
      recordingEpoch: 2, effectiveMode: 'off'
    })
  });
  const ack = await new TelemetryController(() => client).setMode('off');
  assert.equal(ack.status, 'partially_applied');
  assert.equal(ack.reason, 'drain_timeout');
});

test('checkpoint guards export epoch and prevents exporting active sessions', async () => {
  const checkpoint = {
    protocolVersion: 1, serverInstanceId: 'server-7',
    recordingEpoch: 4, effectiveMode: 'off',
    closedForInspection: true, exportSupported: true, incompleteReasons: []
  };
  const client = mockClient({
    [METHODS.checkpoint]: () => checkpoint,
    [METHODS.export]: body => {
      assert.deepEqual(body, {
        protocolVersion: 1, serverInstanceId: 'server-7', expectedEpoch: 4
      });
      return {
        status: 'exported', recordingEpoch: 4, completenessVerified: false,
        archivePath: '/private/telemetry/cvolo-diagnostics-4-' + 'a'.repeat(32) + '.zip'
      };
    }
  });
  const ctl = new TelemetryController(() => client);
  const recorded = await ctl.checkpoint();
  const exported = await ctl.exportStopped(recorded);
  assert.equal(exported.recordingEpoch, 4);
  await assert.rejects(ctl.exportStopped({ ...recorded, effectiveMode: 'detailed' }), /Stop recording/);
  await assert.rejects(ctl.exportStopped({ ...recorded, closedForInspection: false }), /Stop recording/);
  assert.equal(client.calls.filter(x => x.method === METHODS.export).length, 1);
});

test('server restart during a request invalidates the response', async () => {
  let finish;
  const client = mockClient({
    [METHODS.status]: () => new Promise(resolve => { finish = resolve; })
  });
  const replacement = mockClient({}, { supported: false });
  let current = client;
  const request = new TelemetryController(() => current).status();
  await Promise.resolve();
  current = replacement;
  finish({ effectiveMode: 'off', recordingEpoch: 0 });
  await assert.rejects(request, /restarted/);
});

test('private trace path uses extension storage with restrictive directory permissions', () => {
  let made;
  const target = createPrivateTracePath('/private/extensions/cvolo', {
    pathApi: path.posix,
    newId: () => 'unique',
    fsApi: { mkdirSync(dir, args) { made = { dir, args }; } }
  });
  assert.equal(target, '/private/extensions/cvolo/telemetry/trace-unique.jsonl');
  assert.deepEqual(made, {
    dir: '/private/extensions/cvolo/telemetry',
    args: { recursive: true, mode: 0o700 }
  });
});

test('archive paths are confined to the private trace directory', () => {
  const trace = '/private/telemetry/trace-abc.jsonl';
  const safe = '/private/telemetry/cvolo-diagnostics-3-' + 'a'.repeat(32) + '.zip';
  const fakeFs = {
    realpathSync: name => name,
    lstatSync: name => ({ isFile: () => true, isSymbolicLink: () => false })
  };
  assert.equal(validatePrivateArchive(safe, trace, { fsApi: fakeFs, pathApi: path.posix }), safe);
  assert.throws(() => validatePrivateArchive('/private/workspace/cvolo-diagnostics-3-' + 'a'.repeat(32) + '.zip',
    trace, { fsApi: fakeFs, pathApi: path.posix }), /outside/);
  assert.throws(() => validatePrivateArchive('/private/telemetry/evil.zip', trace,
    { fsApi: fakeFs, pathApi: path.posix }), /unexpected/);
  const linkFs = {
    ...fakeFs,
    lstatSync: () => ({ isFile: () => true, isSymbolicLink: () => true })
  };
  assert.throws(() => validatePrivateArchive(safe, trace,
    { fsApi: linkFs, pathApi: path.posix }), /regular file/);
});

test('diagnostic markers send only fixed categories with a non-durable ACK', async () => {
  const seen = [];
  const client = mockClient({
    [METHODS.marker]: body => {
      seen.push(body);
      return { status: 'queued_best_effort', markerId: 'marker-1', recordingEpoch: 3, durable: false };
    }
  });
  client.initializeResult.capabilities.experimental.cvoloObservability.addMarker = METHODS.marker;
  const ctl = new TelemetryController(() => client);
  const ack = await ctl.addMarker('definition');
  assert.equal(ack.markerId, 'marker-1');
  assert.equal(ack.durable, false);
  assert.deepEqual(seen, [{ protocolVersion: 1, category: 'definition' }]);
  await assert.rejects(ctl.addMarker('secret source contents'), /Invalid diagnostic marker category/);
  assert.equal(seen.length, 1);
});

test('older servers without the marker method reject without RPC', async () => {
  const client = mockClient({});
  await assert.rejects(new TelemetryController(() => client).addMarker('completion'),
    /does not support diagnostic markers/);
  assert.deepEqual(client.calls, []);
});
