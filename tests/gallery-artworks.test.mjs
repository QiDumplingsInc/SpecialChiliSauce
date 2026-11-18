import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync, rmSync } from 'node:fs';
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
  cpSync(path.join(repoRoot, 'content', 'gallery.json'), path.join(fixtureRoot, 'content', 'gallery.json'));
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
