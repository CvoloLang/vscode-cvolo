'use strict';

const { maskNonCode } = require('./brace-colorizer-runtime');

const TYPE_DECLARATION_KEYWORDS = new Set([
  'struct',
  'class',
  'union',
  'enum',
  'extension',
  'interface',
  'protocol',
  'alias'
]);

const NON_DECLARATION_PREFIXES = new Set([
  'return',
  'await',
  'throw',
  'new',
  'if',
  'for',
  'foreach',
  'while',
  'switch',
  'case'
]);

function range(start, end) {
  return { start, end };
}

function isIdentifierStart(ch) {
  return Boolean(ch) && /[A-Za-z_]/.test(ch);
}

function isIdentifierPart(ch) {
  return Boolean(ch) && /[A-Za-z0-9_]/.test(ch);
}

function previousIdentifierRange(code, endExclusive) {
  let end = endExclusive;
  while (end > 0 && /\s/.test(code[end - 1])) end -= 1;

  let start = end;
  while (start > 0 && isIdentifierPart(code[start - 1])) start -= 1;

  if (start === end || !isIdentifierStart(code[start])) return null;
  return range(start, end);
}

function nextNonWhitespace(code, start) {
  let i = start;
  while (i < code.length && /\s/.test(code[i])) i += 1;
  return i;
}

function findGenericCandidate(code, open) {
  // C#-style generic lists attach directly to the preceding identifier.
  if (open <= 0 || !isIdentifierPart(code[open - 1])) return null;

  const owner = previousIdentifierRange(code, open);
  if (!owner) return null;

  const delimiters = [open];
  const identifiers = [];
  let depth = 1;
  let i = open + 1;

  while (i < code.length) {
    const ch = code[i];

    if (ch === '<' && i > 0 && isIdentifierPart(code[i - 1])) {
      depth += 1;
      delimiters.push(i);
      i += 1;
      continue;
    }

    if (ch === '>') {
      depth -= 1;
      delimiters.push(i);
      if (depth === 0) {
        const after = nextNonWhitespace(code, i + 1);
        if (after === i + 1 && after < code.length && isIdentifierPart(code[after])) {
          return null;
        }
        return {
          open,
          close: i,
          owner,
          delimiters,
          identifiers
        };
      }
      if (depth < 0) return null;
      i += 1;
      continue;
    }

    if (isIdentifierStart(ch)) {
      const start = i;
      i += 1;
      while (i < code.length && isIdentifierPart(code[i])) i += 1;
      identifiers.push({ start, end: i, depth, text: code.slice(start, i) });
      continue;
    }

    // Valid type-list punctuation. Anything expression-like means this was
    // almost certainly a comparison/operator rather than a generic list.
    if (/\s/.test(ch) || ',.?:[]*&'.includes(ch)) {
      i += 1;
      continue;
    }

    if (';{}=+/%!|^'.includes(ch) || ch === '(' || ch === ')') {
      return null;
    }

    i += 1;
  }

  return null;
}

function collectGenericCandidates(code) {
  const result = [];

  for (let i = 0; i < code.length; i += 1) {
    if (code[i] !== '<') continue;
    const candidate = findGenericCandidate(code, i);
    if (!candidate) continue;
    result.push(candidate);
    i = candidate.close;
  }

  return result;
}

function linePrefix(code, position) {
  const lineStart = Math.max(code.lastIndexOf('\n', position - 1), code.lastIndexOf('\r', position - 1)) + 1;
  return code.slice(lineStart, position);
}

function isGenericDeclaration(code, candidate) {
  const ownerText = code.slice(candidate.owner.start, candidate.owner.end);
  const beforeOwner = linePrefix(code, candidate.owner.start).trimEnd();

  const typeDecl = beforeOwner.match(/\b([A-Za-z_][A-Za-z0-9_]*)\s*$/);
  if (typeDecl && TYPE_DECLARATION_KEYWORDS.has(typeDecl[1])) {
    return true;
  }

  const after = nextNonWhitespace(code, candidate.close + 1);
  if (code[after] !== '(') return false;

  const prefix = beforeOwner.trim();
  if (!prefix || /[.=,([]\s*$/.test(prefix)) return false;

  const lastWord = prefix.match(/([A-Za-z_][A-Za-z0-9_]*)\s*$/)?.[1] ?? '';
  if (NON_DECLARATION_PREFIXES.has(lastWord)) return false;

  // A generic function declaration has something return-type-like before its
  // name. A call such as Foo<T>(...) has no such prefix, and obj.Foo<T>(...)
  // is rejected above because its prefix ends in '.'.
  return /[A-Za-z0-9_>\]]/.test(prefix[prefix.length - 1] ?? '') && ownerText.length > 0;
}

function computeNamespaceRanges(code) {
  const ranges = [];
  const regex = /\b(?:using|namespace)\s+([A-Za-z_][A-Za-z0-9_]*(?:\s*\.\s*[A-Za-z_][A-Za-z0-9_]*)*)/g;
  let match;

  while ((match = regex.exec(code)) !== null) {
    const qualifiedName = match[1];
    const relativeStart = match[0].lastIndexOf(qualifiedName);
    const start = match.index + relativeStart;
    ranges.push(range(start, start + qualifiedName.length));
  }

  return ranges;
}

function computeSyntaxColorRanges(source) {
  const code = maskNonCode(source);
  const namespaceRanges = computeNamespaceRanges(code);
  const candidates = collectGenericCandidates(code);
  const genericDelimiterRanges = [];
  const declaredTypeParameters = new Set();

  for (const candidate of candidates) {
    for (const offset of candidate.delimiters) {
      genericDelimiterRanges.push(range(offset, offset + 1));
    }

    if (isGenericDeclaration(code, candidate)) {
      for (const identifier of candidate.identifiers) {
        if (identifier.depth === 1) {
          declaredTypeParameters.add(identifier.text);
        }
      }
    }
  }

  const typeParameterRanges = [];
  if (declaredTypeParameters.size > 0) {
    for (const candidate of candidates) {
      for (const identifier of candidate.identifiers) {
        if (declaredTypeParameters.has(identifier.text)) {
          typeParameterRanges.push(range(identifier.start, identifier.end));
        }
      }
    }
  }

  return {
    namespaceRanges,
    genericDelimiterRanges,
    typeParameterRanges
  };
}

module.exports = {
  collectGenericCandidates,
  computeSyntaxColorRanges,
  isGenericDeclaration
};
