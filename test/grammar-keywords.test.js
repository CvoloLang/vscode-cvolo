'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const grammar = JSON.parse(fs.readFileSync(
  path.join(__dirname, '..', 'syntaxes', 'cvolo.tmLanguage.json'),
  'utf8'
));

function patternNamed(name) {
  return grammar.repository.keywords.patterns.find(pattern => pattern.name === name);
}

test('delegate is lexically classified as a language keyword', () => {
  const modifiers = patternNamed('storage.modifier.cvolo');
  assert.ok(modifiers, 'storage.modifier.cvolo pattern must exist');
  assert.match('delegate', new RegExp(modifiers.match));
});

test('native delegate keywords remain independently classifiable', () => {
  const modifiers = patternNamed('storage.modifier.cvolo');
  const regex = new RegExp(modifiers.match, 'g');
  assert.deepEqual('public unsafe delegate'.match(regex), ['public', 'unsafe', 'delegate']);
});

test('type declaration keyword is colored even before its name is typed', () => {
  const declaration = patternNamed('storage.type.declaration.cvolo');
  assert.ok(declaration, 'standalone type declaration keyword scope must exist');
  for (const keyword of ['struct', 'union', 'enum', 'extension', 'interface', 'protocol', 'alias']) {
    assert.match(keyword, new RegExp(declaration.match));
  }
  for (const incomplete of ['stru', 'struc', 'randomStruct']) {
    assert.doesNotMatch(incomplete, new RegExp(declaration.match));
  }
});

test('attribute syntax keeps the C#-like name scope without treating strings as identifiers', () => {
  const attribute = grammar.repository.attributes.patterns[0];
  assert.equal(attribute.beginCaptures['2'].name, 'entity.name.type.attribute.cvolo');
  for (const source of ['[Ctor]', '[SuppressWarning("CVL1002")]', '[Author("Example")]']) {
    const match = new RegExp(attribute.begin).exec(source);
    assert.ok(match, 'attribute must be recognized: ' + source);
  }
  assert.ok(attribute.patterns.some(pattern => pattern.include === '#strings'));
});
