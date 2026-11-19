// Site search for gallery pages. Static site, no backend — this searches
// assets/js/gallery-search-index.js, which build.mjs generates from
// content/gallery.json and content/artworks.json. It matches page titles and
// artwork titles (bilingual) and links to them. Not a full-text search of page
// content.

document.addEventListener('DOMContentLoaded', function () {
  const searchRoot = document.querySelector('.gallery-search');
  if (!searchRoot) return;

  const toggle = searchRoot.querySelector('.gallery-search-toggle');
  const input = searchRoot.querySelector('.gallery-search-input');
  const results = searchRoot.querySelector('.gallery-search-results');
  const form = searchRoot.querySelector('.gallery-search-form');
  if (!toggle || !input || !results || !form) return;

  const PAGES = Array.isArray(window.GALLERY_SEARCH_INDEX) ? window.GALLERY_SEARCH_INDEX : [];
  if (PAGES.length === 0) {
    // The generated index failed to load. Say so rather than silently
    // presenting a search box that can never return a result.
    console.error('gallery-search: assets/js/gallery-search-index.js did not load; search is unavailable.');
    toggle.hidden = true;
    return;
  }

  function isZh() {
    return document.body.classList.contains('chinese');
  }

  function syncLanguage() {
    const zh = isZh();
    const placeholder = zh ? input.dataset.placeholderZh : input.dataset.placeholderEn;
    input.placeholder = placeholder;
    input.setAttribute('aria-label', placeholder);
    toggle.setAttribute('aria-label', zh ? toggle.dataset.labelZh : toggle.dataset.labelEn);
  }
  syncLanguage();
  document.querySelectorAll('.lang-btn').forEach((btn) => btn.addEventListener('click', syncLanguage));

  function openSearch() {
    searchRoot.classList.add('open');
    toggle.setAttribute('aria-expanded', 'true');
    input.focus();
  }

  function closeSearch() {
    searchRoot.classList.remove('open');
    toggle.setAttribute('aria-expanded', 'false');
    results.classList.remove('visible');
    input.value = '';
  }

  toggle.addEventListener('click', () => {
    if (searchRoot.classList.contains('open')) {
      closeSearch();
    } else {
      openSearch();
    }
  });

  document.addEventListener('click', (e) => {
    if (!searchRoot.contains(e.target)) closeSearch();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && searchRoot.classList.contains('open')) {
      closeSearch();
      toggle.focus();
    }
  });

  function renderResults(query) {
    const q = query.trim().toLowerCase();
    results.replaceChildren();
    if (!q) {
      results.classList.remove('visible');
      return;
    }

    const matches = PAGES.filter(
      (p) => p.en.toLowerCase().includes(q) || p.zh.includes(q)
    );

    if (matches.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'gallery-search-empty';
      empty.textContent = isZh() ? '未找到匹配页面' : 'No matching pages';
      results.appendChild(empty);
    } else {
      matches.forEach((p) => {
        const link = document.createElement('a');
        link.href = p.href;
        link.textContent = isZh() ? p.zh : p.en;
        results.appendChild(link);
      });
    }
    results.classList.add('visible');
  }

  input.addEventListener('input', () => renderResults(input.value));

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim().toLowerCase();
    if (!q) return;
    const match = PAGES.find(
      (p) => p.en.toLowerCase().includes(q) || p.zh.includes(q)
    );
    if (match) window.location.href = match.href;
  });
});
