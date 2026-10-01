'use strict';

// `null` is a language literal exactly like `true` and `false`. It must be claimed by the same
// `constant.language.cvolo` rule, must never be matched inside a longer identifier, and the
// string/comment rules that sit before the constant rule in the document order must keep winning.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const grammar = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'syntaxes', 'cvolo.tmLanguage.json'),
  'utf8'
));

const LITERALS = ['true', 'false', 'null'];

function documentOrder() {
  return grammar.patterns.map(pattern => pattern.include.slice(1));
}

function constantRule() {
  return grammar.repository.constants.patterns[0];
}

function literalsIn(source) {
  const regex = new RegExp(constantRule().match, 'g');
  return [...source.matchAll(regex)].map(match => match[0]);
}

test('true, false and null are one constant.language family', () => {
  assert.equal(constantRule().name, 'constant.language.cvolo');
  for (const literal of LITERALS) {
    assert.deepEqual(literalsIn(`val p = ${literal};`), [literal],
      `${literal} must be claimed by the language-constant rule`);
  }
});

test('the constant rule never claims a literal inside a longer identifier', () => {
  assert.deepEqual(literalsIn('val p = nullValue;'), []);
  assert.deepEqual(literalsIn('val nullable = 0;'), []);
  assert.deepEqual(literalsIn('val my_null = 0;'), []);
  assert.deepEqual(literalsIn('val truthy = falseish;'), []);
});

test('string and comment rules sit before the constant rule in document order', () => {
  const order = documentOrder();
  const constants = order.indexOf('constants');
  assert.ok(constants >= 0, 'the constants rule must be included');
  assert.ok(order.indexOf('strings') < constants, 'string literals must win over constants');
  assert.ok(order.indexOf('raw-strings') < constants, 'raw strings must win over constants');
  assert.ok(order.indexOf('interpolated-strings') < constants, 'interpolated strings must win over constants');
  assert.ok(order.indexOf('comments') < constants, 'comments must win over constants');
});

test('a quoted or commented null is owned by the string and comment rules', () => {
  const strings = grammar.repository.strings.patterns[0];
  const lineComment = grammar.repository.comments.patterns.find(pattern => pattern.name === 'comment.line.double-slash.cvolo');
  const blockComment = grammar.repository.comments.patterns.find(pattern => pattern.name === 'comment.block.cvolo');

  assert.equal(strings.begin, '"', 'a double quote begins a string');
  assert.ok(new RegExp(lineComment.begin).test('// null'), '// begins a line comment');
  assert.ok(new RegExp(blockComment.begin).test('/* null */'), '/* begins a block comment');
});
