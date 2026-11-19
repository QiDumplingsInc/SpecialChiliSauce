import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// Artwork is display only, and the artwork catalog is empty until real photos
// land. Both facts make these tests the only way to exercise the real artwork
// rendering path: each test renders a sample catalog through build.mjs into a
// temporary directory (--fixture), then asserts on the resulting HTML. Nothing
// here writes to the working tree.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const SAMPLE_ARTWORKS = {
  artworks: [
    {
      id: 'painting-dusk',
      medium: 'painting',
      titleEn: 'Dusk Field',
      titleZh: '黄昏原野',
      year: 2024,
      // Three photographs, so this work exercises the carousel: the face-on
      // view first, then the work on a wall, then a close detail.
      images: [
        {
          src: 'assets/gallery/painting-dusk-1.jpg',
          width: 1600,
          height: 1200,
          view: 'front',
          altEn: 'An abstract field of blue and green under a low sun',
          altZh: '低垂日光下的蓝绿色抽象原野',
        },
        {
          src: 'assets/gallery/painting-dusk-2.jpg',
          width: 1000,
          height: 750,
          view: 'in-situ',
          altEn: 'The painting hung above a sideboard in a hallway',
          altZh: '画作挂在走廊餐边柜上方',
        },
        {
          src: 'assets/gallery/painting-dusk-3.jpg',
          width: 1000,
          height: 750,
          view: 'detail',
          altEn: 'Close detail of the brushwork at the horizon',
          altZh: '地平线处笔触的局部特写',
        },
      ],
      sizeRange: 'large',
      colors: ['blues', 'greens'],
      style: 'abstract',
      dimensionsEn: '90 x 120 cm',
      dimensionsZh: '90 x 120 厘米',
    },
    {
      id: 'painting-quiet',
      medium: 'painting',
      titleEn: 'Quiet Room',
      titleZh: '静室',
      year: 2026,
      // One photograph, so this work must render no carousel chrome at all.
      images: [
        {
          src: 'assets/gallery/painting-quiet-1.jpg',
          width: 1200,
          height: 1500,
          view: 'front',
          altEn: 'A figure seated by a window in warm brown light',
          altZh: '暖棕色光线中坐在窗边的人物',
        },
      ],
      sizeRange: 'small',
      colors: ['browns'],
      style: 'figurative',
    },
  ],
};

const SAMPLE_SLIDE_COUNT = SAMPLE_ARTWORKS.artworks.reduce((total, artwork) => total + artwork.images.length, 0);

async function loadFixturePage(fixtureRoot, fileName) {
  // jsdom does not fetch external <script src>, so inline each local script the
  // way loadPage() does. The generated search index comes from the fixture; the
  // hand-written scripts come from the repo.
  const html = readFileSync(path.join(fixtureRoot, fileName), 'utf8').replace(
    /<script src="([^"]+)"><\/script>/g,
    (match, src) => {
      const source = src.endsWith('gallery-search-index.js')
        ? readFileSync(path.join(fixtureRoot, src), 'utf8')
        : readFileSync(path.join(repoRoot, src), 'utf8');
      return `<script>${source}</script>`;
    }
  );
  const dom = new JSDOM(html, { runScripts: 'dangerously' });
  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') resolve();
    else dom.window.addEventListener('load', resolve);
  });
  return dom;
}

function renderWithArtworks(catalog) {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'gallery-fixture-'));
  mkdirSync(path.join(fixtureRoot, 'content'), { recursive: true });
  mkdirSync(path.join(fixtureRoot, 'assets', 'js'), { recursive: true });
  // The hub page's hero slides, about panels and medium-card covers each name a
  // real artwork id, and the build refuses a reference it cannot resolve. Point
  // them at the sample catalogue so a fixture render exercises the same code
  // path the site does: an explicit cover where the medium has works, and the
  // placeholder where it has none.
  const fixtureConfig = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'gallery.json'), 'utf8'));
  const sampleCover = { artworkId: catalog.artworks[0].id, imageIndex: 0 };
  fixtureConfig.heroSlides = fixtureConfig.heroSlides.map((slide) => ({ ...slide, ...sampleCover }));
  fixtureConfig.aboutPanels = fixtureConfig.aboutPanels.map(() => ({ ...sampleCover }));
  fixtureConfig.mediumPages = fixtureConfig.mediumPages.map((page) => {
    const { cover, ...rest } = page;
    const works = catalog.artworks.filter((artwork) => artwork.medium === page.slug);
    return works.length === 0 ? rest : { ...rest, cover: { artworkId: works[0].id, imageIndex: 0 } };
  });
  writeFileSync(path.join(fixtureRoot, 'content', 'gallery.json'), JSON.stringify(fixtureConfig, null, 4));
  writeFileSync(path.join(fixtureRoot, 'content', 'artworks.json'), JSON.stringify(catalog, null, 4));
  execFileSync('node', ['build.mjs', '--fixture', fixtureRoot], { cwd: repoRoot, encoding: 'utf8' });
  return fixtureRoot;
}

test('no gallery page offers a wishlist, an inquiry or a dead placeholder link', () => {
  const fixtureRoot = renderWithArtworks(SAMPLE_ARTWORKS);
  try {
    for (const name of ['gallery.html', 'gallery-painting.html', 'gallery-sculpture.html', 'gallery-artists.html']) {
      const html = readFileSync(path.join(fixtureRoot, name), 'utf8');
      assert.doesNotMatch(html, /wishlist/i, `${name} still has a wishlist affordance`);
      assert.doesNotMatch(html, /artwork-inquire|>Inquire</i, `${name} still has an inquire affordance`);
      assert.doesNotMatch(html, /href="#"/, `${name} still has a link that goes nowhere`);
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('every rendered artwork image carries width, height and an alt in both languages', () => {
  const fixtureRoot = renderWithArtworks(SAMPLE_ARTWORKS);
  try {
    const dom = new JSDOM(readFileSync(path.join(fixtureRoot, 'gallery-painting.html'), 'utf8'));
    const images = [...dom.window.document.querySelectorAll('.artwork-image')];
    assert.equal(images.length, SAMPLE_SLIDE_COUNT, 'every photograph in the catalogue must render');
    for (const image of images) {
      assert.match(image.getAttribute('width'), /^\d+$/, 'width must be a pixel count');
      assert.match(image.getAttribute('height'), /^\d+$/, 'height must be a pixel count');
      assert.ok(image.getAttribute('alt'), 'alt must not be empty');
      assert.ok(image.dataset.altEn && image.dataset.altZh, 'both alt languages must be present');
      assert.ok(image.dataset.view, 'every photograph must declare which view it is');
      assert.equal(image.getAttribute('loading'), 'lazy');
    }
    dom.window.close();
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('a work with several photographs renders one slide each, front view first', () => {
  const fixtureRoot = renderWithArtworks(SAMPLE_ARTWORKS);
  try {
    const dom = new JSDOM(readFileSync(path.join(fixtureRoot, 'gallery-painting.html'), 'utf8'));
    const card = dom.window.document.querySelector('.artwork-card[data-title-en="Dusk Field"]');
    const slides = [...card.querySelectorAll('.artwork-slide .artwork-image')];
    assert.deepEqual(
      slides.map((image) => image.dataset.view),
      ['front', 'in-situ', 'detail'],
      'slides must follow catalogue order, which puts the face-on view first'
    );
    assert.equal(card.querySelectorAll('.artwork-carousel-dot').length, 3, 'one dot per photograph');
    // The box has to reserve the first photograph's shape, or the grid reflows
    // as each card's tallest slide loads.
    assert.match(card.querySelector('.artwork-carousel').getAttribute('style'), /aspect-ratio: 1600 \/ 1200/);
    dom.window.close();
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('a work with one photograph renders no carousel control', () => {
  const fixtureRoot = renderWithArtworks(SAMPLE_ARTWORKS);
  try {
    const dom = new JSDOM(readFileSync(path.join(fixtureRoot, 'gallery-painting.html'), 'utf8'));
    const card = dom.window.document.querySelector('.artwork-card[data-title-en="Quiet Room"]');
    // A control that cannot do anything is worse than no control, so a single
    // photograph gets a bare image and no arrows, dots or scroll strip.
    assert.equal(card.querySelectorAll('.artwork-image').length, 1);
    assert.equal(card.querySelector('.artwork-carousel'), null, 'one photograph needs no scroll strip');
    assert.equal(card.querySelector('.artwork-carousel-nav'), null, 'one photograph needs no arrows');
    assert.equal(card.querySelector('.artwork-carousel-dot'), null, 'one photograph needs no dots');
    dom.window.close();
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('the carousel controls become usable and step through the photographs', async () => {
  const fixtureRoot = renderWithArtworks(SAMPLE_ARTWORKS);
  try {
    const dom = await loadFixturePage(fixtureRoot, 'gallery-painting.html');
    const card = dom.window.document.querySelector('.artwork-card[data-title-en="Dusk Field"]');
    const dots = [...card.querySelectorAll('.artwork-carousel-dot')];
    const next = card.querySelector('.artwork-carousel-next');
    const previous = card.querySelector('.artwork-carousel-prev');
    const selected = () => dots.findIndex((dot) => dot.getAttribute('aria-current') === 'true');

    // The arrows and dots ship hidden so they are never inert for a reader
    // without JavaScript, who can still swipe the scroll-snap strip.
    assert.ok(!next.hidden && !previous.hidden, 'the script must unhide the controls it drives');
    assert.equal(selected(), 0);

    next.click();
    assert.equal(selected(), 1, 'next moves to the second photograph');
    dots[2].click();
    assert.equal(selected(), 2, 'a dot jumps straight to its photograph');

    // Both arrows wrap, so neither is ever a dead end that would have to be
    // disabled at the ends of the strip.
    next.click();
    assert.equal(selected(), 0, 'next wraps from the last photograph to the first');
    previous.click();
    assert.equal(selected(), 2, 'previous wraps from the first photograph to the last');

    card.querySelector('.artwork-carousel').dispatchEvent(
      new dom.window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })
    );
    assert.equal(selected(), 1, 'a left arrow key moves back one photograph');
    dom.window.close();
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('the filter bar only offers facet values that some artwork on the page actually has', () => {
  const fixtureRoot = renderWithArtworks(SAMPLE_ARTWORKS);
  try {
    const dom = new JSDOM(readFileSync(path.join(fixtureRoot, 'gallery-painting.html'), 'utf8'));
    const { document } = dom.window;
    const offered = [...document.querySelectorAll('.filter-option')].map(
      (option) => `${option.dataset.facet}:${option.dataset.value}`
    );
    // Both sample works differ on size, color and style, so each of those
    // facets has two or more values and appears. No work has a "reds" colour
    // or a "realist" style, so neither may be offered.
    assert.ok(offered.includes('size:large') && offered.includes('size:small'));
    assert.ok(offered.includes('style:abstract') && offered.includes('style:figurative'));
    assert.ok(!offered.includes('colors:reds'), 'offered a colour no artwork has');
    assert.ok(!offered.includes('style:realist'), 'offered a style no artwork has');
    assert.ok(document.querySelector('.filter-year-from'), 'two different years should give a year range');
    dom.window.close();
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('a medium page with no artwork renders an empty state and no filter bar', () => {
  const html = readFileSync(path.join(repoRoot, 'gallery-sculpture.html'), 'utf8');
  assert.ok(html.includes('artwork-empty-state'), 'expected the honest empty state');
  assert.ok(!html.includes('artwork-filter-bar'), 'a page with nothing to filter must not render a filter bar');
  assert.ok(!html.includes('artwork-grid'), 'a page with no artwork must not render an empty grid');
});

test('selecting a filter option hides the artwork that does not match', async () => {
  const fixtureRoot = renderWithArtworks(SAMPLE_ARTWORKS);
  try {
    const dom = await loadFixturePage(fixtureRoot, 'gallery-painting.html');
    const { document } = dom.window;
    const cards = [...document.querySelectorAll('.artwork-card')];
    assert.equal(cards.filter((card) => !card.hidden).length, 2, 'both works visible before filtering');

    document.querySelector('.filter-option[data-facet="style"][data-value="abstract"]').click();
    const visible = cards.filter((card) => !card.hidden);
    assert.equal(visible.length, 1);
    assert.equal(visible[0].dataset.titleEn, 'Dusk Field');
    assert.ok(!document.querySelector('.filter-clear').hidden, 'clear control should appear once a filter is on');

    document.querySelector('.filter-clear').click();
    assert.equal(cards.filter((card) => !card.hidden).length, 2, 'clearing restores every work');
    dom.window.close();
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('a filter combination that matches nothing shows the no-matches message', async () => {
  const fixtureRoot = renderWithArtworks(SAMPLE_ARTWORKS);
  try {
    const dom = await loadFixturePage(fixtureRoot, 'gallery-painting.html');
    const { document } = dom.window;
    document.querySelector('.filter-option[data-facet="style"][data-value="abstract"]').click();
    document.querySelector('.filter-option[data-facet="size"][data-value="small"]').click();
    assert.equal([...document.querySelectorAll('.artwork-card')].filter((card) => !card.hidden).length, 0);
    assert.ok(!document.querySelector('.artwork-no-matches').hidden);
    dom.window.close();
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('the generated search index covers every medium page and every artwork title', () => {
  const fixtureRoot = renderWithArtworks(SAMPLE_ARTWORKS);
  try {
    const source = readFileSync(path.join(fixtureRoot, 'assets', 'js', 'gallery-search-index.js'), 'utf8');
    const index = JSON.parse(source.slice(source.indexOf('['), source.lastIndexOf(']') + 1));
    const galleryConfig = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'gallery.json'), 'utf8'));
    for (const page of galleryConfig.mediumPages) {
      assert.ok(
        index.some((entry) => entry.href === `gallery-${page.slug}.html`),
        `search index is missing gallery-${page.slug}.html`
      );
    }
    for (const artwork of SAMPLE_ARTWORKS.artworks) {
      assert.ok(
        index.some((entry) => entry.en.startsWith(artwork.titleEn) && entry.href === `gallery-${artwork.medium}.html`),
        `search index is missing artwork "${artwork.titleEn}"`
      );
      assert.ok(
        index.some((entry) => entry.zh.startsWith(artwork.titleZh)),
        `search index is missing the Chinese title for "${artwork.titleEn}"`
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('an undated work renders n.d. and no year filter claims it', async () => {
  const fixtureRoot = renderWithArtworks({
    artworks: [
      SAMPLE_ARTWORKS.artworks[0],
      SAMPLE_ARTWORKS.artworks[1],
      // Two dated works give the year range something to span; the third is the
      // undated one under test.
      { ...SAMPLE_ARTWORKS.artworks[1], id: 'painting-undated', titleEn: 'Undated Study', titleZh: '无年份习作', year: undefined },
    ],
  });
  try {
    const dom = await loadFixturePage(fixtureRoot, 'gallery-painting.html');
    const { document } = dom.window;
    const undated = document.querySelector('.artwork-card[data-title-en="Undated Study"]');
    assert.equal(undated.dataset.year, '', 'an undated work must carry an empty data-year');
    assert.match(undated.querySelector('.artwork-title.lang-en').textContent, /n\.d\.$/);
    assert.match(undated.querySelector('.artwork-title.lang-zh').textContent, /年份不详$/);

    // A year bound must exclude the undated work rather than let it pass one
    // bound and fail the other, which is what Number('') === 0 used to do.
    const from = document.querySelector('.filter-year-from');
    from.value = '2000';
    from.dispatchEvent(new dom.window.Event('input'));
    assert.ok(undated.hidden, 'an undated work cannot be shown to fall inside a year range');

    const to = document.querySelector('.filter-year-to');
    from.value = '';
    to.value = '2100';
    to.dispatchEvent(new dom.window.Event('input'));
    assert.ok(undated.hidden, 'an upper year bound alone must exclude the undated work too');
    dom.window.close();
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('every artwork class the build renders has a CSS rule', () => {
  // The section-page placeholder once shipped with no rule in either
  // stylesheet and rendered as unstyled text on five live pages. The carousel
  // adds eight new classes, so check the same class of defect here: markup
  // referencing a class nobody styled.
  const fixtureRoot = renderWithArtworks(SAMPLE_ARTWORKS);
  try {
    const html = readFileSync(path.join(fixtureRoot, 'gallery-painting.html'), 'utf8');
    const stylesheets =
      readFileSync(path.join(repoRoot, 'assets', 'css', 'site.css'), 'utf8') +
      readFileSync(path.join(repoRoot, 'assets', 'css', 'gallery.css'), 'utf8');
    const classNames = new Set();
    for (const match of html.matchAll(/class="([^"{]+)"/g)) {
      for (const name of match[1].trim().split(/\s+/)) {
        if (name.startsWith('artwork-') || name === 'visually-hidden') classNames.add(name);
      }
    }
    assert.ok(classNames.has('artwork-slide'), 'sanity check: expected the carousel slide class');
    assert.ok(classNames.has('visually-hidden'), 'sanity check: expected the control label class');
    for (const name of classNames) {
      assert.match(
        stylesheets,
        new RegExp(`\\.${name}([\\s,:{]|$)`, 'm'),
        `.${name} is rendered by build.mjs but has no CSS rule`
      );
    }
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('every catalogued image exists and its declared width and height match the file', () => {
  const catalog = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'artworks.json'), 'utf8'));
  const images = catalog.artworks.flatMap((artwork) =>
    artwork.images.map((image) => ({ ...image, artworkId: artwork.id }))
  );
  for (const image of images) {
    const bytes = readFileSync(path.join(repoRoot, image.src));
    // Read the real geometry out of the JPEG rather than trusting the catalog
    // or sips, which reports the pre-rotation buffer for a phone photo. A
    // declared size that disagrees with the file reintroduces the layout shift
    // that width/height exist to prevent, and a leftover EXIF orientation tag
    // makes the browser rotate an already-rotated image.
    let width = 0;
    let height = 0;
    let orientation = 1;
    let offset = 2;
    while (offset < bytes.length - 1) {
      if (bytes[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = bytes[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xda) break;
      const segmentLength = bytes.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        height = bytes.readUInt16BE(offset + 5);
        width = bytes.readUInt16BE(offset + 7);
        break;
      }
      if (marker === 0xe1 && bytes.toString('ascii', offset + 4, offset + 10) === 'Exif\0\0') {
        const tiff = offset + 10;
        const littleEndian = bytes.toString('ascii', tiff, tiff + 2) === 'II';
        const directory =
          tiff + (littleEndian ? bytes.readUInt32LE(tiff + 4) : bytes.readUInt32BE(tiff + 4));
        const entryCount = littleEndian ? bytes.readUInt16LE(directory) : bytes.readUInt16BE(directory);
        for (let entryIndex = 0; entryIndex < entryCount; entryIndex += 1) {
          const entry = directory + 2 + entryIndex * 12;
          const tag = littleEndian ? bytes.readUInt16LE(entry) : bytes.readUInt16BE(entry);
          if (tag === 0x0112) {
            orientation = littleEndian ? bytes.readUInt16LE(entry + 8) : bytes.readUInt16BE(entry + 8);
          }
        }
      }
      offset += 2 + segmentLength;
    }
    assert.ok(width > 0 && height > 0, `${image.src} is not a readable JPEG`);
    assert.equal(image.width, width, `${image.artworkId}: ${image.src} declares the wrong width`);
    assert.equal(image.height, height, `${image.artworkId}: ${image.src} declares the wrong height`);
    assert.equal(orientation, 1, `${image.src} carries EXIF orientation ${orientation}; bake the rotation in`);
  }
});

// The hub page (gallery.html) is where a visitor lands. Its hero slides, its
// seven medium cards and its two about panels all advertised "coming soon"
// while real photographs sat one click behind them -- markup and data tests
// could not catch that, because the page was well-formed and simply said
// something untrue. These tests check what the hub claims against the catalogue.

const committedHub = () => new JSDOM(readFileSync(path.join(repoRoot, 'gallery.html'), 'utf8'));

const catalogue = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'artworks.json'), 'utf8'));
const galleryConfig = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'gallery.json'), 'utf8'));
const catalogueImagesBySrc = new Map(
  catalogue.artworks.flatMap((artwork) => artwork.images.map((image) => [image.src, { ...image, artworkId: artwork.id }]))
);

test('the hub shows a photograph for every medium that has works, and promises none for the rest', () => {
  const dom = committedHub();
  try {
    const cards = [...dom.window.document.querySelectorAll('.medium-card')];
    assert.equal(cards.length, galleryConfig.mediumPages.length, 'one card per medium page');
    for (const [index, page] of galleryConfig.mediumPages.entries()) {
      const card = cards[index];
      const works = catalogue.artworks.filter((artwork) => artwork.medium === page.slug);
      const image = card.querySelector('img');
      if (works.length > 0) {
        assert.ok(image, `${page.slug} has ${works.length} published work(s) but its hub card shows no photograph`);
        assert.match(image.getAttribute('width'), /^\d+$/, `${page.slug} cover must declare a pixel width`);
        assert.match(image.getAttribute('height'), /^\d+$/, `${page.slug} cover must declare a pixel height`);
        assert.ok(image.getAttribute('alt'), `${page.slug} cover must carry alt text`);
        assert.doesNotMatch(card.textContent, /coming soon/i, `${page.slug} has works, so its card must not promise an image`);
      } else {
        assert.equal(image, null, `${page.slug} has no published work, so its card must not show one`);
        assert.doesNotMatch(
          card.textContent,
          /coming soon/i,
          `${page.slug} has no works; its card should say so rather than promise an image`
        );
      }
    }
  } finally {
    dom.window.close();
  }
});

test('every photograph the hub renders is a real catalogue file, and never an in-situ view', () => {
  // Every hub slot has a fixed aspect ratio and crops the photograph to fill
  // it. An in-situ shot was framed deliberately to show the work in its room,
  // so cropping it away in a hero band or a square card defeats the reason it
  // was taken. Front and detail views are already closed in on the work.
  const dom = committedHub();
  try {
    const images = [...dom.window.document.querySelectorAll('img')].filter((image) =>
      image.getAttribute('src').startsWith('assets/gallery/')
    );
    assert.ok(images.length >= 1 + galleryConfig.heroSlides.length, 'the hub should render its hero and cover photographs');
    for (const image of images) {
      const source = catalogueImagesBySrc.get(image.getAttribute('src'));
      assert.ok(source, `${image.getAttribute('src')} is on the hub but not in content/artworks.json`);
      assert.notEqual(source.view, 'in-situ', `${source.src} is an in-situ view and the hub crops to fit`);
      assert.equal(Number(image.getAttribute('width')), source.width, `${source.src} declares the wrong width on the hub`);
      assert.equal(Number(image.getAttribute('height')), source.height, `${source.src} declares the wrong height on the hub`);
      assert.ok(image.dataset.altEn && image.dataset.altZh, `${source.src} needs alt text in both languages`);
    }
  } finally {
    dom.window.close();
  }
});

test('the hub hero carousel has one pager button per slide and loads its first photograph eagerly', () => {
  const dom = committedHub();
  try {
    const slides = [...dom.window.document.querySelectorAll('.hero-carousel-slide')];
    const dots = [...dom.window.document.querySelectorAll('.hero-carousel-pager button')];
    assert.equal(slides.length, galleryConfig.heroSlides.length);
    assert.equal(dots.length, slides.length, 'a pager button that matches no slide is a control that does nothing');
    assert.equal(slides.filter((slide) => slide.classList.contains('active')).length, 1);
    const first = slides[0].querySelector('.hero-carousel-image');
    assert.equal(first.getAttribute('loading'), null, 'the first slide is above the fold, so it must not be lazy');
    for (const slide of slides.slice(1)) {
      assert.equal(slide.querySelector('.hero-carousel-image').getAttribute('loading'), 'lazy');
    }
  } finally {
    dom.window.close();
  }
});

test('an unresolvable hub photograph reference fails the build', async () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'gallery-hub-'));
  try {
    mkdirSync(path.join(fixtureRoot, 'content'), { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'assets', 'js'), { recursive: true });
    const brokenConfig = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'gallery.json'), 'utf8'));
    brokenConfig.heroSlides[0].artworkId = 'no-such-work';
    writeFileSync(path.join(fixtureRoot, 'content', 'gallery.json'), JSON.stringify(brokenConfig, null, 4));
    writeFileSync(path.join(fixtureRoot, 'content', 'artworks.json'), JSON.stringify(SAMPLE_ARTWORKS, null, 4));
    assert.throws(() => execFileSync('node', ['build.mjs', '--fixture', fixtureRoot], { cwd: repoRoot, stdio: 'pipe' }));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('an in-situ photograph in a hub slot fails the build', () => {
  const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'gallery-hub-'));
  try {
    mkdirSync(path.join(fixtureRoot, 'content'), { recursive: true });
    mkdirSync(path.join(fixtureRoot, 'assets', 'js'), { recursive: true });
    const brokenConfig = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'gallery.json'), 'utf8'));
    // painting-dusk's second photograph is its in-situ view.
    brokenConfig.heroSlides = [{ ...brokenConfig.heroSlides[0], artworkId: 'painting-dusk', imageIndex: 1 }];
    brokenConfig.aboutPanels = [
      { artworkId: 'painting-dusk', imageIndex: 0 },
      { artworkId: 'painting-dusk', imageIndex: 0 },
    ];
    brokenConfig.mediumPages = brokenConfig.mediumPages.map(({ cover, ...rest }) => rest);
    writeFileSync(path.join(fixtureRoot, 'content', 'gallery.json'), JSON.stringify(brokenConfig, null, 4));
    writeFileSync(path.join(fixtureRoot, 'content', 'artworks.json'), JSON.stringify(SAMPLE_ARTWORKS, null, 4));
    assert.throws(() => execFileSync('node', ['build.mjs', '--fixture', fixtureRoot], { cwd: repoRoot, stdio: 'pipe' }));
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test('switching the hub to Chinese switches its photograph alt text too', async () => {
  // alt is an attribute, so the .lang-en/.lang-zh CSS rules cannot swap it.
  // The hub does not load the filter script, so the swap lives in the shared
  // language script; before it moved there, every hub photograph kept its
  // English alt for a Chinese reader.
  const { loadPage } = await import('./helpers/loadPage.mjs');
  const dom = await loadPage('gallery.html');
  try {
    const { document } = dom.window;
    const image = document.querySelector('.hero-carousel-image');
    assert.equal(image.getAttribute('alt'), image.dataset.altEn);
    document.querySelector('.lang-btn[data-lang="zh"]').click();
    assert.equal(image.getAttribute('alt'), image.dataset.altZh);
    document.querySelector('.lang-btn[data-lang="en"]').click();
    assert.equal(image.getAttribute('alt'), image.dataset.altEn);
  } finally {
    dom.window.close();
  }
});
