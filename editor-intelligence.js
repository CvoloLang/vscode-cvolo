'use strict';

const vscode = require('vscode');
const {
  LAYOUT_SCHEME,
  REFERENCE_PROVIDER_COMMAND,
  SHOW_REFERENCES_COMMAND,
  SHOW_REFERENCES_EDITOR_COMMAND,
  SHOW_TYPE_LAYOUT_COMMAND,
  TYPE_LAYOUT_REQUEST,
  formatTypeLayout,
  layoutDocumentDescriptor,
  normalizeTypeLayout,
  parseSourceTarget,
  typeLayoutRequestParams
} = require('./editor-intelligence-runtime');

function formatError(error) {
  return error?.message ?? String(error);
}

function activeSourceTarget() {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    return null;
  }

  return {
    uri: editor.document.uri.toString(),
    position: {
      line: editor.selection.active.line,
      character: editor.selection.active.character
    }
  };
}

function resolveSourceTarget(args) {
  return parseSourceTarget(args) ?? activeSourceTarget();
}

async function showReferences(args, log) {
  const target = resolveSourceTarget(args);
  if (!target) {
    void vscode.window.showWarningMessage('Cvolo: open a Cvolo file and place the cursor on a declaration.');
    return;
  }

  const uri = vscode.Uri.parse(target.uri);
  const position = new vscode.Position(target.position.line, target.position.character);

  const locations = await vscode.commands.executeCommand(REFERENCE_PROVIDER_COMMAND, uri, position);
  const results = Array.isArray(locations) ? locations : [];

  log(`show references: ${results.length} location(s) at ${target.uri}:${target.position.line + 1}`);

  await vscode.commands.executeCommand(SHOW_REFERENCES_EDITOR_COMMAND, uri, position, results);
}

// The two viewer settings, read at the moment the document is written. The notation and the padding
// share are presentation choices about numbers the compiler already reported, so they are read here
// and never carried through the language server request.
function layoutViewOptions() {
  const layout = vscode.workspace.getConfiguration('cvolo').get('layout', {});

  return {
    offsetFormat: layout.offsetFormat,
    showPaddingPercentage: layout.showPaddingPercentage
  };
}

async function showTypeLayout(args, getClient, documents, log) {
  const target = resolveSourceTarget(args);
  if (!target) {
    void vscode.window.showWarningMessage('Cvolo: open a Cvolo file and place the cursor on a type.');
    return;
  }

  const client = getClient();
  if (!client) {
    void vscode.window.showErrorMessage('Cvolo Language Server is not running.');
    return;
  }

  let response;
  try {
    response = await client.sendRequest(TYPE_LAYOUT_REQUEST, typeLayoutRequestParams(target));
  } catch (error) {
    void vscode.window.showErrorMessage(`Cvolo: type layout request failed. ${formatError(error)}`);
    return;
  }

  const layout = normalizeTypeLayout(response);
  if (!layout) {
    void vscode.window.showInformationMessage('Cvolo: no type layout is available at this position.');
    return;
  }

  const uri = vscode.Uri.from(layoutDocumentDescriptor(layout));
  documents.set(uri.toString(), formatTypeLayout(layout, layoutViewOptions()));

  log(`show type layout: ${layout.typeDisplay} (${layout.targetDisplay}) for ${target.uri}`);

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside
  });
}

function registerEditorIntelligence(context, { getClient, log = () => {} }) {
  const documents = new Map();

  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(LAYOUT_SCHEME, {
    provideTextDocumentContent: uri => documents.get(uri.toString()) ?? ''
  }));

  context.subscriptions.push(vscode.commands.registerCommand(SHOW_REFERENCES_COMMAND, async (...args) => {
    try {
      await showReferences(args, log);
    } catch (error) {
      log(`show references failed: ${formatError(error)}`);
      void vscode.window.showErrorMessage(`Cvolo: showing references failed. ${formatError(error)}`);
    }
  }));

  context.subscriptions.push(vscode.commands.registerCommand(SHOW_TYPE_LAYOUT_COMMAND, async (...args) => {
    try {
      await showTypeLayout(args, getClient, documents, log);
    } catch (error) {
      log(`show type layout failed: ${formatError(error)}`);
      void vscode.window.showErrorMessage(`Cvolo: showing the type layout failed. ${formatError(error)}`);
    }
  }));
}

module.exports = {
  registerEditorIntelligence
};
