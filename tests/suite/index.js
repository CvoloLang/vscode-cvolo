'use strict';

// Mocha runner for the extension-host suite. @vscode/test-electron loads this module
// inside the VS Code extension host and calls run() exactly once.

const fs = require('node:fs');
const path = require('node:path');
const Mocha = require('mocha');

async function run() {
    const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 60000 });

    for (const file of fs.readdirSync(__dirname)) {
        if (file.endsWith('.host.js')
            && (process.env.CVOLO_RUN_RECOVERY_E2E === '1'
                || file !== 'zz-declaration-recovery.host.js')) {
            mocha.addFile(path.join(__dirname, file));
        }
    }

    return new Promise((resolve, reject) => {
        try {
            mocha.run(failures => {
                if (failures > 0) {
                    reject(new Error(`${failures} extension-host test(s) failed`));
                } else {
                    resolve();
                }
            });
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { run };
