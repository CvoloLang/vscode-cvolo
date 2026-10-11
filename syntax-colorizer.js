'use strict';

const vscode = require('vscode');
const { computeSyntaxColorRanges } = require('./syntax-colorizer-runtime');

const NAMESPACE_COLOR = '#D4D4D4';
const GENERIC_DELIMITER_COLOR = '#FFD700';
const TYPE_PARAMETER_COLOR = '#B8D7A3';
// TextMate syntax highlighting stays responsive while expensive document-wide
// decoration scans are delayed until typing has paused.
const DECORATION_QUIET_PERIOD_MS = 160;

function toVsCodeRanges(document, ranges) {
  return ranges.map(({ start, end }) => new vscode.Range(
    document.positionAt(start),
    document.positionAt(end)
  ));
}

function registerCvoloSyntaxColorizer(context) {
  const namespaceDecoration = vscode.window.createTextEditorDecorationType({ color: NAMESPACE_COLOR });
  const genericDelimiterDecoration = vscode.window.createTextEditorDecorationType({ color: GENERIC_DELIMITER_COLOR });
  const typeParameterDecoration = vscode.window.createTextEditorDecorationType({ color: TYPE_PARAMETER_COLOR });
  const decorationTypes = [namespaceDecoration, genericDelimiterDecoration, typeParameterDecoration];
  context.subscriptions.push(...decorationTypes);

  const pending = new Map();
  let disposed = false;

  function clearEditor(editor) {
    for (const decorationType of decorationTypes) {
      editor.setDecorations(decorationType, []);
    }
  }

  function applyToEditor(editor) {
    if (disposed) return;
    if (!editor || editor.document.languageId !== 'cvolo') {
      if (editor) clearEditor(editor);
      return;
    }
    const document = editor.document;
    const ranges = computeSyntaxColorRanges(document.getText());
    if (disposed || editor.document !== document) return;
    editor.setDecorations(namespaceDecoration, toVsCodeRanges(document, ranges.namespaceRanges));
    editor.setDecorations(genericDelimiterDecoration, toVsCodeRanges(document, ranges.genericDelimiterRanges));
    editor.setDecorations(typeParameterDecoration, toVsCodeRanges(document, ranges.typeParameterRanges));
  }

  function applyToDocument(document) {
    if (disposed) return;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === document) applyToEditor(editor);
    }
  }

  function scheduleDocument(document) {
    if (disposed || document.languageId !== 'cvolo') return;
    const key = document.uri.toString();
    const previous = pending.get(key);
    if (previous) clearTimeout(previous);
    const handle = setTimeout(() => {
      pending.delete(key);
      applyToDocument(document);
    }, DECORATION_QUIET_PERIOD_MS);
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
        disposed = true;
        for (const handle of pending.values()) clearTimeout(handle);
        pending.clear();
      }
    }
  );

  for (const editor of vscode.window.visibleTextEditors) applyToEditor(editor);
}

module.exports = { registerCvoloSyntaxColorizer };
