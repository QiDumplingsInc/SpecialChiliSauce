import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './helpers/loadPage.mjs';

test('no duplicate element IDs across the page', async () => {
  const dom = await loadPage();
  const { document } = dom.window;
  const ids = [...document.querySelectorAll('[id]')].map((el) => el.id);
  const seen = new Set();
  const duplicates = ids.filter((id) => {
    if (seen.has(id)) return true;
    seen.add(id);
    return false;
  });
  assert.deepEqual(duplicates, []);
});

test('form fields have unique name attributes (no hidden duplicate submitted alongside a visible one)', async () => {
  const dom = await loadPage();
  const { document } = dom.window;
  const names = [...document.querySelectorAll('input[name], select[name], textarea[name]')]
    .map((el) => el.name);
  const seen = new Set();
  const duplicates = names.filter((name) => {
    if (seen.has(name)) return true;
    seen.add(name);
    return false;
  });
  assert.deepEqual(duplicates, []);
});

test('every target="_blank" link has rel="noopener noreferrer"', async () => {
  const dom = await loadPage();
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
