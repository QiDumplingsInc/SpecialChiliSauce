// Regression guard for the overlay's HTML sinks (assets/js/edit-mode.js).
//
// The security review of commit ae48be1 confirmed that every innerHTML
// assignment in the overlay interpolates only hardcoded COPY.* UI constants,
// and that every content-derived value reaches the page through textContent or
// setAttribute instead. That is what makes the overlay safe to run against a
// sessionStorage payload an attacker could have written.
//
// Today that safety is a convention. Nothing fails if a future edit drops a
// pending edit's value into one of those templates, which would open a stored
// XSS path on the editor's own page. These tests turn the convention into a
// red build: they parse the overlay, isolate each innerHTML right-hand side,
// and assert it is made of nothing but string literals and COPY references.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const overlayPath = path.join(__dirname, '..', 'assets', 'js', 'edit-mode.js');

test('every innerHTML assignment in the overlay interpolates only hardcoded COPY constants', () => {
  const source = readFileSync(overlayPath, 'utf-8');
  const assignments = [];

  for (let i = 0; i < source.length; i += 1) {
    if (!source.startsWith('.innerHTML', i)) {
      continue;
    }
    let cursor = i + '.innerHTML'.length;
    while (cursor < source.length && /\s/.test(source[cursor])) {
      cursor += 1;
    }
    if (source[cursor] !== '=' || source[cursor + 1] === '=') {
      continue;
    }
    cursor += 1;

    // Walk to the semicolon that ends the statement, tracking quote state so a
    // semicolon inside an HTML string literal does not cut the expression short.
    let quote = '';
    let end = cursor;
    while (end < source.length) {
      const character = source[end];
      if (quote !== '') {
        if (character === '\\') {
          end += 2;
          continue;
        }
        if (character === quote) {
          quote = '';
        }
      } else if (character === "'" || character === '"' || character === '`') {
        quote = character;
      } else if (character === ';') {
        break;
      }
      end += 1;
    }
    assert.ok(
      end < source.length,
      `An innerHTML assignment at line ${source.slice(0, i).split('\n').length} is never terminated by a semicolon, so this guard cannot read it. Rewrite the statement so the expression ends with a semicolon.`
    );

    assignments.push({
      line: source.slice(0, i).split('\n').length,
      expression: source.slice(cursor, end)
    });
  }

  // Anti-vacuity: the overlay builds its toolbar and review screen with
  // innerHTML, so finding none means the scan above broke rather than that the
  // code became safe.
  assert.ok(
    assignments.length > 0,
    'Found no innerHTML assignment in assets/js/edit-mode.js. This guard only proves something while it can still see those statements, so either the overlay stopped using innerHTML and this test should be deleted, or the scan needs fixing.'
  );

  for (const assignment of assignments) {
    assert.ok(
      !assignment.expression.includes('`'),
      `The innerHTML assignment at assets/js/edit-mode.js:${assignment.line} uses a template literal. Interpolation there is invisible to this guard, so use single-quoted strings concatenated with COPY.* constants instead.`
    );

    // Strip the parts that are safe by construction: quoted markup, COPY
    // lookups, concatenation operators and whitespace. Anything that survives
    // is a value whose origin this guard cannot vouch for.
    const residue = assignment.expression
      .replace(/'(?:[^'\\]|\\.)*'/g, '')
      .replace(/"(?:[^"\\]|\\.)*"/g, '')
      .replace(/\bCOPY(?:\.[A-Za-z_$][\w$]*)+/g, '')
      .replace(/[+\s]/g, '');

    assert.equal(
      residue,
      '',
      `The innerHTML assignment at assets/js/edit-mode.js:${assignment.line} interpolates ${JSON.stringify(residue)}, which is not a hardcoded COPY.* constant. A content or editor-supplied value rendered as HTML is a stored XSS path on the editor's page. Assign it with textContent, or set it with setAttribute, instead.`
    );
  }
});

test('the overlay reaches the DOM through no HTML sink other than innerHTML', () => {
  const source = readFileSync(overlayPath, 'utf-8');

  for (const sink of ['eval(', 'new Function(', 'insertAdjacentHTML', 'document.write', 'outerHTML']) {
    const index = source.indexOf(sink);
    assert.equal(
      index,
      -1,
      `assets/js/edit-mode.js:${source.slice(0, index).split('\n').length} uses ${sink}, which parses its argument as HTML or as code. The innerHTML guard in this file does not cover it, so route the value through textContent or setAttribute instead.`
    );
  }
});
