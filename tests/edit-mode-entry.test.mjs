// Behavioural tests for the edit-mode front door (edit.html).
//
// ARQ-10 shipped edit mode behind a URL switch: the editor had to type
// ?edit=1 onto a gallery address. edit.html replaces that with a page she can
// bookmark. The properties worth pinning are the ones she cannot check for
// herself.
//
// First, one click has to actually reach edit mode, and it has to reach it
// through the switch the gallery really reads -- so the second test drives the
// generated page's own bootstrap rather than asserting on a key name.
//
// Second, the page has to keep working when the browser does not cooperate: no
// JavaScript at all, and site storage refused. A front door that silently does
// nothing on a phone is the failure this whole feature is trying to avoid.
//
// Third, turning the mode off here must not throw away unsubmitted edits, the
// same promise the overlay's own Exit edit mode button makes.
//
// Fourth, the page has no sign-in field. That is deliberate and is covered by
// a test, because the reason is not visible in the markup: the site is static,
// so a check in browser JavaScript would be readable by anyone viewing source
// and would protect nothing. See tests/edit-mode-build.test.mjs for the same
// invariant on the overlay's own files.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM, VirtualConsole } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');
const siteOrigin = 'https://qidumplingsinc.github.io/SpecialChiliSauce/';
const entrySource = readFileSync(path.join(repoRoot, 'edit.html'), 'utf-8');

/**
 * Load edit.html into jsdom the way a browser would, and run its script.
 *
 * Input: `seed` is an optional object of sessionStorage key/value pairs to put
 * in place before the page runs, which is how a test reproduces an editor who
 * already has edit mode on or has unsubmitted edits. `blockStorage` makes
 * window.sessionStorage throw on access, which is what a browser with site
 * storage refused actually does.
 *
 * Output: the JSDOM instance, loaded, with the page's own script already run.
 *
 * Process: parses the committed file at the real site URL with no query
 * string, because reaching edit mode without typing one is the whole point,
 * then waits for load so the script has settled.
 */
async function loadEntry({ seed, blockStorage } = {}) {
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', () => {});
  const dom = new JSDOM(entrySource, {
    url: `${siteOrigin}edit.html`,
    runScripts: 'dangerously',
    virtualConsole,
    beforeParse(window) {
      for (const [key, value] of Object.entries(seed ?? {})) {
        window.sessionStorage.setItem(key, value);
      }
      if (blockStorage) {
        Object.defineProperty(window, 'sessionStorage', {
          configurable: true,
          get() {
            throw new Error('storage is blocked in this browser');
          },
        });
      }
    },
  });
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') resolve();
    else dom.window.addEventListener('load', resolve);
  });
  return dom;
}

test('one click on the entry page turns edit mode on, with no query string to type', async (t) => {
  const dom = await loadEntry();
  t.after(() => dom.window.close());
  const { document, sessionStorage } = dom.window;

  const enter = document.getElementById('edit-mode-enter');
  assert.equal(enter.hidden, false, 'the way in should be the visible control when the mode is off');
  assert.equal(sessionStorage.getItem('galleryEditMode'), null, 'sanity check: the mode starts off');

  enter.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

  assert.equal(sessionStorage.getItem('galleryEditMode'), 'on', 'the click should turn the mode on');
  assert.equal(
    enter.getAttribute('href'),
    'gallery.html',
    'with storage available the mode carries itself, so the gallery URL should stay clean'
  );
});

test('the switch the entry page flips is the one a generated gallery page acts on', async (t) => {
  // The end-to-end property, driven through the real page rather than through
  // a shared key name: load gallery.html at an address with no query string,
  // with only what the entry page leaves behind, and the page's own bootstrap
  // should decide to pull in edit mode. Without that flag it must pull in
  // nothing, which is the cost an ordinary visitor pays.
  const galleryHtml = readFileSync(path.join(repoRoot, 'gallery.html'), 'utf-8');

  const loadGallery = async (seeded) => {
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', () => {});
    const dom = new JSDOM(galleryHtml, {
      url: `${siteOrigin}gallery.html`,
      runScripts: 'dangerously',
      virtualConsole,
      beforeParse(window) {
        if (seeded) window.sessionStorage.setItem('galleryEditMode', 'on');
        window.IntersectionObserver = class {
          observe() {}
          unobserve() {}
          disconnect() {}
        };
        window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
      },
    });
    await new Promise((resolve) => {
      if (dom.window.document.readyState === 'complete') resolve();
      else dom.window.addEventListener('load', resolve);
    });
    return dom;
  };

  const editing = await loadGallery(true);
  t.after(() => editing.window.close());
  assert.ok(
    editing.window.document.querySelector('link[href="assets/css/edit-mode.css"]'),
    'the gallery should pull in the edit-mode stylesheet from the flag alone'
  );
  assert.ok(
    editing.window.document.querySelector('script[src="assets/js/edit-mode-rules.js"]'),
    'the gallery should start loading edit mode from the flag alone'
  );

  const visiting = await loadGallery(false);
  t.after(() => visiting.window.close());
  assert.equal(
    visiting.window.document.querySelector('link[href="assets/css/edit-mode.css"]'),
    null,
    'a visitor who never asked for edit mode should load no extra stylesheet'
  );
  assert.equal(
    visiting.window.document.querySelector('script[src^="assets/js/edit-mode"]'),
    null,
    'a visitor who never asked for edit mode should load no extra script'
  );
});

test('the entry page reports the mode it found instead of always offering to turn it on', async (t) => {
  const dom = await loadEntry({ seed: { galleryEditMode: 'on' } });
  t.after(() => dom.window.close());
  const { document } = dom.window;

  assert.equal(document.getElementById('edit-mode-enter').hidden, true, 'no point offering a mode already on');
  assert.equal(document.getElementById('edit-mode-leave').hidden, false, 'the way out should be offered instead');
  assert.equal(document.getElementById('edit-mode-state-on').hidden, false, 'the page should say the mode is on');
  assert.equal(document.getElementById('edit-mode-state-off').hidden, true);

  document
    .getElementById('edit-mode-leave')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

  assert.equal(dom.window.sessionStorage.getItem('galleryEditMode'), null, 'the click should turn the mode off');
  assert.equal(document.getElementById('edit-mode-enter').hidden, false, 'and offer the way back in');
  assert.equal(document.getElementById('edit-mode-leave').hidden, true);
  assert.equal(document.getElementById('edit-mode-state-off').hidden, false);
});

test('turning edit mode off from the entry page keeps edits that were never submitted', async (t) => {
  // The overlay's Exit edit mode button leaves pending edits in storage on
  // purpose, so that leaving the mode by accident costs nothing. A second way
  // out that quietly dropped them would make that promise untrue.
  const pending = JSON.stringify([
    {
      file: 'content/gallery.json',
      collection: 'mediumPages',
      key: 'painting',
      field: 'titleEn',
      before: 'Painting',
      after: 'Paintings',
    },
  ]);
  const dom = await loadEntry({ seed: { galleryEditMode: 'on', galleryEditPending: pending } });
  t.after(() => dom.window.close());

  dom.window.document
    .getElementById('edit-mode-leave')
    .dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true, cancelable: true }));

  assert.equal(dom.window.sessionStorage.getItem('galleryEditMode'), null);
  assert.equal(
    dom.window.sessionStorage.getItem('galleryEditPending'),
    pending,
    'unsubmitted edits must survive leaving the mode'
  );
});

test('a browser that refuses site storage still gets a link that reaches edit mode', async (t) => {
  // Kay opens this on a phone, possibly in a private window, where reading
  // window.sessionStorage throws. The mode cannot follow her between pages
  // there, so the link falls back to the query string and the page says what
  // it can and cannot do rather than failing silently.
  const dom = await loadEntry({ blockStorage: true });
  t.after(() => dom.window.close());
  const { document } = dom.window;

  assert.equal(
    document.getElementById('edit-mode-enter').getAttribute('href'),
    'gallery.html?edit=1',
    'the link must still reach edit mode when storage cannot hold the flag'
  );
  assert.equal(document.getElementById('edit-mode-state-blocked').hidden, false, 'and the page should say so');
  assert.equal(document.getElementById('edit-mode-enter').hidden, false, 'the way in should still be offered');
});

test('the front door works with no JavaScript at all', () => {
  // The committed href carries ?edit=1, so a browser that runs none of the
  // page's script still reaches edit mode on the page the link opens. The
  // script is what upgrades that to a clean URL and a mode that persists.
  const dom = new JSDOM(entrySource, { url: `${siteOrigin}edit.html` });
  assert.equal(
    dom.window.document.getElementById('edit-mode-enter').getAttribute('href'),
    'gallery.html?edit=1',
    'the markup alone must reach edit mode'
  );
  dom.window.close();
});

test('the entry page says what edit mode does and does not do, in both languages at once', async (t) => {
  // This page is reached cold from a bookmark, with no language switcher on
  // it, so the site's lang-en/lang-zh classes would hide one language with no
  // way to get it back. Both languages are therefore shown together.
  const dom = await loadEntry();
  t.after(() => dom.window.close());
  const { document } = dom.window;

  const explanation = document.querySelector('.edit-entry-what');
  assert.ok(explanation, 'the page should carry a one-line explanation');
  assert.equal(explanation.hidden, false, 'and it should be visible on arrival');

  const chinese = explanation.querySelector('[lang="zh"]');
  assert.ok(chinese, 'the explanation should have a Chinese counterpart');
  assert.match(chinese.textContent, /[\u4e00-\u9fff]/, 'the Chinese counterpart should be in Chinese');

  const english = explanation.textContent.replace(chinese.textContent, '').trim();
  assert.ok(english.length > 40, 'the English explanation should be a sentence, not a label');
  assert.ok(!/[\u4e00-\u9fff]/.test(english), 'the two languages should be separate elements, not one mixed string');

  assert.ok(
    !/class="[^"]*\blang-(en|zh)\b/.test(entrySource),
    'the toggle classes would hide one language on a page with nothing to toggle them'
  );
});

test('hiding a control on the entry page actually hides it in a real browser', () => {
  // Both controls carry .cta-button, which sets its own display, and a class
  // beats the browser's own [hidden] rule on specificity -- so the hidden
  // attribute alone would leave the control on screen. site.css calls this
  // exact trap out as having broken the language classes three times.
  //
  // This is a source check, not a computed-style check, on purpose: jsdom
  // reports display:none for [hidden] regardless of a competing class rule, so
  // a getComputedStyle assertion here would pass whether the override exists
  // or not. A test that cannot fail is worse than none, so what gets pinned is
  // the override itself.
  assert.match(
    entrySource,
    /\[hidden\]\s*\{\s*display:\s*none\s*!important;/,
    'the page needs an explicit [hidden] override to outrank .cta-button'
  );
  const { document } = new JSDOM(entrySource, { url: `${siteOrigin}edit.html` }).window;
  for (const id of ['edit-mode-enter', 'edit-mode-leave']) {
    assert.ok(
      document.getElementById(id).classList.contains('cta-button'),
      `sanity check: ${id} is expected to carry the class that makes the override necessary`
    );
  }
});

test('the entry page has no sign-in field, and no admin asset for it to load', async (t) => {
  // A field here would be the one thing on this page that lies. The site is
  // static with no server, so anything typed into it would be checked by code
  // the visitor can read, and the real control is the reviewer who reads the
  // downloaded patch before it reaches the live site.
  const dom = await loadEntry();
  t.after(() => dom.window.close());
  const { document } = dom.window;

  assert.deepEqual(
    [...document.querySelectorAll('input, form, textarea, select')].map((element) => element.tagName),
    [],
    'the front door takes no typed input of any kind'
  );
  assert.ok(!/type="password"/.test(entrySource), 'and there is no password field to find');

  // The overlay loads on the gallery page, on demand. Pulling it in here
  // would make the front door pay for a feature it only switches on.
  assert.equal(document.querySelector('link[href*="edit-mode.css"]'), null);
  assert.equal(document.querySelector('script[src*="edit-mode"]'), null);
});
