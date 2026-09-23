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
