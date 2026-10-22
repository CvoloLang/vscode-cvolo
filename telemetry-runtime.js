'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const METHODS = Object.freeze({
  status: 'cvolo/observability/status.v1',
  setRecording: 'cvolo/observability/setRecording.v1',
  checkpoint: 'cvolo/observability/checkpoint.v1',
  export: 'cvolo/observability/export.v1'
});

function recordingCapability(client) {
  const capability = client?.initializeResult?.capabilities?.experimental?.cvoloObservability;
  return capability?.version === 1
    && capability.setRecording === METHODS.setRecording
    && capability.getStatus === METHODS.status
    && capability.getCheckpoint === METHODS.checkpoint
    ? capability : null;
}

// One trace per server generation, under the workspace extension host's
// private storage rather than the user's project or shared temp directory.
// The CLI can still be launched independently without this environment.
function createPrivateTracePath(storageRoot, {
  fsApi = fs, pathApi = path, newId = randomUUID
} = {}) {
  const directory = pathApi.join(storageRoot, 'telemetry');
  fsApi.mkdirSync(directory, { recursive: true, mode: 0o700 });
  return pathApi.join(directory, 'trace-' + newId() + '.jsonl');
}

// The server selects the export path, but this is still untrusted RPC data.
// Only reveal a real ZIP sibling of the private trace that we launched.
// Reject symlinks and directory escapes, including paths via symlinked parents.
function validatePrivateArchive(archivePath, tracePath, {
  fsApi = fs, pathApi = path
} = {}) {
  if (typeof archivePath !== 'string' || !pathApi.isAbsolute(archivePath)) {
    throw new Error('The server did not return an absolute diagnostic archive path.');
  }
  const filename = pathApi.basename(archivePath);
  if (!/^cvolo-diagnostics-[0-9]+-[a-f0-9]{32}\.zip$/.test(filename)) {
    throw new Error('The server returned an unexpected diagnostic archive name.');
  }
  const expected = fsApi.realpathSync(pathApi.dirname(tracePath));
  const actual = fsApi.realpathSync(pathApi.dirname(archivePath));
  if (actual !== expected || pathApi.dirname(pathApi.resolve(archivePath)) !== pathApi.resolve(pathApi.dirname(tracePath))) {
    throw new Error('The diagnostic archive is outside the private telemetry directory.');
  }
  const stat = fsApi.lstatSync(archivePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error('The diagnostic archive is not a regular file.');
  }
  return archivePath;
}

class TelemetryController {
  constructor(getClient) {
    if (typeof getClient !== 'function') throw new TypeError('getClient must be a function');
    this.getClient = getClient;
  }

  async invoke(method, argument) {
    const client = this.getClient();
    if (!client || typeof client.sendRequest !== 'function' || !client.isRunning?.()) {
      throw new Error('The Cvolo Language Server is not running.');
    }
    const capability = recordingCapability(client);
    if (!capability) {
      throw new Error('The running Cvolo Language Server does not support diagnostic recording v1. Update or select a newer server.');
    }
    if (method === METHODS.export && capability.export !== METHODS.export) {
      throw new Error('The running server does not support diagnostic bundle export.');
    }
    const result = argument === undefined
      ? await client.sendRequest(method)
      : await client.sendRequest(method, argument);
    if (this.getClient() !== client) {
      throw new Error('The Language Server restarted during the recording request. Query its status again.');
    }
    return result;
  }

  async status() {
    const value = await this.invoke(METHODS.status);
    if (!value || typeof value.effectiveMode !== 'string' || !Number.isSafeInteger(value.recordingEpoch)) {
      throw new Error('The server returned an invalid recording status.');
    }
    return value;
  }

  async setMode(mode) {
    if (mode !== 'off' && mode !== 'basic' && mode !== 'detailed') {
      throw new Error('Unsupported diagnostic recording mode.');
    }
    const ack = await this.invoke(METHODS.setRecording, { protocolVersion: 1, mode });
    if (!ack || !['applied', 'partially_applied', 'rejected'].includes(ack.status)
        || typeof ack.effectiveMode !== 'string' || !Number.isSafeInteger(ack.recordingEpoch)) {
      throw new Error('The server returned an invalid recording acknowledgement.');
    }
    return ack;
  }

  async checkpoint() {
    const data = await this.invoke(METHODS.checkpoint);
    if (!data || data.protocolVersion !== 1
        || typeof data.serverInstanceId !== 'string'
        || !Number.isSafeInteger(data.recordingEpoch)
        || typeof data.effectiveMode !== 'string'
        || !Array.isArray(data.incompleteReasons)) {
      throw new Error('The server returned an invalid recording checkpoint.');
    }
    return data;
  }

  async exportStopped(checkpoint) {
    if (!checkpoint || checkpoint.effectiveMode !== 'off' || checkpoint.closedForInspection !== true) {
      throw new Error('Stop recording and complete the drain before exporting.');
    }
    if (!checkpoint.exportSupported) {
      throw new Error('The running server does not provide an exportable disk recording.');
    }
    const reply = await this.invoke(METHODS.export, {
      protocolVersion: 1,
      serverInstanceId: checkpoint.serverInstanceId,
      expectedEpoch: checkpoint.recordingEpoch
    });
    if (reply?.status !== 'exported') {
      throw new Error('Export was rejected: ' + String(reply?.reason || 'unknown reason'));
    }
    if (reply.recordingEpoch !== checkpoint.recordingEpoch
        || typeof reply.archivePath !== 'string'
        || reply.completenessVerified !== false) {
      throw new Error('The server returned an inconsistent or unsupported archive acknowledgement.');
    }
    return reply;
  }
}

module.exports = {
  METHODS,
  recordingCapability,
  createPrivateTracePath,
  validatePrivateArchive,
  TelemetryController
};
