'use strict';

// Item 9: audit the lexical classification of the canonical generic snippet. Each assertion pins a
// real grammar rule, never a "capitalised identifier means type" guess, and nothing here introduces
// a semantic-token claim. Where a distinction genuinely needs semantic knowledge (local names) the
// scope stays neutral instead of lying.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const grammar = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'syntaxes', 'cvolo.tmLanguage.json'),
  'utf8'
));

const SNIPPET = [
  'namespace System.Memory;',
  'public struct Heap<T, A> where A : Allocator where default A : SystemAllocator { T* Ptr; }',
  'public extension Heap<T, A> { Heap(T value) { val allocator = default(A); val layout = Layout.FromType<T>(); Ptr = allocator.Alloc(layout); } }'
].join('\n');

function documentOrder() {
  return grammar.patterns.map(pattern => pattern.include.slice(1));
}

function rule(name) {
  return grammar.repository[name];
}

function firstMatch(source, pattern) {
  const match = new RegExp(pattern).exec(source);
  return match ? match[0] : null;
}

test('the snippet is the audit source and every name is present', () => {
  for (const name of ['Heap', 'T', 'A', 'Allocator', 'SystemAllocator', 'Layout', 'FromType', 'Alloc', 'Ptr', 'allocator', 'layout']) {
    assert.ok(SNIPPET.includes(name), `the snippet must mention ${name}`);
  }
});

test('type declarations claim Heap as a type name', () => {
  const declaration = rule('type-declarations').patterns[0];
  assert.equal(declaration.captures['2'].name, 'entity.name.type.cvolo');

  const struct = new RegExp(declaration.match).exec('public struct Heap<T, A>');
  assert.ok(struct, 'a struct declaration must be recognised');
  assert.equal(struct[2], 'Heap');

  const extension = new RegExp(declaration.match).exec('public extension Heap<T, A>');
  assert.ok(extension, 'a generic extension target must be recognised');
  assert.equal(extension[2], 'Heap');
});

test('generic type parameters win inside angle brackets', () => {
  const order = documentOrder();
  assert.ok(order.indexOf('generic-arguments') < order.indexOf('type-references'),
    'the generic list must be claimed before the generic type-reference heuristic');

  const generic = rule('generic-arguments').patterns[0];
  assert.ok(new RegExp(generic.begin).test('Heap<T, A>'), 'a name immediately before < opens a generic list');
  assert.ok(!new RegExp(generic.begin).test('a < b'), 'a spaced comparison is not a generic list');
  assert.ok(new RegExp(generic.end).test('>'), 'the generic list closes on >');

  const typeParameters = generic.patterns
    .map(pattern => pattern.name ?? pattern.include)
    .indexOf('entity.name.type.type-parameter.cvolo');
  const references = generic.patterns
    .map(pattern => pattern.name ?? pattern.include)
    .indexOf('#type-references');
  assert.ok(typeParameters >= 0, 'the type-parameter rule must exist inside a generic list');
  assert.ok(typeParameters < references, 'type parameters must be claimed before generic type references');

  const parameterMatch = generic.patterns.find(pattern => pattern.name === 'entity.name.type.type-parameter.cvolo');
  const matched = [...'T, A'.matchAll(new RegExp(parameterMatch.match, 'g'))].map(match => match[0]);
  assert.deepEqual(matched, ['T', 'A']);
});

test('keywords claim default and val', () => {
  const keywords = rule('keywords').patterns;
  const modifier = keywords.find(pattern => pattern.name === 'storage.modifier.cvolo');
  const control = keywords.find(pattern => pattern.name === 'keyword.control.cvolo');

  assert.ok(new RegExp(modifier.match).test('val'), 'val is a storage modifier');
  assert.ok(new RegExp(control.match).test('default'), 'default is a control keyword');
});

test('callables claim FromType and Alloc, and member access never outranks them', () => {
  const order = documentOrder();
  assert.ok(order.indexOf('function-calls') < order.indexOf('member-access-identifiers'),
    'a call name must be claimed before the dotted-member heuristic');

  const callable = rule('function-calls').patterns[0].match;
  assert.equal(firstMatch('Layout.FromType<T>()', callable), 'FromType');
  assert.equal(firstMatch('allocator.Alloc(layout)', callable), 'Alloc');

  const member = rule('member-access-identifiers').patterns[0].match;
  assert.equal(firstMatch('allocator.Alloc', member), 'Alloc');
});

test('generic delimiters are operators, not comparison-only text', () => {
  const operators = rule('operators').patterns[0].match;
  assert.ok(new RegExp(operators).test('<'), '< is an operator');
  assert.ok(new RegExp(operators).test('>'), '> is an operator');
});

test('local identifiers keep a neutral scope and are never claimed as types', () => {
  const typeReference = rule('type-references').patterns[0].match;
  assert.ok(!new RegExp(typeReference).test('Layout'), 'lexical coloring must not guess that an uppercase identifier is a type');
  assert.ok(!new RegExp(typeReference).test('allocator'), 'a local identifier is not a type reference');
  assert.ok(!new RegExp(typeReference).test('layout'), 'a local identifier is not a type reference');
});
