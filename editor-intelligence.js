'use strict';

const vscode = require('vscode');
const {
  ANCHORED_ACTION_KIND_SHOW_LAYOUT,
  ANCHORED_ACTION_KIND_SHOW_REFERENCES,
  ANCHORED_ACTION_KIND_UNAVAILABLE,
  EXECUTE_ANCHORED_LENS_COMMAND,
  LAYOUT_SCHEME,
  LAYOUT_UNAVAILABLE_TEXT,
  REFERENCE_PROVIDER_COMMAND,
  RESOLVE_ANCHORED_LENS_REQUEST,
  SHOW_REFERENCES_COMMAND,
  SHOW_REFERENCES_EDITOR_COMMAND,
  SHOW_TYPE_LAYOUT_COMMAND,
  TYPE_LAYOUT_REQUEST,
  VALIDATE_ANCHORED_ACTION_REQUEST,
  anchoredLensRequest,
  formatByteCount,
  fieldRepresentation,
  isInsideAggregateInitializer,
  layoutDocumentDescriptor,
  normalizeAnchoredResult,
  normalizeTypeLayout,
  parseSourceTarget,
  renderLayout,
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

async function showTypeLayout(args, getClient, views, log) {
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

  await presentLayout(response, target.uri, views, log);
}

// Writes one compiler layout into a generated read-only view. The registry entry is presentation
// state: the latest text, the spans to navigate by, the compiler's subject so the view can be
// re-asked, the source document that anchors it, and a generation so a slow answer cannot replace a
// newer one (§45). A manual Show Type Layout and an anchored lens action share this path, so an
// anchored view refreshes exactly like a manual one.
async function presentLayout(value, anchorUri, views, log) {
  const layout = normalizeTypeLayout(value);
  if (!layout) {
    void vscode.window.showInformationMessage('Cvolo: no type layout is available at this position.');
    return;
  }

  const options = layoutViewOptions();
  const view = renderLayout(layout, options);

  const uri = vscode.Uri.from(layoutDocumentDescriptor(layout));
  views.set(uri.toString(), {
    text: view.text,
    tokens: view.tokens,
    options,
    subject: layout.subject,
    anchor: { uri: anchorUri },
    generation: 0
  });

  log(`show type layout: ${layout.typeDisplay} (${layout.targetDisplay}) for ${anchorUri}`);

  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document, {
    preview: true,
    viewColumn: vscode.ViewColumn.Beside
  });
}

// An anchored lens click. The lens carries only an opaque token; the server re-resolves the action
// against the snapshot that is current and hands back a second, single-use token. The extension asks
// the server to validate that second token before it does anything, and then performs exactly the
// action the server returned — it never re-queries the reference provider with a stale position
// (§19-§22, §47).
async function executeAnchoredLens(args, getClient, views, log) {
  const client = getClient();
  if (!client) {
    void vscode.window.showErrorMessage('Cvolo Language Server is not running.');
    return;
  }

  const request = anchoredLensRequest(args);
  if (!request) {
    log('anchored lens ignored: the command did not carry a v3 lens token');
    return;
  }

  let response;
  try {
    response = await client.sendRequest('workspace/executeCommand', {
      command: RESOLVE_ANCHORED_LENS_REQUEST,
      arguments: [request]
    });
  } catch (error) {
    void vscode.window.showErrorMessage(`Cvolo: the lens action could not be resolved. ${formatError(error)}`);
    return;
  }

  const action = normalizeAnchoredResult(response);
  if (!action || action.kind === ANCHORED_ACTION_KIND_UNAVAILABLE) {
    void vscode.window.showInformationMessage('Cvolo: this lens is no longer valid for the current document.');
    return;
  }

  let validation;
  try {
    validation = await client.sendRequest(VALIDATE_ANCHORED_ACTION_REQUEST, { actionToken: action.actionToken });
  } catch (error) {
    void vscode.window.showErrorMessage(`Cvolo: the lens action could not be validated. ${formatError(error)}`);
    return;
  }

  if (!validation || validation.valid !== true) {
    void vscode.window.showInformationMessage('Cvolo: this lens is no longer valid for the current document.');
    return;
  }

  if (action.kind === ANCHORED_ACTION_KIND_SHOW_REFERENCES) {
    if (!action.anchor) {
      void vscode.window.showInformationMessage('Cvolo: this lens is no longer valid for the current document.');
      return;
    }

    const uri = vscode.Uri.parse(action.wireUri ?? request.wireUri);
    const position = new vscode.Position(action.anchor.line, action.anchor.character);
    const locations = action.locations.map(toLocation).filter(location => location !== null);

    log(`anchored references: ${locations.length} location(s) at ${uri.toString()}:${action.anchor.line + 1}`);

    await vscode.commands.executeCommand(SHOW_REFERENCES_EDITOR_COMMAND, uri, position, locations);
    return;
  }

  if (action.kind === ANCHORED_ACTION_KIND_SHOW_LAYOUT) {
    await presentLayout(action.layout, action.wireUri ?? request.wireUri, views, log);
  }
}

// A view re-renders from the same registry entry, so a refresh only replaces the text and the spans.
// A null answer means the type the view was about is gone; the view says so instead of keeping the
// numbers it was opened with (§30).
function applyLayoutResponse(entry, response) {
  const layout = normalizeTypeLayout(response);
  if (!layout) {
    entry.text = LAYOUT_UNAVAILABLE_TEXT;
    entry.tokens = [];
    return;
  }

  const view = renderLayout(layout, entry.options);
  entry.text = view.text;
  entry.tokens = view.tokens;
}

// Edits arrive in bursts, so a refresh waits for a short quiet period before it runs. The refresh
// walks every open view and re-asks by the compiler's subject; the server re-resolves it against the
// snapshot that is current, so the numbers always describe the program as it is now, not as it was
// when the view opened (§27-§29).
const REFRESH_DEBOUNCE_MS = 200;

function createLayoutRefresher(getClient, views, layoutChanged, log) {
  let timer = null;

  function schedule() {
    if (timer !== null) {
      clearTimeout(timer);
    }

    timer = setTimeout(async () => {
      timer = null;

      const client = getClient();
      if (!client) {
        return;
      }

      for (const [key, entry] of views) {
        if (!entry.subject) {
          continue;
        }

        const generation = ++entry.generation;
        let response;
        try {
          response = await client.sendRequest(
            TYPE_LAYOUT_REQUEST,
            typeLayoutRequestParams({ uri: entry.anchor.uri, subject: entry.subject })
          );
        } catch (error) {
          log(`layout refresh failed: ${formatError(error)}`);
          continue;
        }

        // A slower answer must not replace a newer one (§55).
        if (entry.generation !== generation) {
          continue;
        }

        entry.options = layoutViewOptions();
        applyLayoutResponse(entry, response);
        layoutChanged.fire(vscode.Uri.parse(key));
      }
    }, REFRESH_DEBOUNCE_MS);
  }

  return { schedule };
}

// The token whose span contains the cursor, if any. The server decided what each span means; the
// extension only asks "is the cursor inside it", so no displayed text is ever parsed (§19).
function tokenAt(tokens, position) {
  for (const token of tokens) {
    if (token.line === position.line && position.character >= token.start && position.character <= token.end) {
      return token;
    }
  }

  return null;
}

function toLocation(target) {
  if (!target) {
    return null;
  }

  return new vscode.Location(
    vscode.Uri.parse(target.uri),
    new vscode.Position(target.position.line, target.position.character)
  );
}

function factsBlock(facts) {
  const width = facts.reduce((longest, [label]) => Math.max(longest, label.length + 1), 0);
  const body = facts.map(([label, text]) => `${label}:`.padEnd(width) + '  ' + text).join('\n');
  return ['```text', body, '```'].join('\n');
}

function fieldHover(token, options) {
  const facts = [
    ['Offset', formatByteCount(token.offset, options, true)],
    ['Size', formatByteCount(token.size, options, true)],
    ['Alignment', formatByteCount(token.alignment, options, true)]
  ];
  const representation = fieldRepresentation(token.typeDisplay);
  if (representation) {
    facts.push(['Representation', representation]);
  }

  const blocks = [`\`\`\`cvolo\n${token.signature}\n\`\`\``, factsBlock(facts)];
  if (token.documentation) {
    blocks.push(token.documentation);
  }

  return blocks.join('\n\n');
}

function typeHover(token, options) {
  if (!token.facts) {
    return `\`\`\`cvolo\n${token.display}\n\`\`\``;
  }

  const facts = token.facts;
  const lines = [];

  if (facts.elementCount !== null && facts.elementSize !== null) {
    lines.push(['Length', String(facts.elementCount)]);
    lines.push(['Element size', formatByteCount(facts.elementSize, options, true)]);
    if (facts.stride !== null) {
      lines.push(['Stride', formatByteCount(facts.stride, options, true)]);
    }
    lines.push(['Total size', formatByteCount(facts.size, options, true)]);
    lines.push(['Alignment', formatByteCount(facts.alignment, options, true)]);
  } else {
    lines.push(['Size', formatByteCount(facts.size, options, true)]);
    lines.push(['Alignment', formatByteCount(facts.alignment, options, true)]);
  }

  return [`\`\`\`cvolo\n${token.display}\n\`\`\``, factsBlock(lines)].join('\n\n');
}

function paddingHover(token, options) {
  if (token.paddingKind === 'tail') {
    return `${formatByteCount(token.size, options, true)} of tail padding required to preserve the type's ${token.alignment}-byte alignment.`;
  }

  const before = token.before ? ` before field '${token.before}'` : '';
  return `${formatByteCount(token.size, options, true)} of alignment padding${before}.`;
}

function hoverMarkdown(token, options) {
  switch (token.kind) {
    case 'field':
      return fieldHover(token, options);
    case 'padding':
      return paddingHover(token, options);
    default:
      return typeHover(token, options);
  }
}

function registerLayoutProviders(context, views) {
  context.subscriptions.push(vscode.languages.registerDefinitionProvider({ scheme: LAYOUT_SCHEME }, {
    provideDefinition: (document, position) => {
      const view = views.get(document.uri.toString());
      if (!view) {
        return null;
      }

      const token = tokenAt(view.tokens, position);
      // A padding row describes a gap in the layout; there is nothing in the source for it to open.
      if (!token || token.kind === 'padding') {
        return null;
      }

      return toLocation(token.definition);
    }
  }));

  context.subscriptions.push(vscode.languages.registerHoverProvider({ scheme: LAYOUT_SCHEME }, {
    provideHover: (document, position) => {
      const view = views.get(document.uri.toString());
      if (!view) {
        return null;
      }

      const token = tokenAt(view.tokens, position);
      return token ? new vscode.Hover(hoverMarkdown(token, view.options)) : null;
    }
  }));

  // A concrete nested aggregate type can open its own layout. The target is the compiler's, so the
  // lens reuses the same command with the server-resolved location; no name is resolved here (§24).
  context.subscriptions.push(vscode.languages.registerCodeLensProvider({ scheme: LAYOUT_SCHEME }, {
    provideCodeLenses: document => {
      const view = views.get(document.uri.toString());
      if (!view) {
        return [];
      }

      const lenses = [];
      for (const token of view.tokens) {
        if (token.kind === 'type' && token.nestedLayout) {
          lenses.push(new vscode.CodeLens(
            new vscode.Range(token.line, token.start, token.line, token.end),
            {
              title: 'Show Layout',
              command: SHOW_TYPE_LAYOUT_COMMAND,
              arguments: [token.nestedLayout.uri, token.nestedLayout.position]
            }
          ));
        }
      }

      return lenses;
    }
  }));
}

// When Enter is pressed inside a recognized aggregate initializer's braces, keep the field
// suggestions reachable without making the user invoke Ctrl+Space. Guarded by a client-side
// brace/`=` scan so ordinary blocks, calls and unrelated braces never trigger a request.
function maybeTriggerInitializerSuggest(event) {
  const editor = vscode.window.visibleTextEditors.find(candidate => candidate.document === event.document);
  if (!editor) {
    return;
  }

  const insertedNewline = event.contentChanges.some(change => /[\r\n]/.test(change.text));
  if (!insertedNewline) {
    return;
  }

  const text = event.document.getText();
  const offset = event.document.offsetAt(editor.selection.active);
  if (!isInsideAggregateInitializer(text, offset)) {
    return;
  }

  void vscode.commands.executeCommand('editor.action.triggerSuggest');
}

function registerEditorIntelligence(context, { getClient, log = () => {} }) {
  const views = new Map();

  // An open view is text the extension owns, so a refresh has to tell the editor to ask for it again.
  const layoutChanged = new vscode.EventEmitter();
  context.subscriptions.push(layoutChanged);

  context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider(LAYOUT_SCHEME, {
    onDidChange: layoutChanged.event,
    provideTextDocumentContent: uri => views.get(uri.toString())?.text ?? ''
  }));

  registerLayoutProviders(context, views);

  // Every open view is re-asked when a Cvolo document changes or a viewer setting changes. The
  // project's own semantic generation and target live on the server side of the snapshot, so the
  // client only has to know that something relevant moved (§29).
  const refresher = createLayoutRefresher(getClient, views, layoutChanged, log);
  context.subscriptions.push(vscode.workspace.onDidChangeTextDocument(event => {
    if (event.document.languageId === 'cvolo') {
      refresher.schedule();
      maybeTriggerInitializerSuggest(event);
    }
  }));
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(event => {
    if (event.affectsConfiguration('cvolo')) {
      refresher.schedule();
    }
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
      await showTypeLayout(args, getClient, views, log);
    } catch (error) {
      log(`show type layout failed: ${formatError(error)}`);
      void vscode.window.showErrorMessage(`Cvolo: showing the type layout failed. ${formatError(error)}`);
    }
  }));

  // The only command an anchored lens may carry. It forwards the opaque lens token to the server and
  // performs the action the server validated; the legacy cvolo.showReferences command is not a lens
  // bridge and is never reachable from a lens (§20).
  context.subscriptions.push(vscode.commands.registerCommand(EXECUTE_ANCHORED_LENS_COMMAND, async (...args) => {
    try {
      await executeAnchoredLens(args, getClient, views, log);
    } catch (error) {
      log(`anchored lens failed: ${formatError(error)}`);
      void vscode.window.showErrorMessage(`Cvolo: the lens action failed. ${formatError(error)}`);
    }
  }));
}

module.exports = {
  registerEditorIntelligence
};
