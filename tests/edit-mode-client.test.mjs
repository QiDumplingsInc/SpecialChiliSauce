// Behavioural tests for the browser overlay (assets/js/edit-mode.js).
//
// These drive the real overlay in jsdom against a real generated page, so they
// exercise the code an editor runs rather than a reimplementation of it. The
// properties that matter are the ones a non-technical editor cannot check for
// themselves. A value the gate would refuse must be refused here with a
// message, and the page must be put back rather than left displaying text that
// could never be submitted. The review screen must list exactly what
// apply-patch.mjs --dry-run will report, because the editor reads the review
// screen and the reviewer reads the dry run, and the two disagreeing is how an
// editor loses trust in the tool. Finally the downloaded file has to be in the
// exact patch format, which the last test proves by handing it to the gate.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

import { applyPatchFile } from '../scripts/apply-patch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const artworkCatalog = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'artworks.json'), 'utf8'));
const firstPainting = artworkCatalog.artworks.find((artwork) => artwork.medium === 'painting');
const TITLE_ADDRESS = `content/artworks.json|artworks|${firstPainting.id}|titleEn`;

/**
 * Load a generated gallery page into jsdom with edit mode already running.
 *
 * Input: `filename` is a generated page at the repo root; `pending` is an
 * optional array of pending-edit records to seed sessionStorage with, which is
 * how a test reproduces an editor who made a change and then navigated.
 *
 * Output: a JSDOM instance whose document has the overlay attached, plus a
 * `downloads` array that collects every Blob the overlay hands to
 * URL.createObjectURL, so the download can be inspected.
 *
 * Process: inline every local <script src> the way the other page tests do,
 * then append the generated rules and the overlay directly instead of relying
 * on the bootstrap's dynamic injection, which jsdom will not fetch. Stubs
 * URL.createObjectURL because jsdom has none, and silences jsdom's navigation
 * error because clicking a download link is a navigation it does not model.
 */
async function loadEditMode(filename, pending) {
  const html = readFileSync(path.join(repoRoot, filename), 'utf-8').replace(
    /<script src="([^"]+)"><\/script>/g,
    (match, src) =>
      /^https?:\/\//.test(src) ? match : `<script>${readFileSync(path.join(repoRoot, src), 'utf-8')}</script>`
  );
  const rules = readFileSync(path.join(repoRoot, 'assets', 'js', 'edit-mode-rules.js'), 'utf-8');
  const overlay = readFileSync(path.join(repoRoot, 'assets', 'js', 'edit-mode.js'), 'utf-8');
  const seed =
    pending === undefined
      ? ''
      : `<script>window.sessionStorage.setItem('galleryEditPending', ${JSON.stringify(JSON.stringify(pending))});</script>`;
  const withOverlay = html.replace('</body>', `${seed}<script>${rules}</script><script>${overlay}</script></body>`);

  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  const downloads = [];
  const dom = new JSDOM(withOverlay, {
    url: 'https://qidumplingsinc.github.io/SpecialChiliSauce/gallery-painting.html?edit=1',
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      window.URL.createObjectURL = (blob) => {
        downloads.push(blob);
        return 'blob:stub';
      };
      window.URL.revokeObjectURL = () => {};
    },
  });
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') resolve();
    else dom.window.addEventListener('load', resolve);
  });
  dom.downloads = downloads;
  return dom;
}

/**
 * Edit one addressed element the way an editor does and commit the change.
 *
 * Input: the JSDOM instance, the `data-edit-field` address to edit, and the
 * `value` to type. Output: the element that was edited, so the caller can
 * assert on what the page now displays.
 *
 * Process: click the element to make it editable, replace its text, then blur,
 * which is the overlay's commit point. Dispatching the real events rather than
 * calling internals keeps these tests about behaviour.
 */
function editField(dom, address, value) {
  const { document, Event, FocusEvent } = dom.window;
  const element = document.querySelector(`[data-edit-field="${address}"]`);
  assert.ok(element, `expected an editable element for ${address}`);
  element.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
  element.textContent = value;
  element.dispatchEvent(new FocusEvent('blur', { bubbles: false }));
  return element;
}

const statusOf = (dom) => dom.window.document.querySelector('.edit-mode-status').textContent;
const reviewRows = (dom) =>
  [...dom.window.document.querySelectorAll('.edit-mode-review-row')].map((row) => ({
    where: row.querySelector('.edit-mode-review-where').textContent,
    before: row.querySelector('.edit-mode-review-before .edit-mode-review-value').textContent,
    after: row.querySelector('.edit-mode-review-after .edit-mode-review-value').textContent,
  }));

test('an editor changes gallery text and sees the change in place on the real page', async (t) => {
  const dom = await loadEditMode('gallery-painting.html');
  t.after(() => dom.window.close());

  assert.ok(dom.window.document.body.classList.contains('edit-mode-on'), 'edit mode should be on');
  const element = editField(dom, TITLE_ADDRESS, 'Lemons and a Lime');

  assert.equal(element.textContent, 'Lemons and a Lime', 'the change should show on the page itself');
  assert.ok(element.classList.contains('edit-mode-changed'), 'a changed element should be marked as changed');
  assert.equal(statusOf(dom), '', 'a valid edit should report no problem');
  assert.deepEqual(reviewRows(dom), [
    { where: `artworks / ${firstPainting.id} / titleEn`, before: firstPainting.titleEn, after: 'Lemons and a Lime' },
  ]);
});

test('a pending edit survives navigation to another gallery page', async (t) => {
  // One patch can legitimately span pages, so the review screen has to carry
  // an edit made on a page the editor has since left.
  const dom = await loadEditMode('gallery-artists.html', [
    {
      file: 'content/artworks.json',
      collection: 'artworks',
      key: firstPainting.id,
      field: 'titleEn',
      before: firstPainting.titleEn,
      after: 'Lemons and a Lime',
    },
  ]);
  t.after(() => dom.window.close());

  assert.deepEqual(reviewRows(dom), [
    { where: `artworks / ${firstPainting.id} / titleEn`, before: firstPainting.titleEn, after: 'Lemons and a Lime' },
  ]);
});

test('a restored edit that now matches what is on disk is dropped, not shown', async (t) => {
  // A patch may have been applied and the pages rebuilt since the edit was
  // made. Disk wins, because the gate drops a no-op edit from its summary and
  // the review screen has to agree with it.
  const dom = await loadEditMode('gallery-painting.html', [
    {
      file: 'content/artworks.json',
      collection: 'artworks',
      key: firstPainting.id,
      field: 'titleEn',
      before: 'Something Older',
      after: firstPainting.titleEn,
    },
  ]);
  t.after(() => dom.window.close());

  assert.deepEqual(reviewRows(dom), [], 'an edit equal to disk is not a change');
});

test('typing the original value back removes the pending change', async (t) => {
  const dom = await loadEditMode('gallery-painting.html');
  t.after(() => dom.window.close());

  editField(dom, TITLE_ADDRESS, 'Lemons and a Lime');
  assert.equal(reviewRows(dom).length, 1);

  const element = editField(dom, TITLE_ADDRESS, firstPainting.titleEn);
  assert.deepEqual(reviewRows(dom), [], 'the gate drops a no-op edit, so the review screen must too');
  assert.ok(!element.classList.contains('edit-mode-changed'));
});

test('surrounding whitespace is trimmed, so the review screen shows what the gate will store', async (t) => {
  const dom = await loadEditMode('gallery-painting.html');
  t.after(() => dom.window.close());

  const element = editField(dom, TITLE_ADDRESS, '   Lemons and a Lime   ');

  assert.equal(element.textContent, 'Lemons and a Lime');
  assert.deepEqual(reviewRows(dom).map((row) => row.after), ['Lemons and a Lime']);
});

test('a value the gate would refuse is refused here, with a message and no change to the page', async (t) => {
  for (const [label, typed] of [
    ['empty', '   '],
    ['angle brackets', 'Lemons <b>and</b> a Lime'],
    ['braces', 'Lemons {{TITLE}}'],
    ['two lines', 'Lemons\nand a Lime'],
    ['over the field limit', 'x'.repeat(201)],
    ['over the raw ceiling', 'y'.repeat(4097)],
  ]) {
    const dom = await loadEditMode('gallery-painting.html');
    try {
      const element = editField(dom, TITLE_ADDRESS, typed);

      assert.notEqual(statusOf(dom), '', `${label}: the editor should be told what is wrong`);
      assert.equal(element.textContent, firstPainting.titleEn, `${label}: the page should be put back`);
      assert.deepEqual(reviewRows(dom), [], `${label}: nothing should be pending`);
      assert.equal(
        dom.window.document.querySelector('.edit-mode-download').disabled,
        true,
        `${label}: there should be nothing to download`
      );
    } finally {
      dom.window.close();
    }
  }
});

test('a client message never disagrees with the gate about the length limit', async (t) => {
  // 200 is the titleEn cap in EDITABLE_CONTENT, reached here through the
  // generated rules file rather than typed into this test twice.
  const dom = await loadEditMode('gallery-painting.html');
  t.after(() => dom.window.close());
  const limit = dom.window.GALLERY_EDIT_RULES['content/artworks.json'].artworks.fields.titleEn.maxLength;

  const atLimit = 'z'.repeat(limit);
  assert.equal(editField(dom, TITLE_ADDRESS, atLimit).textContent, atLimit, 'exactly at the limit is allowed');

  editField(dom, TITLE_ADDRESS, 'z'.repeat(limit + 1));
  assert.match(statusOf(dom), new RegExp(String(limit)), 'the message should name the real limit');
});

test('Escape cancels an edit in progress and leaves the page alone', async (t) => {
  const dom = await loadEditMode('gallery-painting.html');
  t.after(() => dom.window.close());
  const { document, KeyboardEvent, Event, FocusEvent } = dom.window;
  const element = document.querySelector(`[data-edit-field="${TITLE_ADDRESS}"]`);

  element.dispatchEvent(new Event('click', { bubbles: true, cancelable: true }));
  element.textContent = 'Half-typed something';
  element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  element.dispatchEvent(new FocusEvent('blur', { bubbles: false }));

  assert.equal(element.textContent, firstPainting.titleEn);
  assert.deepEqual(reviewRows(dom), []);
});

test('clicking an editable element inside a link edits it instead of navigating', async (t) => {
  // Every medium card label on gallery.html sits inside an <a href>, so a
  // click that also followed the href would make those labels uneditable.
  const dom = await loadEditMode('gallery.html');
  t.after(() => dom.window.close());
  const { document, Event } = dom.window;
  const label = document.querySelector('[data-edit-field*="mediumPages"][data-edit-field$="titleEn"]');
  assert.ok(label.closest('a'), 'sanity check: the label should be inside a link');

  const click = new Event('click', { bubbles: true, cancelable: true });
  label.dispatchEvent(click);

  assert.equal(click.defaultPrevented, true, 'the click must not follow the link');
  assert.ok(label.classList.contains('edit-mode-editing'), 'the label should have become editable');
});

test('the review screen discards one change and puts that text back', async (t) => {
  const dom = await loadEditMode('gallery-painting.html');
  t.after(() => dom.window.close());
  const { document, Event } = dom.window;
  const second = artworkCatalog.artworks.filter((artwork) => artwork.medium === 'painting')[1];
  const secondAddress = `content/artworks.json|artworks|${second.id}|titleEn`;

  editField(dom, TITLE_ADDRESS, 'Lemons and a Lime');
  editField(dom, secondAddress, 'A Second New Title');
  assert.equal(reviewRows(dom).length, 2);

  document
    .querySelector(`[data-edit-discard="${TITLE_ADDRESS}"]`)
    .dispatchEvent(new Event('click', { bubbles: true }));

  assert.deepEqual(reviewRows(dom).map((row) => row.after), ['A Second New Title']);
  assert.equal(
    document.querySelector(`[data-edit-field="${TITLE_ADDRESS}"]`).textContent,
    firstPainting.titleEn,
    'discarding should put the real page text back'
  );
  assert.equal(
    document.querySelector(`[data-edit-field="${secondAddress}"]`).textContent,
    'A Second New Title',
    'the change that was kept should still show'
  );
});

test('Submit downloads a patch the gate accepts, and --dry-run reports exactly the review screen', async (t) => {
  const dom = await loadEditMode('gallery-painting.html');
  t.after(() => dom.window.close());
  const second = artworkCatalog.artworks.filter((artwork) => artwork.medium === 'painting')[1];
  const secondAddress = `content/artworks.json|artworks|${second.id}|titleEn`;

  editField(dom, TITLE_ADDRESS, 'Lemons and a Lime');
  editField(dom, secondAddress, 'A Second New Title');
  const shown = reviewRows(dom);

  const download = dom.window.document.querySelector('.edit-mode-download');
  assert.equal(download.disabled, false);
  download.dispatchEvent(new dom.window.Event('click', { bubbles: true }));

  assert.equal(dom.downloads.length, 1, 'Submit should download exactly one file');
  const patch = JSON.parse(await dom.downloads[0].text());
  assert.deepEqual(patch, {
    version: 1,
    edits: [
      {
        file: 'content/artworks.json',
        collection: 'artworks',
        key: firstPainting.id,
        field: 'titleEn',
        value: 'Lemons and a Lime',
      },
      {
        file: 'content/artworks.json',
        collection: 'artworks',
        key: second.id,
        field: 'titleEn',
        value: 'A Second New Title',
      },
    ],
  });

  // Hand the downloaded bytes to the real submit path, in its own copy of the
  // content files, and require the dry run to report the review screen's rows.
  const workspace = mkdtempSync(path.join(tmpdir(), 'edit-mode-submit-'));
  try {
    mkdirSync(path.join(workspace, 'content'), { recursive: true });
    mkdirSync(path.join(workspace, 'assets', 'js'), { recursive: true });
    copyFileSync(path.join(repoRoot, 'content', 'artworks.json'), path.join(workspace, 'content', 'artworks.json'));
    copyFileSync(path.join(repoRoot, 'content', 'gallery.json'), path.join(workspace, 'content', 'gallery.json'));
    const patchPath = path.join(workspace, 'edit-patch.json');
    writeFileSync(patchPath, await dom.downloads[0].text());

    const dry = applyPatchFile(patchPath, { contentRoot: workspace, dryRun: true });
    assert.equal(dry.ok, true, dry.errors.join('; '));
    assert.deepEqual(
      dry.summary.map((entry) => ({
        where: `${entry.collection} / ${entry.key} / ${entry.field}`,
        before: entry.before,
        after: entry.after,
      })),
      shown,
      'the dry run must report exactly what the editor reviewed'
    );

    const applied = applyPatchFile(patchPath, { contentRoot: workspace });
    assert.equal(applied.ok, true, applied.errors.join('; '));
    assert.equal(applied.changed, true);
    const written = JSON.parse(readFileSync(path.join(workspace, 'content', 'artworks.json'), 'utf8'));
    assert.equal(
      written.artworks.find((artwork) => artwork.id === firstPainting.id).titleEn,
      'Lemons and a Lime',
      'the downloaded patch should land in the content file'
    );
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test('the overlay carries no credential of any kind into the page', async (t) => {
  // Criterion read from the running page rather than from the source: no
  // password input exists, and nothing was written to localStorage, which is
  // where a credential would have to live to survive a session.
  const dom = await loadEditMode('gallery-painting.html');
  t.after(() => dom.window.close());

  assert.equal(dom.window.document.querySelector('input[type="password"]'), null);
  assert.equal(dom.window.localStorage.length, 0, 'edit mode should persist nothing durably');
  assert.deepEqual(Object.keys(dom.window.sessionStorage).sort(), ['galleryEditMode', 'galleryEditPending']);
});
