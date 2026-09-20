'use strict';

const CONTROL_HEADERS = new Set([
  'if',
  'for',
  'foreach',
  'while',
  'switch',
  'catch',
  'lock',
  'using',
  'nameof',
  'typeof',
  'sizeof'
]);

function blank(chars, start, end) {
  for (let i = start; i < end; i += 1) {
    if (chars[i] !== '\n' && chars[i] !== '\r') {
      chars[i] = ' ';
    }
  }
}

function maskNonCode(source) {
  const chars = source.split('');
  const length = source.length;
  let i = 0;

  while (i < length) {
    // Line comment.
    if (source[i] === '/' && source[i + 1] === '/') {
      let end = i + 2;
      while (end < length && source[end] !== '\n' && source[end] !== '\r') {
        end += 1;
      }
      blank(chars, i, end);
      i = end;
      continue;
    }

    // Block comment.
    if (source[i] === '/' && source[i + 1] === '*') {
      let end = i + 2;
      while (end < length && !(source[end] === '*' && source[end + 1] === '/')) {
        end += 1;
      }
      end = Math.min(length, end + 2);
      blank(chars, i, end);
      i = end;
      continue;
    }

    // Cvolo raw strings: @"...", @$"...", or "@...
    const rawPrefixLength =
      source.startsWith('@$"', i) ? 3 :
      source.startsWith('@"', i) ? 2 :
      source.startsWith('"@', i) ? 2 :
      0;

    if (rawPrefixLength > 0) {
      let end = i + rawPrefixLength;
      while (end < length) {
        if (source[end] === '"') {
          if (source[end + 1] === '"') {
            end += 2;
            continue;
          }
          end += 1;
          break;
        }
        end += 1;
      }
      blank(chars, i, end);
      i = end;
      continue;
    }

    // Interpolated or regular string. We intentionally mask interpolation
    // bodies too; native bracket coloring can still handle them.
    if ((source[i] === '$' && source[i + 1] === '"') || source[i] === '"') {
      const start = i;
      let end = source[i] === '$' ? i + 2 : i + 1;
      while (end < length) {
        if (source[end] === '\\') {
          end += 2;
          continue;
        }
        if (source[end] === '"') {
          end += 1;
          break;
        }
        end += 1;
      }
      blank(chars, start, Math.min(end, length));
      i = end;
      continue;
    }

    // Character literal.
    if (source[i] === "'") {
      const start = i;
      let end = i + 1;
      while (end < length) {
        if (source[end] === '\\') {
          end += 2;
          continue;
        }
        if (source[end] === "'") {
          end += 1;
          break;
        }
        end += 1;
      }
      blank(chars, start, Math.min(end, length));
      i = end;
      continue;
    }

    i += 1;
  }

  return chars.join('');
}

function previousIdentifier(text, endExclusive) {
  let i = endExclusive - 1;
  while (i >= 0 && /\s/.test(text[i])) i -= 1;

  // Skip a generic argument list such as Foo<T>.
  if (i >= 0 && text[i] === '>') {
    let depth = 1;
    i -= 1;
    while (i >= 0 && depth > 0) {
      if (text[i] === '>') depth += 1;
      else if (text[i] === '<') depth -= 1;
      i -= 1;
    }
    while (i >= 0 && /\s/.test(text[i])) i -= 1;
  }

  const end = i + 1;
  while (i >= 0 && /[A-Za-z0-9_]/.test(text[i])) i -= 1;
  const start = i + 1;

  if (start >= end || !/[A-Za-z_]/.test(text[start])) {
    return '';
  }
  return text.slice(start, end);
}

function looksLikeTopLevelFunctionHeader(headerText) {
  const header = headerText.trimEnd();
  if (!header.endsWith(')')) {
    return false;
  }

  let depth = 0;
  let openParen = -1;
  for (let i = header.length - 1; i >= 0; i -= 1) {
    if (header[i] === ')') {
      depth += 1;
    } else if (header[i] === '(') {
      depth -= 1;
      if (depth === 0) {
        openParen = i;
        break;
      }
    }
  }

  if (openParen < 0) {
    return false;
  }

  const name = previousIdentifier(header, openParen);
  return Boolean(name) && !CONTROL_HEADERS.has(name);
}

function computeBraceColorOffsets(source) {
  const code = maskNonCode(source);
  const groups = [[], [], []];
  const stack = [];
  let topLevelHeaderStart = 0;

  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];

    if (ch === ';' && stack.length === 0) {
      topLevelHeaderStart = i + 1;
      continue;
    }

    if (ch === '{') {
      let colorIndex;

      if (stack.length === 0) {
        const header = code.slice(topLevelHeaderStart, i);
        colorIndex = looksLikeTopLevelFunctionHeader(header) ? 1 : 0;
      } else {
        colorIndex = (stack[stack.length - 1].colorIndex + 1) % 3;
      }

      stack.push({ colorIndex });
      groups[colorIndex].push(i);
      continue;
    }

    if (ch === '}') {
      const entry = stack.pop();
      const colorIndex = entry?.colorIndex ?? 0;
      groups[colorIndex].push(i);

      if (stack.length === 0) {
        topLevelHeaderStart = i + 1;
      }
    }
  }

  return groups;
}

module.exports = {
  computeBraceColorOffsets,
  looksLikeTopLevelFunctionHeader,
  maskNonCode
};
