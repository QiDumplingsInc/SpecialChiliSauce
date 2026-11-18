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

import { EDITABLE_CONTENT } from './scripts/content-patch.mjs';

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

const mediumSlugs = new Set(galleryConfig.mediumPages.map((page) => page.slug));
const seenArtworkIds = new Set();
for (const artwork of artworkCatalog.artworks) {
  for (const field of ['id', 'medium', 'titleEn', 'titleZh', 'image', 'imageWidth', 'imageHeight', 'altEn', 'altZh']) {
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
  if (!Number.isInteger(artwork.imageWidth) || artwork.imageWidth <= 0) {
    throw new Error(`content/artworks.json: artwork "${artwork.id}" imageWidth must be a positive integer`);
  }
  if (!Number.isInteger(artwork.imageHeight) || artwork.imageHeight <= 0) {
    throw new Error(`content/artworks.json: artwork "${artwork.id}" imageHeight must be a positive integer`);
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
const editableAddresses = new Set();
const contentByFile = {
  'content/gallery.json': galleryConfig,
  'content/artworks.json': artworkCatalog,
  'content/home.json': homeContent,
};
for (const [file, collections] of Object.entries(EDITABLE_CONTENT)) {
  const data = contentByFile[file];
  for (const [collection, spec] of Object.entries(collections)) {
    for (const record of data[collection] ?? []) {
      for (const field of Object.keys(spec.fields)) {
        editableAddresses.add(`${file}|${collection}|${record[spec.keyField]}|${field}`);
      }
    }
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
  mediumGrid += `        <a href="gallery-${page.slug}.html" class="medium-card">\n`;
  mediumGrid += '          <div class="medium-placeholder">\n';
  mediumGrid += '            <span class="lang-en">Image coming soon</span>\n';
  mediumGrid += '            <span class="lang-zh">图片即将上线</span>\n';
  mediumGrid += '          </div>\n';
  mediumGrid += `          <span class="medium-card-label lang-en" data-edit-field="content/gallery.json|mediumPages|${escapeHtml(page.slug)}|titleEn">${escapeHtml(page.titleEn)}</span>\n`;
  mediumGrid += `          <span class="medium-card-label lang-zh" data-edit-field="content/gallery.json|mediumPages|${escapeHtml(page.slug)}|titleZh">${escapeHtml(page.titleZh)}</span>\n`;
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
      artworkGrid += `          <img class="artwork-image" src="${escapeHtml(artwork.image)}"`;
      artworkGrid += ` alt="${escapeHtml(artwork.altEn)}"`;
      artworkGrid += ` width="${artwork.imageWidth}" height="${artwork.imageHeight}" loading="lazy"`;
      artworkGrid += ` data-alt-en="${escapeHtml(artwork.altEn)}" data-alt-zh="${escapeHtml(artwork.altZh)}">\n`;
      artworkGrid += '        </div>\n';
      artworkGrid += '        <div class="artwork-artist">KAY</div>\n';
      // The title is wrapped in its own span rather than composed with the
      // year into one string, so the element carrying the edit address holds
      // exactly the title that is on disk and nothing else. That is the whole
      // contract the browser overlay reads: textContent is the value.
      artworkGrid += `        <div class="artwork-title lang-en"><span data-edit-field="content/artworks.json|artworks|${escapeHtml(artwork.id)}|titleEn">${escapeHtml(artwork.titleEn)}</span>, ${escapeHtml(year.en)}</div>\n`;
      artworkGrid += `        <div class="artwork-title lang-zh"><span data-edit-field="content/artworks.json|artworks|${escapeHtml(artwork.id)}|titleZh">${escapeHtml(artwork.titleZh)}</span>，${escapeHtml(year.zh)}</div>\n`;
      if (artwork.dimensionsEn && artwork.dimensionsZh) {
        artworkGrid += `        <div class="artwork-dimensions lang-en" data-edit-field="content/artworks.json|artworks|${escapeHtml(artwork.id)}|dimensionsEn">${escapeHtml(artwork.dimensionsEn)}</div>\n`;
        artworkGrid += `        <div class="artwork-dimensions lang-zh" data-edit-field="content/artworks.json|artworks|${escapeHtml(artwork.id)}|dimensionsZh">${escapeHtml(artwork.dimensionsZh)}</div>\n`;
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
      TITLE_EN_EDIT_ATTR: ` data-edit-field="content/gallery.json|mediumPages|${escapeHtml(page.slug)}|titleEn"`,
      TITLE_ZH_EDIT_ATTR: ` data-edit-field="content/gallery.json|mediumPages|${escapeHtml(page.slug)}|titleZh"`,
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
      TITLE_EN_EDIT_ATTR: ` data-edit-field="content/gallery.json|sectionPages|${escapeHtml(page.slug)}|titleEn"`,
      TITLE_ZH_EDIT_ATTR: ` data-edit-field="content/gallery.json|sectionPages|${escapeHtml(page.slug)}|titleZh"`,
      META_DESCRIPTION: escapeHtml(page.metaDescription),
      BODY_EN: escapeHtml(page.bodyEn),
      BODY_ZH: escapeHtml(page.bodyZh),
      BODY_EN_EDIT_ATTR: ` data-edit-field="content/gallery.json|sectionPages|${escapeHtml(page.slug)}|bodyEn"`,
      BODY_ZH_EDIT_ATTR: ` data-edit-field="content/gallery.json|sectionPages|${escapeHtml(page.slug)}|bodyZh"`,
    },
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
