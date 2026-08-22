import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './helpers/loadPage.mjs';

// These checks only need the parsed DOM tree, not script execution, but
// reuse loadPage() (which does run the page's <script>) rather than a
// separate parse-only helper — one loading path is simpler to maintain
// than two, and running the script here is harmless (no network calls
// happen at load time; fetch only fires from the newsletter submit
// handler, which nothing in this file triggers).

function findDuplicates(items) {
  const seen = new Set();
  return items.filter((item) => (seen.has(item) ? true : (seen.add(item), false)));
}

test('no duplicate element IDs across the page', async (t) => {
  const dom = await loadPage();
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
  assert.deepEqual(findDuplicates(ids), []);
});

test('form fields have unique name attributes (no hidden duplicate submitted alongside a visible one)', async (t) => {
  const dom = await loadPage();
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const names = [...document.querySelectorAll('input[name], select[name], textarea[name]')]
    .map((el) => el.name);
  assert.deepEqual(findDuplicates(names), []);
});

test('every target="_blank" link has rel="noopener noreferrer"', async (t) => {
  const dom = await loadPage();
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const blankLinks = [...document.querySelectorAll('a[target="_blank"]')];
  assert.ok(blankLinks.length > 0, 'sanity check: expected at least one target=_blank link');
  for (const link of blankLinks) {
    const rel = link.getAttribute('rel') || '';
    assert.ok(
      rel.includes('noopener') && rel.includes('noreferrer'),
      `link to ${link.href} is missing rel="noopener noreferrer"`
    );
  }
});
