'use strict';

// Extension-host test entry point (INC "Stable Editor Intelligence" change #5).
//
// Downloads a real VS Code build with @vscode/test-electron, then launches it as an
// extension development host with this folder force-loaded and the Mocha suite in
// tests/suite/index.js as the test runner. Ordinary `node --test` never scans this
// directory (Node only auto-discovers a literal `test/` folder), so the fast unit
// suite in test/ and this host suite stay independent.
//
// Run with: npm run test:host

const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { runTests } = require('@vscode/test-electron');

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
    const workspacePath = path.resolve(__dirname, 'fixtures', 'workspace');

    // A recovery run must use the exact freshly built executable under test.
    // Give VS Code a private user profile so the override is effective on
    // Windows too, without altering the developer's personal settings.
    const recovery = process.env.CVOLO_RUN_RECOVERY_E2E === '1';
    const server = process.env.CVOLO_E2E_SERVER;
    if (recovery && (!server || !path.isAbsolute(server) || !fs.statSync(server, { throwIfNoEntry: false })?.isFile())) {
        throw new Error('Set CVOLO_E2E_SERVER to an existing absolute Language Server executable for recovery E2E');
    }
    if (recovery) {
        // The binary's embedded revision is the development build identity:
        // never infer it from the extension checkout or the executable filename.
        const probe = spawnSync(server, ['--version', '--json'], {
            encoding: 'utf8', windowsHide: true, timeout: 15000
        });
        if (probe.error || probe.status !== 0) {
            throw new Error('Cannot read server build identity (--version --json): '
                + (probe.error?.message || probe.stderr || 'exit ' + probe.status));
        }
        let version;
        try {
            version = JSON.parse(probe.stdout.trim());
        } catch {
            throw new Error('Language Server --version --json must return one JSON object');
        }
        const sha = /^[0-9a-f]{40}$/i;
        if (!sha.test(version.languageServerCommit || '')) {
            throw new Error('LSP development build has no embedded commit SHA: '
                + String(version.languageServerCommit));
        }
        console.log('[recovery:e2e] LSP dev revision:', version.languageServerCommit);
        console.log('[recovery:e2e] Tooling release:', version.toolingVersion,
            'source revision:', version.toolingCommit || 'unknown');
        if (process.env.CVOLO_E2E_LSP_COMMIT
            && version.languageServerCommit !== process.env.CVOLO_E2E_LSP_COMMIT) {
            throw new Error('Running LSP commit differs from CVOLO_E2E_LSP_COMMIT');
        }
        if (process.env.CVOLO_E2E_TOOLING_COMMIT
            && version.toolingCommit !== process.env.CVOLO_E2E_TOOLING_COMMIT) {
            throw new Error('Running Tooling commit differs from CVOLO_E2E_TOOLING_COMMIT');
        }
    }
    const userDataDir = recovery ? fs.mkdtempSync(path.join(os.tmpdir(), 'cvolo-e2e-user-')) : null;
    if (userDataDir) {
        fs.mkdirSync(path.join(userDataDir, 'User'), { recursive: true });
        fs.writeFileSync(path.join(userDataDir, 'User', 'settings.json'),
            JSON.stringify({ 'cvolo.server.path': server }, null, 2));
    }
    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                workspacePath,
                ...(userDataDir ? ['--user-data-dir', userDataDir] : []),
                '--disable-extensions',
                '--disable-workspace-trust',
                '--skip-welcome'
            ]
        });
    } catch (error) {
        console.error('Cvolo extension-host tests failed:', error);
        process.exitCode = 1;
    } finally {
        if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    }
}

void main();
