// Tests for the attribute contract admin edit mode is built on.
//
// The browser overlay turns a data-edit-field attribute straight into a patch
// edit, so two properties have to hold or the editor gets a pencil that can
// only ever produce a rejected submission. First, every address the build
// emits must name a whitelisted field on a record that exists. Second, the
// element carrying the address must have a textContent exactly equal to the
// raw value on disk, because that is the value the overlay reports as "before"
// and the value the gate compares against. These tests pin both, plus the
// generated rules file the client validation mirrors its limits from.

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EDITABLE_CONTENT } from '../scripts/content-patch.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const galleryConfig = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'gallery.json'), 'utf8'));
const artworkCatalog = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'artworks.json'), 'utf8'));
const generatedPages = readdirSync(repoRoot).filter((name) => /^gallery(-[a-z-]+)?\.html$/.test(name));

const addressesIn = (html) => [...html.matchAll(/data-edit-field="([^"]*)"/g)].map((match) => match[1]);

test('every emitted address names a whitelisted field on a record that exists', () => {
  const allowed = new Set();
  for (const [file, collections] of Object.entries(EDITABLE_CONTENT)) {
    const data = file === 'content/gallery.json' ? galleryConfig : artworkCatalog;
    for (const [collection, spec] of Object.entries(collections)) {
      for (const record of data[collection]) {
        for (const field of Object.keys(spec.fields)) {
          allowed.add(`${file}|${collection}|${record[spec.keyField]}|${field}`);
        }
      }
    }
  }

  let seen = 0;
  for (const name of generatedPages) {
    for (const address of addressesIn(readFileSync(path.join(repoRoot, name), 'utf8'))) {
      seen += 1;
      assert.equal(address.split('|').length, 4, `${name}: "${address}" is not a four-part address`);
      assert.ok(allowed.has(address), `${name}: "${address}" is not an editable address`);
    }
  }
  assert.ok(seen > 0, 'sanity check: the generated pages should carry edit addresses at all');
});

test('an element carrying an address has a textContent equal to the raw value on disk', () => {
  // This is the contract the overlay reads, so it is checked against the
  // content files rather than against the rendered text of another element.
  const valueOf = (address) => {
    const [file, collection, key, field] = address.split('|');
    const data = file === 'content/gallery.json' ? galleryConfig : artworkCatalog;
    const spec = EDITABLE_CONTENT[file][collection];
    return data[collection].find((record) => record[spec.keyField] === key)[field];
  };
  const unescape = (text) =>
    text
      .replaceAll('&lt;', '<')
      .replaceAll('&gt;', '>')
      .replaceAll('&quot;', '"')
      .replaceAll('&amp;', '&');

  let checked = 0;
  for (const name of generatedPages) {
    const html = readFileSync(path.join(repoRoot, name), 'utf8');
    for (const match of html.matchAll(/data-edit-field="([^"]*)"[^>]*>([^<]*)</g)) {
      assert.equal(
        unescape(match[2]),
        valueOf(match[1]),
        `${name}: the element for ${match[1]} does not render exactly that value`
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'sanity check: expected addressed elements to check');
});

test('an artwork title is addressable on its own, not fused to the year', () => {
  // The title used to render as "Lemons, 2024" in one element. Edit mode
  // cannot address that, because there is no way to recover the title from
  // the composed string, so the title now owns its own span.
  const html = readFileSync(path.join(repoRoot, 'gallery-painting.html'), 'utf8');
  const first = artworkCatalog.artworks.find((artwork) => artwork.medium === 'painting');
  assert.ok(
    html.includes(
      `<span data-edit-field="content/artworks.json|artworks|${first.id}|titleEn">${first.titleEn}</span>, `
    ),
    'the English artwork title should sit in its own addressed span, followed by the year'
  );
});

test('the visible text fields are all reachable, and the unexposed ones are not', () => {
  const emitted = new Set();
  for (const name of generatedPages) {
    for (const address of addressesIn(readFileSync(path.join(repoRoot, name), 'utf8'))) {
      const parts = address.split('|');
      emitted.add(`${parts[1]}.${parts[3]}`);
    }
  }
  assert.deepEqual(
    [...emitted].sort(),
    [
      'artworks.titleEn',
      'artworks.titleZh',
      'mediumPages.titleEn',
      'mediumPages.titleZh',
      'sectionPages.bodyEn',
      'sectionPages.bodyZh',
      'sectionPages.titleEn',
      'sectionPages.titleZh',
    ],
    'altEn, altZh, metaDescription and year are deliberately not inline-editable yet; see the ARQ-10 plan'
  );
});

test('dimensions become editable as soon as an artwork has them', () => {
  // No work in the catalogue carries dimensions yet, so no dimensions element
  // is rendered and the field is unreachable today. That is the right
  // behaviour -- edit mode can rewrite wording but never invent a field -- but
  // it means the dimensions path is only covered if a fixture supplies one.
  assert.ok(
    artworkCatalog.artworks.every((artwork) => !artwork.dimensionsEn),
    'catalogue gained dimensions: drop this fixture and assert on the real pages instead'
  );

  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'edit-mode-dimensions-'));
  try {
    mkdirSync(path.join(fixtureRoot, 'content'), { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'assets', 'js'), { recursive: true });
    cpSync(path.join(repoRoot, 'content', 'gallery.json'), path.join(fixtureRoot, 'content', 'gallery.json'));
    const catalog = JSON.parse(JSON.stringify(artworkCatalog));
    catalog.artworks[0].dimensionsEn = '30 x 40 cm';
    catalog.artworks[0].dimensionsZh = '30 x 40 厘米';
    writeFileSync(path.join(fixtureRoot, 'content', 'artworks.json'), `${JSON.stringify(catalog, null, 4)}\n`);

    execFileSync('node', ['build.mjs', '--fixture', fixtureRoot], { cwd: repoRoot, stdio: 'pipe' });

    const page = readFileSync(path.join(fixtureRoot, `gallery-${catalog.artworks[0].medium}.html`), 'utf8');
    assert.ok(
      page.includes(
        `data-edit-field="content/artworks.json|artworks|${catalog.artworks[0].id}|dimensionsEn">30 x 40 cm<`
      ),
      'a work with dimensions should render them as an addressed, editable element'
    );
    assert.ok(
      page.includes(
        `data-edit-field="content/artworks.json|artworks|${catalog.artworks[0].id}|dimensionsZh">30 x 40 厘米<`
      ),
      'the Chinese dimensions should be addressable too'
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('the generated client rules are the gate whitelist, not a retyped copy of it', () => {
  // The browser tells the editor "at most 200 characters" from this file. If
  // it could drift from EDITABLE_CONTENT, the friendly message would start
  // disagreeing with the rule that actually decides.
  const source = readFileSync(path.join(repoRoot, 'assets', 'js', 'edit-mode-rules.js'), 'utf8');
  const start = source.indexOf('{');
  assert.ok(start > 0, 'expected the rules file to assign an object literal');
  assert.deepEqual(JSON.parse(source.slice(start, source.lastIndexOf('}') + 1)), EDITABLE_CONTENT);
  assert.match(source, /Do not edit by hand/, 'the generated file should say it is generated');
});

test('build --check fails when the generated rules file has drifted', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'edit-mode-rules-'));
  try {
    mkdirSync(path.join(fixtureRoot, 'content'), { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'assets', 'js'), { recursive: true });
    cpSync(path.join(repoRoot, 'content'), path.join(fixtureRoot, 'content'), { recursive: true });
    for (const name of generatedPages) {
      cpSync(path.join(repoRoot, name), path.join(fixtureRoot, name));
    }
    cpSync(
      path.join(repoRoot, 'assets', 'js', 'gallery-search-index.js'),
      path.join(fixtureRoot, 'assets', 'js', 'gallery-search-index.js')
    );
    writeFileSync(path.join(fixtureRoot, 'assets', 'js', 'edit-mode-rules.js'), 'window.GALLERY_EDIT_RULES = {};\n');

    assert.throws(
      () => execFileSync('node', ['build.mjs', '--check', '--fixture', fixtureRoot], { cwd: repoRoot, stdio: 'pipe' }),
      /edit-mode-rules\.js/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('a hand-written address the gate would refuse fails the build', () => {
  // The guard that makes the whitelist enforcement rather than documentation.
  // The addresses the build generates always agree with the data it renders
  // from, so the case worth pinning is the other one: somebody types an
  // address into a template by hand. That needs a whole temporary repo,
  // because build.mjs always reads templates/ next to itself.
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'edit-mode-guard-'));
  try {
    for (const name of ['build.mjs', 'content', 'templates', 'scripts']) {
      cpSync(path.join(repoRoot, name), path.join(fixtureRoot, name), { recursive: true });
    }
    mkdirSync(path.join(fixtureRoot, 'assets', 'js'), { recursive: true });
    cpSync(
      path.join(repoRoot, 'assets', 'js', 'gallery-search-index.js'),
      path.join(fixtureRoot, 'assets', 'js', 'gallery-search-index.js')
    );

    const templatePath = path.join(fixtureRoot, 'templates', 'page-section.html');
    const template = readFileSync(templatePath, 'utf8');
    writeFileSync(
      templatePath,
      template.replace(
        '<div class="painting-grid">',
        '<div class="painting-grid" data-edit-field="content/artworks.json|artworks|painting-001|image">'
      )
    );

    assert.throws(
      () => execFileSync('node', ['build.mjs'], { cwd: fixtureRoot, stdio: 'pipe' }),
      /not an editable address/,
      'an address naming a non-whitelisted field must fail the build'
    );

    // And the same for a malformed address, which would otherwise reach the
    // browser as an edit whose patch has empty parts.
    writeFileSync(
      templatePath,
      template.replace('<div class="painting-grid">', '<div class="painting-grid" data-edit-field="titleEn">')
    );
    assert.throws(
      () => execFileSync('node', ['build.mjs'], { cwd: fixtureRoot, stdio: 'pipe' }),
      /four-part file\|collection\|key\|field address/
    );
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('the bootstrap loads nothing for a visitor who did not ask for edit mode', () => {
  // Edit mode costs an ordinary page view one conditional and no requests.
  // If the bootstrap ever loaded its stylesheet unconditionally, the public
  // gallery would start paying for an admin feature.
  const bootstrap = readFileSync(path.join(repoRoot, 'templates', 'partials', 'edit-mode-bootstrap.html'), 'utf8');
  assert.match(bootstrap, /if \(!wanted\) return;/, 'the bootstrap should return before loading anything');
  const beforeGuard = bootstrap.slice(0, bootstrap.indexOf('if (!wanted) return;'));
  assert.ok(!beforeGuard.includes('edit-mode.css'), 'the stylesheet must not be requested before the guard');
  assert.ok(!beforeGuard.includes('edit-mode.js'), 'the overlay must not be requested before the guard');

  for (const name of generatedPages) {
    const html = readFileSync(path.join(repoRoot, name), 'utf8');
    assert.ok(
      !/<script src="assets\/js\/edit-mode/.test(html),
      `${name} should not load the overlay with a static script tag`
    );
    assert.ok(
      !/<link[^>]+edit-mode\.css/.test(html),
      `${name} should not load the edit-mode stylesheet with a static link tag`
    );
  }
});

test('no password, secret or credential appears in the browser edit-mode code', () => {
  // Edit mode is a mode toggle. A browser-side credential on a static site
  // protects nothing and would only imply a boundary that is not there. The
  // words appear in the prose explaining why there is none, so comments are
  // stripped before scanning and only real code is checked.
  const browserSources = [
    'assets/js/edit-mode.js',
    'assets/js/edit-mode-rules.js',
    'assets/css/edit-mode.css',
    'templates/partials/edit-mode-bootstrap.html',
  ];
  for (const name of browserSources) {
    const code = readFileSync(path.join(repoRoot, name), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/^\s*\/\/.*$/gm, ' ')
      .replace(/\s\/\/.*$/gm, ' ');
    for (const forbidden of [
      'password',
      'passcode',
      'secret',
      'credential',
      'username',
      'apiKey',
      'api_key',
      'bcrypt',
      'sha256',
      'crypto',
      'atob',
      'btoa',
    ]) {
      assert.ok(!code.toLowerCase().includes(forbidden.toLowerCase()), `${name} should contain no ${forbidden}`);
    }
    assert.ok(!/type="password"/.test(code), `${name} should have no password input`);
  }
});

test('edit mode makes no network call and touches nothing outside the browser', () => {
  // The only output is a downloaded file. A fetch here would mean edit mode
  // had grown a backend, which is the thing the design deliberately does not
  // have, and would need a security review this feature is built to avoid.
  const overlay = readFileSync(path.join(repoRoot, 'assets', 'js', 'edit-mode.js'), 'utf8');
  for (const forbidden of ['fetch(', 'XMLHttpRequest', 'navigator.sendBeacon', 'WebSocket', 'EventSource']) {
    assert.ok(!overlay.includes(forbidden), `the overlay should not use ${forbidden}`);
  }
  assert.match(overlay, /link\.download = 'edit-patch\.json'/, 'the only output should be the patch download');
});
