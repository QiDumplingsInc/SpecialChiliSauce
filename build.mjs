// build.mjs -- renders every gallery*.html page at the repo root from the
// templates in templates/ and the data in content/.
//
// Input:  content/gallery.json   (nav tabs, medium pages, section pages)
//         content/artworks.json  (the artwork catalog, display only)
//         templates/page-*.html  (one template per page shape)
//         templates/partials/*   (header, footers, filter bar, placeholder card)
// Output: gallery.html plus gallery-<slug>.html at the repo root, written in
//         place so GitHub Pages keeps serving the committed HTML with no
//         build step at deploy time. Also assets/js/gallery-search-index.js
//         and assets/js/edit-mode-rules.js, both generated from the same data.
//
// Process: load the data, resolve every {{> partial}} include, substitute the
// {{TOKEN}} placeholders, then either write each file or, with --check,
// compare the rendered bytes against what is on disk and exit non-zero on any
// difference. --check is what CI and the test suite use to prove the committed
// HTML has not drifted away from the templates.
//
// Admin edit mode: every element whose text is an editable content value is
// rendered with a data-edit-field attribute carrying the patch address for
// that value. The contract the browser overlay relies on is that such an
// element's textContent is exactly the raw value on disk, which is why an
// artwork title is wrapped in its own span instead of being composed with the
// year into one string. Every address emitted is checked against the gate's
// own whitelist before anything is written, so the build -- not a reviewer --
// is what stops an address that names a field edit mode must not reach.
//
// Run: node build.mjs          (write)
//      node build.mjs --check  (verify, no writes)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EDITABLE_CONTENT, EDITABLE_RULE_TYPES, formatContentFile } from './scripts/content-patch.mjs';

const repoRoot = dirname(fileURLToPath(import.meta.url));
const checkOnly = process.argv.includes('--check');
// --fixture <dir> reads content from <dir>/content and writes the rendered
// pages into <dir>, leaving the working tree untouched. Templates always come
// from the repo. Tests use it to render a sample artwork catalog and assert on
// the real build output instead of mutating tracked files.
const fixtureFlag = process.argv.indexOf('--fixture');
const workRoot = fixtureFlag === -1 ? repoRoot : path.resolve(process.argv[fixtureFlag + 1]);

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const galleryConfig = JSON.parse(readFileSync(path.join(workRoot, 'content', 'gallery.json'), 'utf8'));
const artworkCatalog = JSON.parse(readFileSync(path.join(workRoot, 'content', 'artworks.json'), 'utf8'));

if (!Array.isArray(galleryConfig.navTabs) || galleryConfig.navTabs.length === 0) {
  throw new Error('content/gallery.json: navTabs must be a non-empty array');
}
if (!Array.isArray(galleryConfig.mediumPages) || galleryConfig.mediumPages.length === 0) {
  throw new Error('content/gallery.json: mediumPages must be a non-empty array');
}
if (!Array.isArray(galleryConfig.sectionPages)) {
  throw new Error('content/gallery.json: sectionPages must be an array');
}
if (!Array.isArray(galleryConfig.facets)) {
  throw new Error('content/gallery.json: facets must be an array');
}
if (!Array.isArray(galleryConfig.searchPages)) {
  throw new Error('content/gallery.json: searchPages must be an array');
}
for (const facet of galleryConfig.facets) {
  if (!facet.key || !facet.field || !facet.labelEn || !facet.labelZh || !Array.isArray(facet.values)) {
    throw new Error(`content/gallery.json: facet "${facet.key ?? '(no key)'}" needs key, field, labelEn, labelZh and values`);
  }
}
if (!galleryConfig.artworkEmptyState?.en || !galleryConfig.artworkEmptyState?.zh) {
  throw new Error('content/gallery.json: artworkEmptyState needs both en and zh copy');
}
if (!galleryConfig.mediumEmptyCover?.en || !galleryConfig.mediumEmptyCover?.zh) {
  throw new Error('content/gallery.json: mediumEmptyCover needs both en and zh copy');
}
if (!Array.isArray(galleryConfig.heroSlides) || galleryConfig.heroSlides.length === 0) {
  throw new Error('content/gallery.json: heroSlides must be a non-empty array');
}
for (const [index, slide] of galleryConfig.heroSlides.entries()) {
  if (!slide.artworkId || !Number.isInteger(slide.imageIndex) || !slide.headlineEn || !slide.headlineZh) {
    throw new Error(
      `content/gallery.json: heroSlides entry ${index + 1} needs artworkId, imageIndex, headlineEn and headlineZh`
    );
  }
}
// The hub template has exactly two alternating about panels, so the config has
// to supply exactly two photographs; a third would silently never render.
if (!Array.isArray(galleryConfig.aboutPanels) || galleryConfig.aboutPanels.length !== 2) {
  throw new Error('content/gallery.json: aboutPanels must be an array of exactly two entries');
}
for (const [index, panel] of galleryConfig.aboutPanels.entries()) {
  if (!panel.artworkId || !Number.isInteger(panel.imageIndex)) {
    throw new Error(`content/gallery.json: aboutPanels entry ${index + 1} needs artworkId and imageIndex`);
  }
}
if (!Array.isArray(artworkCatalog.artworks)) {
  throw new Error('content/artworks.json: artworks must be an array');
}

const IMAGE_VIEWS = new Set(['front', 'in-situ', 'detail']);
const mediumSlugs = new Set(galleryConfig.mediumPages.map((page) => page.slug));
const seenArtworkIds = new Set();
for (const artwork of artworkCatalog.artworks) {
  for (const field of ['id', 'medium', 'titleEn', 'titleZh']) {
    if (artwork[field] === undefined || artwork[field] === null || artwork[field] === '') {
      throw new Error(`content/artworks.json: artwork ${artwork.id ?? '(no id)'} is missing required field "${field}"`);
    }
  }
  if (seenArtworkIds.has(artwork.id)) {
    throw new Error(`content/artworks.json: duplicate artwork id "${artwork.id}"`);
  }
  seenArtworkIds.add(artwork.id);
  if (!mediumSlugs.has(artwork.medium)) {
    throw new Error(
      `content/artworks.json: artwork "${artwork.id}" has medium "${artwork.medium}", which is not a slug in gallery.json mediumPages`
    );
  }
  if (!Array.isArray(artwork.images) || artwork.images.length === 0) {
    throw new Error(`content/artworks.json: artwork "${artwork.id}" needs a non-empty images array`);
  }
  for (const [index, image] of artwork.images.entries()) {
    for (const field of ['src', 'width', 'height', 'view', 'altEn', 'altZh']) {
      if (image[field] === undefined || image[field] === null || image[field] === '') {
        throw new Error(`content/artworks.json: artwork "${artwork.id}" image ${index + 1} is missing "${field}"`);
      }
    }
    if (!IMAGE_VIEWS.has(image.view)) {
      throw new Error(
        `content/artworks.json: artwork "${artwork.id}" image ${index + 1} has view "${image.view}"; use front, in-situ or detail`
      );
    }
    if (!Number.isInteger(image.width) || image.width <= 0) {
      throw new Error(`content/artworks.json: artwork "${artwork.id}" image ${index + 1} width must be a positive integer`);
    }
    if (!Number.isInteger(image.height) || image.height <= 0) {
      throw new Error(`content/artworks.json: artwork "${artwork.id}" image ${index + 1} height must be a positive integer`);
    }
  }
  // The owner's rule for photograph order: the face-on shot leads when one
  // exists, because that is what the grid shows. A work photographed only in
  // the room it hangs in is deliberate -- there is no face-on shot to copy
  // from -- so it leads with the in-situ view and the details follow.
  if (artwork.images.some((image) => image.view === 'front') && artwork.images[0].view !== 'front') {
    throw new Error(
      `content/artworks.json: artwork "${artwork.id}" has a front photograph, so a front image must come first`
    );
  }
  // year is optional on purpose. Several works are unsigned and undated, and
  // the catalogue records that rather than inventing a plausible year; those
  // render as "n.d.", the standard notation for an undated work.
  if (artwork.year !== undefined && !(Number.isInteger(artwork.year) && artwork.year >= 1000 && artwork.year <= 9999)) {
    throw new Error(`content/artworks.json: artwork "${artwork.id}" year must be a four-digit integer or omitted`);
  }
}

const UNDATED_EN = 'n.d.';
const UNDATED_ZH = '年份不详';
const yearLabel = (artwork) => ({
  en: artwork.year === undefined ? UNDATED_EN : String(artwork.year),
  zh: artwork.year === undefined ? UNDATED_ZH : String(artwork.year),
});

const artworkById = new Map(artworkCatalog.artworks.map((artwork) => [artwork.id, artwork]));

// Resolves one { artworkId, imageIndex } reference from gallery.json into the
// image object it names, for the hub page's hero slides, medium-card covers and
// about panels. Returns that image object. Throws with the referring config
// path when the work or the index does not exist, or when the referenced
// photograph is an in-situ view: every hub slot has a fixed aspect ratio and
// crops the photograph to fill it, and an in-situ shot was framed deliberately
// to show the work in its room, so cropping it away defeats the reason it was
// taken. Front and detail views are already closed in on the work.
const resolveHubImage = (reference, configPath) => {
  const artwork = artworkById.get(reference.artworkId);
  if (artwork === undefined) {
    throw new Error(`${configPath}: no artwork with id "${reference.artworkId}" in content/artworks.json`);
  }
  const image = artwork.images[reference.imageIndex];
  if (image === undefined) {
    throw new Error(`${configPath}: artwork "${reference.artworkId}" has no image at index ${reference.imageIndex}`);
  }
  if (image.view === 'in-situ') {
    throw new Error(
      `${configPath}: artwork "${reference.artworkId}" image ${reference.imageIndex + 1} is an in-situ view; the hub crops to fit, so use a front or detail photograph`
    );
  }
  return image;
};

// The chili sauce landing page (index.html) is generated from
// templates/page-home.html and the copy in content/home.json, so admin edit
// mode can change a word or a price without anyone touching the markup.
// content/home.json is a flat list of editable strings; each one becomes a
// {{HOME_STRINGS_<KEY>_TEXT}} token in the template. The values are substituted
// verbatim, not HTML-escaped: the page's body copy legitimately holds literal
// quotation marks and ampersands in text context, so escaping here would corrupt
// copy that must round-trip byte for byte. Markup injection is not the risk it
// would be for an escaped value, because the gate (scripts/content-patch.mjs)
// already rejects the characters < > { and } in any editable value.
// A --fixture run renders a sample gallery into a temp directory and never the
// chili sauce page, so the home copy is loaded and index.html is generated only
// in the real build (workRoot === repoRoot).
const renderHome = workRoot === repoRoot;
const homeContent = renderHome
  ? JSON.parse(readFileSync(path.join(workRoot, 'content', 'home.json'), 'utf8'))
  : { strings: [] };
const homeTokens = {};
if (renderHome) {
  if (!Array.isArray(homeContent.strings) || homeContent.strings.length === 0) {
    throw new Error('content/home.json: strings must be a non-empty array');
  }
  const seenHomeKeys = new Set();
  for (const entry of homeContent.strings) {
    if (entry === null || typeof entry !== 'object' || typeof entry.key !== 'string' || entry.key === '') {
      throw new Error('content/home.json: every string needs a non-empty "key"');
    }
    if (seenHomeKeys.has(entry.key)) {
      throw new Error(`content/home.json: duplicate string key "${entry.key}"`);
    }
    seenHomeKeys.add(entry.key);
    if (typeof entry.text !== 'string' || entry.text === '') {
      throw new Error(`content/home.json: string "${entry.key}" needs non-empty "text"`);
    }
    homeTokens[`HOME_STRINGS_${entry.key.replace(/-/g, '_').toUpperCase()}_TEXT`] = entry.text;
  }
}

// Every patch address the generated pages are allowed to carry, derived from
// the gate's own whitelist crossed with the records that actually exist. The
// browser overlay turns a data-edit-field attribute straight into a patch
// edit, so an address that names a non-whitelisted field or a record that is
// not there would hand the editor a pencil whose submit can only ever be
// rejected. Checking the rendered output against this set makes that a build
// failure rather than something a reviewer has to notice.
//
// The same loop enforces the other direction: a field in the whitelist whose
// rule type the overlay cannot edit is reach the gate grants that no editor
// can use, so it widens the write path for nothing. Failing the build here is
// what keeps the whitelist and the overlay's reach one set rather than two
// lists that drift. See EDITABLE_RULE_TYPES in scripts/content-patch.mjs.
const editableAddresses = new Set();
const contentByFile = {
  'content/gallery.json': galleryConfig,
  'content/artworks.json': artworkCatalog,
  'content/home.json': homeContent,
};
for (const [file, collections] of Object.entries(EDITABLE_CONTENT)) {
  const data = contentByFile[file];
  for (const [collection, spec] of Object.entries(collections)) {
    for (const [field, rule] of Object.entries(spec.fields)) {
      if (!EDITABLE_RULE_TYPES.includes(rule.type)) {
        throw new Error(
          `${file}/${collection}/${field} is whitelisted with rule type "${rule.type}", which the browser ` +
            `overlay cannot edit (it handles ${EDITABLE_RULE_TYPES.join(', ')}). Either give the overlay a ` +
            'mechanism for it or take the field out of EDITABLE_CONTENT in scripts/content-patch.mjs.'
        );
      }
    }
    for (const record of data[collection] ?? []) {
      for (const field of Object.keys(spec.fields)) {
        editableAddresses.add(`${file}|${collection}|${record[spec.keyField]}|${field}`);
      }
    }
  }
}

// Membership in that set is necessary but not sufficient: the gate also refuses
// a whole patch when the content file's formatting does not round-trip, because
// rewriting such a file would reformat it end to end and bury the real edit. A
// correctly addressed pencil on a hand-compacted file is therefore still a
// pencil that can only ever be rejected -- and that failure reaches the editor
// at submit time, after they have done the work. Checking the formatting of
// every file the pages address turns it into a build failure instead, at the
// moment the file drifts.
for (const file of Object.keys(EDITABLE_CONTENT)) {
  const raw = readFileSync(path.join(repoRoot, file), 'utf8');
  if (formatContentFile(JSON.parse(raw)) !== raw) {
    throw new Error(
      `${file}: formatting does not round-trip, so edit mode cannot patch it; ` +
        'run pretty-format-json --indent=4 --no-sort-keys on it, or stop rendering data-edit-field attributes for it'
    );
  }
}

const partialsDir = path.join(repoRoot, 'templates', 'partials');
const partials = new Map();
for (const fileName of readdirSync(partialsDir)) {
  if (!fileName.endsWith('.html')) continue;
  partials.set(fileName.replace(/\.html$/, ''), readFileSync(path.join(partialsDir, fileName), 'utf8'));
}

// The language-switcher note is a comment that only gallery.html carries today.
// Keeping it a per-page value is what lets the shared header partial regenerate
// all 13 pages byte for byte instead of adding a comment-only diff to 12 of them.
const languageSwitcherNote =
  '    <!-- Language Switcher: nested inside header so mobile positioning\n' +
  '         is relative to the header box, never above/overlapping it -->\n';

let mediumGrid = '      <div class="medium-grid">\n';
for (const page of galleryConfig.mediumPages) {
  const works = artworkCatalog.artworks.filter((artwork) => artwork.medium === page.slug);
  const cover = page.cover ?? (works.length > 0 ? { artworkId: works[0].id, imageIndex: 0 } : null);
  mediumGrid += `        <a href="gallery-${page.slug}.html" class="medium-card">\n`;
  if (cover === null) {
    // A medium with no works does not promise a photograph. "Image coming
    // soon" on a card whose page says no works are published yet is a promise
    // nobody made; this says the same thing the page says.
    mediumGrid += '          <div class="medium-placeholder">\n';
    mediumGrid += `            <span class="lang-en">${escapeHtml(galleryConfig.mediumEmptyCover.en)}</span>\n`;
    mediumGrid += `            <span class="lang-zh">${escapeHtml(galleryConfig.mediumEmptyCover.zh)}</span>\n`;
    mediumGrid += '          </div>\n';
  } else {
    const image = resolveHubImage(cover, `gallery.json mediumPages "${page.slug}" cover`);
    mediumGrid += `          <img class="medium-card-image" src="${escapeHtml(image.src)}"`;
    mediumGrid += ` alt="${escapeHtml(image.altEn)}"`;
    mediumGrid += ` width="${image.width}" height="${image.height}" loading="lazy"`;
    mediumGrid += ` data-alt-en="${escapeHtml(image.altEn)}" data-alt-zh="${escapeHtml(image.altZh)}">\n`;
  }
  mediumGrid += `          <span class="medium-card-label lang-en" data-edit-field="content/gallery.json|mediumPages|${escapeHtml(page.slug)}|titleEn">${escapeHtml(page.titleEn)}</span>\n`;
  mediumGrid += `          <span class="medium-card-label lang-zh" data-edit-field="content/gallery.json|mediumPages|${escapeHtml(page.slug)}|titleZh">${escapeHtml(page.titleZh)}</span>\n`;
  mediumGrid += '        </a>\n';
}
mediumGrid += '      </div>\n';

let heroSlides = '';
let heroPager = '';
for (const [slideIndex, slide] of galleryConfig.heroSlides.entries()) {
  const artwork = artworkById.get(slide.artworkId);
  const image = resolveHubImage(slide, `gallery.json heroSlides entry ${slideIndex + 1}`);
  const year = yearLabel(artwork);
  const activeClass = slideIndex === 0 ? ' active' : '';
  heroSlides += `    <div class="hero-carousel-slide${activeClass}">\n`;
  heroSlides += `      <img class="hero-carousel-image" src="${escapeHtml(image.src)}"`;
  heroSlides += ` alt="${escapeHtml(image.altEn)}"`;
  heroSlides += ` width="${image.width}" height="${image.height}"`;
  heroSlides += slideIndex === 0 ? '' : ' loading="lazy"';
  heroSlides += ` data-alt-en="${escapeHtml(image.altEn)}" data-alt-zh="${escapeHtml(image.altZh)}">\n`;
  heroSlides += '      <div class="hero-carousel-copy">\n';
  heroSlides += `        <h1 class="lang-en">${escapeHtml(slide.headlineEn)}</h1>\n`;
  heroSlides += `        <h1 class="lang-zh">${escapeHtml(slide.headlineZh)}</h1>\n`;
  heroSlides += `        <p class="lang-en">${escapeHtml(artwork.titleEn)}, ${escapeHtml(year.en)}</p>\n`;
  heroSlides += `        <p class="lang-zh">${escapeHtml(artwork.titleZh)}，${escapeHtml(year.zh)}</p>\n`;
  heroSlides += '      </div>\n';
  heroSlides += '    </div>\n';
  heroPager += `      <button${slideIndex === 0 ? ' class="active"' : ''} data-slide="${slideIndex}"`;
  heroPager += ` aria-label="Go to slide ${slideIndex + 1}"></button>\n`;
}

// The two alternating about panels. Each is one photograph beside its text; the
// panel is decorative framing for the copy, so it takes a cropped-to-fit
// photograph rather than a work's primary view.
const aboutPanelImages = galleryConfig.aboutPanels.map((panel, panelIndex) => {
  const image = resolveHubImage(panel, `gallery.json aboutPanels entry ${panelIndex + 1}`);
  let markup = `      <img class="about-panel-photo" src="${escapeHtml(image.src)}"`;
  markup += ` alt="${escapeHtml(image.altEn)}"`;
  markup += ` width="${image.width}" height="${image.height}" loading="lazy"`;
  markup += ` data-alt-en="${escapeHtml(image.altEn)}" data-alt-zh="${escapeHtml(image.altZh)}">\n`;
  return markup;
});

// Renders one artwork grid: the <div class="artwork-grid"> block with one card
// per work, image (or a multi-image carousel), the "KAY" byline and the
// bilingual title + year. Returns that block as a string. Two callers share it
// -- every medium page and every collection section -- so the card markup, the
// carousel and the edit pencils stay one definition rather than two that drift.
// The caller supplies the works and decides what wraps the grid (a filter bar
// and a no-matches message on medium pages, a section head on collection pages).
const renderArtworkGrid = (works) => {
  let grid = '    <div class="artwork-grid">\n';
  for (const artwork of works) {
    const colors = Array.isArray(artwork.colors) ? artwork.colors.join(' ') : '';
    const year = yearLabel(artwork);
    grid += '      <div class="artwork-card"';
    grid += ` data-medium="${escapeHtml(artwork.medium)}"`;
    grid += ` data-year="${escapeHtml(artwork.year ?? '')}"`;
    grid += ` data-size="${escapeHtml(artwork.sizeRange ?? '')}"`;
    grid += ` data-colors="${escapeHtml(colors)}"`;
    grid += ` data-style="${escapeHtml(artwork.style ?? '')}"`;
    grid += ` data-subject="${escapeHtml(artwork.subject ?? '')}"`;
    grid += ` data-title-en="${escapeHtml(artwork.titleEn)}"`;
    grid += ` data-title-zh="${escapeHtml(artwork.titleZh)}"`;
    grid += '>\n';
    grid += '        <div class="artwork-image-wrap">\n';
    // A work with one photograph renders a bare image: carousel controls on a
    // single slide would be an affordance that does nothing. A work with
    // several renders a scroll-snap strip, which already swipes on touch and
    // scrolls with no script at all; the buttons and dots start hidden and the
    // carousel script unhides them, so they never sit there inert.
    const slides = artwork.images;
    if (slides.length > 1) {
      // The aspect ratio is per work, so it has to be an inline style rather
      // than a stylesheet rule. It comes from the first photograph, which is
      // the one the grid shows.
      grid += `          <div class="artwork-carousel" role="group" aria-roledescription="carousel" data-slide-count="${slides.length}"`;
      grid += ` style="aspect-ratio: ${slides[0].width} / ${slides[0].height}" tabindex="0">\n`;
    }
    const slideIndent = slides.length > 1 ? '            ' : '          ';
    for (const [slideIndex, image] of slides.entries()) {
      if (slides.length > 1) {
        grid += `${slideIndent}<div class="artwork-slide" data-slide="${slideIndex}">\n`;
      }
      const imageIndent = slides.length > 1 ? `${slideIndent}  ` : slideIndent;
      grid += `${imageIndent}<img class="artwork-image" src="${escapeHtml(image.src)}"`;
      grid += ` alt="${escapeHtml(image.altEn)}"`;
      grid += ` width="${image.width}" height="${image.height}" loading="lazy"`;
      grid += ` data-view="${escapeHtml(image.view)}"`;
      grid += ` data-alt-en="${escapeHtml(image.altEn)}" data-alt-zh="${escapeHtml(image.altZh)}">\n`;
      if (slides.length > 1) {
        grid += `${slideIndent}</div>\n`;
      }
    }
    if (slides.length > 1) {
      grid += '          </div>\n';
      for (const direction of ['prev', 'next']) {
        const glyph = direction === 'prev' ? '&#8249;' : '&#8250;';
        const labelEn = direction === 'prev' ? 'Previous view' : 'Next view';
        const labelZh = direction === 'prev' ? '上一张' : '下一张';
        grid += `          <button type="button" class="artwork-carousel-nav artwork-carousel-${direction}" hidden>\n`;
        grid += `            <span aria-hidden="true">${glyph}</span>\n`;
        grid += `            <span class="visually-hidden lang-en">${labelEn}</span>\n`;
        grid += `            <span class="visually-hidden lang-zh">${labelZh}</span>\n`;
        grid += '          </button>\n';
      }
      grid += '          <div class="artwork-carousel-dots" hidden>\n';
      for (const slideIndex of slides.keys()) {
        grid += `            <button type="button" class="artwork-carousel-dot" data-slide="${slideIndex}"`;
        grid += slideIndex === 0 ? ' aria-current="true">\n' : '>\n';
        grid += `              <span class="visually-hidden lang-en">View ${slideIndex + 1}</span>\n`;
        grid += `              <span class="visually-hidden lang-zh">第 ${slideIndex + 1} 张</span>\n`;
        grid += '            </button>\n';
      }
      grid += '          </div>\n';
    }
    grid += '        </div>\n';
    grid += '        <div class="artwork-artist">KAY</div>\n';
    // The title is wrapped in its own span rather than composed with the
    // year into one string, so the element carrying the edit address holds
    // exactly the title that is on disk and nothing else. That is the whole
    // contract the browser overlay reads: textContent is the value.
    grid += `        <div class="artwork-title lang-en"><span data-edit-field="content/artworks.json|artworks|${escapeHtml(artwork.id)}|titleEn">${escapeHtml(artwork.titleEn)}</span>, ${escapeHtml(year.en)}</div>\n`;
    grid += `        <div class="artwork-title lang-zh"><span data-edit-field="content/artworks.json|artworks|${escapeHtml(artwork.id)}|titleZh">${escapeHtml(artwork.titleZh)}</span>，${escapeHtml(year.zh)}</div>\n`;
    if (artwork.dimensionsEn && artwork.dimensionsZh) {
      grid += `        <div class="artwork-dimensions lang-en" data-edit-field="content/artworks.json|artworks|${escapeHtml(artwork.id)}|dimensionsEn">${escapeHtml(artwork.dimensionsEn)}</div>\n`;
      grid += `        <div class="artwork-dimensions lang-zh" data-edit-field="content/artworks.json|artworks|${escapeHtml(artwork.id)}|dimensionsZh">${escapeHtml(artwork.dimensionsZh)}</div>\n`;
    }
    grid += '      </div>\n';
  }
  grid += '    </div>\n';
  return grid;
};

// The Collections page groups the catalog into curated series. Membership lives
// on each work (artwork.collections, an array of slugs); the series title, blurb
// and cover live in gallery.json collections. Validate that pairing before any
// render: the hub-image rule already refuses an in-situ cover, and here we also
// refuse a cover or a membership slug that names a series that does not exist,
// and a series that no work joins.
const collectionsPage = galleryConfig.collectionsPage;
if (
  !collectionsPage ||
  !collectionsPage.titleEn ||
  !collectionsPage.titleZh ||
  !collectionsPage.metaDescription ||
  !collectionsPage.introEn ||
  !collectionsPage.introZh
) {
  throw new Error('content/gallery.json: collectionsPage needs titleEn, titleZh, metaDescription, introEn and introZh');
}
if (!Array.isArray(galleryConfig.collections) || galleryConfig.collections.length === 0) {
  throw new Error('content/gallery.json: collections must be a non-empty array');
}
const collectionSlugs = new Set();
for (const collection of galleryConfig.collections) {
  for (const field of ['slug', 'titleEn', 'titleZh', 'blurbEn', 'blurbZh']) {
    if (collection[field] === undefined || collection[field] === null || collection[field] === '') {
      throw new Error(`content/gallery.json: collection "${collection.slug ?? '(no slug)'}" is missing "${field}"`);
    }
  }
  if (collectionSlugs.has(collection.slug)) {
    throw new Error(`content/gallery.json: duplicate collection slug "${collection.slug}"`);
  }
  collectionSlugs.add(collection.slug);
  if (!collection.cover || !collection.cover.artworkId || !Number.isInteger(collection.cover.imageIndex)) {
    throw new Error(`content/gallery.json: collection "${collection.slug}" needs a cover with artworkId and imageIndex`);
  }
}
for (const artwork of artworkCatalog.artworks) {
  if (artwork.collections === undefined) continue;
  if (!Array.isArray(artwork.collections)) {
    throw new Error(`content/artworks.json: artwork "${artwork.id}" collections must be an array`);
  }
  for (const slug of artwork.collections) {
    if (!collectionSlugs.has(slug)) {
      throw new Error(
        `content/artworks.json: artwork "${artwork.id}" names collection "${slug}", which is not a slug in gallery.json collections`
      );
    }
  }
}
const worksByCollection = new Map(galleryConfig.collections.map((collection) => [collection.slug, []]));
for (const artwork of artworkCatalog.artworks) {
  for (const slug of artwork.collections ?? []) {
    worksByCollection.get(slug).push(artwork);
  }
}
for (const collection of galleryConfig.collections) {
  if (worksByCollection.get(collection.slug).length === 0) {
    throw new Error(`content/gallery.json: collection "${collection.slug}" has no works; every series must hold at least one`);
  }
}

// The overview grid: one square cover card per series, reusing the hub's
// medium-card look, each an in-page anchor to its section plus a work count.
let collectionsOverview = '      <div class="medium-grid">\n';
for (const collection of galleryConfig.collections) {
  const image = resolveHubImage(collection.cover, `gallery.json collections "${collection.slug}" cover`);
  const count = worksByCollection.get(collection.slug).length;
  collectionsOverview += `        <a href="#collection-${escapeHtml(collection.slug)}" class="medium-card">\n`;
  collectionsOverview += `          <img class="medium-card-image" src="${escapeHtml(image.src)}"`;
  collectionsOverview += ` alt="${escapeHtml(image.altEn)}"`;
  collectionsOverview += ` width="${image.width}" height="${image.height}" loading="lazy"`;
  collectionsOverview += ` data-alt-en="${escapeHtml(image.altEn)}" data-alt-zh="${escapeHtml(image.altZh)}">\n`;
  collectionsOverview += `          <span class="medium-card-label lang-en">${escapeHtml(collection.titleEn)}</span>\n`;
  collectionsOverview += `          <span class="medium-card-label lang-zh">${escapeHtml(collection.titleZh)}</span>\n`;
  collectionsOverview += `          <span class="collection-card-count lang-en">${count} works</span>\n`;
  collectionsOverview += `          <span class="collection-card-count lang-zh">${count} 件作品</span>\n`;
  collectionsOverview += '        </a>\n';
}
collectionsOverview += '      </div>\n';

// One section per series: the editable title and blurb, a chili-red count pill,
// then the shared artwork grid. The title and blurb carry edit pencils so the
// browser overlay can reach them; the count is derived, so it does not.
let collectionsSections = '';
for (const collection of galleryConfig.collections) {
  const works = worksByCollection.get(collection.slug);
  const count = works.length;
  collectionsSections += `      <section class="collection-section" id="collection-${escapeHtml(collection.slug)}">\n`;
  collectionsSections += '        <div class="collection-section-head">\n';
  collectionsSections += `          <h2 class="collection-section-title lang-en" data-edit-field="content/gallery.json|collections|${escapeHtml(collection.slug)}|titleEn">${escapeHtml(collection.titleEn)}</h2>\n`;
  collectionsSections += `          <h2 class="collection-section-title lang-zh" data-edit-field="content/gallery.json|collections|${escapeHtml(collection.slug)}|titleZh">${escapeHtml(collection.titleZh)}</h2>\n`;
  collectionsSections += `          <span class="collection-count-pill lang-en">${count} works</span>\n`;
  collectionsSections += `          <span class="collection-count-pill lang-zh">${count} 件作品</span>\n`;
  collectionsSections += '        </div>\n';
  collectionsSections += `        <p class="collection-blurb lang-en" data-edit-field="content/gallery.json|collections|${escapeHtml(collection.slug)}|blurbEn">${escapeHtml(collection.blurbEn)}</p>\n`;
  collectionsSections += `        <p class="collection-blurb lang-zh" data-edit-field="content/gallery.json|collections|${escapeHtml(collection.slug)}|blurbZh">${escapeHtml(collection.blurbZh)}</p>\n`;
  collectionsSections += renderArtworkGrid(works);
  collectionsSections += '      </section>\n';
}

const pages = [];
// editableRecords names every whitelisted record a page renders in place,
// derived from the same content arrays the markup above is built from, not from
// the data-edit-field attributes themselves. The reverse guard at the end of the
// render loop crosses it with the whitelist to prove each such record still
// carries its pencils here. Deriving it from the data rather than from the
// attribute strings is the point: a change that drops the attribute leaves the
// record in this list, so the guard fails instead of the pencil going missing
// unseen. The hub renders one medium card per mediumPages record.
pages.push({
  fileName: 'gallery.html',
  templateName: 'page-gallery',
  activeTab: 'gallery.html',
  tokens: {
    LANGUAGE_SWITCHER_NOTE: languageSwitcherNote,
    HERO_SLIDES: heroSlides,
    HERO_PAGER: heroPager,
    MEDIUM_GRID: mediumGrid,
    ABOUT_PANEL_1: aboutPanelImages[0],
    ABOUT_PANEL_2: aboutPanelImages[1],
  },
  editableRecords: galleryConfig.mediumPages.map((page) => ({
    file: 'content/gallery.json',
    collection: 'mediumPages',
    key: page.slug,
  })),
});
for (const page of galleryConfig.mediumPages) {
  const works = artworkCatalog.artworks.filter((artwork) => artwork.medium === page.slug);

  // The filter bar is derived from the works actually on the page, so a facet
  // can never offer a value that matches nothing and the bar disappears
  // entirely when there is nothing to filter. That is the whole point of
  // generating it: the old hand-written bar was inert markup.
  let filterBar = '';
  if (works.length > 0) {
    let dropdowns = '';
    for (const facet of galleryConfig.facets) {
      const present = facet.values.filter((option) =>
        works.some((artwork) => {
          const field = artwork[facet.field];
          return Array.isArray(field) ? field.includes(option.value) : field === option.value;
        })
      );
      if (present.length < 2) continue;
      dropdowns += '      <div class="filter-dropdown">\n';
      dropdowns += `        <button class="filter-dropdown-toggle" type="button" id="filter-toggle-${facet.key}" aria-expanded="false">\n`;
      dropdowns += `          <span class="lang-en">${escapeHtml(facet.labelEn)}</span><span class="lang-zh">${escapeHtml(facet.labelZh)}</span>\n`;
      dropdowns += '        </button>\n';
      dropdowns += `        <div class="filter-dropdown-panel" role="group" aria-labelledby="filter-toggle-${facet.key}">\n`;
      for (const option of present) {
        dropdowns += '          <button type="button" class="filter-option" role="checkbox" aria-checked="false"';
        dropdowns += ` data-facet="${escapeHtml(facet.key)}" data-value="${escapeHtml(option.value)}">\n`;
        dropdowns += '            <span class="filter-check" aria-hidden="true">&#10003;</span>\n';
        dropdowns += `            <span class="lang-en">${escapeHtml(option.en)}</span><span class="lang-zh">${escapeHtml(option.zh)}</span>\n`;
        dropdowns += '          </button>\n';
      }
      dropdowns += '        </div>\n';
      dropdowns += '      </div>\n';
    }

    const years = [...new Set(works.filter((artwork) => artwork.year !== undefined).map((artwork) => artwork.year))].sort(
      (a, b) => a - b
    );
    if (years.length > 1) {
      dropdowns += '      <div class="filter-dropdown">\n';
      dropdowns += '        <button class="filter-dropdown-toggle" type="button" id="filter-toggle-year" aria-expanded="false">\n';
      dropdowns += '          <span class="lang-en">Year Range</span><span class="lang-zh">年份范围</span>\n';
      dropdowns += '        </button>\n';
      dropdowns += '        <div class="filter-dropdown-panel" role="group" aria-labelledby="filter-toggle-year">\n';
      dropdowns += '          <div class="filter-year-range">\n';
      dropdowns += `            <input type="number" class="filter-year-from" min="${years[0]}" max="${years[years.length - 1]}" placeholder="From" aria-label="Earliest year">\n`;
      dropdowns += `            <input type="number" class="filter-year-to" min="${years[0]}" max="${years[years.length - 1]}" placeholder="To" aria-label="Latest year">\n`;
      dropdowns += '          </div>\n';
      dropdowns += '        </div>\n';
      dropdowns += '      </div>\n';
    }

    if (dropdowns !== '') {
      filterBar = '    <div class="artwork-filter-bar">\n';
      filterBar += dropdowns;
      filterBar += '      <button type="button" class="filter-clear" hidden>\n';
      filterBar += '        <span class="lang-en">Clear filters</span><span class="lang-zh">清除筛选</span>\n';
      filterBar += '      </button>\n';
      filterBar += '    </div>\n';
    }
  }

  let artworkGrid = '';
  if (works.length === 0) {
    artworkGrid += '    <div class="artwork-empty-state">\n';
    artworkGrid += `      <span class="lang-en">${escapeHtml(galleryConfig.artworkEmptyState.en)}</span>\n`;
    artworkGrid += `      <span class="lang-zh">${escapeHtml(galleryConfig.artworkEmptyState.zh)}</span>\n`;
    artworkGrid += '    </div>\n';
  } else {
    artworkGrid += renderArtworkGrid(works);
    artworkGrid += '    <div class="artwork-no-matches" hidden>\n';
    artworkGrid += '      <span class="lang-en">No works match the selected filters.</span>\n';
    artworkGrid += '      <span class="lang-zh">没有符合所选筛选条件的作品。</span>\n';
    artworkGrid += '    </div>\n';
  }

  pages.push({
    fileName: `gallery-${page.slug}.html`,
    templateName: 'page-medium',
    // Every medium page is a child of the Artworks tab, so that tab stays the
    // highlighted one rather than no tab being highlighted at all.
    activeTab: 'gallery.html',
    tokens: {
      LANGUAGE_SWITCHER_NOTE: '',
      TITLE_EN: escapeHtml(page.titleEn),
      TITLE_ZH: escapeHtml(page.titleZh),
      TITLE_EN_EDIT_ATTR: ` data-edit-field="content/gallery.json|mediumPages|${escapeHtml(page.slug)}|titleEn"`,
      TITLE_ZH_EDIT_ATTR: ` data-edit-field="content/gallery.json|mediumPages|${escapeHtml(page.slug)}|titleZh"`,
      META_DESCRIPTION: escapeHtml(page.metaDescription),
      FILTER_BAR: filterBar,
      ARTWORK_GRID: artworkGrid,
    },
    // The heading renders this medium's own title, and the grid renders every
    // artwork of this medium, so each of those records must keep its pencils.
    editableRecords: [
      { file: 'content/gallery.json', collection: 'mediumPages', key: page.slug },
      ...works.map((artwork) => ({ file: 'content/artworks.json', collection: 'artworks', key: artwork.id })),
    ],
  });
}
for (const page of galleryConfig.sectionPages) {
  pages.push({
    fileName: `gallery-${page.slug}.html`,
    templateName: 'page-section',
    activeTab: `gallery-${page.slug}.html`,
    tokens: {
      LANGUAGE_SWITCHER_NOTE: '',
      TITLE_EN: escapeHtml(page.titleEn),
      TITLE_ZH: escapeHtml(page.titleZh),
      TITLE_EN_EDIT_ATTR: ` data-edit-field="content/gallery.json|sectionPages|${escapeHtml(page.slug)}|titleEn"`,
      TITLE_ZH_EDIT_ATTR: ` data-edit-field="content/gallery.json|sectionPages|${escapeHtml(page.slug)}|titleZh"`,
      META_DESCRIPTION: escapeHtml(page.metaDescription),
      BODY_EN: escapeHtml(page.bodyEn),
      BODY_ZH: escapeHtml(page.bodyZh),
      BODY_EN_EDIT_ATTR: ` data-edit-field="content/gallery.json|sectionPages|${escapeHtml(page.slug)}|bodyEn"`,
      BODY_ZH_EDIT_ATTR: ` data-edit-field="content/gallery.json|sectionPages|${escapeHtml(page.slug)}|bodyZh"`,
    },
    // A section page renders its own title and body copy in place.
    editableRecords: [{ file: 'content/gallery.json', collection: 'sectionPages', key: page.slug }],
  });
}

// The chili sauce page carries its own header and markup, so it is rendered
// from its own template with the home.json copy substituted in. It has no
// gallery nav tabs or language-switcher note placeholders of its own.
if (renderHome) {
  pages.push({
    fileName: 'index.html',
    templateName: 'page-home',
    activeTab: null,
    tokens: homeTokens,
    // Empty because content/home.json is deliberately outside EDITABLE_CONTENT
    // until the in-place pencil for this page ships: the page renders no
    // whitelisted record, so the reverse pencil guard has nothing to require.
    editableRecords: [],
  });
}

// The Collections page: a cover overview over one section per series. Its hero
// copy is site structure (not editable), while each series title and blurb and
// each artwork title render with pencils, so every one of those records is
// listed here for the reverse guard to confirm its attributes are present.
pages.push({
  fileName: 'gallery-collections.html',
  templateName: 'page-collections',
  activeTab: 'gallery-collections.html',
  tokens: {
    LANGUAGE_SWITCHER_NOTE: '',
    TITLE_EN: escapeHtml(collectionsPage.titleEn),
    TITLE_ZH: escapeHtml(collectionsPage.titleZh),
    META_DESCRIPTION: escapeHtml(collectionsPage.metaDescription),
    INTRO_EN: escapeHtml(collectionsPage.introEn),
    INTRO_ZH: escapeHtml(collectionsPage.introZh),
    COLLECTIONS_OVERVIEW: collectionsOverview,
    COLLECTIONS_SECTIONS: collectionsSections,
  },
  editableRecords: [
    ...galleryConfig.collections.map((collection) => ({
      file: 'content/gallery.json',
      collection: 'collections',
      key: collection.slug,
    })),
    ...galleryConfig.collections.flatMap((collection) =>
      worksByCollection.get(collection.slug).map((artwork) => ({
        file: 'content/artworks.json',
        collection: 'artworks',
        key: artwork.id,
      }))
    ),
  ],
});

// The New Arrivals page is a flat, ordered grid of the most recent works. The
// order is editorial, not derived: newArrivalsPage.artworkIds lists the works
// newest first by hand, so a work with no year can still be featured and the
// sequence never depends on every record carrying a year. Each id must name a
// real artwork, the same contract the hub image and collection membership use.
const newArrivalsPage = galleryConfig.newArrivalsPage;
if (
  !newArrivalsPage ||
  !newArrivalsPage.titleEn ||
  !newArrivalsPage.titleZh ||
  !newArrivalsPage.metaDescription ||
  !newArrivalsPage.introEn ||
  !newArrivalsPage.introZh
) {
  throw new Error('content/gallery.json: newArrivalsPage needs titleEn, titleZh, metaDescription, introEn and introZh');
}
if (!Array.isArray(newArrivalsPage.artworkIds) || newArrivalsPage.artworkIds.length === 0) {
  throw new Error('content/gallery.json: newArrivalsPage.artworkIds must be a non-empty array');
}
const newArrivalsWorks = newArrivalsPage.artworkIds.map((id) => {
  const artwork = artworkById.get(id);
  if (!artwork) {
    throw new Error(
      `content/gallery.json: newArrivalsPage.artworkIds names "${id}", which is not an artwork in content/artworks.json`
    );
  }
  return artwork;
});
pages.push({
  fileName: 'gallery-new-arrivals.html',
  templateName: 'page-new-arrivals',
  activeTab: 'gallery-new-arrivals.html',
  tokens: {
    LANGUAGE_SWITCHER_NOTE: '',
    TITLE_EN: escapeHtml(newArrivalsPage.titleEn),
    TITLE_ZH: escapeHtml(newArrivalsPage.titleZh),
    META_DESCRIPTION: escapeHtml(newArrivalsPage.metaDescription),
    INTRO_EN: escapeHtml(newArrivalsPage.introEn),
    INTRO_ZH: escapeHtml(newArrivalsPage.introZh),
    ARTWORK_GRID: renderArtworkGrid(newArrivalsWorks),
  },
  editableRecords: newArrivalsWorks.map((artwork) => ({
    file: 'content/artworks.json',
    collection: 'artworks',
    key: artwork.id,
  })),
});

// The Portfolio page is the whole catalogue in one place, grouped by medium in
// the same order the hub lists the media. A medium with no works is skipped
// rather than shown as an empty heading, so the page grows and shrinks with the
// catalogue on its own. Each medium heading renders its title with pencils, so
// the medium record is listed for the reverse guard just as the hub lists it.
const portfolioPage = galleryConfig.portfolioPage;
if (
  !portfolioPage ||
  !portfolioPage.titleEn ||
  !portfolioPage.titleZh ||
  !portfolioPage.metaDescription ||
  !portfolioPage.introEn ||
  !portfolioPage.introZh
) {
  throw new Error('content/gallery.json: portfolioPage needs titleEn, titleZh, metaDescription, introEn and introZh');
}
let portfolioSections = '';
const portfolioMediumPages = [];
const portfolioWorks = [];
for (const medium of galleryConfig.mediumPages) {
  const works = artworkCatalog.artworks.filter((artwork) => artwork.medium === medium.slug);
  if (works.length === 0) continue;
  portfolioMediumPages.push(medium);
  portfolioWorks.push(...works);
  portfolioSections += `      <section class="collection-section" id="portfolio-${escapeHtml(medium.slug)}">\n`;
  portfolioSections += '        <div class="collection-section-head">\n';
  portfolioSections += `          <h2 class="collection-section-title lang-en" data-edit-field="content/gallery.json|mediumPages|${escapeHtml(medium.slug)}|titleEn">${escapeHtml(medium.titleEn)}</h2>\n`;
  portfolioSections += `          <h2 class="collection-section-title lang-zh" data-edit-field="content/gallery.json|mediumPages|${escapeHtml(medium.slug)}|titleZh">${escapeHtml(medium.titleZh)}</h2>\n`;
  portfolioSections += `          <span class="collection-count-pill lang-en">${works.length} ${works.length === 1 ? 'work' : 'works'}</span>\n`;
  portfolioSections += `          <span class="collection-count-pill lang-zh">${works.length} 件作品</span>\n`;
  portfolioSections += '        </div>\n';
  portfolioSections += renderArtworkGrid(works);
  portfolioSections += '      </section>\n';
}
pages.push({
  fileName: 'gallery-portfolio.html',
  templateName: 'page-portfolio',
  activeTab: 'gallery-portfolio.html',
  tokens: {
    LANGUAGE_SWITCHER_NOTE: '',
    TITLE_EN: escapeHtml(portfolioPage.titleEn),
    TITLE_ZH: escapeHtml(portfolioPage.titleZh),
    META_DESCRIPTION: escapeHtml(portfolioPage.metaDescription),
    INTRO_EN: escapeHtml(portfolioPage.introEn),
    INTRO_ZH: escapeHtml(portfolioPage.introZh),
    PORTFOLIO_SECTIONS: portfolioSections,
  },
  editableRecords: [
    ...portfolioMediumPages.map((medium) => ({
      file: 'content/gallery.json',
      collection: 'mediumPages',
      key: medium.slug,
    })),
    ...portfolioWorks.map((artwork) => ({
      file: 'content/artworks.json',
      collection: 'artworks',
      key: artwork.id,
    })),
  ],
});

// The Artists page profiles the people behind the work. The catalogue has no
// per-work artist field because every work is by one artist, so each artist
// section shows the whole catalogue beneath the bio. The cover follows the hub
// image rule (no in-situ shot), and the bio is site prose rather than an
// in-place editable record, so the only pencils here are the artwork titles.
const artistsPage = galleryConfig.artistsPage;
if (
  !artistsPage ||
  !artistsPage.titleEn ||
  !artistsPage.titleZh ||
  !artistsPage.metaDescription ||
  !artistsPage.introEn ||
  !artistsPage.introZh
) {
  throw new Error('content/gallery.json: artistsPage needs titleEn, titleZh, metaDescription, introEn and introZh');
}
if (!Array.isArray(galleryConfig.artists) || galleryConfig.artists.length === 0) {
  throw new Error('content/gallery.json: artists must be a non-empty array');
}
const artistWorks = artworkCatalog.artworks;
let artistsSections = '';
for (const artist of galleryConfig.artists) {
  if (
    !artist.slug ||
    !artist.nameEn ||
    !artist.nameZh ||
    !Array.isArray(artist.bioEn) ||
    artist.bioEn.length === 0 ||
    !Array.isArray(artist.bioZh) ||
    artist.bioZh.length === 0 ||
    artist.bioEn.length !== artist.bioZh.length
  ) {
    throw new Error(
      `content/gallery.json: artist "${artist.slug ?? '(no slug)'}" needs slug, nameEn, nameZh and matching non-empty bioEn and bioZh arrays`
    );
  }
  const cover = resolveHubImage(artist.cover, `gallery.json artists "${artist.slug}" cover`);
  const coverArtwork = artworkById.get(artist.cover.artworkId);
  artistsSections += `      <section class="collection-section" id="artist-${escapeHtml(artist.slug)}">\n`;
  artistsSections += '        <div class="collection-section-head">\n';
  artistsSections += `          <h2 class="collection-section-title lang-en">${escapeHtml(artist.nameEn)}</h2>\n`;
  artistsSections += `          <h2 class="collection-section-title lang-zh">${escapeHtml(artist.nameZh)}</h2>\n`;
  artistsSections += `          <span class="collection-count-pill lang-en">${artistWorks.length} ${artistWorks.length === 1 ? 'work' : 'works'}</span>\n`;
  artistsSections += `          <span class="collection-count-pill lang-zh">${artistWorks.length} 件作品</span>\n`;
  artistsSections += '        </div>\n';
  artistsSections += '        <div class="medium-grid">\n';
  artistsSections += `          <a href="gallery-${escapeHtml(coverArtwork.medium)}.html" class="medium-card">\n`;
  artistsSections += `            <img class="medium-card-image" src="${escapeHtml(cover.src)}" alt="${escapeHtml(cover.altEn)}" width="${cover.width}" height="${cover.height}" loading="lazy" data-alt-en="${escapeHtml(cover.altEn)}" data-alt-zh="${escapeHtml(cover.altZh)}">\n`;
  artistsSections += `            <span class="medium-card-label lang-en">${escapeHtml(artist.nameEn)}</span>\n`;
  artistsSections += `            <span class="medium-card-label lang-zh">${escapeHtml(artist.nameZh)}</span>\n`;
  artistsSections += '          </a>\n';
  artistsSections += '        </div>\n';
  for (const [paragraphIndex, paragraphEn] of artist.bioEn.entries()) {
    artistsSections += `        <p class="collection-blurb lang-en">${escapeHtml(paragraphEn)}</p>\n`;
    artistsSections += `        <p class="collection-blurb lang-zh">${escapeHtml(artist.bioZh[paragraphIndex])}</p>\n`;
  }
  artistsSections += renderArtworkGrid(artistWorks);
  artistsSections += '      </section>\n';
}
pages.push({
  fileName: 'gallery-artists.html',
  templateName: 'page-artists',
  activeTab: 'gallery-artists.html',
  tokens: {
    LANGUAGE_SWITCHER_NOTE: '',
    TITLE_EN: escapeHtml(artistsPage.titleEn),
    TITLE_ZH: escapeHtml(artistsPage.titleZh),
    META_DESCRIPTION: escapeHtml(artistsPage.metaDescription),
    INTRO_EN: escapeHtml(artistsPage.introEn),
    INTRO_ZH: escapeHtml(artistsPage.introZh),
    ARTISTS_SECTIONS: artistsSections,
  },
  editableRecords: artistWorks.map((artwork) => ({
    file: 'content/artworks.json',
    collection: 'artworks',
    key: artwork.id,
  })),
});

// The search box used to carry its own hand-maintained copy of every page
// title. Generating the index from the same content that renders the pages
// means a new medium page or a new artwork becomes searchable without anybody
// remembering to edit a second list, and it puts real artwork titles into
// search results instead of page titles only.
const searchIndex = [
  ...galleryConfig.searchPages.map((entry) => ({ en: entry.en, zh: entry.zh, href: entry.href })),
  ...galleryConfig.navTabs
    .filter((tab) => !tab.href.includes('#'))
    .map((tab) => ({ en: tab.en, zh: tab.zh, href: tab.href })),
  ...galleryConfig.mediumPages.map((page) => ({
    en: page.titleEn,
    zh: page.titleZh,
    href: `gallery-${page.slug}.html`,
  })),
  ...artworkCatalog.artworks.map((artwork) => ({
    en: `${artwork.titleEn}, ${yearLabel(artwork).en}`,
    zh: `${artwork.titleZh}，${yearLabel(artwork).zh}`,
    href: `gallery-${artwork.medium}.html`,
  })),
];
const searchIndexSource =
  '// Generated by build.mjs from content/gallery.json and content/artworks.json.\n' +
  '// Do not edit by hand; run "npm run build".\n' +
  `window.GALLERY_SEARCH_INDEX = ${JSON.stringify(searchIndex, null, 2)};\n`;

// The browser overlay has to tell an editor "at most 200 characters" before
// they submit, which means it needs the same per-field limits the gate
// enforces. Generating that table from EDITABLE_CONTENT rather than retyping
// it in the client keeps one source of truth: change a limit in the gate and
// --check fails until this file is regenerated, so the friendly message can
// never quietly disagree with the rule that actually decides.
const editModeRulesSource =
  '// Generated by build.mjs from EDITABLE_CONTENT in scripts/content-patch.mjs.\n' +
  '// Do not edit by hand; run "npm run build".\n' +
  '//\n' +
  '// These limits exist to give the editor a fast, friendly message. They are a\n' +
  '// courtesy, not a control: scripts/content-patch.mjs re-validates every edit\n' +
  '// when the downloaded patch is applied, and that check is the one that counts.\n' +
  `window.GALLERY_EDIT_RULES = ${JSON.stringify(EDITABLE_CONTENT, null, 2)};\n`;

const drifted = [];
const searchIndexPath = path.join(workRoot, 'assets', 'js', 'gallery-search-index.js');
const editModeRulesPath = path.join(workRoot, 'assets', 'js', 'edit-mode-rules.js');
if (checkOnly) {
  if (readFileSync(searchIndexPath, 'utf8') !== searchIndexSource) drifted.push('assets/js/gallery-search-index.js');
  if (readFileSync(editModeRulesPath, 'utf8') !== editModeRulesSource) drifted.push('assets/js/edit-mode-rules.js');
} else {
  writeFileSync(searchIndexPath, searchIndexSource);
  writeFileSync(editModeRulesPath, editModeRulesSource);
}

for (const page of pages) {
  let rendered = readFileSync(path.join(repoRoot, 'templates', `${page.templateName}.html`), 'utf8');

  for (let pass = 0; rendered.includes('{{> '); pass += 1) {
    if (pass > 4) {
      throw new Error(`${page.fileName}: partial includes nested more than 5 deep, likely a cycle`);
    }
    rendered = rendered.replace(/\{\{> ([a-z0-9-]+)\}\}/g, (match, name) => {
      if (!partials.has(name)) {
        throw new Error(`${page.fileName}: template includes "${name}", which is not a file in templates/partials`);
      }
      return partials.get(name);
    });
  }

  let navTabs = '';
  for (const tab of galleryConfig.navTabs) {
    const activeClass = tab.href === page.activeTab ? ' class="active"' : '';
    navTabs += `      <li><a href="${escapeHtml(tab.href)}"${activeClass}>`;
    navTabs += `<span class="lang-en">${escapeHtml(tab.en)}</span>`;
    navTabs += `<span class="lang-zh">${escapeHtml(tab.zh)}</span></a></li>\n`;
  }
  rendered = rendered.replace('{{NAV_TABS}}\n', navTabs);

  // LANGUAGE_SWITCHER_NOTE sits on its own line, so an empty value has to take
  // the newline with it rather than leaving a blank line behind.
  rendered = rendered.replace('{{LANGUAGE_SWITCHER_NOTE}}\n', page.tokens.LANGUAGE_SWITCHER_NOTE);
  for (const [token, value] of Object.entries(page.tokens)) {
    if (token === 'LANGUAGE_SWITCHER_NOTE') continue;
    // A block token sits on its own line, so an empty value has to take that
    // line's newline with it rather than leaving a blank line behind.
    const blockValue = value === '' ? '' : value.endsWith('\n') ? value : `${value}\n`;
    rendered = rendered.replaceAll(`{{${token}}}\n`, blockValue);
    rendered = rendered.replaceAll(`{{${token}}}`, value);
  }

  const leftover = rendered.match(/\{\{[^}]+\}\}/);
  if (leftover) {
    throw new Error(`${page.fileName}: unsubstituted placeholder ${leftover[0]}`);
  }

  // Edit mode can only ever reach the addresses rendered into the page, so
  // this is the point where the whitelist stops being documentation and
  // becomes enforcement. An address that is malformed, names a field the gate
  // refuses, or points at a record that does not exist fails the build here
  // rather than becoming a pencil in the browser that cannot submit.
  const emitted = new Set();
  for (const match of rendered.matchAll(/data-edit-field="([^"]*)"/g)) {
    const address = match[1];
    const parts = address.split('|');
    if (parts.length !== 4 || parts.some((part) => part === '')) {
      throw new Error(
        `${page.fileName}: data-edit-field "${address}" is not a four-part file|collection|key|field address`
      );
    }
    if (!editableAddresses.has(address)) {
      throw new Error(
        `${page.fileName}: data-edit-field "${address}" is not an editable address; ` +
          'it names a field missing from EDITABLE_CONTENT in scripts/content-patch.mjs, or a record that does not exist'
      );
    }
    emitted.add(address);
  }

  // The forward loop above proves every pencil is legitimate; this loop proves
  // the reverse, per address rather than per collection.field. For each record
  // this page renders, every whitelisted field the record actually carries must
  // be rendered as a pencil here. Dropping the attribute from one page while
  // another page still emits the same collection.field would pass a coarser
  // check, but it is exactly the drift that hands an editor a page whose copy
  // looks editable in one place and is silently frozen in another. An optional
  // field a record leaves empty is a real absence, not drift, so it is expected
  // only when the record carries a value -- the dimensions fields no catalogue
  // record fills stay legitimately absent without a hand-kept exemption list.
  for (const { file, collection, key } of page.editableRecords) {
    const data = file === 'content/gallery.json' ? galleryConfig : artworkCatalog;
    const spec = EDITABLE_CONTENT[file][collection];
    const record = data[collection].find((item) => item[spec.keyField] === key);
    for (const [field, rule] of Object.entries(spec.fields)) {
      const value = record[field];
      const hasValue = value !== undefined && value !== null && value !== '';
      if (rule.optional && !hasValue) continue;
      const address = `${file}|${collection}|${key}|${field}`;
      if (!emitted.has(address)) {
        throw new Error(
          `${page.fileName}: ${file} ${collection} record "${key}" field "${field}" is whitelisted and ` +
            'renders on this page, but no data-edit-field pencil carries it; a change dropped the attribute here ' +
            'while another page may still cover the field. Restore the pencil or take the field out of ' +
            'EDITABLE_CONTENT in scripts/content-patch.mjs.'
        );
      }
    }
  }

  const outputPath = path.join(workRoot, page.fileName);
  if (checkOnly) {
    const onDisk = readFileSync(outputPath, 'utf8');
    if (onDisk !== rendered) drifted.push(page.fileName);
  } else {
    writeFileSync(outputPath, rendered);
  }
}

if (checkOnly) {
  if (drifted.length > 0) {
    console.error(`Gallery HTML has drifted from templates/ and content/: ${drifted.join(', ')}`);
    console.error('Run "npm run build" and commit the result.');
    process.exit(1);
  }
  console.log(`Checked ${pages.length} gallery pages: committed HTML matches templates and content.`);
} else {
  console.log(`Wrote ${pages.length} gallery pages from templates and content.`);
}
