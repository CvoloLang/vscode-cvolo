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
const { runTests } = require('@vscode/test-electron');

async function main() {
    const extensionDevelopmentPath = path.resolve(__dirname, '..');
    const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
    const workspacePath = path.resolve(__dirname, 'fixtures', 'workspace');

    try {
        await runTests({
            extensionDevelopmentPath,
            extensionTestsPath,
            launchArgs: [
                workspacePath,
                '--disable-extensions',
                '--disable-workspace-trust',
                '--skip-welcome'
            ]
        });
    } catch (error) {
        console.error('Cvolo extension-host tests failed:', error);
        process.exit(1);
    }
}

void main();
