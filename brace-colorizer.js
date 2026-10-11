'use strict';

const vscode = require('vscode');
const { computeBraceColorOffsets } = require('./brace-colorizer-runtime');

const BRACE_COLOR_IDS = [
  'editorBracketHighlight.foreground1',
  'editorBracketHighlight.foreground2',
  'editorBracketHighlight.foreground3'
];
const DECORATION_QUIET_PERIOD_MS = 160;

function makeRanges(document, offsets) {
  return offsets.map(offset => {
    const start = document.positionAt(offset);
    const end = document.positionAt(offset + 1);
    return new vscode.Range(start, end);
  });
}

function registerCvoloBraceColorizer(context) {
  const decorationTypes = BRACE_COLOR_IDS.map(id =>
    vscode.window.createTextEditorDecorationType({ color: new vscode.ThemeColor(id) })
  );
  context.subscriptions.push(...decorationTypes);
  const pending = new Map();
  let disposed = false;

  function clearEditor(editor) {
    for (const decorationType of decorationTypes) editor.setDecorations(decorationType, []);
  }

  function applyToEditor(editor) {
    if (disposed) return;
    if (!editor || editor.document.languageId !== 'cvolo') {
      if (editor) clearEditor(editor);
      return;
    }
    const document = editor.document;
    const groups = computeBraceColorOffsets(document.getText());
    if (disposed || editor.document !== document) return;
    for (let i = 0; i < decorationTypes.length; i += 1) {
      editor.setDecorations(decorationTypes[i], makeRanges(document, groups[i]));
    }
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

module.exports = { registerCvoloBraceColorizer };
