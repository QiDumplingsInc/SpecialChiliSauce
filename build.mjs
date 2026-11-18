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

const escapeHtml = (value) =>
  String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');

const galleryConfig = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'gallery.json'), 'utf8'));
const artworkCatalog = JSON.parse(readFileSync(path.join(repoRoot, 'content', 'artworks.json'), 'utf8'));

if (!Array.isArray(galleryConfig.navTabs) || galleryConfig.navTabs.length === 0) {
  throw new Error('content/gallery.json: navTabs must be a non-empty array');
}
if (!Array.isArray(galleryConfig.mediumPages) || galleryConfig.mediumPages.length === 0) {
  throw new Error('content/gallery.json: mediumPages must be a non-empty array');
}
if (!Array.isArray(galleryConfig.sectionPages)) {
  throw new Error('content/gallery.json: sectionPages must be an array');
}
if (!Array.isArray(artworkCatalog.artworks)) {
  throw new Error('content/artworks.json: artworks must be an array');
}

const mediumSlugs = new Set(galleryConfig.mediumPages.map((page) => page.slug));
const seenArtworkIds = new Set();
for (const artwork of artworkCatalog.artworks) {
  for (const field of ['id', 'medium', 'titleEn', 'titleZh', 'year', 'image', 'imageWidth', 'imageHeight', 'altEn', 'altZh']) {
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
  let artworkGrid = '    <div class="artwork-grid">\n';
  if (works.length === 0) {
    // No catalogued work for this medium yet, so show the placeholder card the
    // page has always shown. placeholderCardCount keeps the rendered output
    // identical to the hand-written HTML this build replaces.
    artworkGrid += partials.get('artwork-card-placeholder').repeat(galleryConfig.placeholderCardCount);
  } else {
    for (const artwork of works) {
      const colors = Array.isArray(artwork.colors) ? artwork.colors.join(' ') : '';
      artworkGrid += '      <div class="artwork-card"';
      artworkGrid += ` data-medium="${escapeHtml(artwork.medium)}"`;
      artworkGrid += ` data-year="${escapeHtml(artwork.year)}"`;
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
      artworkGrid += `        <div class="artwork-title lang-en">${escapeHtml(artwork.titleEn)}, ${escapeHtml(artwork.year)}</div>\n`;
      artworkGrid += `        <div class="artwork-title lang-zh">${escapeHtml(artwork.titleZh)}，${escapeHtml(artwork.year)}</div>\n`;
      if (artwork.dimensionsEn && artwork.dimensionsZh) {
        artworkGrid += `        <div class="artwork-dimensions lang-en">${escapeHtml(artwork.dimensionsEn)}</div>\n`;
        artworkGrid += `        <div class="artwork-dimensions lang-zh">${escapeHtml(artwork.dimensionsZh)}</div>\n`;
      }
      artworkGrid += '      </div>\n';
    }
  }
  artworkGrid += '    </div>\n';

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

const drifted = [];
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
    rendered = rendered.replaceAll(`{{${token}}}\n`, value.endsWith('\n') ? value : `${value}\n`);
    rendered = rendered.replaceAll(`{{${token}}}`, value);
  }

  const leftover = rendered.match(/\{\{[^}]+\}\}/);
  if (leftover) {
    throw new Error(`${page.fileName}: unsubstituted placeholder ${leftover[0]}`);
  }

  const outputPath = path.join(repoRoot, page.fileName);
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
