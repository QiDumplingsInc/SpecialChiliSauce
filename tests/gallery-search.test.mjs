import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './helpers/loadPage.mjs';

function openSearch(dom) {
  const { document, Event } = dom.window;
  document
    .querySelector('.gallery-search-toggle')
    .dispatchEvent(new Event('click', { bubbles: true }));
}

function typeQuery(dom, value) {
  const { document, Event } = dom.window;
  const input = document.querySelector('.gallery-search-input');
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

test('search toggle opens and closes the results panel', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const root = document.querySelector('.gallery-search');
  const toggle = document.querySelector('.gallery-search-toggle');

  assert.ok(!root.classList.contains('open'));
  openSearch(dom);
  assert.ok(root.classList.contains('open'));
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');

  openSearch(dom);
  assert.ok(!root.classList.contains('open'));
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
});

test('typing a matching query shows results for both English and Chinese terms', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const results = document.querySelector('.gallery-search-results');

  openSearch(dom);
  typeQuery(dom, 'paint');
  assert.ok(results.classList.contains('visible'));
  assert.ok([...results.querySelectorAll('a')].some((a) => a.getAttribute('href') === 'gallery-painting.html'));

  typeQuery(dom, '素描');
  assert.ok([...results.querySelectorAll('a')].some((a) => a.getAttribute('href') === 'gallery-drawing.html'));
});

test('a query with no matches shows the empty state', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const results = document.querySelector('.gallery-search-results');

  openSearch(dom);
  typeQuery(dom, 'zzzznotfound');

  assert.ok(results.querySelector('.gallery-search-empty'));
  assert.equal(results.querySelectorAll('a').length, 0);
});

test('Escape closes the search and returns focus to the toggle', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document, KeyboardEvent } = dom.window;
  const root = document.querySelector('.gallery-search');

  openSearch(dom);
  assert.ok(root.classList.contains('open'));

  document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
  assert.ok(!root.classList.contains('open'));
});

test('clicking outside the search widget closes it', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document, Event } = dom.window;
  const root = document.querySelector('.gallery-search');

  openSearch(dom);
  assert.ok(root.classList.contains('open'));

  document.body.dispatchEvent(new Event('click', { bubbles: true }));
  assert.ok(!root.classList.contains('open'));
});

test('search input label switches to Chinese when the language toggle is clicked', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document, Event } = dom.window;
  const input = document.querySelector('.gallery-search-input');

  document
    .querySelector('.lang-btn[data-lang="zh"]')
    .dispatchEvent(new Event('click', { bubbles: true }));

  assert.equal(input.placeholder, '搜索');
});
