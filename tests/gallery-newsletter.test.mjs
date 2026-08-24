import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './helpers/loadPage.mjs';

function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fillAndSubmit(dom, { name, email, honeypot = '' } = {}) {
  const { document, Event } = dom.window;
  if (name !== undefined) document.getElementById('galleryNewsletterName').value = name;
  if (email !== undefined) document.getElementById('galleryNewsletterEmail').value = email;
  document.querySelector('.gallery-newsletter-honeypot').value = honeypot;
  const form = document.getElementById('galleryNewsletterForm');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

test('gallery newsletter form renders the expected fields, including a hidden gallery source', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  assert.ok(document.getElementById('galleryNewsletterName'));
  assert.ok(document.getElementById('galleryNewsletterEmail'));
  assert.ok(document.querySelector('.gallery-newsletter-honeypot'));
  assert.equal(document.querySelectorAll('.gallery-newsletter-submit').length, 2);

  const sourceField = document.querySelector('#galleryNewsletterForm input[name="source"]');
  assert.ok(sourceField, 'hidden source field exists');
  assert.equal(sourceField.value, 'gallery');
});

test('honeypot filled in: submission is dropped without calling fetch', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  let fetchCalled = false;
  dom.window.fetch = () => {
    fetchCalled = true;
    return Promise.resolve({});
  };

  fillAndSubmit(dom, { name: 'Bot', email: 'bot@example.com', honeypot: 'spam' });

  assert.equal(fetchCalled, false);
});

test('valid submission posts name, email, and source=gallery, then shows the English thank-you message', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  let capturedBody;
  dom.window.fetch = (url, opts) => {
    capturedBody = opts.body.toString();
    return Promise.resolve({});
  };

  fillAndSubmit(dom, { name: 'Jane', email: 'jane@example.com' });

  assert.match(capturedBody, /name=Jane/);
  assert.match(capturedBody, /email=jane%40example\.com/);
  assert.match(capturedBody, /source=gallery/);

  await flushPromises();

  assert.ok(document.getElementById('galleryNewsletterStatusEn').classList.contains('visible'));
  assert.ok(!document.getElementById('galleryNewsletterStatusZh').classList.contains('visible'));
});

test('valid submission in Chinese mode shows the Chinese thank-you message', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document, Event } = dom.window;
  dom.window.fetch = () => Promise.resolve({});

  document
    .querySelector('.lang-btn[data-lang="zh"]')
    .dispatchEvent(new Event('click', { bubbles: true }));

  fillAndSubmit(dom, { name: 'Jian', email: 'jian@example.com' });
  await flushPromises();

  assert.ok(document.getElementById('galleryNewsletterStatusZh').classList.contains('visible'));
  assert.ok(!document.getElementById('galleryNewsletterStatusEn').classList.contains('visible'));
});

test('submit buttons are disabled while the request is in flight, then re-enabled', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  let resolveFetch;
  dom.window.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });

  fillAndSubmit(dom, { name: 'Slow', email: 'slow@example.com' });

  const buttons = [...document.querySelectorAll('.gallery-newsletter-submit')];
  assert.ok(buttons.every((btn) => btn.disabled));

  resolveFetch({});
  await flushPromises();

  assert.ok(buttons.every((btn) => !btn.disabled));
});

test('fetch rejection shows the error message and re-enables the buttons', async (t) => {
  const dom = await loadPage('gallery.html');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  dom.window.fetch = () => Promise.reject(new Error('network down'));

  fillAndSubmit(dom, { name: 'Offline', email: 'offline@example.com' });
  await flushPromises();

  assert.ok(document.getElementById('galleryNewsletterErrorEn').classList.contains('visible'));
  const buttons = [...document.querySelectorAll('.gallery-newsletter-submit')];
  assert.ok(buttons.every((btn) => !btn.disabled));
});
