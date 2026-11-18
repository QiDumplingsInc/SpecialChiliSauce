// Behavioural tests for the admin edit-mode patch gate (scripts/content-patch.mjs).
//
// This module is the only write path from the browser edit mode into the
// repository, so these tests are the security boundary for the whole feature:
// every rejection case below is an attack or a mistake that must never reach a
// pull request. The happy-path tests additionally pin the diff shape, because a
// patch that rewrites the whole content file is unreviewable even when its
// values are correct.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyContentPatch, EDITABLE_CONTENT } from '../scripts/content-patch.mjs';

const repoRoot = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Each test gets its own copy of the real content files, so a test that writes
// can never touch the working tree and tests cannot see each other's writes.
const freshContentRoot = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'content-patch-'));
  mkdirSync(path.join(dir, 'content'));
  copyFileSync(path.join(repoRoot, 'content', 'artworks.json'), path.join(dir, 'content', 'artworks.json'));
  copyFileSync(path.join(repoRoot, 'content', 'gallery.json'), path.join(dir, 'content', 'gallery.json'));
  return dir;
};

const edit = (overrides = {}) => ({
  file: 'content/artworks.json',
  collection: 'artworks',
  key: 'painting-001',
  field: 'titleEn',
  value: 'Lemons on a Table',
  ...overrides,
});

const patchOf = (...edits) => ({ version: 1, edits });

test('applies a whitelisted text edit and rewrites only that one value', () => {
  const contentRoot = freshContentRoot();
  const target = path.join(contentRoot, 'content', 'artworks.json');
  const before = readFileSync(target, 'utf8');

  const result = applyContentPatch(patchOf(edit()), { contentRoot });

  assert.equal(result.ok, true);
  assert.deepEqual(result.errors, []);
  assert.equal(result.changed, true);
  assert.deepEqual(result.files, ['content/artworks.json']);

  const after = readFileSync(target, 'utf8');
  const changedLines = after
    .split('\n')
    .filter((line, index) => line !== before.split('\n')[index]);
  assert.equal(changedLines.length, 1, 'a single field edit must produce a single-line diff');
  assert.match(changedLines[0], /"titleEn": "Lemons on a Table",/);

  assert.equal(
    JSON.parse(after).artworks.find((artwork) => artwork.id === 'painting-001').titleEn,
    'Lemons on a Table'
  );
  rmSync(contentRoot, { recursive: true, force: true });
});

test('dryRun validates and reports the change without writing', () => {
  const contentRoot = freshContentRoot();
  const target = path.join(contentRoot, 'content', 'artworks.json');
  const before = readFileSync(target, 'utf8');

  const result = applyContentPatch(patchOf(edit()), { contentRoot, dryRun: true });

  assert.equal(result.ok, true);
  assert.equal(result.changed, true);
  assert.equal(result.summary.length, 1);
  assert.equal(result.summary[0].before, 'Lemons');
  assert.equal(result.summary[0].after, 'Lemons on a Table');
  assert.equal(readFileSync(target, 'utf8'), before, 'dryRun must not write');
  rmSync(contentRoot, { recursive: true, force: true });
});

test('adds an optional field that is absent from the record', () => {
  const contentRoot = freshContentRoot();

  const result = applyContentPatch(
    patchOf(edit({ field: 'dimensionsEn', value: '24 x 18 in' })),
    { contentRoot }
  );

  assert.equal(result.ok, true);
  assert.equal(result.summary[0].before, null);
  const artwork = JSON.parse(readFileSync(path.join(contentRoot, 'content', 'artworks.json'), 'utf8'))
    .artworks.find((entry) => entry.id === 'painting-001');
  assert.equal(artwork.dimensionsEn, '24 x 18 in');
  rmSync(contentRoot, { recursive: true, force: true });
});

test('clears an optional year with null so the card renders n.d.', () => {
  const contentRoot = freshContentRoot();
  const seeded = applyContentPatch(patchOf(edit({ field: 'year', value: 1998 })), { contentRoot });
  assert.equal(seeded.ok, true);

  const result = applyContentPatch(patchOf(edit({ field: 'year', value: null })), { contentRoot });

  assert.equal(result.ok, true);
  const artwork = JSON.parse(readFileSync(path.join(contentRoot, 'content', 'artworks.json'), 'utf8'))
    .artworks.find((entry) => entry.id === 'painting-001');
  assert.equal('year' in artwork, false, 'a cleared year is removed, not stored as null');
  rmSync(contentRoot, { recursive: true, force: true });
});

test('reports no change and writes nothing when the value already matches', () => {
  const contentRoot = freshContentRoot();
  const target = path.join(contentRoot, 'content', 'artworks.json');
  const before = readFileSync(target, 'utf8');

  const result = applyContentPatch(patchOf(edit({ value: 'Lemons' })), { contentRoot });

  assert.equal(result.ok, true);
  assert.equal(result.changed, false, 'a no-op patch must not open an empty pull request');
  assert.equal(readFileSync(target, 'utf8'), before);
  rmSync(contentRoot, { recursive: true, force: true });
});

// --- Rejections. Each one fails the whole patch; nothing is written. ---

const rejects = [
  ['an unknown patch version', { version: 2, edits: [edit()] }, /version/i],
  ['a missing edits array', { version: 1 }, /edits/i],
  ['an empty edits array', patchOf(), /edits/i],
  ['a non-object edit', patchOf('titleEn=x'), /edit 0/i],
  ['an unknown key on an edit', patchOf({ ...edit(), path: 'content/../etc/passwd' }), /unknown propert/i],
  ['a file outside the whitelist', patchOf(edit({ file: 'package.json' })), /file/i],
  ['a path traversal in the file name', patchOf(edit({ file: 'content/../package.json' })), /file/i],
  ['a collection outside the whitelist', patchOf(edit({ collection: 'facets' })), /collection/i],
  ['a field outside the whitelist', patchOf(edit({ field: 'image' })), /field/i],
  ['a structural field disguised as text', patchOf(edit({ field: 'medium', value: 'sculpture' })), /field/i],
  ['an id edit that would re-key the record', patchOf(edit({ field: 'id', value: 'painting-999' })), /field/i],
  ['a prototype-pollution field name', patchOf(edit({ field: '__proto__', value: 'x' })), /field/i],
  ['a prototype-pollution record key', patchOf(edit({ key: '__proto__' })), /key/i],
  ['a record that does not exist', patchOf(edit({ key: 'painting-999' })), /key/i],
  ['a non-string text value', patchOf(edit({ value: 42 })), /value/i],
  ['an empty text value', patchOf(edit({ value: '   ' })), /value/i],
  ['a text value over the field limit', patchOf(edit({ value: 'x'.repeat(201) })), /value/i],
  ['markup in a text value', patchOf(edit({ value: 'Lemons <script>alert(1)</script>' })), /value/i],
  ['a newline in a single-line text value', patchOf(edit({ value: 'Lemons\nand limes' })), /value/i],
  ['a control character in a text value', patchOf(edit({ value: 'Lemons\u0000' })), /value/i],
  ['a non-integer year', patchOf(edit({ field: 'year', value: '1998' })), /value/i],
  ['an out-of-range year', patchOf(edit({ field: 'year', value: 99 })), /value/i],
  ['two edits to the same field', patchOf(edit({ value: 'A' }), edit({ value: 'B' })), /duplicate/i],
  ['more edits than the cap', { version: 1, edits: Array.from({ length: 201 }, () => edit()) }, /edits/i],
];

for (const [label, patch, expected] of rejects) {
  test(`rejects ${label}`, () => {
    const contentRoot = freshContentRoot();
    const target = path.join(contentRoot, 'content', 'artworks.json');
    const before = readFileSync(target, 'utf8');

    const result = applyContentPatch(patch, { contentRoot });

    assert.equal(result.ok, false, `${label} must be rejected`);
    assert.ok(result.errors.length > 0);
    assert.match(result.errors.join(' | '), expected);
    assert.equal(result.changed, false);
    assert.equal(readFileSync(target, 'utf8'), before, 'a rejected patch must write nothing');
    rmSync(contentRoot, { recursive: true, force: true });
  });
}

test('rejects a valid edit when any other edit in the patch is invalid', () => {
  const contentRoot = freshContentRoot();
  const target = path.join(contentRoot, 'content', 'artworks.json');
  const before = readFileSync(target, 'utf8');

  const result = applyContentPatch(
    patchOf(edit(), edit({ key: 'painting-002', field: 'image', value: '../../etc/passwd' })),
    { contentRoot }
  );

  assert.equal(result.ok, false);
  assert.equal(readFileSync(target, 'utf8'), before, 'the patch is all-or-nothing');
  rmSync(contentRoot, { recursive: true, force: true });
});

test('refuses to write a content file whose formatting it cannot reproduce', () => {
  // content/gallery.json is hand-formatted with compact single-line objects that
  // JSON.stringify cannot reproduce, so a parse-and-rewrite would reformat the
  // whole file and bury the real edit. The gate enforces that by code rather
  // than by convention, and will start allowing the file the day its formatting
  // is normalised.
  const contentRoot = freshContentRoot();
  const target = path.join(contentRoot, 'content', 'gallery.json');
  const before = readFileSync(target, 'utf8');

  const result = applyContentPatch(
    patchOf({
      file: 'content/gallery.json',
      collection: 'mediumPages',
      key: 'painting',
      field: 'titleEn',
      value: 'Paintings',
    }),
    { contentRoot }
  );

  assert.equal(result.ok, false);
  assert.match(result.errors.join(' | '), /formatting/i);
  assert.equal(readFileSync(target, 'utf8'), before);
  rmSync(contentRoot, { recursive: true, force: true });
});

test('accepts the same gallery.json edit once the file formatting round-trips', () => {
  const contentRoot = freshContentRoot();
  const target = path.join(contentRoot, 'content', 'gallery.json');
  writeFileSync(target, `${JSON.stringify(JSON.parse(readFileSync(target, 'utf8')), null, 4)}\n`);

  const result = applyContentPatch(
    patchOf({
      file: 'content/gallery.json',
      collection: 'mediumPages',
      key: 'painting',
      field: 'titleEn',
      value: 'Paintings',
    }),
    { contentRoot }
  );

  assert.equal(result.ok, true, result.errors.join(' | '));
  assert.equal(
    JSON.parse(readFileSync(target, 'utf8')).mediumPages.find((page) => page.slug === 'painting').titleEn,
    'Paintings'
  );
  rmSync(contentRoot, { recursive: true, force: true });
});

test('the whitelist exposes no field that the gallery build treats as structure', () => {
  // The edit mode is text only. If a future change adds an image path, a medium
  // slug or an id to the whitelist, a non-technical editor could break every
  // page or point an <img> at an arbitrary path, so pin the surface here.
  const structural = new Set([
    'id',
    'slug',
    'href',
    'medium',
    'image',
    'imageWidth',
    'imageHeight',
    'colors',
    'style',
    'sizeRange',
  ]);
  for (const [file, collections] of Object.entries(EDITABLE_CONTENT)) {
    for (const [collection, spec] of Object.entries(collections)) {
      for (const field of Object.keys(spec.fields)) {
        assert.equal(
          structural.has(field),
          false,
          `${file}/${collection}: "${field}" is structural and must not be editable`
        );
      }
    }
  }
});
