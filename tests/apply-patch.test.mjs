// Behavioural tests for the offline submit path (scripts/apply-patch.mjs).
//
// Edit mode has no backend: the browser's Submit button downloads a patch file
// and this script is what turns that file into a reviewable change on disk.
// That makes it the whole submit path, so these tests cover the two properties
// the reviewer depends on. First, a rejected patch must leave the working tree
// byte for byte unchanged, because a half-applied submission is worse than a
// refused one. Second, a patch that applies must leave content and generated
// HTML consistent, because a content edit that skipped the build would show up
// as a correct JSON diff and a stale page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, chmodSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { applyPatchFile } from '../scripts/apply-patch.mjs';

const repoRoot = path.resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Each test gets its own copy of the real content files plus the directories
// the gallery build writes into, so a test that applies a patch and rebuilds
// can never touch the working tree.
const freshWorkspace = () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'apply-patch-'));
  mkdirSync(path.join(dir, 'content'), { recursive: true });
  mkdirSync(path.join(dir, 'assets', 'js'), { recursive: true });
  copyFileSync(path.join(repoRoot, 'content', 'artworks.json'), path.join(dir, 'content', 'artworks.json'));
  copyFileSync(path.join(repoRoot, 'content', 'gallery.json'), path.join(dir, 'content', 'gallery.json'));
  return dir;
};

const writePatch = (workspace, patch) => {
  const patchPath = path.join(workspace, 'patch.json');
  writeFileSync(patchPath, typeof patch === 'string' ? patch : JSON.stringify(patch, null, 2));
  return patchPath;
};

const titlePatch = (value) => ({
  version: 1,
  edits: [{ file: 'content/artworks.json', collection: 'artworks', key: 'painting-001', field: 'titleEn', value }],
});

test('applies a valid patch file and regenerates the HTML from the new content', () => {
  const workspace = freshWorkspace();
  try {
    const patchPath = writePatch(workspace, titlePatch('Lemons and a Lime'));

    const result = applyPatchFile(patchPath, { contentRoot: workspace });

    assert.equal(result.ok, true, result.errors.join('; '));
    assert.deepEqual(result.errors, []);
    assert.equal(result.changed, true);
    assert.equal(result.built, true, 'a content change must regenerate the pages');
    assert.deepEqual(result.files, ['content/artworks.json']);
    assert.deepEqual(result.summary.map((entry) => [entry.field, entry.before, entry.after]), [
      ['titleEn', 'Lemons', 'Lemons and a Lime'],
    ]);

    const content = JSON.parse(readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8'));
    assert.equal(content.artworks.find((item) => item.id === 'painting-001').titleEn, 'Lemons and a Lime');

    const page = readFileSync(path.join(workspace, 'gallery-painting.html'), 'utf8');
    assert.ok(page.includes('Lemons and a Lime'), 'the regenerated page must carry the new wording');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('refuses a patch file that does not exist and writes nothing', () => {
  const workspace = freshWorkspace();
  try {
    const before = readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8');

    const result = applyPatchFile(path.join(workspace, 'no-such-patch.json'), { contentRoot: workspace });

    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
    assert.equal(result.built, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /cannot be read/);
    assert.equal(readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8'), before);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('refuses a patch file that is not valid JSON', () => {
  const workspace = freshWorkspace();
  try {
    const patchPath = writePatch(workspace, '{ "version": 1, "edits": [ ');

    const result = applyPatchFile(patchPath, { contentRoot: workspace });

    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /is not valid JSON/);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('refuses a patch the content gate rejects and leaves the content files untouched', () => {
  const workspace = freshWorkspace();
  try {
    const before = readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8');
    // `image` is deliberately outside the whitelist: wording is editable, the
    // path an <img> points at is not.
    const patchPath = writePatch(workspace, {
      version: 1,
      edits: [
        { file: 'content/artworks.json', collection: 'artworks', key: 'painting-001', field: 'titleEn', value: 'Fine' },
        { file: 'content/artworks.json', collection: 'artworks', key: 'painting-001', field: 'image', value: 'evil.jpg' },
      ],
    });

    const result = applyPatchFile(patchPath, { contentRoot: workspace });

    assert.equal(result.ok, false);
    assert.equal(result.changed, false);
    assert.equal(result.built, false);
    assert.ok(result.errors.some((message) => /field "image" is not editable/.test(message)));
    assert.equal(
      readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8'),
      before,
      'one rejected edit must discard the whole patch, including the valid edit beside it'
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('reports no change for a patch whose values already match and skips the build', () => {
  const workspace = freshWorkspace();
  try {
    const patchPath = writePatch(workspace, titlePatch('Lemons'));

    const result = applyPatchFile(patchPath, { contentRoot: workspace });

    assert.equal(result.ok, true);
    assert.equal(result.changed, false);
    assert.equal(result.built, false, 'a no-op patch must not run the build or dirty the tree');
    assert.deepEqual(result.files, []);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('restores the content files when the build fails, so a failed submit leaves nothing behind', () => {
  const workspace = freshWorkspace();
  try {
    const before = readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8');
    const patchPath = writePatch(workspace, titlePatch('Lemons and a Lime'));

    const result = applyPatchFile(patchPath, {
      contentRoot: workspace,
      buildCommand: ['node', ['--eval', 'process.exit(1)']],
    });

    assert.equal(result.ok, false);
    assert.equal(result.built, false);
    assert.ok(result.errors.some((message) => /build failed/.test(message)));
    assert.equal(
      readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8'),
      before,
      'a failed build must roll the content file back to its original bytes'
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('a dry run validates and reports the change without writing anything', () => {
  const workspace = freshWorkspace();
  try {
    const before = readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8');
    const patchPath = writePatch(workspace, titlePatch('Lemons and a Lime'));

    const result = applyPatchFile(patchPath, { contentRoot: workspace, dryRun: true });

    assert.equal(result.ok, true);
    assert.equal(result.changed, true);
    assert.equal(result.built, false);
    assert.deepEqual(result.summary.map((entry) => entry.after), ['Lemons and a Lime']);
    assert.equal(readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8'), before);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

// Security review F2: the gate writes each touched content file in a loop with
// no rollback, so a write that fails partway through a two-file patch left one
// file rewritten and the other not. The submit path owns recovering from that.
test('rolls back when one content file writes and the next one fails', () => {
  const workspace = freshWorkspace();
  const galleryPath = path.join(workspace, 'content', 'gallery.json');
  try {
    // gallery.json ships hand-formatted, which the gate refuses. Normalise the
    // copy in this workspace so the patch reaches the write phase at all.
    writeFileSync(galleryPath, `${JSON.stringify(JSON.parse(readFileSync(galleryPath, 'utf8')), null, 4)}\n`);
    const artworksBefore = readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8');
    const galleryBefore = readFileSync(galleryPath, 'utf8');

    const patchPath = writePatch(workspace, {
      version: 1,
      edits: [
        { file: 'content/artworks.json', collection: 'artworks', key: 'painting-001', field: 'titleEn', value: 'Lemons and a Lime' },
        { file: 'content/gallery.json', collection: 'exhibitions', key: 'panelled-wall', field: 'titleEn', value: 'The Panel Wall' },
      ],
    });
    // artworks.json sorts first, so it is written before gallery.json fails.
    chmodSync(galleryPath, 0o444);

    const result = applyPatchFile(patchPath, { contentRoot: workspace });

    assert.equal(result.ok, false);
    assert.equal(result.built, false);
    assert.ok(result.errors.some((message) => /could not be written|rolled back/i.test(message)), result.errors.join('; '));
    assert.equal(
      readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8'),
      artworksBefore,
      'the file that did write must be rolled back when a later file fails'
    );
    assert.equal(readFileSync(galleryPath, 'utf8'), galleryBefore);
  } finally {
    chmodSync(galleryPath, 0o644);
    rmSync(workspace, { recursive: true, force: true });
  }
});
