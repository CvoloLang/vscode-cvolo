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
    path: '/Value',
    query: `target=${TARGET}`
  });

  const otherTarget = runtime.layoutDocumentDescriptor(valueLayout({ targetDisplay: 'aarch64-pc-windows-msvc' }));
  assert.notEqual(otherTarget.query, `target=${TARGET}`);
});

test('display text is sanitized into a URI path segment', () => {
  assert.equal(runtime.sanitizeSegment('Entry[32]'), 'Entry[32]');
  assert.equal(runtime.sanitizeSegment('A B'), 'A B');
  assert.equal(runtime.sanitizeSegment('A?B#C'), 'A_B_C');
  assert.equal(runtime.layoutDocumentDescriptor(valueLayout({ typeDisplay: 'A?B' })).path, '/A_B');
});
