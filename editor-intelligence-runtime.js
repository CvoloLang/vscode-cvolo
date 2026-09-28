'use strict';

const LAYOUT_SCHEME = 'cvolo-layout';

const SHOW_REFERENCES_COMMAND = 'cvolo.showReferences';
const SHOW_TYPE_LAYOUT_COMMAND = 'cvolo.showTypeLayout';
const TYPE_LAYOUT_REQUEST = 'cvolo/typeLayout';
const REFERENCE_PROVIDER_COMMAND = 'vscode.executeReferenceProvider';
const SHOW_REFERENCES_EDITOR_COMMAND = 'editor.action.showReferences';

const CODE_LENS_SETTING_DEFAULTS = Object.freeze({
  references: true,
  layout: true,
  members: false,
  nativeInterop: true
});

const INLAY_HINT_SETTING_DEFAULTS = Object.freeze({
  types: true,
  parameters: true,
  receiverMutability: true,
  layout: false,
  enumValues: false,
  genericArguments: false
});

const TABLE_HEADERS = Object.freeze(['Offset', 'Size', 'Align', 'Field', 'Type']);
const LABEL_SEPARATOR = 2;
const COLUMN_SEPARATOR = '  ';

// The notation a reader chose for byte counts. These three words are the whole vocabulary: a setting
// the extension does not recognise is not a notation to guess at, and the same three words are what
// the language server accepts, so one setting describes the annotations and the viewer alike.
const OFFSET_FORMATS = Object.freeze(['decimal', 'hex', 'decimalAndHex']);
const DEFAULT_OFFSET_FORMAT = 'decimal';
const DEFAULT_LAYOUT_OPTIONS = Object.freeze({ offsetFormat: DEFAULT_OFFSET_FORMAT, showPaddingPercentage: false });
const LAYOUT_DOCUMENT_NAME = 'Layout.cvlayout';

// What an open view shows when the server can no longer resolve its subject: the type was renamed or
// removed, and numbers from an older snapshot must not stay on screen as if they were current (§30).
// This is not an error state; it is the honest answer to a question whose subject is gone.
const LAYOUT_UNAVAILABLE_TEXT = 'Layout\n\nThe type is no longer available in the current project snapshot.\nReopen Show Type Layout from source.\n';
const LAYOUT_INCOMPLETE_TEXT = 'Layout unavailable while the type is incomplete.\n';

function isPosition(value) {
  return !!value
    && typeof value === 'object'
    && Number.isInteger(value.line)
    && value.line >= 0
    && Number.isInteger(value.character)
    && value.character >= 0;
}

function isCount(value) {
  return Number.isInteger(value) && value >= 0;
}

// A source target names a document the editor has to open before it can do anything with it, so the
// value has to be a URI the editor can resolve. A Windows path is not one: parsed as a URI it looks
// like a "d:" scheme, and the editor then refuses to resolve the resource. A drive letter is
// therefore a path, not a scheme, and a value with no scheme at all is read as a file — which is
// also what an older server that sent the document's local path instead of its URI still means.
function isUriText(value) {
  if (/^[A-Za-z]:[\\/]/.test(value)) {
    return false;
  }

  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value);
}

function normalizeUriText(value) {
  const text = value.trim();
  return isUriText(text) ? text : `file:///${text.replace(/\\/g, '/').replace(/^\/+/, '')}`;
}

function count(value) {
  return isCount(value) ? value : null;
}

// Writes one compiler byte count in the chosen notation. The value is never re-derived here: the
// number is the compiler's, and only its radix is a presentation choice. Decimal keeps the byte unit
// the annotations always had. Hexadecimal drops it, because 0x08 is a byte count already and 0x08B
// would read as one longer hex number; it is zero padded to two digits so a small layout keeps a
// stable column width and a larger one simply grows. The combined form puts the decimal value first,
// so neither notation can be mistaken for part of the other.
function formatByteCount(value, options, withUnit = false) {
  const view = layoutOptions(options);
  const decimal = String(value);
  const hex = `0x${value.toString(16).padStart(2, '0')}`;

  switch (view.offsetFormat) {
    case 'hex':
      return hex;
    case 'decimalAndHex':
      return `${decimal}${withUnit ? ' bytes' : ''} (${hex})`;
    default:
      return `${decimal}${withUnit ? ' bytes' : ''}`;
  }
}

function layoutOptions(options) {
  const value = options && typeof options === 'object' ? options : {};
  const offsetFormat = OFFSET_FORMATS.includes(value.offsetFormat) ? value.offsetFormat : DEFAULT_LAYOUT_OPTIONS.offsetFormat;

  return {
    offsetFormat,
    showPaddingPercentage: value.showPaddingPercentage === true
  };
}

// The share of the type a padding takes. This is the one number in the viewer the extension
// calculates, because it is a ratio of two compiler facts rather than a layout fact: a type with no
// size has no share to report, and dividing by zero would produce a number that means nothing.
function paddingPercentage(paddingSize, size) {
  if (!Number.isInteger(paddingSize) || !Number.isInteger(size) || size <= 0) {
    return null;
  }

  return (paddingSize * 100) / size;
}

function parseSourceTarget(args) {
  const values = Array.isArray(args) ? args : [];
  const uri = values[0];
  const position = values[1];

  if (typeof uri !== 'string' || uri.trim().length === 0 || !isPosition(position)) {
    return null;
  }

  return {
    uri: normalizeUriText(uri),
    position: {
      line: position.line,
      character: position.character
    }
  };
}

// A request either names a position in the source, which is how a view is first opened, or names the
// subject the server handed out, which is how an open view refreshes after the project changes. A
// subject request still carries the document, because the subject is only meaningful inside the
// project that document belongs to (§28, §42).
function typeLayoutRequestParams(target) {
  if (!target || typeof target.uri !== 'string' || target.uri.length === 0) {
    throw new TypeError('typeLayoutRequestParams requires a target with a URI.');
  }

  if (typeof target.subject === 'string' && target.subject.trim().length > 0) {
    return {
      textDocument: { uri: target.uri },
      subject: target.subject
    };
  }

  if (!isPosition(target.position)) {
    throw new TypeError('typeLayoutRequestParams requires a source target with a URI and position.');
  }

  return {
    textDocument: { uri: target.uri },
    position: {
      line: target.position.line,
      character: target.position.character
    }
  };
}

// A navigation target the server resolved. The extension never resolves a displayed name itself, so
// a target has to arrive as a URI the editor can open plus the line/character the compiler chose. A
// value that is not exactly that is not a target: it is dropped rather than guessed at (§19).
function normalizeTarget(value) {
  if (!value || typeof value !== 'object'
      || typeof value.uri !== 'string'
      || value.uri.trim().length === 0
      || !value.range
      || !isPosition(value.range.start)) {
    return null;
  }

  return {
    uri: normalizeUriText(value.uri),
    position: {
      line: value.range.start.line,
      character: value.range.start.character
    }
  };
}

function normalizeMemberNavigation(value) {
  if (!value || typeof value !== 'object' || typeof value.signature !== 'string' || value.signature.length === 0) {
    return null;
  }

  return {
    signature: value.signature,
    documentation: typeof value.documentation === 'string' ? value.documentation : null,
    definition: normalizeTarget(value.definition),
    typeDefinition: normalizeTarget(value.typeDefinition),
    nestedLayout: normalizeTarget(value.nestedLayout)
  };
}

function normalizeMember(value) {
  if (!value || typeof value !== 'object'
      || typeof value.name !== 'string'
      || typeof value.typeDisplay !== 'string'
      || !isCount(value.offset)
      || !isCount(value.size)
      || !isCount(value.alignment)) {
    return null;
  }

  return {
    name: value.name,
    typeDisplay: value.typeDisplay,
    offset: value.offset,
    size: value.size,
    alignment: value.alignment,
    navigation: normalizeMemberNavigation(value.navigation)
  };
}

function normalizePadding(value) {
  if (!value || typeof value !== 'object'
      || !isCount(value.offset)
      || !isCount(value.size)
      || (value.kind !== 'internal' && value.kind !== 'tail')) {
    return null;
  }

  return {
    offset: value.offset,
    size: value.size,
    kind: value.kind
  };
}

function normalizeTypeLayout(value) {
  if (!value || typeof value !== 'object'
      || typeof value.typeDisplay !== 'string'
      || value.typeDisplay.length === 0
      || typeof value.targetDisplay !== 'string'
      || value.targetDisplay.length === 0
      || !isCount(value.size)
      || !isCount(value.alignment)
      || !Array.isArray(value.members)
      || !Array.isArray(value.padding)) {
    return null;
  }

  return {
    typeDisplay: value.typeDisplay,
    targetDisplay: value.targetDisplay,
    size: value.size,
    alignment: value.alignment,
    payloadSize: count(value.payloadSize),
    paddingSize: count(value.paddingSize),
    stride: count(value.stride),
    elementCount: count(value.elementCount),
    elementSize: count(value.elementSize),
    elementAlignment: count(value.elementAlignment),
    definition: normalizeTarget(value.definition),
    subject: typeof value.subject === 'string' && value.subject.length > 0 ? value.subject : null,
    members: value.members.map(normalizeMember).filter(member => member !== null),
    padding: value.padding.map(normalizePadding).filter(padding => padding !== null)
  };
}

function layoutFacts(layout, options) {
  // The summary speaks in bytes, so the unit belongs to the value. Hexadecimal drops it for the same
  // reason it does everywhere else, and 0x18 is a byte count the reader can read on its own.
  const bytes = value => formatByteCount(value, options, true);
  const facts = [
    ['Size', bytes(layout.size)],
    ['Alignment', bytes(layout.alignment)]
  ];

  if (layout.payloadSize !== null) {
    facts.push(['Payload', bytes(layout.payloadSize)]);
  }
  if (layout.paddingSize !== null) {
    const share = options.showPaddingPercentage ? paddingPercentage(layout.paddingSize, layout.size) : null;
    facts.push(['Padding', share === null ? bytes(layout.paddingSize) : `${bytes(layout.paddingSize)} (${share.toFixed(1)}%)`]);
  }
  if (layout.elementSize !== null) {
    facts.push(['Element size', bytes(layout.elementSize)]);
  }
  if (layout.elementAlignment !== null) {
    facts.push(['Element alignment', bytes(layout.elementAlignment)]);
  }
  if (layout.stride !== null) {
    facts.push(['Stride', bytes(layout.stride)]);
  }
  if (layout.elementCount !== null) {
    facts.push(['Count', String(layout.elementCount)]);
  }
  if (layout.elementSize !== null && layout.elementCount !== null) {
    facts.push(['Total size', bytes(layout.size)]);
  }

  return facts;
}

function tableRows(layout, options) {
  const rows = [];

  // Every member is a row, and so is every padding region the compiler reported. A gap in the offsets
  // is a real part of the layout, so it gets a row of its own instead of being a number the reader
  // has to notice is missing. The row carries the offset it was built from, because the order of the
  // table is the order of the bytes and not the order the notation happens to print.
  for (const member of layout.members) {
    rows.push({
      offset: member.offset,
      kind: 'field',
      member,
      padding: null,
      cells: [
        formatByteCount(member.offset, options),
        formatByteCount(member.size, options),
        formatByteCount(member.alignment, options),
        member.name,
        member.typeDisplay
      ]
    });
  }

  for (const padding of layout.padding) {
    rows.push({
      offset: padding.offset,
      kind: 'padding',
      member: null,
      padding,
      cells: [
        formatByteCount(padding.offset, options),
        formatByteCount(padding.size, options),
        '-',
        padding.kind === 'tail' ? '<tail padding>' : '<padding>',
        ''
      ]
    });
  }

  return rows.sort((left, right) => left.offset - right.offset);
}

// The rendered column starts. Every cell but the last is padded to the column width and joined with
// the separator, so a token's span is the column start plus its own text length; the trailing column
// carries no padding, which is why the table trims its rows.
function columnStarts(rows) {
  const widths = TABLE_HEADERS.map((header, column) => rows.reduce(
    (width, row) => Math.max(width, row.cells[column].length),
    header.length
  ));

  const starts = [];
  let at = 0;
  for (const width of widths) {
    starts.push(at);
    at += width + COLUMN_SEPARATOR.length;
  }

  return starts;
}

function renderTable(rows) {
  const cells = rows.map(row => row.cells);
  const widths = TABLE_HEADERS.map((header, column) => cells.reduce(
    (width, row) => Math.max(width, row[column].length),
    header.length
  ));

  const line = row => row
    .map((cell, column) => (column === row.length - 1 ? cell : cell.padEnd(widths[column])))
    .join(COLUMN_SEPARATOR)
    .trimEnd();

  return {
    lines: [line([...TABLE_HEADERS]), ...cells.map(line)],
    starts: columnStarts(rows)
  };
}

// Renders the layout document and, in the same pass, records where every navigable token sits. The
// spans are the only thing the definition and hover providers read, so the extension never has to
// find a token by its text or decide what a token means (§19, §20, §44).
function renderLayout(value, options) {
  const layout = normalizeTypeLayout(value);
  if (!layout) {
    throw new TypeError('renderLayout requires a well-formed compiler type layout.');
  }

  const view = layoutOptions(options);
  const facts = layoutFacts(layout, view);
  const labelWidth = facts.reduce((width, [label]) => Math.max(width, label.length + 1), 0) + LABEL_SEPARATOR;

  const lines = [];
  const tokens = [];

  // The title names the type the reader asked about: it navigates to that type's declaration, and its
  // hover repeats the summary the compiler already gave rather than deriving anything.
  lines.push(layout.typeDisplay);
  tokens.push({
    kind: 'type',
    line: 0,
    start: 0,
    end: layout.typeDisplay.length,
    display: layout.typeDisplay,
    definition: layout.definition,
    nestedLayout: null,
    facts: {
      size: layout.size,
      alignment: layout.alignment,
      payloadSize: layout.payloadSize,
      paddingSize: layout.paddingSize,
      stride: layout.stride,
      elementCount: layout.elementCount,
      elementSize: layout.elementSize,
      elementAlignment: layout.elementAlignment
    }
  });

  lines.push(`Target: ${layout.targetDisplay}`);

  if (facts.length > 0) {
    lines.push('');
    for (const [label, text] of facts) {
      lines.push(`${label}:`.padEnd(labelWidth) + text);
    }
  }

  const rows = tableRows(layout, view);
  if (rows.length > 0) {
    lines.push('');
    const table = renderTable(rows);
    const tableStart = lines.length;
    lines.push(...table.lines);

    const fieldColumn = table.starts[3];
    const typeColumn = table.starts[4];
    const byOffset = new Map(layout.members.map(member => [member.offset, member]));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const line = tableStart + i + 1;

      if (row.kind === 'field') {
        const member = row.member;
        const navigation = member.navigation;

        tokens.push({
          kind: 'field',
          line,
          start: fieldColumn,
          end: fieldColumn + member.name.length,
          name: member.name,
          signature: navigation?.signature ?? `${member.typeDisplay} ${layout.typeDisplay}.${member.name}`,
          documentation: navigation?.documentation ?? null,
          offset: member.offset,
          size: member.size,
          alignment: member.alignment,
          definition: navigation?.definition ?? null,
          typeDefinition: navigation?.typeDefinition ?? null,
          nestedLayout: navigation?.nestedLayout ?? null
        });

        // A field's type cell navigates to the type's declaration when the compiler resolved one. Its
        // hover does not quote the field's own size as the type's: those are not the type's numbers.
        tokens.push({
          kind: 'type',
          line,
          start: typeColumn,
          end: typeColumn + member.typeDisplay.length,
          display: member.typeDisplay,
          definition: navigation?.typeDefinition ?? null,
          nestedLayout: navigation?.nestedLayout ?? null,
          facts: null
        });
      } else {
        const padding = row.padding;
        const label = row.cells[3];
        const before = padding.kind === 'internal'
          ? byOffset.get(padding.offset + padding.size)?.name ?? null
          : null;

        tokens.push({
          kind: 'padding',
          line,
          start: fieldColumn,
          end: fieldColumn + label.length,
          paddingKind: padding.kind,
          offset: padding.offset,
          size: padding.size,
          before,
          alignment: layout.alignment
        });
      }
    }
  }

  return { text: lines.join('\n') + '\n', tokens };
}

function formatTypeLayout(value, options) {
  return renderLayout(value, options).text;
}

function layoutDocumentDescriptor(value) {
  const layout = normalizeTypeLayout(value);
  if (!layout) {
    throw new TypeError('layoutDocumentDescriptor requires a well-formed compiler type layout.');
  }

  return {
    scheme: LAYOUT_SCHEME,
    path: `/${LAYOUT_DOCUMENT_NAME}`,
    query: `type=${encodeURIComponent(layout.typeDisplay)}&target=${encodeURIComponent(layout.targetDisplay)}`
  };
}

module.exports = {
  CODE_LENS_SETTING_DEFAULTS,
  COLUMN_SEPARATOR,
  DEFAULT_LAYOUT_OPTIONS,
  INLAY_HINT_SETTING_DEFAULTS,
  LAYOUT_DOCUMENT_NAME,
  LAYOUT_INCOMPLETE_TEXT,
  LAYOUT_SCHEME,
  LAYOUT_UNAVAILABLE_TEXT,
  OFFSET_FORMATS,
  REFERENCE_PROVIDER_COMMAND,
  SHOW_REFERENCES_COMMAND,
  SHOW_REFERENCES_EDITOR_COMMAND,
  SHOW_TYPE_LAYOUT_COMMAND,
  TYPE_LAYOUT_REQUEST,
  formatByteCount,
  formatTypeLayout,
  layoutDocumentDescriptor,
  normalizeTypeLayout,
  parseSourceTarget,
  paddingPercentage,
  renderLayout,
  typeLayoutRequestParams
};
