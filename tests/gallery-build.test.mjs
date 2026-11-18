import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Guards the generated-HTML-is-committed tradeoff. gallery*.html is rendered by
// build.mjs but committed at the repo root so GitHub Pages serves it with no
// build step. That only stays safe while the committed bytes match what the
// templates and content would produce, so the first test here is the one that
// matters: it fails the moment somebody hand-edits a generated page or forgets
// to rerun the build after editing content/ or templates/.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const galleryConfig = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'gallery.json'), 'utf8'));
const generatedPages = readdirSync(repoRoot).filter((name) => /^gallery(-[a-z-]+)?\.html$/.test(name));

test('committed gallery HTML matches what build.mjs renders from templates and content', () => {
  // Throws with the drifted filenames in stderr if any page is out of date.
  execFileSync('node', ['build.mjs', '--check'], { cwd: repoRoot, encoding: 'utf8' });
});

test('build.mjs renders exactly the gallery pages that are committed', () => {
  const expected = [
    'gallery.html',
    ...galleryConfig.mediumPages.map((page) => `gallery-${page.slug}.html`),
    ...galleryConfig.sectionPages.map((page) => `gallery-${page.slug}.html`),
  ].sort();
  assert.deepEqual([...generatedPages].sort(), expected);
});

test('the shared header, nav tabs and footers live in templates, not in 13 copies', () => {
  const headerPartial = readFileSync(path.join(repoRoot, 'templates', 'partials', 'gallery-header.html'), 'utf8');
  assert.ok(headerPartial.includes('gallery-header-sticky'), 'header partial should own the sticky header wrapper');
  assert.ok(headerPartial.includes('{{NAV_TABS}}'), 'header partial should delegate nav tabs to the build');

  for (const name of generatedPages) {
    const html = readFileSync(path.join(repoRoot, name), 'utf8');
    const headerCount = html.split('<div class="gallery-header-sticky">').length - 1;
    assert.equal(headerCount, 1, `${name} should render the shared header exactly once`);
    const footerCount = html.split('<footer role="contentinfo"').length - 1;
    assert.equal(footerCount, 1, `${name} should render a footer exactly once`);
  }
});

test('every generated page highlights exactly one nav tab', () => {
  for (const name of generatedPages) {
    const html = readFileSync(path.join(repoRoot, name), 'utf8');
    const navTabs = html.slice(
      html.indexOf('<nav class="gallery-nav-tabs"'),
      html.indexOf('</nav>', html.indexOf('<nav class="gallery-nav-tabs"'))
    );
    const activeCount = navTabs.split('class="active"').length - 1;
    assert.equal(activeCount, 1, `${name} should mark exactly one nav tab active`);
  }
});

test('an unknown medium on an artwork fails the build instead of rendering a broken page', () => {
  const brokenCatalog = JSON.stringify({
    artworks: [
      {
        id: 'broken-1',
        medium: 'not-a-real-medium',
        titleEn: 'Test',
        titleZh: '测试',
        year: 2026,
        image: 'assets/gallery/test.jpg',
        imageWidth: 10,
        imageHeight: 10,
        altEn: 'Test',
        altZh: '测试',
      },
    ],
  });
  // Rendered into a temporary directory via --fixture, so a test run never
  // touches the tracked catalog even if it fails partway through.
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'gallery-build-'));
  try {
    mkdirSync(path.join(fixtureRoot, 'content'), { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'assets', 'js'), { recursive: true });
    cpSync(path.join(repoRoot, 'content', 'gallery.json'), path.join(fixtureRoot, 'content', 'gallery.json'));
    writeFileSync(path.join(fixtureRoot, 'content', 'artworks.json'), brokenCatalog);
    assert.throws(() => execFileSync('node', ['build.mjs', '--fixture', fixtureRoot], { cwd: repoRoot, stdio: 'pipe' }));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});
