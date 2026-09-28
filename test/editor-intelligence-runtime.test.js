'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const runtime = require('../editor-intelligence-runtime');

const TARGET = 'x86_64-pc-windows-msvc';

function valueLayout(overrides = {}) {
  return {
    typeDisplay: 'Value',
    targetDisplay: TARGET,
    size: 24,
    alignment: 8,
    payloadSize: 13,
    paddingSize: 11,
    stride: null,
    elementCount: null,
    elementSize: null,
    elementAlignment: null,
    members: [
      { name: 'Kind', typeDisplay: 'int', offset: 0, size: 4, alignment: 4 },
      { name: 'Payload', typeDisplay: 'long', offset: 8, size: 8, alignment: 8 },
      { name: 'Version', typeDisplay: 'byte', offset: 16, size: 1, alignment: 1 }
    ],
    padding: [
      { offset: 4, size: 4, kind: 'internal' },
      { offset: 17, size: 7, kind: 'tail' }
    ],
    ...overrides
  };
}

function lines(...values) {
  return values.join('\n') + '\n';
}

test('command arguments are accepted as a document URI and a source position', () => {
  assert.deepEqual(runtime.parseSourceTarget(['file:///a/b.cvl', { line: 3, character: 7 }]), {
    uri: 'file:///a/b.cvl',
    position: { line: 3, character: 7 }
  });
});

test('malformed command arguments are rejected instead of guessed', () => {
  assert.equal(runtime.parseSourceTarget(), null);
  assert.equal(runtime.parseSourceTarget([]), null);
  assert.equal(runtime.parseSourceTarget(['file:///a/b.cvl']), null);
  assert.equal(runtime.parseSourceTarget(['   ', { line: 0, character: 0 }]), null);
  assert.equal(runtime.parseSourceTarget([42, { line: 0, character: 0 }]), null);
  assert.equal(runtime.parseSourceTarget(['file:///a/b.cvl', { line: -1, character: 0 }]), null);
  assert.equal(runtime.parseSourceTarget(['file:///a/b.cvl', { line: 0, character: 1.5 }]), null);
});

test('a document path is read as a file the editor can resolve', () => {
  // A Windows path parsed as a URI looks like a "d:" scheme, and the editor then cannot resolve it.
  assert.deepEqual(runtime.parseSourceTarget(['d:\\dir\\file.cvl', { line: 1, character: 2 }]), {
    uri: 'file:///d:/dir/file.cvl',
    position: { line: 1, character: 2 }
  });

  assert.deepEqual(runtime.parseSourceTarget(['/usr/src/file.cvl', { line: 0, character: 0 }]), {
    uri: 'file:///usr/src/file.cvl',
    position: { line: 0, character: 0 }
  });

  assert.deepEqual(runtime.parseSourceTarget(['  d:\\dir\\file.cvl  ', { line: 0, character: 0 }]), {
    uri: 'file:///d:/dir/file.cvl',
    position: { line: 0, character: 0 }
  });
});

test('a document URI is passed through unchanged', () => {
  for (const uri of [
    'file:///d%3A/Programming/Cvolo/libraries/Base/Memory/Layout.cvl',
    'file:///a/b.cvl',
    'untitled:Untitled-1',
    'cvolo-layout:/Layout?target=x'
  ]) {
    assert.deepEqual(runtime.parseSourceTarget([uri, { line: 0, character: 0 }]), {
      uri,
      position: { line: 0, character: 0 }
    });
  }
});

test('the type layout request carries only the document and position', () => {
  assert.deepEqual(
    runtime.typeLayoutRequestParams({ uri: 'file:///a/b.cvl', position: { line: 2, character: 4 } }),
    {
      textDocument: { uri: 'file:///a/b.cvl' },
      position: { line: 2, character: 4 }
    }
  );
  assert.throws(() => runtime.typeLayoutRequestParams({ uri: 'file:///a/b.cvl' }), TypeError);
});

test('the refresh request carries the compiler subject instead of a position', () => {
  // The view re-asks by the subject the server handed out, so a position is neither needed nor sent.
  assert.deepEqual(
    runtime.typeLayoutRequestParams({ uri: 'file:///a/b.cvl', subject: 'Header' }),
    {
      textDocument: { uri: 'file:///a/b.cvl' },
      subject: 'Header'
    }
  );
  assert.deepEqual(
    runtime.typeLayoutRequestParams({
      uri: 'file:///a/b.cvl',
      subject: 'Header',
      position: { line: 9, character: 9 }
    }),
    {
      textDocument: { uri: 'file:///a/b.cvl' },
      subject: 'Header'
    }
  );
  assert.throws(() => runtime.typeLayoutRequestParams({ uri: 'file:///a/b.cvl', subject: '   ' }), TypeError);
});

test('the documented decoration defaults are the compiler defaults', () => {
  assert.deepEqual(runtime.CODE_LENS_SETTING_DEFAULTS, {
    references: true,
    layout: true,
    members: false,
    nativeInterop: true
  });
  assert.deepEqual(runtime.INLAY_HINT_SETTING_DEFAULTS, {
    types: true,
    parameters: true,
    receiverMutability: true,
    layout: false,
    enumValues: false,
    genericArguments: false
  });
});

test('the layout view shows the header, the target, the facts and the member table', () => {
  assert.equal(
    runtime.formatTypeLayout(valueLayout()),
    lines(
      'Value',
      `Target: ${TARGET}`,
      '',
      'Size:       24 bytes',
      'Alignment:  8 bytes',
      'Payload:    13 bytes',
      'Padding:    11 bytes',
      '',
      'Offset  Size  Align  Field           Type',
      '0       4     4      Kind            int',
      '4       4     -      <padding>',
      '8       8     8      Payload         long',
      '16      1     1      Version         byte',
      '17      7     -      <tail padding>'
    )
  );
});

test('zero padding is reported instead of being hidden', () => {
  const text = runtime.formatTypeLayout(valueLayout({
    typeDisplay: 'Flag',
    size: 1,
    alignment: 1,
    payloadSize: 1,
    paddingSize: 0,
    members: [{ name: 'Value', typeDisplay: 'bool', offset: 0, size: 1, alignment: 1 }],
    padding: []
  }));

  assert.match(text, /Padding:\s+0 bytes/);
  assert.doesNotMatch(text, /<padding>/);
});

test('a union keeps the compiler member order for one shared offset', () => {
  const text = runtime.formatTypeLayout(valueLayout({
    typeDisplay: 'Number',
    size: 8,
    alignment: 8,
    payloadSize: 8,
    paddingSize: 0,
    members: [
      { name: 'IntValue', typeDisplay: 'int', offset: 0, size: 4, alignment: 4 },
      { name: 'FloatValue', typeDisplay: 'double', offset: 0, size: 8, alignment: 8 }
    ],
    padding: []
  }));

  const rows = text.split('\n').filter(line => /^(0|8)\s/.test(line));
  assert.deepEqual(rows, [
    '0       4     4      IntValue    int',
    '0       8     8      FloatValue  double'
  ]);
});

test('array facts appear only when the compiler reported them', () => {
  const arrayText = runtime.formatTypeLayout({
    typeDisplay: 'Entry[32]',
    targetDisplay: TARGET,
    size: 384,
    alignment: 4,
    payloadSize: 384,
    paddingSize: 0,
    stride: 12,
    elementCount: 32,
    elementSize: 12,
    elementAlignment: 4,
    members: [],
    padding: []
  });

  assert.match(arrayText, /Element size:\s+12 bytes/);
  assert.match(arrayText, /Element alignment:\s+4 bytes/);
  assert.match(arrayText, /Stride:\s+12 bytes/);
  assert.match(arrayText, /Count:\s+32/);
  assert.match(arrayText, /Total size:\s+384 bytes/);
  assert.doesNotMatch(runtime.formatTypeLayout(valueLayout()), /Stride/);
});

test('the layout view never re-derives, re-orders or repairs compiler facts', () => {
  const text = runtime.formatTypeLayout(valueLayout({
    size: 24,
    payloadSize: 200,
    paddingSize: 200,
    members: [
      { name: 'Wide', typeDisplay: 'long', offset: 0, size: 16, alignment: 8 },
      { name: 'Narrow', typeDisplay: 'byte', offset: 8, size: 1, alignment: 1 }
    ],
    padding: []
  }));

  assert.match(text, /^Size: {7}24 bytes$/m);
  assert.match(text, /^Payload: {4}200 bytes$/m);
  assert.match(text, /^Padding: {4}200 bytes$/m);
  assert.equal(/<padding>/.test(text), false);
  assert.deepEqual(
    text.split('\n').filter(line => /^\d/.test(line)),
    ['0       16    8      Wide    long', '8       1     1      Narrow  byte']
  );
});

test('malformed compiler layouts are rejected instead of rendered', () => {
  assert.equal(runtime.normalizeTypeLayout(null), null);
  assert.equal(runtime.normalizeTypeLayout({}), null);
  assert.equal(runtime.normalizeTypeLayout(valueLayout({ targetDisplay: '' })), null);
  assert.equal(runtime.normalizeTypeLayout(valueLayout({ size: -1 })), null);
  assert.equal(runtime.normalizeTypeLayout(valueLayout({ size: 1.5 })), null);
  assert.equal(runtime.normalizeTypeLayout(valueLayout({ members: 'none' })), null);
  assert.equal(runtime.normalizeTypeLayout(valueLayout({ padding: null })), null);
  assert.throws(() => runtime.formatTypeLayout({}), TypeError);
  assert.throws(() => runtime.layoutDocumentDescriptor({}), TypeError);
});

test('the compiler subject survives normalisation so the view can be re-asked', () => {
  assert.equal(runtime.normalizeTypeLayout(valueLayout()).subject, null);
  assert.equal(runtime.normalizeTypeLayout(valueLayout({ subject: 'Header' })).subject, 'Header');
  assert.equal(runtime.normalizeTypeLayout(valueLayout({ subject: '' })).subject, null);
});

test('unusable member and padding rows are dropped, not repaired', () => {
  const layout = runtime.normalizeTypeLayout(valueLayout({
    members: [
      { name: 'Kind', typeDisplay: 'int', offset: 0, size: 4, alignment: 4 },
      { name: 'Broken', typeDisplay: 'int', offset: 8, size: -1, alignment: 1 },
      null
    ],
    padding: [
      { offset: 4, size: 4, kind: 'internal' },
      { offset: 8, size: 4, kind: 'leading' }
    ]
  }));

  assert.equal(layout.members.length, 1);
  assert.equal(layout.padding.length, 1);
  assert.deepEqual(layout.padding[0], { offset: 4, size: 4, kind: 'internal' });
});

test('optional facts stay absent when the compiler did not report them', () => {
  const layout = runtime.normalizeTypeLayout(valueLayout());

  assert.equal(layout.payloadSize, 13);
  assert.equal(layout.paddingSize, 11);
  assert.equal(layout.stride, null);
  assert.equal(layout.elementCount, null);
  assert.equal(layout.elementSize, null);
  assert.equal(layout.elementAlignment, null);
});

test('the layout document is a read-only virtual document keyed by type and target', () => {
  assert.equal(runtime.LAYOUT_SCHEME, 'cvolo-layout');
  assert.deepEqual(runtime.layoutDocumentDescriptor(valueLayout()), {
    scheme: 'cvolo-layout',
    path: '/Layout.cvlayout',
    query: `type=Value&target=${TARGET}`
  });

  const otherTarget = runtime.layoutDocumentDescriptor(valueLayout({ targetDisplay: 'aarch64-pc-windows-msvc' }));
  assert.notEqual(otherTarget.query, `type=Value&target=${TARGET}`);
});

test('the type name is escaped as a query value instead of a URI path', () => {
  // The document name is fixed, so a type whose display name contains a separator is carried in the
  // query, where it cannot be read as a path segment or split the URI.
  const descriptor = runtime.layoutDocumentDescriptor(valueLayout({ typeDisplay: 'A?B#C Entry[32]' }));

  assert.equal(descriptor.path, '/Layout.cvlayout');
  assert.equal(descriptor.query, `type=A%3FB%23C%20Entry%5B32%5D&target=${TARGET}`);
});

test('the offset notation applies to every byte count and never to a value it was not given', () => {
  const layout = valueLayout({
    size: 24,
    alignment: 8,
    payloadSize: 13,
    paddingSize: 11,
    members: [
      { name: 'Kind', typeDisplay: 'int', offset: 0, size: 4, alignment: 4 },
      { name: 'Flags', typeDisplay: 'byte', offset: 24, size: 1, alignment: 1 }
    ],
    padding: [{ offset: 4, size: 4, kind: 'internal' }, { offset: 5, size: 3, kind: 'tail' }]
  });

  // The columns are padded to line up, so a row is compared as its cells rather than as a fixed
  // number of spaces: what matters is which value sits in which column. A cell is one number, and the
  // combined notation adds a second one in parentheses, so a cell is a token or a token plus a
  // bracketed one - otherwise the extra space would be read as a column separator.
  const CELL = /(?:\S+ \([^)]*\)|\S+)/g;
  const rows = text => text
    .split('\n')
    .slice(text.split('\n').findIndex(line => line.startsWith('Offset')))
    .filter(line => /^\S/.test(line))
    .map(line => line.match(CELL));
  const fact = (text, label) => text.split('\n').find(line => line.startsWith(`${label}:`));

  const decimal = runtime.formatTypeLayout(layout, { offsetFormat: 'decimal' });
  assert.equal(fact(decimal, 'Size'), 'Size:       24 bytes');
  assert.deepEqual(rows(decimal), [
    ['Offset', 'Size', 'Align', 'Field', 'Type'],
    ['0', '4', '4', 'Kind', 'int'],
    ['4', '4', '-', '<padding>'],
    ['5', '3', '-', '<tail', 'padding>'],
    ['24', '1', '1', 'Flags', 'byte']
  ]);

  // The same numbers, another radix. The unit is dropped because 0x08 is a byte count already and
  // 0x08B would read as one longer hex number.
  const hex = runtime.formatTypeLayout(layout, { offsetFormat: 'hex' });
  assert.equal(fact(hex, 'Size'), 'Size:       0x18');
  assert.deepEqual(rows(hex), [
    ['Offset', 'Size', 'Align', 'Field', 'Type'],
    ['0x00', '0x04', '0x04', 'Kind', 'int'],
    ['0x04', '0x04', '-', '<padding>'],
    ['0x05', '0x03', '-', '<tail', 'padding>'],
    ['0x18', '0x01', '0x01', 'Flags', 'byte']
  ]);

  const both = runtime.formatTypeLayout(layout, { offsetFormat: 'decimalAndHex' });
  assert.equal(fact(both, 'Size'), 'Size:       24 bytes (0x18)');
  assert.deepEqual(rows(both), [
    ['Offset', 'Size', 'Align', 'Field', 'Type'],
    ['0 (0x00)', '4 (0x04)', '4 (0x04)', 'Kind', 'int'],
    ['4 (0x04)', '4 (0x04)', '-', '<padding>'],
    ['5 (0x05)', '3 (0x03)', '-', '<tail', 'padding>'],
    ['24 (0x18)', '1 (0x01)', '1 (0x01)', 'Flags', 'byte']
  ]);
});

test('a table row is never reordered by the notation it is printed in', () => {
  // The table is the order of the bytes. A hexadecimal offset must not sort as text, or a layout
  // would read 0x10 before 0x08.
  const layout = valueLayout({
    size: 32,
    members: [
      { name: 'Last', typeDisplay: 'int', offset: 16, size: 4, alignment: 4 },
      { name: 'First', typeDisplay: 'int', offset: 0, size: 4, alignment: 4 },
      { name: 'Middle', typeDisplay: 'int', offset: 8, size: 4, alignment: 4 }
    ],
    padding: []
  });

  for (const offsetFormat of ['decimal', 'hex', 'decimalAndHex']) {
    const names = runtime
      .formatTypeLayout(layout, { offsetFormat })
      .split('\n')
      .filter(line => /^(?:0x)?\d/.test(line))
      .map(line => line.match(/(?:\S+ \([^)]*\)|\S+)/g)[3]);

    assert.deepEqual(names, ['First', 'Middle', 'Last'], offsetFormat);
  }
});

test('a hex column keeps its width as the layout grows', () => {
  const small = runtime.formatByteCount(8, { offsetFormat: 'hex' });
  const large = runtime.formatByteCount(4096, { offsetFormat: 'hex' });

  assert.equal(small, '0x08');
  assert.equal(large, '0x1000');
});

test('a notation the extension does not know falls back to decimal rather than guessing', () => {
  assert.deepEqual(runtime.OFFSET_FORMATS, ['decimal', 'hex', 'decimalAndHex']);
  assert.equal(runtime.formatByteCount(24, { offsetFormat: 'binary' }), '24');
  assert.equal(runtime.formatByteCount(24, { offsetFormat: 24 }), '24');
  assert.equal(runtime.formatByteCount(24, undefined), '24');
  assert.deepEqual(runtime.DEFAULT_LAYOUT_OPTIONS, { offsetFormat: 'decimal', showPaddingPercentage: false });
});

test('the padding share is a ratio of two compiler facts and never divides by zero', () => {
  const layout = valueLayout({ size: 24, paddingSize: 11 });

  assert.equal(runtime.paddingPercentage(11, 24).toFixed(1), '45.8');
  assert.equal(runtime.paddingPercentage(0, 24).toFixed(1), '0.0');
  assert.equal(runtime.paddingPercentage(0, 0), null);
  assert.equal(runtime.paddingPercentage(4, 0), null);
  assert.equal(runtime.paddingPercentage(null, 24), null);
  assert.equal(runtime.paddingPercentage(4, null), null);

  const withShare = runtime.formatTypeLayout(layout, { showPaddingPercentage: true });
  assert.match(withShare, /^Padding: {4}11 bytes \(45\.8%\)$/m);

  // A type with no size has no share to report, so the line keeps the byte count alone instead of
  // claiming a percentage of nothing.
  const unsized = runtime.formatTypeLayout(valueLayout({ size: 0, paddingSize: 0 }), { showPaddingPercentage: true });
  assert.match(unsized, /^Padding: {4}0 bytes$/m);
  assert.doesNotMatch(unsized, /%/);
  assert.doesNotMatch(runtime.formatTypeLayout(layout), /%/);
});

test('padding is presented as storage information, never as a warning', () => {
  const text = runtime.formatTypeLayout(valueLayout({ padding: [{ offset: 4, size: 4, kind: 'internal' }] }));

  assert.match(text, /^4 {7}4 {5}- {6}<padding>$/m);
  assert.match(text, /<padding>/);
  assert.doesNotMatch(text, /error|warning|invalid/i);
});

test('rendering the layout returns the same text it always did, plus a token per navigable span', () => {
  const layout = valueLayout();
  const view = runtime.renderLayout(layout);

  assert.equal(view.text, runtime.formatTypeLayout(layout));
  assert.ok(Array.isArray(view.tokens));
});

test('every token points at the span the compiler numbers were printed in', () => {
  const view = runtime.renderLayout(valueLayout());
  const textLines = view.text.split('\n');

  for (const token of view.tokens) {
    const line = textLines[token.line];
    assert.ok(line !== undefined, `token on line ${token.line}`);
    // The token spans exactly the documented text, so a client can highlight it without measuring.
    assert.ok(token.end > token.start, `${token.kind} token must be non-empty`);
    assert.ok(token.start >= 0 && token.end <= line.length, `${token.kind} token in range`);
  }
});

test('the title names the type and its hover repeats the compiler summary', () => {
  const view = runtime.renderLayout(valueLayout());
  const title = view.tokens.find(token => token.kind === 'type' && token.facts !== null);

  assert.equal(title.line, 0);
  assert.equal(title.display, 'Value');
  assert.equal(title.end, 'Value'.length);
  assert.deepEqual(title.facts, {
    size: 24,
    alignment: 8,
    payloadSize: 13,
    paddingSize: 11,
    stride: null,
    elementCount: null,
    elementSize: null,
    elementAlignment: null
  });
});

test('a field token carries the field facts and never a type definition it was not given', () => {
  const view = runtime.renderLayout(valueLayout());
  const field = view.tokens.find(token => token.kind === 'field');

  assert.equal(field.name, 'Kind');
  assert.equal(field.offset, 0);
  assert.equal(field.size, 4);
  assert.equal(field.alignment, 4);
  // Without a compiler-provided navigation the fallback signature is built from compiler facts only.
  assert.equal(field.signature, 'int Value.Kind');
  assert.equal(field.documentation, null);
  assert.equal(field.definition, null);
  assert.equal(field.typeDefinition, null);
  assert.equal(field.nestedLayout, null);
});

test('a field token maps the compiler-resolved navigation targets it was given', () => {
  const definition = { uri: 'file:///a.cvl', range: { start: { line: 2, character: 4 } } };
  const typeDefinition = { uri: 'file:///a.cvl', range: { start: { line: 9, character: 7 } } };
  const nestedLayout = { uri: 'file:///a.cvl', range: { start: { line: 9, character: 7 } } };

  const view = runtime.renderLayout(valueLayout({
    members: [{
      name: 'Payload',
      typeDisplay: 'Header',
      offset: 8,
      size: 8,
      alignment: 8,
      navigation: {
        signature: 'Header Value.Payload',
        documentation: 'The frame header.',
        definition,
        typeDefinition,
        nestedLayout
      }
    }],
    padding: []
  }));

  const field = view.tokens.find(token => token.kind === 'field');
  assert.equal(field.signature, 'Header Value.Payload');
  assert.equal(field.documentation, 'The frame header.');
  assert.deepEqual(field.definition, { uri: 'file:///a.cvl', position: { line: 2, character: 4 } });
  assert.deepEqual(field.typeDefinition, { uri: 'file:///a.cvl', position: { line: 9, character: 7 } });
  assert.deepEqual(field.nestedLayout, { uri: 'file:///a.cvl', position: { line: 9, character: 7 } });

  // The type cell on the same row navigates to the same resolved type, and it is not the title.
  const type = view.tokens.filter(token => token.kind === 'type' && token.line === field.line)[0];
  assert.equal(type.display, 'Header');
  assert.deepEqual(type.definition, { uri: 'file:///a.cvl', position: { line: 9, character: 7 } });
  assert.equal(type.facts, null);
});

test('a padding token names the field the internal padding precedes, and nothing for tail padding', () => {
  const view = runtime.renderLayout(valueLayout());

  const internal = view.tokens.find(token => token.kind === 'padding' && token.paddingKind === 'internal');
  assert.equal(internal.offset, 4);
  assert.equal(internal.size, 4);
  // The member that starts at 4 + 4 = 8 is Payload.
  assert.equal(internal.before, 'Payload');
  assert.equal(internal.alignment, 8);

  const tail = view.tokens.find(token => token.kind === 'padding' && token.paddingKind === 'tail');
  assert.equal(tail.before, null);
  assert.equal(tail.alignment, 8);
});
