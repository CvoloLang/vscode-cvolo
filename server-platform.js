'use strict';

// Single source of truth for the VS Code target <-> Cvolo Language Server RID
// mapping. Runtime discovery (extension-runtime.js), the staging script
// (scripts/stage-server.js), the packaging workflow and validation all read the
// mapping from here so the five platforms can never drift apart.
//
// A VS Code target is exactly `<process.platform>-<process.arch>` for every
// supported desktop platform, which is why one table can drive both the runtime
// platform/arch lookup and the `vsce package --target` value.

const TARGETS = Object.freeze([
  Object.freeze({
    target: 'win32-x64',
    rid: 'win-x64',
    platform: 'win32',
    arch: 'x64',
    executable: 'cvolo-language-server.exe',
    archiveExtension: 'zip'
  }),
  Object.freeze({
    target: 'linux-x64',
    rid: 'linux-x64',
    platform: 'linux',
    arch: 'x64',
    executable: 'cvolo-language-server',
    archiveExtension: 'tar.gz'
  }),
  Object.freeze({
    target: 'linux-arm64',
    rid: 'linux-arm64',
    platform: 'linux',
    arch: 'arm64',
    executable: 'cvolo-language-server',
    archiveExtension: 'tar.gz'
  }),
  Object.freeze({
    target: 'darwin-x64',
    rid: 'osx-x64',
    platform: 'darwin',
    arch: 'x64',
    executable: 'cvolo-language-server',
    archiveExtension: 'tar.gz'
  }),
  Object.freeze({
    target: 'darwin-arm64',
    rid: 'osx-arm64',
    platform: 'darwin',
    arch: 'arm64',
    executable: 'cvolo-language-server',
    archiveExtension: 'tar.gz'
  })
]);

const ALL_RIDS = Object.freeze(TARGETS.map(entry => entry.rid));
const ALL_TARGETS = Object.freeze(TARGETS.map(entry => entry.target));

function entryForPlatform(platform, arch) {
  return TARGETS.find(entry => entry.platform === platform && entry.arch === arch) ?? null;
}

function entryForRid(rid) {
  return TARGETS.find(entry => entry.rid === rid) ?? null;
}

function entryForTarget(target) {
  return TARGETS.find(entry => entry.target === target) ?? null;
}

function ridFor(platform, arch) {
  return entryForPlatform(platform, arch)?.rid ?? null;
}

function targetFor(platform, arch) {
  return entryForPlatform(platform, arch)?.target ?? null;
}

function ridForTarget(target) {
  return entryForTarget(target)?.rid ?? null;
}

function targetForRid(rid) {
  return entryForRid(rid)?.target ?? null;
}

function executableForRid(rid) {
  return entryForRid(rid)?.executable ?? null;
}

function archiveExtensionForRid(rid) {
  return entryForRid(rid)?.archiveExtension ?? null;
}

function isKnownRid(rid) {
  return entryForRid(rid) !== null;
}

module.exports = {
  TARGETS,
  ALL_RIDS,
  ALL_TARGETS,
  ridFor,
  targetFor,
  ridForTarget,
  targetForRid,
  executableForRid,
  archiveExtensionForRid,
  isKnownRid
};
