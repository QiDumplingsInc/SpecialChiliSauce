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
    'gallery-collections.html',
    'gallery-new-arrivals.html',
    'gallery-portfolio.html',
    'gallery-artists.html',
    'gallery-exhibitions.html',
    ...galleryConfig.mediumPages.map((page) => `gallery-${page.slug}.html`),
    ...galleryConfig.browsePages.map((page) => `gallery-${page.slug}.html`),
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

test('every class the Exhibitions page renders has a CSS rule', () => {
  // The section pages shipped a .painting-placeholder panel that had no rule in
  // either stylesheet, so it rendered as unstyled body text on five live pages.
  // Exhibitions is where that template ended up: it is the newest page and the
  // one with markup of its own, so it is the page worth pinning against the
  // same class of defect, markup referencing a class nobody styled.
  const html = readFileSync(path.join(repoRoot, 'gallery-exhibitions.html'), 'utf8');
  const stylesheets =
    readFileSync(path.join(repoRoot, 'assets', 'css', 'site.css'), 'utf8') +
    readFileSync(path.join(repoRoot, 'assets', 'css', 'gallery.css'), 'utf8');
  const classNames = new Set();
  for (const match of html.matchAll(/class="([^"{<>]+)"/g)) {
    for (const name of match[1].trim().split(/\s+/)) classNames.add(name);
  }
  assert.ok(classNames.has('exhibition-photo'), 'sanity check: expected the hang photograph class on the page');
  // .lang-btn is a script hook, not a styled class: assets/js/language.js
  // selects the language buttons by it, and their appearance comes from
  // .language-switcher button.
  const scriptHookClasses = new Set(['lang-btn']);
  for (const name of classNames) {
    if (scriptHookClasses.has(name)) continue;
    assert.match(
      stylesheets,
      new RegExp(`\\.${name}([\\s,:{]|$)`, 'm'),
      `.${name} is rendered by gallery-exhibitions.html but has no CSS rule`
    );
  }
});

test('every class the hub page renders has a CSS rule', () => {
  // Same defect class as the section-page test above, applied to the hub, which
  // is the page a visitor lands on. The hub's own <style> block counts as a
  // stylesheet here because its layout rules are page-specific by design.
  const hub = readFileSync(path.join(repoRoot, 'gallery.html'), 'utf8');
  const stylesheets =
    readFileSync(path.join(repoRoot, 'assets', 'css', 'site.css'), 'utf8') +
    readFileSync(path.join(repoRoot, 'assets', 'css', 'gallery.css'), 'utf8') +
    hub.slice(hub.indexOf('<style>'), hub.indexOf('</style>'));
  const classNames = new Set();
  for (const match of hub.matchAll(/class="([^"{<>]+)"/g)) {
    for (const name of match[1].trim().split(/\s+/)) classNames.add(name);
  }
  assert.ok(classNames.has('hero-carousel-image'), 'sanity check: expected the hero photograph class on the hub');
  // .lang-btn is a script hook, not a styled class: assets/js/language.js
  // selects the language buttons by it, and their appearance comes from
  // .language-switcher button. Anything else unstyled is the defect above.
  const scriptHookClasses = new Set(['lang-btn']);
  for (const name of classNames) {
    if (scriptHookClasses.has(name)) continue;
    assert.match(
      stylesheets,
      new RegExp(`\\.${name}([\\s,:{]|$)`, 'm'),
      `.${name} is rendered by gallery.html but has no CSS rule`
    );
  }
});

test('an unknown medium on an artwork fails the build instead of rendering a broken page', () => {
  const brokenCatalog = JSON.stringify({
    artworks: [
      {
        id: 'broken-1',
        medium: 'not-a-real-medium',
        support: 'canvas',
        titleEn: 'Test',
        titleZh: '测试',
        year: 2026,
        images: [
          {
            src: 'assets/gallery/test.jpg',
            width: 10,
            height: 10,
            view: 'front',
            altEn: 'Test',
            altZh: '测试',
          },
        ],
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

test('a front photograph that is not first fails the build', () => {
  // The owner's rule is that the face-on photograph leads when one exists, and
  // that a work with no face-on photograph leads with its in-situ shot. A
  // catalogue that buries the front view behind a room shot is a data mistake,
  // not a layout preference, so the build refuses it rather than rendering a
  // card whose primary image is the wrong one.
  const brokenCatalog = JSON.stringify({
    artworks: [
      {
        id: 'broken-2',
        medium: 'painting',
        support: 'canvas',
        titleEn: 'Test',
        titleZh: '测试',
        images: [
          { src: 'a.jpg', width: 10, height: 10, view: 'in-situ', altEn: 'Test', altZh: '测试' },
          { src: 'b.jpg', width: 10, height: 10, view: 'front', altEn: 'Test', altZh: '测试' },
        ],
      },
    ],
  });
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

// The Collections page groups the catalog into curated series. These fixtures
// build a self-contained catalog so each test isolates one collection rule
// rather than depending on the real content files. A front image leads every
// base work, so the hub's hero, about panels and medium cover all resolve and
// the only variable is the collection data each test changes.
const baseGalleryFixture = () => ({
  searchPages: [],
  facets: [],
  artworkEmptyState: { en: 'None yet', zh: '暂无' },
  mediumEmptyCover: { en: 'No works yet', zh: '暂无作品' },
  heroSlides: [{ artworkId: 'w1', imageIndex: 0, headlineEn: 'Hero', headlineZh: '标题' }],
  aboutPanels: [
    { artworkId: 'w1', imageIndex: 0 },
    { artworkId: 'w2', imageIndex: 0 },
  ],
  navTabs: [
    { href: 'gallery.html', en: 'Artworks', zh: '作品' },
    { href: 'gallery-collections.html', en: 'Collections', zh: '系列' },
  ],
  mediumPages: [{ slug: 'painting', titleEn: 'Painting', titleZh: '绘画', metaDescription: 'Paintings.' }],
  browsePages: [],
  collectionsPage: {
    titleEn: 'Collections',
    titleZh: '系列',
    metaDescription: 'Collections.',
    introEn: 'Works grouped into series.',
    introZh: '按系列分组的作品。',
  },
  collections: [
    {
      slug: 'series-a',
      titleEn: 'Series A',
      titleZh: '系列甲',
      blurbEn: 'The first series.',
      blurbZh: '第一个系列。',
      cover: { artworkId: 'w1', imageIndex: 0 },
    },
  ],
  newArrivalsPage: {
    titleEn: 'New Arrivals',
    titleZh: '新品上架',
    metaDescription: 'New arrivals.',
    introEn: 'The latest works.',
    introZh: '最新作品。',
    artworkIds: ['w1', 'w2'],
  },
  portfolioPage: {
    titleEn: 'Portfolio',
    titleZh: '作品集',
    metaDescription: 'Portfolio.',
    introEn: 'The whole catalogue.',
    introZh: '全部作品。',
  },
  artistsPage: {
    titleEn: 'Artists',
    titleZh: '艺术家',
    metaDescription: 'Artists.',
    introEn: 'The artists.',
    introZh: '艺术家。',
  },
  exhibitionsPage: {
    titleEn: 'Exhibitions',
    titleZh: '展览',
    metaDescription: 'Exhibitions.',
    introEn: 'Where the work has hung.',
    introZh: '作品曾悬挂之处。',
  },
  // Every base work is photographed face on only, so there is no hang scene to
  // show. A test that needs one adds both the in-situ photograph and the scene
  // that claims it, because the build requires that pairing in both directions.
  exhibitions: [],
  artists: [
    {
      slug: 'sample',
      nameEn: 'Sample Artist',
      nameZh: '样本艺术家',
      cover: { artworkId: 'w1', imageIndex: 0 },
      bioEn: ['A sample artist bio.'],
      bioZh: ['样本艺术家简介。'],
    },
  ],
});
const baseArtworksFixture = () => ({
  artworks: [
    {
      id: 'w1',
      medium: 'painting',
      support: 'canvas',
      titleEn: 'Work One',
      titleZh: '作品一',
      images: [{ src: 'a.jpg', width: 10, height: 10, view: 'front', altEn: 'A', altZh: '甲' }],
      collections: ['series-a'],
    },
    {
      id: 'w2',
      medium: 'painting',
      support: 'canvas',
      titleEn: 'Work Two',
      titleZh: '作品二',
      images: [{ src: 'b.jpg', width: 10, height: 10, view: 'front', altEn: 'B', altZh: '乙' }],
      collections: ['series-a'],
    },
  ],
});
const setupCollectionsFixture = (gallery, artworks) => {
  const root = mkdtempSync(path.join(tmpdir(), 'gallery-collections-'));
  mkdirSync(path.join(root, 'content'), { recursive: true });
  mkdirSync(path.join(root, 'assets', 'js'), { recursive: true });
  writeFileSync(path.join(root, 'content', 'gallery.json'), `${JSON.stringify(gallery, null, 4)}\n`);
  writeFileSync(path.join(root, 'content', 'artworks.json'), `${JSON.stringify(artworks, null, 4)}\n`);
  return root;
};

test('a collection renders its series heading and every work it holds', () => {
  const root = setupCollectionsFixture(baseGalleryFixture(), baseArtworksFixture());
  try {
    execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' });
    const html = readFileSync(path.join(root, 'gallery-collections.html'), 'utf8');
    assert.match(html, /id="collection-series-a"/, 'the series section needs its anchor id');
    assert.match(html, /Series A/, 'the series title should render');
    assert.match(html, /Work One/, 'the first work in the series should render');
    assert.match(html, /Work Two/, 'the second work in the series should render');
    assert.match(html, /2 works/, 'the series work count should render');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unknown collection slug on a work fails the build', () => {
  const artworks = baseArtworksFixture();
  artworks.artworks[0].collections = ['no-such-series'];
  const root = setupCollectionsFixture(baseGalleryFixture(), artworks);
  try {
    assert.throws(() => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a collection cover that is an in-situ photograph fails the build', () => {
  const artworks = baseArtworksFixture();
  // A work photographed only where it hangs: no front shot, so it leads with
  // in-situ, which the catalogue allows. Pointing a collection cover at it must
  // fail, because the overview crops covers to a square the way the hub does.
  artworks.artworks.push({
    id: 'w3',
    medium: 'painting',
    support: 'canvas',
    titleEn: 'Work Three',
    titleZh: '作品三',
    images: [{ src: 'c.jpg', width: 10, height: 10, view: 'in-situ', altEn: 'C', altZh: '丙' }],
    collections: ['series-a'],
  });
  const gallery = baseGalleryFixture();
  gallery.collections[0].cover = { artworkId: 'w3', imageIndex: 0 };
  const root = setupCollectionsFixture(gallery, artworks);
  try {
    assert.throws(() => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a collection that no work joins fails the build', () => {
  const gallery = baseGalleryFixture();
  gallery.collections.push({
    slug: 'series-b',
    titleEn: 'Series B',
    titleZh: '系列乙',
    blurbEn: 'The empty series.',
    blurbZh: '空系列。',
    cover: { artworkId: 'w1', imageIndex: 0 },
  });
  // Every base work stays in series-a, so series-b holds nothing.
  const root = setupCollectionsFixture(gallery, baseArtworksFixture());
  try {
    assert.throws(() => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the New Arrivals page renders its listed works in the order given', () => {
  const root = setupCollectionsFixture(baseGalleryFixture(), baseArtworksFixture());
  try {
    execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' });
    const html = readFileSync(path.join(root, 'gallery-new-arrivals.html'), 'utf8');
    assert.match(html, /The latest works\./, 'the intro copy should render');
    assert.match(html, /Work One/, 'the first listed work should render');
    assert.match(html, /Work Two/, 'the second listed work should render');
    assert.ok(
      html.indexOf('Work One') < html.indexOf('Work Two'),
      'the works should keep the order of newArrivalsPage.artworkIds'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The browse pages (Browse by Subject, Browse by Color) group the whole
// catalogue by one filter facet, so they are the only view that cuts across
// medium. These tests assert the two things that make such a page honest: no
// work is left out of it, and no value heading stands over an empty grid.

const artworkCatalog = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'artworks.json'), 'utf8'));
const browsePageHtml = (page) => readFileSync(path.join(repoRoot, `gallery-${page.slug}.html`), 'utf8');
const browseSections = (html) =>
  html
    .split('<section class="collection-section"')
    .slice(1)
    .map((chunk) => chunk.slice(0, chunk.indexOf('</section>')));

test('every browse page renders every work in the catalogue', () => {
  // A work whose facet field is missing or holds a value outside the facet's
  // vocabulary would silently vanish from the page: it matches no value
  // section, and the page would still look complete. This is the check that
  // catches it, which is why the build itself does not have to refuse the data.
  for (const page of galleryConfig.browsePages) {
    const html = browsePageHtml(page);
    for (const artwork of artworkCatalog.artworks) {
      assert.doesNotMatch(
        artwork.titleEn,
        /[&<>"]/,
        `artwork "${artwork.id}" has a title needing HTML escaping, so this test must escape before matching`
      );
      assert.match(
        html,
        new RegExp(`data-title-en="${artwork.titleEn}"`),
        `gallery-${page.slug}.html leaves out "${artwork.titleEn}"; its ${page.facet} value is missing or unknown`
      );
    }
  }
});

test('no browse section stands over an empty grid, and the count pill matches it', () => {
  for (const page of galleryConfig.browsePages) {
    const html = browsePageHtml(page);
    const sections = browseSections(html);
    assert.ok(sections.length > 0, `gallery-${page.slug}.html renders no value section at all`);
    assert.doesNotMatch(
      html,
      /artwork-empty-state/,
      `gallery-${page.slug}.html fell back to the empty state, so no work carries any ${page.facet} value`
    );
    for (const section of sections) {
      const cards = (section.match(/class="artwork-card"/g) ?? []).length;
      assert.ok(cards > 0, `a section of gallery-${page.slug}.html has a heading but no works`);
      const pill = section.match(/collection-count-pill lang-en">(?:(\d+) works|(1) work)</);
      assert.ok(pill, `a section of gallery-${page.slug}.html has no English count pill`);
      assert.equal(
        Number(pill[1] ?? pill[2]),
        cards,
        `a count pill on gallery-${page.slug}.html disagrees with the works under it`
      );
    }
  }
});

test('the hub offers an entry point to every browse page', () => {
  // The decision these pages needed: they are reachable from the hub's explore
  // area rather than from an eighth and ninth gallery nav tab. A browse page
  // nothing links to is a page nobody can find.
  const hub = readFileSync(path.join(repoRoot, 'gallery.html'), 'utf8');
  for (const page of galleryConfig.browsePages) {
    assert.match(hub, new RegExp(`href="gallery-${page.slug}\\.html"`), `the hub does not link gallery-${page.slug}.html`);
    assert.match(hub, new RegExp(page.titleEn), `the hub does not name "${page.titleEn}"`);
  }
  for (const tab of galleryConfig.navTabs) {
    for (const page of galleryConfig.browsePages) {
      assert.notEqual(tab.href, `gallery-${page.slug}.html`, 'a browse page took a nav tab; the entry point is the hub');
    }
  }
});

test('every class the browse-page template renders has a CSS rule', () => {
  // The browse pages ship no CSS of their own: they reuse the Collections
  // page's section classes. This is what proves that claim rather than
  // assuming it.
  const browseTemplate = readFileSync(path.join(repoRoot, 'templates', 'page-browse.html'), 'utf8');
  const stylesheets =
    readFileSync(path.join(repoRoot, 'assets', 'css', 'site.css'), 'utf8') +
    readFileSync(path.join(repoRoot, 'assets', 'css', 'gallery.css'), 'utf8');
  const classNames = new Set();
  for (const match of browseTemplate.matchAll(/class="([^"{]+)"/g)) {
    for (const name of match[1].trim().split(/\s+/)) classNames.add(name);
  }
  assert.ok(classNames.has('category-intro'), 'sanity check: expected the hero intro class in the template');
  for (const name of classNames) {
    assert.match(
      stylesheets,
      new RegExp(`\\.${name}([\\s,:{]|$)`, 'm'),
      `.${name} is rendered by templates/page-browse.html but has no CSS rule`
    );
  }
});

// Fixture-backed browse rules. Each builds a self-contained catalogue so one
// rule is isolated, the same way the collection tests above do.
const browseGalleryFixture = () => {
  const gallery = baseGalleryFixture();
  gallery.facets = [
    {
      key: 'subject',
      field: 'subject',
      labelEn: 'Subject',
      labelZh: '主题',
      values: [
        { value: 'fruit', en: 'Fruit', zh: '水果' },
        { value: 'bird', en: 'Bird', zh: '鸟类' },
      ],
    },
  ];
  gallery.browsePages = [
    {
      slug: 'by-subject',
      facet: 'subject',
      titleEn: 'Browse by Subject',
      titleZh: '按主题浏览',
      metaDescription: 'By subject.',
      introEn: 'Works by subject.',
      introZh: '按主题的作品。',
      cover: { artworkId: 'w1', imageIndex: 0 },
    },
  ];
  return gallery;
};

// The build refuses a facet value no work in the catalogue carries, so a browse
// fixture has to declare its values and hand them out in one piece. This pair
// does that: subject declares fruit and bird, and the two sample works carry
// one each. Pair every browse test with it, or the build fails on the dead
// facet value before it reaches the behaviour under test.
const browseArtworksFixture = () => {
  const artworks = baseArtworksFixture();
  artworks.artworks[0].subject = 'fruit';
  artworks.artworks[1].subject = 'bird';
  return artworks;
};

test('a browse page renders one section per facet value, each holding that value\'s works', () => {
  const root = setupCollectionsFixture(browseGalleryFixture(), browseArtworksFixture());
  try {
    execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' });
    const html = readFileSync(path.join(root, 'gallery-by-subject.html'), 'utf8');
    assert.match(html, /id="browse-by-subject-fruit"/, 'each declared value needs its own section');
    assert.match(html, /id="browse-by-subject-bird"/, 'every declared value needs its own section');
    assert.match(html, /Work One/, 'the work carrying the first value should render under it');
    assert.match(html, /Work Two/, 'the work carrying the second value should render under it');
    assert.match(html, /1 work</, 'a value holding one work reads "1 work", not "1 works"');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a browse page leaves out a work that carries no value for its facet', () => {
  // The reachable half of the old "skips a value nothing carries" assertion. A
  // declared value no work carries now fails the build outright, so the only
  // way a work goes missing from a browse page is that the work itself has no
  // value for the facet -- a data gap on the work, not a dead filter option.
  const gallery = browseGalleryFixture();
  gallery.facets[0].values = [{ value: 'fruit', en: 'Fruit', zh: '水果' }];
  const artworks = baseArtworksFixture();
  artworks.artworks[0].subject = 'fruit';
  const root = setupCollectionsFixture(gallery, artworks);
  try {
    execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' });
    const html = readFileSync(path.join(root, 'gallery-by-subject.html'), 'utf8');
    assert.match(html, /id="browse-by-subject-fruit"/, 'the value a work carries needs its section');
    assert.match(html, /Work One/, 'the work carrying the value should render');
    assert.doesNotMatch(html, /Work Two/, 'a work with no value for the facet must not be placed anywhere');
    assert.match(html, /1 work</, 'the count should name only the works actually under the value');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the New Arrivals page refuses an artwork id that does not exist', () => {
  const gallery = baseGalleryFixture();
  gallery.newArrivalsPage.artworkIds = ['w1', 'no-such-work'];
  const root = setupCollectionsFixture(gallery, baseArtworksFixture());
  try {
    assert.throws(() => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a browse page whose facet declares no values renders the empty state, not a bare hero', () => {
  // A facet with no values is the only way a browse page can have nothing to
  // group now: a declared value no work carries fails the build instead. That
  // is a data gap rather than a configuration error, so the page says what an
  // empty medium page says.
  const gallery = browseGalleryFixture();
  gallery.facets[0].values = [];
  const root = setupCollectionsFixture(gallery, baseArtworksFixture());
  try {
    execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' });
    const html = readFileSync(path.join(root, 'gallery-by-subject.html'), 'utf8');
    assert.match(html, /artwork-empty-state/, 'a browse page with nothing to group needs the shared empty state');
    assert.doesNotMatch(html, /<section class="collection-section"/, 'no value section should render');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a browse page naming a facet that does not exist fails the build', () => {
  const gallery = browseGalleryFixture();
  gallery.browsePages[0].facet = 'not-a-facet';
  const root = setupCollectionsFixture(gallery, browseArtworksFixture());
  try {
    assert.throws(
      () => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }),
      (error) => /names facet "not-a-facet"/.test(String(error.stderr)),
      'the build must fail on the unknown facet, not on some earlier guard'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the Portfolio page groups every work under its medium heading', () => {
  const root = setupCollectionsFixture(baseGalleryFixture(), baseArtworksFixture());
  try {
    execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' });
    const html = readFileSync(path.join(root, 'gallery-portfolio.html'), 'utf8');
    assert.match(html, /id="portfolio-painting"/, 'the medium section needs its anchor id');
    assert.match(html, /Painting/, 'the medium heading should render');
    assert.match(html, /2 works/, 'the medium work count should render');
    assert.match(html, /Work One/, 'a work in the medium should render');
    assert.match(html, /Work Two/, 'every work in the medium should render');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the Artists page renders the artist name, bio and works', () => {
  const root = setupCollectionsFixture(baseGalleryFixture(), baseArtworksFixture());
  try {
    execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' });
    const html = readFileSync(path.join(root, 'gallery-artists.html'), 'utf8');
    assert.match(html, /id="artist-sample"/, 'the artist section needs its anchor id');
    assert.match(html, /Sample Artist/, 'the artist name should render');
    assert.match(html, /A sample artist bio\./, 'the artist bio should render');
    assert.match(html, /Work One/, 'the artist works grid should render the catalogue');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an artist with mismatched bio languages fails the build', () => {
  const gallery = baseGalleryFixture();
  gallery.artists[0].bioZh = [];
  const root = setupCollectionsFixture(gallery, baseArtworksFixture());
  try {
    assert.throws(() => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// The Exhibitions page renders the in-situ photographs the catalogue already
// carried and nothing rendered. Its data model is a pairing in both directions:
// a scene names photographs, and the works visible in a scene are derived from
// those photographs rather than listed again. These fixtures pin each half of
// that pairing, because a break in either one puts an untitled picture of a
// wall on a live page or leaves a real hang record unpublished.
const withHangScene = () => {
  const artworks = baseArtworksFixture();
  artworks.artworks[0].images.push({
    src: 'wall.jpg',
    width: 10,
    height: 10,
    view: 'in-situ',
    altEn: 'Work One on a wall',
    altZh: '墙上的作品一',
  });
  const gallery = baseGalleryFixture();
  gallery.exhibitions = [
    {
      slug: 'a-wall',
      titleEn: 'A Wall',
      titleZh: '一面墙',
      blurbEn: 'One work on one wall.',
      blurbZh: '一面墙上的一件作品。',
      images: [{ artworkId: 'w1', imageIndex: 1 }],
    },
  ];
  return { gallery, artworks };
};

test('a hang scene renders its photograph and the works visible in it', () => {
  const { gallery, artworks } = withHangScene();
  const root = setupCollectionsFixture(gallery, artworks);
  try {
    execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' });
    const html = readFileSync(path.join(root, 'gallery-exhibitions.html'), 'utf8');
    assert.match(html, /id="exhibition-a-wall"/, 'the scene section needs its anchor id');
    assert.match(html, /A Wall/, 'the scene title should render');
    assert.match(html, /One work on one wall\./, 'the scene blurb should render');
    assert.match(html, /src="wall\.jpg"/, 'the hang photograph should render');
    assert.match(html, /Work One/, 'the work visible in the scene should render');
    assert.match(html, /href="gallery-painting\.html"/, 'each visible work cross-links to the page that shows it');
    assert.doesNotMatch(html, /Work Two/, 'a work that is not in the photograph must not be listed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a hang scene photograph that is not an in-situ view fails the build', () => {
  // The exact opposite of the hub rule: the hub crops to a fixed slot so an
  // in-situ shot is wrong there, and here a front view would be a photograph of
  // the work rather than a record of where it hung. The catalogue here carries
  // no room photograph at all, so the view rule is the only thing that can
  // fail and this cannot pass because some other guard fired first.
  const { gallery } = withHangScene();
  gallery.exhibitions[0].images = [{ artworkId: 'w1', imageIndex: 0 }];
  const root = setupCollectionsFixture(gallery, baseArtworksFixture());
  try {
    assert.throws(
      () => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }),
      (error) => /needs an in-situ photograph/.test(String(error.stderr)),
      'a front view in a hang scene must fail the build for that reason'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a browse page whose slug collides with another page fails the build', () => {
  // Both would render to the same gallery-<slug>.html, so one would overwrite
  // the other and --check would compare the survivor against both.
  const gallery = browseGalleryFixture();
  gallery.browsePages[0].slug = 'painting';
  const root = setupCollectionsFixture(gallery, browseArtworksFixture());
  try {
    assert.throws(
      () => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }),
      (error) => /slug "painting" is already used by another page/.test(String(error.stderr)),
      'the build must fail on the slug collision, not on some earlier guard'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an in-situ photograph that belongs to no hang scene fails the build', () => {
  const { artworks } = withHangScene();
  const root = setupCollectionsFixture(baseGalleryFixture(), artworks);
  try {
    assert.throws(
      () => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }),
      (error) => /belongs to no exhibitions scene/.test(String(error.stderr)),
      'an unpublished hang photograph must fail the build for that reason'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the same photograph claimed by two hang scenes fails the build', () => {
  const { gallery, artworks } = withHangScene();
  gallery.exhibitions.push({ ...gallery.exhibitions[0], slug: 'the-same-wall' });
  const root = setupCollectionsFixture(gallery, artworks);
  try {
    assert.throws(
      () => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }),
      (error) => /belongs to exactly one scene/.test(String(error.stderr)),
      'a photograph told about twice must fail the build for that reason'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a facet value no work in the catalogue carries fails the build', () => {
  // The size facet shipped exactly this way: four declared options and no work
  // with a sizeRange, so every chip on the Painting page returned an empty
  // result. A filter that can only ever match nothing is worse than no filter.
  const gallery = baseGalleryFixture();
  gallery.facets = [
    {
      key: 'size',
      field: 'sizeRange',
      labelEn: 'Size Range',
      labelZh: '尺寸范围',
      values: [{ value: 'large', en: 'Large', zh: '大' }],
    },
  ];
  const root = setupCollectionsFixture(gallery, baseArtworksFixture());
  try {
    assert.throws(
      () => execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' }),
      (error) => /could never match anything/.test(String(error.stderr)),
      'a dead facet value must fail the build for that reason'
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a medium page can gather its works on a field other than medium', () => {
  // How the one drawing reaches the Work on Paper page: medium names the
  // technique, support names the thing the work is made on, and a page may
  // select on either. The work stays one catalogue entry listed under both.
  const gallery = baseGalleryFixture();
  gallery.mediumPages.push({
    slug: 'work-on-paper',
    titleEn: 'Work on Paper',
    titleZh: '纸本作品',
    metaDescription: 'Works on paper.',
    select: { field: 'support', value: 'paper' },
  });
  const artworks = baseArtworksFixture();
  artworks.artworks[1].support = 'paper';
  const root = setupCollectionsFixture(gallery, artworks);
  try {
    execFileSync('node', ['build.mjs', '--fixture', root], { cwd: repoRoot, stdio: 'pipe' });
    const html = readFileSync(path.join(root, 'gallery-work-on-paper.html'), 'utf8');
    assert.match(html, /Work Two/, 'the work on paper should render on the page that selects it');
    assert.doesNotMatch(html, /Work One/, 'a work on canvas must not appear on the Work on Paper page');
    const painting = readFileSync(path.join(root, 'gallery-painting.html'), 'utf8');
    assert.match(painting, /Work Two/, 'the same work still appears under its own medium');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('no committed gallery page carries placeholder copy', () => {
  // The whole point of ARQ-45. Nine of the fourteen gallery pages shipped
  // either "Content coming soon" or a one-line empty state; this fails the
  // build out if any page goes back to standing in for content it does not
  // have. A medium with no works says so in written copy, which is a statement
  // rather than a placeholder, and is covered by its own test.
  for (const name of generatedPages) {
    const html = readFileSync(path.join(repoRoot, name), 'utf8');
    assert.doesNotMatch(html, /coming soon/i, `${name} still promises content instead of carrying it`);
    assert.doesNotMatch(html, /painting-placeholder/, `${name} still renders the old placeholder panel`);
  }
});
