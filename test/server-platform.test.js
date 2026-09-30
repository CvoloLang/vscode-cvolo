'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  ALL_RIDS,
  ALL_TARGETS,
  TARGETS,
  archiveExtensionForRid,
  executableForRid,
  isKnownRid,
  ridFor,
  ridForTarget,
  targetFor,
  targetForRid
} = require('../server-platform');

const EXPECTED = [
  ['win32-x64', 'win-x64'],
  ['linux-x64', 'linux-x64'],
  ['linux-arm64', 'linux-arm64'],
  ['darwin-x64', 'osx-x64'],
  ['darwin-arm64', 'osx-arm64']
];

test('target table is exactly the five supported platforms', () => {
  assert.equal(TARGETS.length, 5);
  assert.deepEqual(ALL_TARGETS, EXPECTED.map(([target]) => target));
  assert.deepEqual(ALL_RIDS, EXPECTED.map(([, rid]) => rid));
  for (const entry of TARGETS) {
    assert.ok(Object.isFrozen(entry));
  }
});

test('target <-> RID mapping matches the packaging contract', () => {
  for (const [target, rid] of EXPECTED) {
    assert.equal(ridForTarget(target), rid);
    assert.equal(targetForRid(rid), target);
    assert.equal(isKnownRid(rid), true);
  }
});

test('platform/arch lookup returns the expected target and RID', () => {
  assert.equal(ridFor('win32', 'x64'), 'win-x64');
  assert.equal(ridFor('linux', 'x64'), 'linux-x64');
  assert.equal(ridFor('linux', 'arm64'), 'linux-arm64');
  assert.equal(ridFor('darwin', 'x64'), 'osx-x64');
  assert.equal(ridFor('darwin', 'arm64'), 'osx-arm64');
  assert.equal(targetFor('win32', 'x64'), 'win32-x64');
  assert.equal(targetFor('darwin', 'arm64'), 'darwin-arm64');
});

test('unsupported platforms and RIDs resolve to null', () => {
  assert.equal(ridFor('freebsd', 'x64'), null);
  assert.equal(ridFor('win32', 'arm64'), null);
  assert.equal(targetFor('linux', 'ia32'), null);
  assert.equal(ridForTarget('plan9-x64'), null);
  assert.equal(targetForRid('solaris-x64'), null);
  assert.equal(isKnownRid('linux-musl-x64'), false);
});

test('executable and archive extension are platform specific', () => {
  assert.equal(executableForRid('win-x64'), 'cvolo-language-server.exe');
  for (const rid of ['linux-x64', 'linux-arm64', 'osx-x64', 'osx-arm64']) {
    assert.equal(executableForRid(rid), 'cvolo-language-server');
  }
  assert.equal(executableForRid('unknown'), null);

  assert.equal(archiveExtensionForRid('win-x64'), 'zip');
  for (const rid of ['linux-x64', 'linux-arm64', 'osx-x64', 'osx-arm64']) {
    assert.equal(archiveExtensionForRid(rid), 'tar.gz');
  }
  assert.equal(archiveExtensionForRid('unknown'), null);
});
