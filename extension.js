'use strict';

const vscode = require('vscode');
const { LanguageClient, RevealOutputChannelOn } = require('vscode-languageclient/node');
const { LifecycleController, resolveServerCommand } = require('./extension-runtime');
const { registerCvoloBraceColorizer } = require('./brace-colorizer');
const { registerCvoloSyntaxColorizer } = require('./syntax-colorizer');

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

function reportResolutionFailure(error) {
  const message = formatError(error);
  outputChannel?.appendLine(`[client] server resolution failed: ${message}`);
  void vscode.window.showErrorMessage(
    `Cvolo Language Server could not be resolved. ${message}`
  );
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
  outputChannel.appendLine('[client] server arguments: --stdio');

  const serverOptions = {
    command: resolved.command,
    args: ['--stdio']
  };

  const clientOptions = {
    documentSelector: [{ scheme: 'file', language: 'cvolo' }],
    outputChannel,
    revealOutputChannelOn: RevealOutputChannelOn.Error,
    connectionOptions: {
      maxRestartCount: 0
    }
  };

  const nextClient = new LanguageClient(
    'cvolo',
    'Cvolo Language Server',
    serverOptions,
    clientOptions
  );

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
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('cvolo.server.path')) {
        return;
      }

      requestRestart('cvolo.server.path changed');
    })
  );

  schedule(lifecycle.start('initial start'));
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
  deactivate
};
