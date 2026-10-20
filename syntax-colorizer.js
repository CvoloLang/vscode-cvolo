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
  // Bumped whenever a presentation input changes (color theme or a Cvolo
  // setting). Decoration work captured under an older revision must never be
  // applied on top of newer presentation state.
  let presentationRevision = 0;

  function clearEditor(editor) {
    for (const decorationType of decorationTypes) {
      editor.setDecorations(decorationType, []);
    }
  }

  function capture(editor) {
    const document = editor.document;
    return {
      version: document.version,
      languageId: document.languageId,
      document,
      editor,
      presentationRevision
    };
  }

  // Every fence the INC requires in one predicate: disposal, presentation
  // revision, editor/document binding, document version and language.
  function isCurrent(snapshot) {
    return !disposed
      && snapshot.presentationRevision === presentationRevision
      && snapshot.editor.document === snapshot.document
      && snapshot.document.version === snapshot.version
      && snapshot.document.languageId === 'cvolo'
      && snapshot.languageId === 'cvolo';
  }

  function applyToEditor(editor) {
    if (disposed || !editor) return;
    if (editor.document.languageId !== 'cvolo') {
      clearEditor(editor);
      return;
    }
    // These decorations reproduce the optional VS2019 palette. Other themes
    // must retain control through TextMate scopes and semantic token mappings.
    if (vscode.workspace.getConfiguration('workbench').get('colorTheme') !== 'Cvolo VS2019 Dark') {
      clearEditor(editor);
      return;
    }
    const snapshot = capture(editor);
    if (!isCurrent(snapshot)) return;
    const ranges = computeSyntaxColorRanges(snapshot.document.getText());
    // Recheck after the scan boundary before the first apply; every subsequent
    // setDecorations call stays in this synchronous turn.
    if (!isCurrent(snapshot)) return;
    editor.setDecorations(namespaceDecoration, toVsCodeRanges(snapshot.document, ranges.namespaceRanges));
    editor.setDecorations(genericDelimiterDecoration, toVsCodeRanges(snapshot.document, ranges.genericDelimiterRanges));
    editor.setDecorations(typeParameterDecoration, toVsCodeRanges(snapshot.document, ranges.typeParameterRanges));
  }

  function applyToDocument(document) {
    if (disposed) return;
    for (const editor of vscode.window.visibleTextEditors) {
      if (editor.document === document) applyToEditor(editor);
    }
  }

  function applyToVisibleEditors() {
    for (const editor of vscode.window.visibleTextEditors) applyToEditor(editor);
  }

  function cancelPending(key) {
    const handle = pending.get(key);
    if (handle !== undefined) {
      clearTimeout(handle);
      pending.delete(key);
    }
  }

  function scheduleDocument(document) {
    const key = document.uri.toString();
    // Replacement cancels the obsolete timer for the previous revision.
    cancelPending(key);
    if (disposed || document.languageId !== 'cvolo') return;
    const version = document.version;
    const revision = presentationRevision;
    const handle = setTimeout(() => {
      pending.delete(key);
      if (disposed || revision !== presentationRevision) return;
      if (document.languageId !== 'cvolo' || document.version !== version) return;
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
    vscode.workspace.onDidOpenTextDocument(document => {
      applyToDocument(document);
    }),
    vscode.workspace.onDidChangeTextDocument(event => {
      scheduleDocument(event.document);
    }),
    vscode.workspace.onDidCloseTextDocument(document => {
      cancelPending(document.uri.toString());
    }),
    vscode.window.onDidChangeActiveColorTheme(() => {
      presentationRevision += 1;
      applyToVisibleEditors();
    }),
    vscode.workspace.onDidChangeConfiguration(event => {
      if (!event.affectsConfiguration('cvolo')
        && !event.affectsConfiguration('workbench.colorTheme')
        && !event.affectsConfiguration('workbench.colorCustomizations')
        && !event.affectsConfiguration('editor.tokenColorCustomizations')) {
        return;
      }
      // Theme changes update presentation only; Tooling is never rebound here.
      presentationRevision += 1;
      applyToVisibleEditors();
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
