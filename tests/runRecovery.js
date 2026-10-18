'use strict';

// Explicit opt-in to the full VS Code/LSP recovery matrix.
// PowerShell: $env:CVOLO_E2E_SERVER = 'D:\\path\\to\\cvolo-language-server.exe'
//            npm run test:recovery
if (!process.env.CVOLO_E2E_SERVER) {
    console.error('Set CVOLO_E2E_SERVER to the absolute path of the newly built LSP executable.');
    process.exit(1);
}
process.env.CVOLO_RUN_RECOVERY_E2E = '1';
require('./runTest');
