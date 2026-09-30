#!/usr/bin/env node
'use strict';

// Deterministic stager for the bundled Cvolo Language Server.
//
// It downloads exactly one platform archive from the official GitHub Release,
// verifies it against SHA256SUMS and its `.manifest.sha256` sidecar, validates
// the archive's bundle-manifest.json, then extracts the archive unchanged into
// server/<rid>/.
//
// The GitHub Release is authoritative. Nothing is ever copied from a local
// LanguageServer build tree (LanguageServer/bin, LanguageServer/artifacts, or
// any previous staging directory).
//
// Usage:
//   node scripts/stage-server.js --lsp-version 0.1.0-alpha.11 --rid win-x64

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

const {
  ALL_RIDS,
  archiveExtensionForRid,
  executableForRid,
  isKnownRid,
  targetForRid
} = require('../server-platform');

const DEFAULT_OWNER = 'CvoloLang';
const DEFAULT_REPO = 'LanguageServer';
const SCHEMA_VERSION = 2;

// Contract values this stager enforces. They are validation gates, not stored
// identities: the manifest is still the source of truth for what was published.
const DEFAULT_EXPECT = Object.freeze({
  toolingVersion: '0.0.21.0',
  compilerCompatibilityLine: '0.0.21'
});

const USER_AGENT = 'cvolo-vscode-stage-server';

class StageError extends Error {}

function fail(message) {
  throw new StageError(message);
}

function parseArgs(argv) {
  const options = {
    lspVersion: null,
    rid: null,
    owner: DEFAULT_OWNER,
    repo: DEFAULT_REPO,
    releaseTag: null,
    expectCommit: null,
    expectToolingVersion: DEFAULT_EXPECT.toolingVersion,
    expectCompilerLine: DEFAULT_EXPECT.compilerCompatibilityLine
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined || value.startsWith('--')) {
        fail(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };

    switch (arg) {
      case '--lsp-version': options.lspVersion = next(); break;
      case '--rid': options.rid = next(); break;
      case '--owner': options.owner = next(); break;
      case '--repo': options.repo = next(); break;
      case '--release-tag': options.releaseTag = next(); break;
      case '--expect-commit': options.expectCommit = next().trim().toLowerCase(); break;
      case '--expect-tooling-version': options.expectToolingVersion = next(); break;
      case '--expect-compiler-line': options.expectCompilerLine = next(); break;
      case '--help': case '-h': options.help = true; break;
      default: fail(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

function usage() {
  return [
    'Usage: node scripts/stage-server.js --lsp-version <version> --rid <rid>',
    '',
    `Supported RIDs: ${ALL_RIDS.join(', ')}`,
    '',
    'Options:',
    '  --lsp-version <v>            Exact Language Server version to stage.',
    '  --rid <rid>                  Target RID (one of the supported RIDs).',
    '  --owner <org>                GitHub owner (default CvoloLang).',
    '  --repo <name>                GitHub repo (default LanguageServer).',
    '  --release-tag <tag>          Release tag (default v<lsp-version>).',
    '  --expect-commit <sha>        Require this 40-hex languageServerCommit.',
    '  --expect-tooling-version <v> Require this toolingVersion.',
    '  --expect-compiler-line <v>   Require this compilerCompatibilityLine.'
  ].join('\n');
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function sha256File(filePath) {
  return sha256(fs.readFileSync(filePath));
}

function parseManifestChecksum(text) {
  const match = text.match(/^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/m);
  if (!match) {
    fail('Could not parse the manifest checksum sidecar.');
  }
  return { hash: match[1].toLowerCase(), name: match[2] };
}

function parseSha256Sums(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/);
    if (match) {
      map.set(match[2], match[1].toLowerCase());
    }
  }
  return map;
}

function sanitizeEntryName(rawName) {
  const normalized = rawName.replace(/\\/g, '/').replace(/^\.\//, '');
  if (normalized === '' || normalized === '.') {
    return null;
  }
  if (normalized.startsWith('/') || /^[A-Za-z]:/.test(normalized)) {
    fail(`Archive member uses an absolute path: ${rawName}`);
  }
  const segments = normalized.split('/').filter(segment => segment.length > 0 && segment !== '.');
  if (segments.includes('..')) {
    fail(`Archive member escapes the extraction root: ${rawName}`);
  }
  return segments.join('/');
}

function roundUp(value, unit) {
  return Math.ceil(value / unit) * unit;
}

function readTarEntries(buffer) {
  const entries = [];
  let offset = 0;
  let pendingLongName = null;
  let pendingPaxName = null;

  while (offset + 512 <= buffer.length) {
    const header = buffer.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) {
      break;
    }

    const rawName = readCString(header, 0, 100);
    const mode = parseInt(readCString(header, 100, 8).trim() || '0', 8) || 0;
    const size = parseInt(readCString(header, 124, 12).trim() || '0', 8) || 0;
    const typeflag = String.fromCharCode(header[156] || 0x30);
    const prefix = readCString(header, 345, 155);
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;

    if (typeflag === 'L') {
      pendingLongName = readCString(buffer, dataStart, size);
      offset = roundUp(dataEnd, 512);
      continue;
    }
    if (typeflag === 'x' || typeflag === 'g') {
      const pax = buffer.subarray(dataStart, dataEnd).toString('utf8');
      const pathMatch = pax.match(/\d+ path=([^\n]+)\n/);
      if (pathMatch) {
        pendingPaxName = pathMatch[1];
      }
      offset = roundUp(dataEnd, 512);
      continue;
    }

    let name = prefix ? `${prefix}/${rawName}` : rawName;
    if (typeflag === 'K') {
      offset = roundUp(dataEnd, 512);
      continue;
    }
    if (pendingLongName !== null) {
      name = pendingLongName;
      pendingLongName = null;
    }
    if (pendingPaxName !== null) {
      name = pendingPaxName;
      pendingPaxName = null;
    }

    const normalized = sanitizeEntryName(name);
    const isDirectory = typeflag === '5' || /\/$/.test(rawName);
    const isRegularFile = typeflag === '0' || typeflag === '\u0000' || typeflag === '';
    if (normalized !== null) {
      if (isDirectory) {
        entries.push({ name: normalized, directory: true });
      } else if (isRegularFile) {
        entries.push({ name: normalized, directory: false, mode, data: buffer.subarray(dataStart, dataEnd) });
      }
    }

    offset = roundUp(dataEnd, 512);
  }

  return entries;
}

function readCString(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end === -1 ? slice.length : end).toString('utf8');
}

function findEndOfCentralDirectory(buffer) {
  const minimum = Math.max(0, buffer.length - 22 - 0xffff);
  for (let i = buffer.length - 22; i >= minimum; i -= 1) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      return i;
    }
  }
  return -1;
}

function readZipEntries(buffer) {
  const eocd = findEndOfCentralDirectory(buffer);
  if (eocd < 0) {
    fail('Archive is not a valid zip file (no end-of-central-directory record).');
  }

  const count = buffer.readUInt16LE(eocd + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  let pointer = centralDirectoryOffset;

  for (let i = 0; i < count; i += 1) {
    if (buffer.readUInt32LE(pointer) !== 0x02014b50) {
      fail('Archive is not a valid zip file (bad central directory entry).');
    }

    const method = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const externalAttributes = buffer.readUInt32LE(pointer + 38);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const rawName = buffer.subarray(pointer + 46, pointer + 46 + nameLength).toString('utf8');
    const normalized = sanitizeEntryName(rawName);
    const unixMode = (externalAttributes >>> 16) & 0o777;
    const isDirectory = /\/$/.test(rawName);

    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
      fail('Archive is not a valid zip file (bad local header).');
    }
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    const compressed = buffer.subarray(dataStart, dataStart + compressedSize);

    let data = null;
    if (!isDirectory && normalized !== null) {
      if (method === 0) {
        data = Buffer.from(compressed);
      } else if (method === 8) {
        data = zlib.inflateRawSync(compressed);
      } else {
        fail(`Unsupported zip compression method ${method} for ${rawName}`);
      }
    }

    if (normalized !== null) {
      entries.push(isDirectory
        ? { name: normalized, directory: true }
        : { name: normalized, directory: false, mode: unixMode, data });
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function readArchiveEntries(archivePath) {
  const raw = fs.readFileSync(archivePath);
  if (archivePath.endsWith('.zip')) {
    return readZipEntries(raw);
  }
  if (archivePath.endsWith('.tar.gz')) {
    return readTarEntries(zlib.gunzipSync(raw));
  }
  fail(`Unsupported archive type: ${archivePath}`);
}

function extractEntries(entries, destination) {
  for (const entry of entries) {
    const target = path.join(destination, entry.name);
    if (entry.directory) {
      fs.mkdirSync(target, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, entry.data);
    // Only apply a mode the archive actually encodes. Windows-created zips
    // carry external attributes whose Unix permission bits are 0; applying that
    // would chmod the file to 0000 on Linux/macOS and make it unreadable. When
    // no usable mode is present, leave the umask default.
    if (typeof entry.mode === 'number' && entry.mode > 0 && process.platform !== 'win32') {
      fs.chmodSync(target, entry.mode & 0o777);
    }
  }
}

function findEntry(entries, name) {
  return entries.find(entry => !entry.directory && entry.name === name) ?? null;
}

function walkFiles(root) {
  const files = [];
  const stack = [''];
  while (stack.length > 0) {
    const relative = stack.pop();
    const absolute = path.join(root, relative);
    for (const dirent of fs.readdirSync(absolute, { withFileTypes: true })) {
      const childRelative = relative === '' ? dirent.name : `${relative}/${dirent.name}`;
      if (dirent.isDirectory()) {
        stack.push(childRelative);
      } else if (dirent.isFile()) {
        files.push(childRelative);
      }
    }
  }
  return files.sort();
}

function listRidDirectories(serverDir) {
  if (!fs.existsSync(serverDir)) {
    return [];
  }
  return fs.readdirSync(serverDir, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory() && isKnownRid(dirent.name))
    .map(dirent => dirent.name)
    .sort();
}

function wipeStagingArea(serverDir) {
  if (!fs.existsSync(serverDir)) {
    fs.mkdirSync(serverDir, { recursive: true });
    return;
  }
  for (const dirent of fs.readdirSync(serverDir, { withFileTypes: true })) {
    if (dirent.isDirectory()) {
      fs.rmSync(path.join(serverDir, dirent.name), { recursive: true, force: true });
    } else if (dirent.name !== 'README.md') {
      fs.rmSync(path.join(serverDir, dirent.name), { force: true });
    }
  }
}

async function fetchRelease(owner, repo, tag, token) {
  const headers = { 'User-Agent': USER_AGENT };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/tags/${encodeURIComponent(tag)}`;
  const response = await fetch(url, { headers });
  if (!response.ok) {
    return { ok: false, status: response.status };
  }
  return { ok: true, release: await response.json() };
}

async function download(url, destination, token) {
  const headers = { 'User-Agent': USER_AGENT };
  if (token && url.includes('api.github.com')) {
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(url, { headers, redirect: 'follow' });
  if (!response.ok) {
    fail(`Download failed (${response.status}) for ${url}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  fs.writeFileSync(destination, buffer);
  return destination;
}

function verifyManifest(manifest, { rid, lspVersion, expectCommit, expectToolingVersion, expectCompilerLine }) {
  if (manifest.schemaVersion !== SCHEMA_VERSION) {
    fail(`bundle-manifest schemaVersion must be ${SCHEMA_VERSION}, found ${manifest.schemaVersion}.`);
  }
  if (manifest.languageServerVersion !== lspVersion) {
    fail(`bundle-manifest languageServerVersion ${manifest.languageServerVersion} != requested ${lspVersion}.`);
  }
  if (typeof manifest.languageServerCommit !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.languageServerCommit)) {
    fail(`bundle-manifest languageServerCommit is not 40 hex chars: ${manifest.languageServerCommit}.`);
  }
  if (expectCommit && manifest.languageServerCommit !== expectCommit) {
    fail(`bundle-manifest languageServerCommit ${manifest.languageServerCommit} != expected ${expectCommit}.`);
  }
  if (manifest.toolingVersion !== expectToolingVersion) {
    fail(`bundle-manifest toolingVersion ${manifest.toolingVersion} != expected ${expectToolingVersion}.`);
  }
  if (manifest.compilerCompatibilityLine !== expectCompilerLine) {
    fail(`bundle-manifest compilerCompatibilityLine ${manifest.compilerCompatibilityLine} != expected ${expectCompilerLine}.`);
  }
  if (manifest.rid !== rid) {
    fail(`bundle-manifest rid ${manifest.rid} != requested ${rid}.`);
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    fail('bundle-manifest files[] is missing or empty.');
  }
  const entrypoint = manifest.entrypoint;
  if (typeof entrypoint !== 'string' || entrypoint.length === 0 || entrypoint.includes('/')) {
    fail(`bundle-manifest entrypoint is invalid: ${entrypoint}.`);
  }
}

function verifyExtractedTree(serverRidDir, manifest) {
  const expected = new Map(manifest.files.map(file => [file.path, file]));
  const actual = walkFiles(serverRidDir).filter(file => file !== 'bundle-manifest.json');

  const extras = actual.filter(file => !expected.has(file));
  const missing = [...expected.keys()].filter(file => !actual.includes(file));
  if (extras.length > 0) {
    fail(`Unexpected files in the staged bundle (stale or local build output?): ${extras.join(', ')}`);
  }
  if (missing.length > 0) {
    fail(`Missing files from the staged bundle: ${missing.join(', ')}`);
  }

  for (const file of actual) {
    const record = expected.get(file);
    const absolute = path.join(serverRidDir, file);
    const stat = fs.statSync(absolute);
    if (stat.size !== record.size) {
      fail(`Size mismatch for ${file}: manifest ${record.size}, staged ${stat.size}.`);
    }
    if (sha256File(absolute) !== record.sha256) {
      fail(`SHA-256 mismatch for ${file}.`);
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (!options.lspVersion) {
    fail('Missing --lsp-version.');
  }
  if (!options.rid) {
    fail('Missing --rid.');
  }
  if (!isKnownRid(options.rid)) {
    fail(`Unsupported RID "${options.rid}". Supported: ${ALL_RIDS.join(', ')}.`);
  }

  const rid = options.rid;
  const target = targetForRid(rid);
  const extension = archiveExtensionForRid(rid);
  const entrypoint = executableForRid(rid);
  const tag = options.releaseTag ?? `v${options.lspVersion}`;
  const repoRoot = path.resolve(__dirname, '..');
  const serverDir = path.join(repoRoot, 'server');
  const archiveName = `cvolo-language-server-${options.lspVersion}-${rid}.${extension}`;
  const sidecarName = `cvolo-language-server-${options.lspVersion}-${rid}.manifest.sha256`;
  const baseUrl = `https://github.com/${options.owner}/${options.repo}/releases/download/${tag}`;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || '';

  process.stdout.write(`Staging ${rid} (${target}) from ${options.owner}/${options.repo}@${tag}\n`);

  const resolved = await fetchRelease(options.owner, options.repo, tag, token);
  if (!resolved.ok) {
    process.stdout.write(`  note: release API lookup returned ${resolved.status}; continuing with direct download\n`);
  } else {
    if (resolved.release.draft) {
      fail(`Release ${tag} is a draft; refusing to stage from it.`);
    }
    if (resolved.release.tag_name !== tag) {
      fail(`Release API resolved tag ${resolved.release.tag_name} != requested ${tag}.`);
    }
    process.stdout.write(`  resolved release ${tag} (${resolved.release.assets?.length ?? 0} assets)\n`);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cvolo-stage-'));
  try {
    const archivePath = path.join(workDir, archiveName);
    const sidecarPath = path.join(workDir, sidecarName);
    const sumsPath = path.join(workDir, 'SHA256SUMS');

    process.stdout.write('  downloading archive, sidecar and SHA256SUMS\n');
    await download(`${baseUrl}/${archiveName}`, archivePath, token);
    await download(`${baseUrl}/${sidecarName}`, sidecarPath, token);
    await download(`${baseUrl}/SHA256SUMS`, sumsPath, token);

    const sums = parseSha256Sums(fs.readFileSync(sumsPath, 'utf8'));
    const expectedArchiveHash = sums.get(archiveName);
    if (!expectedArchiveHash) {
      fail(`SHA256SUMS does not list ${archiveName}.`);
    }
    const actualArchiveHash = sha256File(archivePath);
    if (actualArchiveHash !== expectedArchiveHash) {
      fail(`Archive hash mismatch for ${archiveName}.`);
    }
    process.stdout.write(`  archive verified against SHA256SUMS (${actualArchiveHash.slice(0, 12)}...)\n`);

    const entries = readArchiveEntries(archivePath);
    const manifestEntry = findEntry(entries, 'bundle-manifest.json');
    if (!manifestEntry) {
      fail('Archive does not contain bundle-manifest.json at its root.');
    }

    const sidecar = parseManifestChecksum(fs.readFileSync(sidecarPath, 'utf8'));
    const manifestHash = sha256(manifestEntry.data);
    if (manifestHash !== sidecar.hash) {
      fail('bundle-manifest.json hash does not match its sidecar.');
    }
    process.stdout.write(`  bundle-manifest verified against sidecar (${manifestHash.slice(0, 12)}...)\n`);

    const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
    verifyManifest(manifest, {
      rid,
      lspVersion: options.lspVersion,
      expectCommit: options.expectCommit,
      expectToolingVersion: options.expectToolingVersion,
      expectCompilerLine: options.expectCompilerLine
    });
    process.stdout.write(`  manifest: ${manifest.languageServerVersion} @ ${manifest.languageServerCommit.slice(0, 12)} (tooling ${manifest.toolingVersion})\n`);

    wipeStagingArea(serverDir);
    const serverRidDir = path.join(serverDir, rid);
    fs.mkdirSync(serverRidDir, { recursive: true });
    extractEntries(entries, serverRidDir);

    const ridDirectories = listRidDirectories(serverDir);
    if (ridDirectories.length !== 1 || ridDirectories[0] !== rid) {
      fail(`server/ must contain exactly one RID directory (${rid}); found: ${ridDirectories.join(', ') || 'none'}.`);
    }

    const entrypointPath = path.join(serverRidDir, manifest.entrypoint);
    if (!fs.existsSync(entrypointPath) || !fs.statSync(entrypointPath).isFile()) {
      fail(`Entrypoint ${manifest.entrypoint} is missing from the staged bundle.`);
    }
    if (manifest.entrypoint !== entrypoint) {
      fail(`Entrypoint ${manifest.entrypoint} != expected ${entrypoint} for ${rid}.`);
    }

    for (const nested of listRidDirectories(serverRidDir)) {
      fail(`Nested RID directory found inside the bundle: ${nested}.`);
    }

    verifyExtractedTree(serverRidDir, manifest);

    const count = walkFiles(serverRidDir).length;
    process.stdout.write(`  staged ${count} files into server/${rid}/\n`);
    process.stdout.write(`Staged server/${rid}/ from ${options.owner}/${options.repo}@${tag} (verified).\n`);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

main().catch(error => {
  if (error instanceof StageError) {
    process.stderr.write(`stage-server: ${error.message}\n`);
  } else {
    process.stderr.write(`stage-server: unexpected error: ${error?.stack ?? error}\n`);
  }
  process.exitCode = 1;
});
