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
