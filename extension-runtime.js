'use strict';

const fs = require('fs');
const path = require('path');

const PATH_SERVER_COMMAND = 'cvolo-language-server';

function currentRid(platform = process.platform, arch = process.arch) {
  if (platform === 'win32' && arch === 'x64') return 'win-x64';
  if (platform === 'linux' && arch === 'x64') return 'linux-x64';
  if (platform === 'linux' && arch === 'arm64') return 'linux-arm64';
  if (platform === 'darwin' && arch === 'x64') return 'osx-x64';
  if (platform === 'darwin' && arch === 'arm64') return 'osx-arm64';
  return null;
}

function bundledServerPath({
  extensionRoot,
  platform = process.platform,
  arch = process.arch,
  pathApi = path
}) {
  const rid = currentRid(platform, arch);
  if (!rid) {
    return null;
  }

  const executable = platform === 'win32'
    ? `${PATH_SERVER_COMMAND}.exe`
    : PATH_SERVER_COMMAND;

  return pathApi.join(extensionRoot, 'server', rid, executable);
}

function isFile(fsApi, candidate) {
  try {
    return fsApi.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function resolveServerCommand({
  configuredPath = '',
  extensionRoot,
  platform = process.platform,
  arch = process.arch,
  fsApi = fs,
  pathApi = path
}) {
  const configured = String(configuredPath ?? '').trim();

  if (configured.length > 0) {
    if (!pathApi.isAbsolute(configured)) {
      throw new Error('cvolo.server.path must be an absolute executable path.');
    }

    if (!fsApi.existsSync(configured)) {
      throw new Error(`Configured Cvolo Language Server does not exist: ${configured}`);
    }

    if (!isFile(fsApi, configured)) {
      throw new Error(`Configured Cvolo Language Server is not a file: ${configured}`);
    }

    return { command: configured, source: 'cvolo.server.path' };
  }

  const bundled = bundledServerPath({ extensionRoot, platform, arch, pathApi });
  if (bundled && fsApi.existsSync(bundled) && isFile(fsApi, bundled)) {
    return { command: bundled, source: `bundled ${currentRid(platform, arch)}` };
  }

  return { command: PATH_SERVER_COMMAND, source: 'PATH' };
}

class LifecycleController {
  constructor({ startClient, stopClient, onError = () => {} }) {
    if (typeof startClient !== 'function' || typeof stopClient !== 'function') {
      throw new TypeError('LifecycleController requires startClient and stopClient functions.');
    }

    this._startClient = startClient;
    this._stopClient = stopClient;
    this._onError = onError;
    this._client = undefined;
    this._tail = Promise.resolve();
    this._deactivating = false;
    this._deactivationPromise = undefined;
  }

  get isDeactivating() {
    return this._deactivating;
  }

  get hasClient() {
    return this._client !== undefined;
  }

  _enqueue(label, operation) {
    const result = this._tail
      .catch(() => undefined)
      .then(operation);

    this._tail = result.catch((error) => {
      try {
        this._onError(label, error);
      } catch {
        // Error reporting must never poison lifecycle serialization.
      }
      return undefined;
    });

    return result;
  }

  async _startCurrent() {
    if (this._deactivating || this._client) {
      return false;
    }

    const nextClient = await this._startClient();
    if (!nextClient) {
      throw new Error('startClient must resolve to a client instance.');
    }

    this._client = nextClient;
    return true;
  }

  async _stopCurrent() {
    const current = this._client;
    if (!current) {
      return false;
    }

    // Keep the reference until stop succeeds. If stop fails, a later allowed
    // lifecycle operation can retry the same client instead of accidentally
    // starting a replacement beside a process that may still be alive.
    await this._stopClient(current);
    this._client = undefined;
    return true;
  }

  start(reason = 'start') {
    if (this._deactivating) {
      return Promise.resolve(false);
    }

    return this._enqueue(reason, () => this._startCurrent());
  }

  stop(reason = 'stop') {
    return this._enqueue(reason, () => this._stopCurrent());
  }

  restart(reason = 'restart') {
    if (this._deactivating) {
      return Promise.resolve(false);
    }

    return this._enqueue(reason, async () => {
      if (this._deactivating) {
        return false;
      }

      await this._stopCurrent();

      if (this._deactivating) {
        return false;
      }

      return this._startCurrent();
    });
  }

  deactivate(reason = 'deactivate') {
    this._deactivating = true;

    if (!this._deactivationPromise) {
      this._deactivationPromise = this._enqueue(reason, () => this._stopCurrent());
    }

    return this._deactivationPromise;
  }

  settled() {
    return this._tail;
  }
}

module.exports = {
  PATH_SERVER_COMMAND,
  LifecycleController,
  bundledServerPath,
  currentRid,
  resolveServerCommand
};
