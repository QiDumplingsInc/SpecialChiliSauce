// build.mjs -- renders every gallery*.html page at the repo root from the
// templates in templates/ and the data in content/.
//
// Input:  content/gallery.json   (nav tabs, medium pages, section pages)
//         content/artworks.json  (the artwork catalog, display only)
//         templates/page-*.html  (one template per page shape)
//         templates/partials/*   (header, footers, filter bar, placeholder card)
// Output: gallery.html plus gallery-<slug>.html at the repo root, written in
//         place so GitHub Pages keeps serving the committed HTML with no
//         build step at deploy time.
//
// Process: load the data, resolve every {{> partial}} include, substitute the
// {{TOKEN}} placeholders, then either write each file or, with --check,
// compare the rendered bytes against what is on disk and exit non-zero on any
// difference. --check is what CI and the test suite use to prove the committed
// HTML has not drifted away from the templates.
//
// Run: node build.mjs          (write)
//      node build.mjs --check  (verify, no writes)

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path, { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
  mediumGrid += `        <a href="gallery-${page.slug}.html" class="medium-card">\n`;
  mediumGrid += '          <div class="medium-placeholder">\n';
  mediumGrid += '            <span class="lang-en">Image coming soon</span>\n';
  mediumGrid += '            <span class="lang-zh">图片即将上线</span>\n';
  mediumGrid += '          </div>\n';
  mediumGrid += `          <span class="medium-card-label lang-en">${escapeHtml(page.titleEn)}</span>\n`;
  mediumGrid += `          <span class="medium-card-label lang-zh">${escapeHtml(page.titleZh)}</span>\n`;
  mediumGrid += '        </a>\n';
}
mediumGrid += '      </div>\n';

const pages = [];
pages.push({
  fileName: 'gallery.html',
  templateName: 'page-gallery',
  activeTab: 'gallery.html',
  tokens: { LANGUAGE_SWITCHER_NOTE: languageSwitcherNote, MEDIUM_GRID: mediumGrid },
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
    artworkGrid += '    <div class="artwork-grid">\n';
    for (const artwork of works) {
      const colors = Array.isArray(artwork.colors) ? artwork.colors.join(' ') : '';
      const year = yearLabel(artwork);
      artworkGrid += '      <div class="artwork-card"';
      artworkGrid += ` data-medium="${escapeHtml(artwork.medium)}"`;
      artworkGrid += ` data-year="${escapeHtml(artwork.year ?? '')}"`;
      artworkGrid += ` data-size="${escapeHtml(artwork.sizeRange ?? '')}"`;
      artworkGrid += ` data-colors="${escapeHtml(colors)}"`;
      artworkGrid += ` data-style="${escapeHtml(artwork.style ?? '')}"`;
      artworkGrid += ` data-title-en="${escapeHtml(artwork.titleEn)}"`;
      artworkGrid += ` data-title-zh="${escapeHtml(artwork.titleZh)}"`;
      artworkGrid += '>\n';
      artworkGrid += '        <div class="artwork-image-wrap">\n';
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
        artworkGrid += `          <div class="artwork-carousel" role="group" aria-roledescription="carousel" data-slide-count="${slides.length}"`;
        artworkGrid += ` style="aspect-ratio: ${slides[0].width} / ${slides[0].height}" tabindex="0">\n`;
      }
      const slideIndent = slides.length > 1 ? '            ' : '          ';
      for (const [slideIndex, image] of slides.entries()) {
        if (slides.length > 1) {
          artworkGrid += `${slideIndent}<div class="artwork-slide" data-slide="${slideIndex}">\n`;
        }
        const imageIndent = slides.length > 1 ? `${slideIndent}  ` : slideIndent;
        artworkGrid += `${imageIndent}<img class="artwork-image" src="${escapeHtml(image.src)}"`;
        artworkGrid += ` alt="${escapeHtml(image.altEn)}"`;
        artworkGrid += ` width="${image.width}" height="${image.height}" loading="lazy"`;
        artworkGrid += ` data-view="${escapeHtml(image.view)}"`;
        artworkGrid += ` data-alt-en="${escapeHtml(image.altEn)}" data-alt-zh="${escapeHtml(image.altZh)}">\n`;
        if (slides.length > 1) {
          artworkGrid += `${slideIndent}</div>\n`;
        }
      }
      if (slides.length > 1) {
        artworkGrid += '          </div>\n';
        for (const direction of ['prev', 'next']) {
          const glyph = direction === 'prev' ? '&#8249;' : '&#8250;';
          const labelEn = direction === 'prev' ? 'Previous view' : 'Next view';
          const labelZh = direction === 'prev' ? '上一张' : '下一张';
          artworkGrid += `          <button type="button" class="artwork-carousel-nav artwork-carousel-${direction}" hidden>\n`;
          artworkGrid += `            <span aria-hidden="true">${glyph}</span>\n`;
          artworkGrid += `            <span class="visually-hidden lang-en">${labelEn}</span>\n`;
          artworkGrid += `            <span class="visually-hidden lang-zh">${labelZh}</span>\n`;
          artworkGrid += '          </button>\n';
        }
        artworkGrid += '          <div class="artwork-carousel-dots" hidden>\n';
        for (const slideIndex of slides.keys()) {
          artworkGrid += `            <button type="button" class="artwork-carousel-dot" data-slide="${slideIndex}"`;
          artworkGrid += slideIndex === 0 ? ' aria-current="true">\n' : '>\n';
          artworkGrid += `              <span class="visually-hidden lang-en">View ${slideIndex + 1}</span>\n`;
          artworkGrid += `              <span class="visually-hidden lang-zh">第 ${slideIndex + 1} 张</span>\n`;
          artworkGrid += '            </button>\n';
        }
        artworkGrid += '          </div>\n';
      }
      artworkGrid += '        </div>\n';
      artworkGrid += '        <div class="artwork-artist">KAY</div>\n';
      artworkGrid += `        <div class="artwork-title lang-en">${escapeHtml(artwork.titleEn)}, ${escapeHtml(year.en)}</div>\n`;
      artworkGrid += `        <div class="artwork-title lang-zh">${escapeHtml(artwork.titleZh)}，${escapeHtml(year.zh)}</div>\n`;
      if (artwork.dimensionsEn && artwork.dimensionsZh) {
        artworkGrid += `        <div class="artwork-dimensions lang-en">${escapeHtml(artwork.dimensionsEn)}</div>\n`;
        artworkGrid += `        <div class="artwork-dimensions lang-zh">${escapeHtml(artwork.dimensionsZh)}</div>\n`;
      }
      artworkGrid += '      </div>\n';
    }
    artworkGrid += '    </div>\n';
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
      META_DESCRIPTION: escapeHtml(page.metaDescription),
      FILTER_BAR: filterBar,
      ARTWORK_GRID: artworkGrid,
    },
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
      META_DESCRIPTION: escapeHtml(page.metaDescription),
      BODY_EN: escapeHtml(page.bodyEn),
      BODY_ZH: escapeHtml(page.bodyZh),
    },
  });
}

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

const drifted = [];
const searchIndexPath = path.join(workRoot, 'assets', 'js', 'gallery-search-index.js');
if (checkOnly) {
  if (readFileSync(searchIndexPath, 'utf8') !== searchIndexSource) drifted.push('assets/js/gallery-search-index.js');
} else {
  writeFileSync(searchIndexPath, searchIndexSource);
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
