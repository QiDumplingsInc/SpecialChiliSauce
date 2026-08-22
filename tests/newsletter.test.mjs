import test from 'node:test';
import assert from 'node:assert/strict';
import { loadPage } from './helpers/loadPage.mjs';

// Waits for the macrotask queue, which only runs after every pending
// microtask (including a chained .then().catch().finally()) has settled —
// more reliable than guessing how many `await Promise.resolve()` hops
// a given promise chain needs.
function flushPromises() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function fillAndSubmit(dom, { name, email, honeypot = '' } = {}) {
  const { document, Event } = dom.window;
  if (name !== undefined) document.getElementById('newsletterName').value = name;
  if (email !== undefined) document.getElementById('newsletterEmail').value = email;
  document.querySelector('.newsletter-honeypot').value = honeypot;
  const form = document.getElementById('newsletterForm');
  form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
}

test('newsletter form renders the expected fields', async () => {
  const dom = await loadPage();
  const { document } = dom.window;
  assert.ok(document.getElementById('newsletterName'));
  assert.ok(document.getElementById('newsletterEmail'));
  assert.ok(document.querySelector('.newsletter-honeypot'));
  assert.equal(document.querySelectorAll('.newsletter-submit').length, 2);
});

test('honeypot filled in: submission is dropped without calling fetch', async () => {
  const dom = await loadPage();
  let fetchCalled = false;
  dom.window.fetch = () => {
    fetchCalled = true;
    return Promise.resolve({});
  };

  fillAndSubmit(dom, { name: 'Bot', email: 'bot@example.com', honeypot: 'spam' });

  assert.equal(fetchCalled, false);
});

test('valid submission posts name and email, then shows the English thank-you message', async () => {
  const dom = await loadPage();
  const { document } = dom.window;
  let capturedBody;
  dom.window.fetch = (url, opts) => {
    capturedBody = opts.body.toString();
    return Promise.resolve({});
  };

  fillAndSubmit(dom, { name: 'Jane', email: 'jane@example.com' });

  assert.match(capturedBody, /name=Jane/);
  assert.match(capturedBody, /email=jane%40example\.com/);

  // Flush the mocked promise chain's .then()/.finally().
  await flushPromises();

  assert.ok(document.getElementById('newsletterStatusEn').classList.contains('visible'));
  assert.ok(!document.getElementById('newsletterStatusZh').classList.contains('visible'));
});

test('valid submission in Chinese mode shows the Chinese thank-you message', async () => {
  const dom = await loadPage();
  const { document, Event } = dom.window;
  dom.window.fetch = () => Promise.resolve({});

  document
    .querySelector('.lang-btn[data-lang="zh"]')
    .dispatchEvent(new Event('click', { bubbles: true }));

  fillAndSubmit(dom, { name: 'Jian', email: 'jian@example.com' });
  await flushPromises();

  assert.ok(document.getElementById('newsletterStatusZh').classList.contains('visible'));
  assert.ok(!document.getElementById('newsletterStatusEn').classList.contains('visible'));
});

test('submit buttons are disabled while the request is in flight, then re-enabled', async () => {
  const dom = await loadPage();
  const { document } = dom.window;
  let resolveFetch;
  dom.window.fetch = () => new Promise((resolve) => { resolveFetch = resolve; });

  fillAndSubmit(dom, { name: 'Slow', email: 'slow@example.com' });

  const buttons = [...document.querySelectorAll('.newsletter-submit')];
  assert.ok(buttons.every((btn) => btn.disabled));

  resolveFetch({});
  await flushPromises();

  assert.ok(buttons.every((btn) => !btn.disabled));
});

test('fetch rejection shows the error message and re-enables the buttons', async () => {
  const dom = await loadPage();
  const { document } = dom.window;
  dom.window.fetch = () => Promise.reject(new Error('network down'));

  fillAndSubmit(dom, { name: 'Offline', email: 'offline@example.com' });
  await flushPromises();

  assert.ok(document.getElementById('newsletterErrorEn').classList.contains('visible'));
  const buttons = [...document.querySelectorAll('.newsletter-submit')];
  assert.ok(buttons.every((btn) => !btn.disabled));
});
