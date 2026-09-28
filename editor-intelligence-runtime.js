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

function count(value) {
  return isCount(value) ? value : null;
}

function bytes(value) {
  return `${value} bytes`;
}

function parseSourceTarget(args) {
  const values = Array.isArray(args) ? args : [];
  const uri = values[0];
  const position = values[1];

  if (typeof uri !== 'string' || uri.trim().length === 0 || !isPosition(position)) {
    return null;
  }

  return {
    uri,
    position: {
      line: position.line,
      character: position.character
    }
  };
}

function typeLayoutRequestParams(target) {
  if (!target || typeof target.uri !== 'string' || target.uri.length === 0 || !isPosition(target.position)) {
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
    alignment: value.alignment
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
    members: value.members.map(normalizeMember).filter(member => member !== null),
    padding: value.padding.map(normalizePadding).filter(padding => padding !== null)
  };
}

function layoutFacts(layout) {
  const facts = [
    ['Size', bytes(layout.size)],
    ['Alignment', bytes(layout.alignment)]
  ];

  if (layout.payloadSize !== null) {
    facts.push(['Payload', bytes(layout.payloadSize)]);
  }
  if (layout.paddingSize !== null) {
    facts.push(['Padding', bytes(layout.paddingSize)]);
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

function tableRows(layout) {
  const rows = [];

  for (const member of layout.members) {
    rows.push([String(member.offset), String(member.size), String(member.alignment), member.name, member.typeDisplay]);
  }

  for (const padding of layout.padding) {
    rows.push([
      String(padding.offset),
      String(padding.size),
      '-',
      padding.kind === 'tail' ? '<tail padding>' : '<padding>',
      ''
    ]);
  }

  return rows.sort((left, right) => Number(left[0]) - Number(right[0]));
}

function formatTable(rows) {
  const widths = TABLE_HEADERS.map((header, column) => rows.reduce(
    (width, row) => Math.max(width, row[column].length),
    header.length
  ));

  const line = cells => cells
    .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column])))
    .join(COLUMN_SEPARATOR)
    .trimEnd();

  return [line(TABLE_HEADERS), ...rows.map(line)];
}

function formatTypeLayout(value) {
  const layout = normalizeTypeLayout(value);
  if (!layout) {
    throw new TypeError('formatTypeLayout requires a well-formed compiler type layout.');
  }

  const facts = layoutFacts(layout);
  const labelWidth = facts.reduce((width, [label]) => Math.max(width, label.length + 1), 0) + LABEL_SEPARATOR;

  const lines = [
    layout.typeDisplay,
    `Target: ${layout.targetDisplay}`,
    '',
    ...facts.map(([label, value]) => `${label}:`.padEnd(labelWidth) + value)
  ];

  const rows = tableRows(layout);
  if (rows.length > 0) {
    lines.push('', ...formatTable(rows));
  }

  return lines.join('\n') + '\n';
}

function sanitizeSegment(text) {
  return String(text).replace(/[\u0000-\u001f?#]/g, '_');
}

function layoutDocumentDescriptor(value) {
  const layout = normalizeTypeLayout(value);
  if (!layout) {
    throw new TypeError('layoutDocumentDescriptor requires a well-formed compiler type layout.');
  }

  return {
    scheme: LAYOUT_SCHEME,
    path: `/${sanitizeSegment(layout.typeDisplay)}`,
    query: `target=${encodeURIComponent(layout.targetDisplay)}`
  };
}

module.exports = {
  CODE_LENS_SETTING_DEFAULTS,
  COLUMN_SEPARATOR,
  INLAY_HINT_SETTING_DEFAULTS,
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
  sanitizeSegment,
  typeLayoutRequestParams
};
