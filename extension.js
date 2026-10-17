'use strict';

const vscode = require('vscode');
const fs = require('fs');
const path = require('path');
const { LanguageClient, RevealOutputChannelOn } = require('vscode-languageclient/node');
const { LifecycleController, currentRid, formatBundleProvenance, readBundleManifest, resolveServerCommand, supportsDiagnosticLogDirectory, supportsContinuousLog, debugLogPath, pruneDebugLogs } = require('./extension-runtime');
const { registerCvoloBraceColorizer } = require('./brace-colorizer');
const { registerCvoloSyntaxColorizer } = require('./syntax-colorizer');
const { registerEditorIntelligence } = require('./editor-intelligence');

let lifecycle;
let outputChannel;

function formatError(error) {
  return error?.message ?? String(error);
}

function configuredServerPath() {
  return vscode.workspace
    .getConfiguration('cvolo')
    .get('server.path', '');
}

function configuredLibraryPaths() {
  const value = vscode.workspace
    .getConfiguration('cvolo')
    .get('libraryPaths', []);

  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string' && item.trim().length > 0)
    : [];
}

function reportResolutionFailure(error) {
  const message = formatError(error);
  outputChannel?.appendLine(`[client] server resolution failed: ${message}`);
  void vscode.window.showErrorMessage(
    `Cvolo Language Server could not be resolved. ${message}`
  );
}

// The server cannot infer a managed location; the client owns the path. Logs live
// under the extension's private global storage, never in the user's workspace.
function diagnosticLogDirectory(context) {
  return path.join(context.globalStorageUri.fsPath, 'logs');
}

function newestDiagnosticLog(directory) {
  let entries;
  try {
    entries = fs.readdirSync(directory, { withFileTypes: true });
  } catch {
    return undefined;
  }

  let newest;
  let newestTime = -Infinity;
  for (const entry of entries) {
    if (!entry.isFile() || !(entry.name.startsWith('cvolo-lsp-') || entry.name.startsWith('cvolo-debug-')) || !entry.name.endsWith('.log')) {
      continue;
    }

    const candidate = path.join(directory, entry.name);
    try {
      const time = fs.statSync(candidate).mtimeMs;
      if (time > newestTime) {
        newestTime = time;
        newest = candidate;
      }
    } catch {
      // A log rotated away between read and stat is simply not a candidate.
    }
  }

  return newest;
}

async function openDiagnosticLog(context) {
  const directory = diagnosticLogDirectory(context);
  const target = newestDiagnosticLog(directory);
  if (!target) {
    void vscode.window.showInformationMessage(
      'No Cvolo log is available. Enable cvolo.debug.logging to save an ongoing debug log, or wait for an internal error to create an incident log.'
    );
    return;
  }

  try {
    const document = await vscode.workspace.openTextDocument(vscode.Uri.file(target));
    await vscode.window.showTextDocument(document, { preview: false });
  } catch (error) {
    void vscode.window.showErrorMessage(`Could not open the Cvolo diagnostic log: ${formatError(error)}`);
  }
}

function logBundledProvenance(context, source) {
  const bundle = readBundleManifest({
    extensionRoot: context.extensionPath,
    platform: process.platform,
    arch: process.arch
  });

  if (!bundle) {
    outputChannel.appendLine(
      `[client] bundled server manifest (server/${currentRid()}/bundle-manifest.json) could not be read.`
    );
    return;
  }

  for (const line of formatBundleProvenance(bundle.manifest, source)) {
    outputChannel.appendLine(line);
  }
}

// A transient ingress-admission timeout means the server could not admit the request before the
// input barrier timed out while edits were still draining. The typed error stays on the wire
// (RequestFailed / cvoloKind=InputBarrierTimeout) so the contract is never weakened; the client
// only declines to escalate it to a user-visible error notification, because the request is
// retried by the editor once typing settles.
function isTransientAdmissionTimeout(error) {
  return error?.code === -32803 && error?.data?.cvoloKind === 'InputBarrierTimeout';
}

class CvoloLanguageClient extends LanguageClient {
  handleFailedRequest(type, token, error, defaultValue, showNotification = true) {
    if (isTransientAdmissionTimeout(error)) {
      outputChannel?.appendLine(
        `[client] ${type.method} deferred: the server was still applying input.`
      );
      return defaultValue;
    }

    return super.handleFailedRequest(type, token, error, defaultValue, showNotification);
  }
}

async function createAndStartClient(context) {
  let resolved;
  try {
    resolved = resolveServerCommand({
      configuredPath: configuredServerPath(),
      extensionRoot: context.extensionPath,
      platform: process.platform,
      arch: process.arch
    });
  } catch (error) {
    reportResolutionFailure(error);
    throw error;
  }

  outputChannel.appendLine(
    `[client] starting Cvolo Language Server from ${resolved.source}: ${resolved.command}`
  );

  if (resolved.source.startsWith('bundled ')) {
    logBundledProvenance(context, resolved.source);
  }

  const serverArguments = ['--stdio'];
  const debugMode = vscode.workspace.getConfiguration('cvolo').get('debug.logging', 'auto');
  const debugEnabled = debugMode === 'on' || (debugMode === 'auto' && context.extensionMode === vscode.ExtensionMode.Development);
  if (debugEnabled) {
    const directory = diagnosticLogDirectory(context);
    if (supportsContinuousLog(resolved.command)) {
      try {
        fs.mkdirSync(directory, { recursive: true });
        pruneDebugLogs(directory);
        const logFile = debugLogPath(directory);
        serverArguments.push('--log', logFile);
        outputChannel.appendLine('[client] debug log: ' + logFile + ' (no raw JSON-RPC frames)');
      } catch (error) {
        outputChannel.appendLine('[client] unable to create debug log directory: ' + formatError(error));
      }
    } else {
      outputChannel.appendLine('[client] selected server does not support --log; debug logging unavailable.');
    }
  }
  const diagnosticDirectory = diagnosticLogDirectory(context);
  if (supportsDiagnosticLogDirectory(resolved.command)) {
    serverArguments.push('--diagnostic-log-dir', diagnosticDirectory);
  } else {
    outputChannel.appendLine(
      '[client] this server build does not support --diagnostic-log-dir; the session diagnostic log will not be materialized.'
    );
  }

  outputChannel.appendLine(`[client] server arguments: ${serverArguments.join(' ')}`);

  const serverOptions = {
    command: resolved.command,
    args: serverArguments
  };

  const clientOptions = {
    documentSelector: [{ scheme: 'file', language: 'cvolo' }],
    initializationOptions: {
      libraryPaths: configuredLibraryPaths()
    },
    outputChannel,
    revealOutputChannelOn: RevealOutputChannelOn.Error,
    synchronize: {
      configurationSection: 'cvolo'
    },
    connectionOptions: {
      maxRestartCount: 0
    }
  };

  const nextClient = new CvoloLanguageClient(
    'cvolo',
    'Cvolo Language Server',
    serverOptions,
    clientOptions
  );

  // The anchored-lens handshake is a client capability the extension owns. vscode-languageclient has
  // no clientOptions.capabilities slot, so it is contributed as a static feature before start().
  // Advertising it tells the server it may hand out opaque anchored lens tokens; a client that does
  // not advertise it receives only inert lens text, never a positional command.
  nextClient.registerFeature({
    fillClientCapabilities(capabilities) {
      const experimental = capabilities.experimental ?? {};
      experimental.cvoloAnchoredLens = { version: 3, validateAction: true };
      capabilities.experimental = experimental;
    },
    // vscode-languageclient treats every registered feature as a full Feature:
    // initialize() is called from LanguageClient.start() and clear()/dispose() during
    // teardown. All three must exist or start() throws "feature.initialize is not a function".
    initialize() { },
    clear() { },
    dispose() { }
  });

  try {
    await nextClient.start();
    return nextClient;
  } catch (error) {
    outputChannel.appendLine(
      `[client] LanguageClient start/initialization failed (${resolved.source}: ${resolved.command}): ${formatError(error)}`
    );

    try {
      await nextClient.stop();
    } catch (cleanupError) {
      outputChannel.appendLine(
        `[client] failed to clean up after startup failure: ${formatError(cleanupError)}`
      );
    }

    // vscode-languageclient owns any user-facing notification for failures that
    // occur after LanguageClient.start() takes over the startup sequence.
    throw error;
  }
}

async function stopClient(client) {
  await client.stop();
}

function schedule(operation) {
  void operation.catch(() => undefined);
}

function requestRestart(reason) {
  const currentLifecycle = lifecycle;
  if (!currentLifecycle || currentLifecycle.isDeactivating) {
    return;
  }

  outputChannel?.appendLine(`[client] restarting Language Server: ${reason}`);
  schedule(currentLifecycle.restart(reason));
}

async function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Cvolo Language Server');
  context.subscriptions.push(outputChannel);

  registerCvoloBraceColorizer(context);
  registerCvoloSyntaxColorizer(context);
  registerEditorIntelligence(context, {
    getClient: () => lifecycle?.client,
    log: message => outputChannel?.appendLine(`[client] ${message}`)
  });

  lifecycle = new LifecycleController({
    startClient: () => createAndStartClient(context),
    stopClient,
    onError: (reason, error) => {
      outputChannel?.appendLine(`[client] lifecycle operation failed (${reason}): ${formatError(error)}`);
    }
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('cvolo.restartLanguageServer', () => {
      requestRestart('manual command');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('cvolo.openDiagnosticLog', () => {
      schedule(openDiagnosticLog(context));
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(event => {
      const serverPathChanged = event.affectsConfiguration('cvolo.server.path');
      const libraryPathsChanged = event.affectsConfiguration('cvolo.libraryPaths');
      const debugModeChanged = event.affectsConfiguration('cvolo.debug.logging');
      if (!serverPathChanged && !libraryPathsChanged && !debugModeChanged) {
        return;
      }

      requestRestart(libraryPathsChanged
        ? 'cvolo.libraryPaths changed'
        : debugModeChanged ? 'cvolo.debug.logging changed' : 'cvolo.server.path changed');
    })
  );

  schedule(lifecycle.start('initial start'));

  return { getClient: () => lifecycle?.client };
}

async function deactivate() {
  const currentLifecycle = lifecycle;

  if (currentLifecycle) {
    const deactivation = currentLifecycle.deactivate('deactivate');
    lifecycle = undefined;
    await deactivation.catch(() => undefined);
  } else {
    lifecycle = undefined;
  }

  outputChannel = undefined;
}

module.exports = {
  activate,
  deactivate,
  getClient: () => lifecycle?.client
};