'use strict';

// The viewer's highlighting is a TextMate grammar, so the only way a line can be coloured correctly
// is for exactly one top-level rule to claim it. The grammar used to start with a `title` rule whose
// pattern matched every non-blank line, which shadowed every other rule and left the whole document
// one scope (§11, §12, §51). These tests render real documents and pin the claim of every line so a
// rule can never swallow the view again.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const runtime = require('../editor-intelligence-runtime');

const grammar = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'syntaxes', 'cvolo-layout.tmLanguage.json'), 'utf8'));

function orderedRules() {
  return grammar.patterns.map(pattern => {
    const name = pattern.include.slice(1);
    const rule = grammar.repository[name];
    assert.ok(rule && rule.match, `grammar rule ${name} must exist and carry a match pattern`);
    return { name, regex: new RegExp(rule.match) };
  });
}

function claims(line) {
  return orderedRules().filter(rule => rule.regex.test(line)).map(rule => rule.name);
}

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

function renderLines(layout, options) {
  return runtime.formatTypeLayout(layout, options).split('\n');
}

function claimableLines(layout, options) {
  return renderLines(layout, options).filter(line => line !== '');
}

test('every line of the rendered view is claimed by exactly one grammar rule', () => {
  const formats = ['decimal', 'hex', 'decimalAndHex'];
  for (const offsetFormat of formats) {
    for (const showPaddingPercentage of [false, true]) {
      const lines = renderLines(valueLayout(), { offsetFormat, showPaddingPercentage });
      assert.ok(claimableLines(valueLayout(), { offsetFormat, showPaddingPercentage }).length >= 10,
        `${offsetFormat} view should render the full document`);
      for (const line of lines) {
        const expected = line === '' ? ['blank-line'] : [claims(line)[0]];
        assert.deepEqual(
          claims(line),
          expected,
          `${offsetFormat} line ${JSON.stringify(line)} must be claimed by exactly one rule, was ${claims(line).join(',')}`
        );
      }
    }
  }
});

test('the title rule claims only the single type-name line', () => {
  const lines = claimableLines(valueLayout({ typeDisplay: 'Pair<int>' }), { offsetFormat: 'decimal' });

  assert.deepEqual(claims(lines[0]), ['title']);
  assert.equal(lines[0], 'Pair<int>');

  // No other rendered line is a single token, so nothing else may fall to the title rule.
  for (const line of lines.slice(1)) {
    assert.ok(!claims(line).includes('title'), `line ${JSON.stringify(line)} must not be a title`);
  }
});

test('each structural line lands on its own rule', () => {
  const lines = claimableLines(valueLayout(), { offsetFormat: 'decimalAndHex', showPaddingPercentage: true });

  const claimed = new Map(lines.map(line => [claims(line)[0], line]));
  assert.ok(claimed.has('title'), 'a title is claimed');
  assert.ok(claimed.has('target'), 'a target is claimed');
  assert.ok(claimed.has('fact'), 'a fact is claimed');
  assert.ok(claimed.has('table-heading'), 'the table heading is claimed');
  assert.ok(claimed.has('table-row'), 'a field row is claimed');
  assert.ok(claimed.has('padding-row'), 'a padding row is claimed');

  assert.match(claimed.get('target'), /^Target: \S+$/);
  assert.match(claimed.get('table-heading'), /^Offset\s+Size\s+Align\s+Field\s+Type$/);
});

test('a field row exposes its number, member and type captures', () => {
  const rule = grammar.repository['table-row'];
  const line = claimableLines(valueLayout(), { offsetFormat: 'decimal' })
    .find(candidate => claims(candidate)[0] === 'table-row' && candidate.includes('Payload'));

  const match = new RegExp(rule.match).exec(line);
  assert.ok(match, `the field row ${JSON.stringify(line)} must match the table rule`);
  assert.equal(match[7], 'Payload');
  assert.equal(match[9], 'long');
  assert.equal(rule.captures['7'].name, 'variable.other.member.cvolo-layout');
  assert.ok(rule.captures['9'], 'the type cell must be a nested capture');
});

test('a padding row exposes its padding cell and never a member', () => {
  const rule = grammar.repository['padding-row'];
  const line = claimableLines(valueLayout(), { offsetFormat: 'decimal' })
    .find(candidate => candidate.includes('<padding>'));

  const match = new RegExp(rule.match).exec(line);
  assert.ok(match, `the padding row ${JSON.stringify(line)} must match the padding rule`);
  assert.equal(match[7], '<padding>');
  assert.equal(rule.captures['7'].name, 'comment.block.padding.cvolo-layout');
});
