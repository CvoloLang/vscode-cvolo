'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSyntaxColorRanges } = require('../syntax-colorizer-runtime');
const { computeBraceColorOffsets, maskNonCode } = require('../brace-colorizer-runtime');
const strings = (s, arr) => arr.map(({ start, end }) => s.slice(start, end));

test('generic declarations stay highlighted while ambiguous uses are omitted', () => {
  const source = 'class Box<TEntity, TId> { ILogger<Box<TEntity, TId>> logger; }';
  const result = computeSyntaxColorRanges(source);
  assert.deepEqual(strings(source, result.typeParameterRanges), ['TEntity', 'TId']);
});

test('comparison operators are not generic delimiters', () => {
  assert.deepEqual(computeSyntaxColorRanges('if (x < y && z > q) {}').genericDelimiterRanges, []);
});

test('source mask ignores braces in strings and comments', () => {
  const source = 'int Main() { // }\nval x = "{"; }';
  assert.equal(maskNonCode(source).includes('//'), false);
  assert.deepEqual(computeBraceColorOffsets(source)[1], [11, source.length - 1]);
});

test('typing thousands of unterminated generic candidates has bounded scan cost', () => {
  const source = 'identifier<incomplete\n'.repeat(10000);
  const started = performance.now();
  const result = computeSyntaxColorRanges(source);
  const elapsed = performance.now() - started;
  assert.deepEqual(result.genericDelimiterRanges, []);
  // Environment-dependent upper bound, aimed at catching accidental O(n^2).
  assert.ok(elapsed < 3000, `Unterminated generic scanning took ${elapsed}ms`);
});
