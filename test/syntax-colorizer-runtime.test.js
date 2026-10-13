'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { computeSyntaxColorRanges } = require('../syntax-colorizer-runtime');

function texts(source, ranges) {
  return ranges.map(({ start, end }) => source.slice(start, end));
}

test('using and namespace qualified names are forced to VS2019 foreground', () => {
  const source = [
    'using System.Text.RegularExpressions;',
    'using BenchmarkDotNet.Attributes;',
    '',
    'namespace Cvolo.Benchmarks;'
  ].join('\n');

  const result = computeSyntaxColorRanges(source);
  assert.deepEqual(texts(source, result.namespaceRanges), [
    'System.Text.RegularExpressions',
    'BenchmarkDotNet.Attributes',
    'Cvolo.Benchmarks'
  ]);
});

test('generic delimiters are identified and declaration parameters use interface color', () => {
  const source = 'struct GenericTest<T, D> { }';
  const result = computeSyntaxColorRanges(source);

  assert.deepEqual(texts(source, result.genericDelimiterRanges), ['<', '>']);
  assert.deepEqual(texts(source, result.typeParameterRanges), ['T', 'D']);
});

test('type parameters are decorated only at declaration sites, never at ambiguous uses', () => {
  const source = [
    'class DataStoreBase<TEntity, TId> {',
    '  ILogger<DataStoreBase<TEntity, TId>> logger;',
    '}'
  ].join('\n');
  const result = computeSyntaxColorRanges(source);
  const parameters = texts(source, result.typeParameterRanges);

  assert.deepEqual(parameters, ['TEntity', 'TId']);
  assert.equal(parameters.includes('DataStoreBase'), false);
  assert.equal(texts(source, result.genericDelimiterRanges).join(''), '<><<>>');
});

test('an unrelated concrete type named like a declared parameter is never relabeled', () => {
  const source = [
    'class Box<T> { }',
    'val value = External<T>();'
  ].join('\n');
  const result = computeSyntaxColorRanges(source);

  assert.deepEqual(texts(source, result.typeParameterRanges), ['T']);
  assert.deepEqual(texts(source, result.genericDelimiterRanges), ['<', '>', '<', '>']);
});

test('generic method declarations collect their type parameters', () => {
  const source = 'public T Map<T, U>(T value) { return value; }';
  const result = computeSyntaxColorRanges(source);
  assert.deepEqual(texts(source, result.typeParameterRanges), ['T', 'U']);
});

test('comparison operators are not treated as generic delimiters', () => {
  const source = 'if (x < y && z > q) { return; }';
  const result = computeSyntaxColorRanges(source);
  assert.deepEqual(result.genericDelimiterRanges, []);
});

test('generic-looking text in comments and strings is ignored', () => {
  const source = [
    '// Foo<T>',
    'val string text = "Bar<U>";',
    'struct Real<V> { }'
  ].join('\n');
  const result = computeSyntaxColorRanges(source);
  assert.deepEqual(texts(source, result.genericDelimiterRanges), ['<', '>']);
  assert.deepEqual(texts(source, result.typeParameterRanges), ['V']);
});
