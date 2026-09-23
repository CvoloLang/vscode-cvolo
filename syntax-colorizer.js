'use strict';

const vscode = require('vscode');
const { computeSyntaxColorRanges } = require('./syntax-colorizer-runtime');

const NAMESPACE_COLOR = '#D4D4D4';
const GENERIC_DELIMITER_COLOR = '#FFD700';
const TYPE_PARAMETER_COLOR = '#B8D7A3';

function toVsCodeRanges(document, ranges) {
  return ranges.map(({ start, end }) => new vscode.Range(
    document.positionAt(start),
    document.positionAt(end)
  ));
}

function registerCvoloSyntaxColorizer(context) {
  const namespaceDecoration = vscode.window.createTextEditorDecorationType({
    color: NAMESPACE_COLOR
  });
  const genericDelimiterDecoration = vscode.window.createTextEditorDecorationType({
    color: GENERIC_DELIMITER_COLOR
  });
  const typeParameterDecoration = vscode.window.createTextEditorDecorationType({
    color: TYPE_PARAMETER_COLOR
  });

  const decorationTypes = [
    namespaceDecoration,
    genericDelimiterDecoration,
    typeParameterDecoration
  ];
  context.subscriptions.push(...decorationTypes);

  const pending = new Map();

  function clearEditor(editor) {
    for (const decorationType of decorationTypes) {
      editor.setDecorations(decorationType, []);
    }
  }

  function applyToEditor(editor) {
    if (!editor || editor.document.languageId !== 'cvolo') {
      if (editor) clearEditor(editor);
      return;
    }

    const ranges = computeSyntaxColorRanges(editor.document.getText());
    editor.setDecorations(namespaceDecoration, toVsCodeRanges(editor.document, ranges.namespaceRanges));
    editor.setDecorations(genericDelimiterDecoration, toVsCodeRanges(editor.document, ranges.genericDelimiterRanges));
    editor.setDecorations(typeParameterDecoration, toVsCodeRanges(editor.document, ranges.typeParameterRanges));
  }

  function applyToDocument(document) {
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === document) applyToEditor(editor);
    }
  }

  function scheduleDocument(document) {
    if (document.languageId !== 'cvolo') return;

    const key = document.uri.toString();
    const previous = pending.get(key);
    if (previous) clearTimeout(previous);

    const handle = setTimeout(() => {
      pending.delete(key);
      applyToDocument(document);
    }, 40);

    pending.set(key, handle);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (editor) applyToEditor(editor);
    }),
    vscode.window.onDidChangeVisibleTextEditors(editors => {
      for (const editor of editors) applyToEditor(editor);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      scheduleDocument(event.document);
    }),
    {
      dispose() {
        for (const handle of pending.values()) clearTimeout(handle);
        pending.clear();
      }
    }
  );

  for (const editor of vscode.window.visibleTextEditors) {
    applyToEditor(editor);
  }
}

module.exports = {
  registerCvoloSyntaxColorizer
};
