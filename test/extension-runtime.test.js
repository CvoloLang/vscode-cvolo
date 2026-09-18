'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const test = require('node:test');

const {
  LifecycleController,
  bundledServerPath,
  currentRid,
  resolveServerCommand
} = require('../extension-runtime');

function fakeFs(entries = {}) {
  return {
    existsSync(candidate) {
      return Object.prototype.hasOwnProperty.call(entries, candidate);
    },
    statSync(candidate) {
      if (!Object.prototype.hasOwnProperty.call(entries, candidate)) {
        throw new Error(`ENOENT: ${candidate}`);
      }
      return {
        isFile() {
          return entries[candidate] === 'file';
        }
      };
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('RID mapping is deterministic', () => {
  assert.equal(currentRid('win32', 'x64'), 'win-x64');
  assert.equal(currentRid('linux', 'x64'), 'linux-x64');
  assert.equal(currentRid('linux', 'arm64'), 'linux-arm64');
  assert.equal(currentRid('darwin', 'x64'), 'osx-x64');
  assert.equal(currentRid('darwin', 'arm64'), 'osx-arm64');
  assert.equal(currentRid('freebsd', 'x64'), null);
});

test('bundled server layout follows server/<rid>/cvolo-language-server[.exe]', () => {
  assert.equal(
    bundledServerPath({ extensionRoot: '/ext', platform: 'linux', arch: 'x64', pathApi: path.posix }),
    '/ext/server/linux-x64/cvolo-language-server'
  );
  assert.equal(
    bundledServerPath({ extensionRoot: 'C:\\ext', platform: 'win32', arch: 'x64', pathApi: path.win32 }),
    'C:\\ext\\server\\win-x64\\cvolo-language-server.exe'
  );
});

test('explicit valid server path wins over bundle and PATH', () => {
  const configured = '/custom/cvolo-language-server';
  const bundled = '/ext/server/linux-x64/cvolo-language-server';
  const result = resolveServerCommand({
    configuredPath: `  ${configured}  `,
    extensionRoot: '/ext',
    platform: 'linux',
    arch: 'x64',
    fsApi: fakeFs({ [configured]: 'file', [bundled]: 'file' }),
    pathApi: path.posix
  });

  assert.deepEqual(result, { command: configured, source: 'cvolo.server.path' });
});

test('relative explicit path is rejected', () => {
  assert.throws(() => resolveServerCommand({
    configuredPath: './server',
    extensionRoot: '/ext',
    platform: 'linux',
    arch: 'x64',
    fsApi: fakeFs(),
    pathApi: path.posix
  }), /absolute executable path/);
});

test('missing explicit path is rejected instead of falling back', () => {
  assert.throws(() => resolveServerCommand({
    configuredPath: '/missing/cvolo-language-server',
    extensionRoot: '/ext',
    platform: 'linux',
    arch: 'x64',
    fsApi: fakeFs(),
    pathApi: path.posix
  }), /does not exist/);
});

test('directory explicit path is rejected', () => {
  const configured = '/custom/server-dir';
  assert.throws(() => resolveServerCommand({
    configuredPath: configured,
    extensionRoot: '/ext',
    platform: 'linux',
    arch: 'x64',
    fsApi: fakeFs({ [configured]: 'directory' }),
    pathApi: path.posix
  }), /is not a file/);
});

test('existing bundled server is selected without an override', () => {
  const bundled = '/ext/server/linux-x64/cvolo-language-server';
  const result = resolveServerCommand({
    extensionRoot: '/ext',
    platform: 'linux',
    arch: 'x64',
    fsApi: fakeFs({ [bundled]: 'file' }),
    pathApi: path.posix
  });

  assert.deepEqual(result, { command: bundled, source: 'bundled linux-x64' });
});

test('PATH is used when no override or bundle exists', () => {
  const result = resolveServerCommand({
    extensionRoot: '/ext',
    platform: 'linux',
    arch: 'x64',
    fsApi: fakeFs(),
    pathApi: path.posix
  });

  assert.deepEqual(result, { command: 'cvolo-language-server', source: 'PATH' });
});

test('unsupported RID falls back to PATH', () => {
  const result = resolveServerCommand({
    extensionRoot: '/ext',
    platform: 'freebsd',
    arch: 'x64',
    fsApi: fakeFs(),
    pathApi: path.posix
  });

  assert.deepEqual(result, { command: 'cvolo-language-server', source: 'PATH' });
});

test('double start guard keeps one client lifecycle', async () => {
  let starts = 0;
  const lifecycle = new LifecycleController({
    startClient: async () => ({ id: ++starts }),
    stopClient: async () => {}
  });

  assert.equal(await lifecycle.start('first'), true);
  assert.equal(await lifecycle.start('second'), false);
  assert.equal(starts, 1);
});

test('stop clears client and allows a later serialized start', async () => {
  let starts = 0;
  let stops = 0;
  const lifecycle = new LifecycleController({
    startClient: async () => ({ id: ++starts }),
    stopClient: async () => { stops += 1; }
  });

  await lifecycle.start();
  assert.equal(await lifecycle.stop(), true);
  assert.equal(await lifecycle.start(), true);
  assert.equal(starts, 2);
  assert.equal(stops, 1);
});

test('initial start and queued restart do not overlap', async () => {
  const gate = deferred();
  const events = [];
  let starts = 0;
  let active = 0;
  let maxActive = 0;

  const lifecycle = new LifecycleController({
    startClient: async () => {
      const id = ++starts;
      active += 1;
      maxActive = Math.max(maxActive, active);
      events.push(`start-${id}-begin`);
      if (id === 1) await gate.promise;
      events.push(`start-${id}-end`);
      return { id };
    },
    stopClient: async client => {
      events.push(`stop-${client.id}`);
      active -= 1;
    }
  });

  const initial = lifecycle.start('initial');
  const restart = lifecycle.restart('manual');
  await Promise.resolve();
  gate.resolve();
  await Promise.all([initial, restart]);

  assert.deepEqual(events, [
    'start-1-begin', 'start-1-end', 'stop-1', 'start-2-begin', 'start-2-end'
  ]);
  assert.equal(maxActive, 1);
});

test('two restarts serialize stop/start pairs', async () => {
  const events = [];
  let nextId = 0;
  const lifecycle = new LifecycleController({
    startClient: async () => {
      const client = { id: ++nextId };
      events.push(`start-${client.id}`);
      return client;
    },
    stopClient: async client => {
      events.push(`stop-${client.id}`);
    }
  });

  await lifecycle.start('initial');
  await Promise.all([
    lifecycle.restart('restart-1'),
    lifecycle.restart('restart-2')
  ]);

  assert.deepEqual(events, [
    'start-1', 'stop-1', 'start-2', 'stop-2', 'start-3'
  ]);
});

test('failed lifecycle operation is reported and does not poison later work', async () => {
  const failures = [];
  let attempts = 0;
  const lifecycle = new LifecycleController({
    startClient: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('boom');
      return { id: attempts };
    },
    stopClient: async () => {},
    onError: (reason, error) => failures.push([reason, error.message])
  });

  await assert.rejects(lifecycle.start('first start'), /boom/);
  assert.equal(await lifecycle.start('retry'), true);
  assert.deepEqual(failures, [['first start', 'boom']]);
});



test('failed stop keeps the current client so a later restart can retry it', async () => {
  const events = [];
  let starts = 0;
  let stopAttempts = 0;
  const lifecycle = new LifecycleController({
    startClient: async () => {
      const client = { id: ++starts };
      events.push(`start-${client.id}`);
      return client;
    },
    stopClient: async client => {
      stopAttempts += 1;
      events.push(`stop-${client.id}-attempt-${stopAttempts}`);
      if (stopAttempts === 1) throw new Error('stop failed');
    }
  });

  await lifecycle.start('initial');
  await assert.rejects(lifecycle.restart('first restart'), /stop failed/);
  assert.equal(lifecycle.hasClient, true);
  assert.equal(starts, 1);

  await lifecycle.restart('retry restart');
  assert.equal(starts, 2);
  assert.deepEqual(events, [
    'start-1',
    'stop-1-attempt-1',
    'stop-1-attempt-2',
    'start-2'
  ]);
});

test('deactivation fence skips a queued restart and performs final stop', async () => {
  const startGate = deferred();
  const startEntered = deferred();
  const events = [];
  let starts = 0;
  const lifecycle = new LifecycleController({
    startClient: async () => {
      const id = ++starts;
      events.push(`start-${id}-begin`);
      startEntered.resolve();
      if (id === 1) await startGate.promise;
      events.push(`start-${id}-end`);
      return { id };
    },
    stopClient: async client => events.push(`stop-${client.id}`)
  });

  const initial = lifecycle.start('initial');
  await startEntered.promise;
  const restart = lifecycle.restart('queued restart');
  const deactivate = lifecycle.deactivate('deactivate');
  startGate.resolve();
  await Promise.all([initial, restart, deactivate]);

  assert.deepEqual(events, ['start-1-begin', 'start-1-end', 'stop-1']);
  assert.equal(starts, 1);
  assert.equal(lifecycle.hasClient, false);
});

test('deactivation after restart stop phase skips replacement start', async () => {
  const stopGate = deferred();
  const stopEntered = deferred();
  const events = [];
  let starts = 0;
  const lifecycle = new LifecycleController({
    startClient: async () => {
      const client = { id: ++starts };
      events.push(`start-${client.id}`);
      return client;
    },
    stopClient: async client => {
      events.push(`stop-${client.id}-begin`);
      stopEntered.resolve();
      await stopGate.promise;
      events.push(`stop-${client.id}-end`);
    }
  });

  await lifecycle.start('initial');
  const restart = lifecycle.restart('restart');
  await stopEntered.promise;
  const deactivate = lifecycle.deactivate('deactivate');
  stopGate.resolve();
  await Promise.all([restart, deactivate]);

  assert.deepEqual(events, ['start-1', 'stop-1-begin', 'stop-1-end']);
  assert.equal(starts, 1);
  assert.equal(lifecycle.hasClient, false);
});

test('deactivation during an already-running start lets it settle then stops it', async () => {
  const startGate = deferred();
  const startEntered = deferred();
  const events = [];
  const lifecycle = new LifecycleController({
    startClient: async () => {
      events.push('start-begin');
      startEntered.resolve();
      await startGate.promise;
      events.push('start-end');
      return { id: 1 };
    },
    stopClient: async () => events.push('stop')
  });

  const start = lifecycle.start('initial');
  await startEntered.promise;
  const deactivate = lifecycle.deactivate('deactivate');
  startGate.resolve();
  await Promise.all([start, deactivate]);

  assert.deepEqual(events, ['start-begin', 'start-end', 'stop']);
  assert.equal(lifecycle.hasClient, false);
});
