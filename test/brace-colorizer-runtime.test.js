'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  computeBraceColorOffsets,
  looksLikeTopLevelFunctionHeader,
  maskNonCode
} = require('../brace-colorizer-runtime');

function colorsFor(source) {
  const groups = computeBraceColorOffsets(source);
  const result = new Map();
  groups.forEach((offsets, colorIndex) => {
    for (const offset of offsets) {
      result.set(offset, colorIndex);
    }
  });
  return [...result.entries()].sort((a, b) => a[0] - b[0]).map(([, color]) => color);
}

test('type blocks start yellow then nested function/block use blue and purple', () => {
  const source = [
    'extension Point : S {',
    '  int Sum() {',
    '    if (true) {',
    '      return 0;',
    '    }',
    '  }',
    '}'
  ].join('\n');

  assert.deepEqual(colorsFor(source), [0, 1, 2, 2, 1, 0]);
});

test('top-level functions start blue and continue purple then yellow', () => {
  const source = [
    'int Twice(int value) {',
    '  if (value > 0) {',
    '    {',
    '      return value;',
    '    }',
    '  }',
    '}'
  ].join('\n');

  assert.deepEqual(colorsFor(source), [1, 2, 0, 0, 2, 1]);
});

test('braces in comments and strings are ignored', () => {
  const source = [
    'int Main() {',
    '  // { ignored }',
    '  val string s = "{ ignored }";',
    '  /* { ignored } */',
    '}'
  ].join('\n');

  assert.deepEqual(colorsFor(source), [1, 1]);
});

test('function header detection rejects control-flow headers', () => {
  assert.equal(looksLikeTopLevelFunctionHeader('int Main()'), true);
  assert.equal(looksLikeTopLevelFunctionHeader('if (ready)'), false);
});

test('mask keeps line structure while hiding comments', () => {
  const source = 'a // {x}\nb';
  const masked = maskNonCode(source);
  assert.equal(masked.includes('{'), false);
  assert.equal(masked.includes('\n'), true);
});
