// Site search for gallery pages. Static site, no backend — this
// searches a small hardcoded index of known page titles (bilingual)
// and links to them. Not a full-text search of page content.

document.addEventListener('DOMContentLoaded', function () {
  const searchRoot = document.querySelector('.gallery-search');
  if (!searchRoot) return;

  const toggle = searchRoot.querySelector('.gallery-search-toggle');
  const input = searchRoot.querySelector('.gallery-search-input');
  const results = searchRoot.querySelector('.gallery-search-results');
  const form = searchRoot.querySelector('.gallery-search-form');
  if (!toggle || !input || !results || !form) return;

  const PAGES = [
    { en: 'Special Chili Sauce', zh: '特制辣椒酱', href: 'index.html' },
    { en: 'Home', zh: '首页', href: 'home.html' },
    { en: 'New Arrivals', zh: '新品上架', href: 'gallery-new-arrivals.html' },
    { en: 'Portfolio', zh: '作品集', href: 'gallery-portfolio.html' },
    { en: 'Artists', zh: '艺术家', href: 'gallery-artists.html' },
    { en: 'Artworks', zh: '作品', href: 'gallery.html' },
    { en: 'Exhibitions', zh: '展览', href: 'gallery-exhibitions.html' },
    { en: 'Collections', zh: '系列', href: 'gallery-collections.html' },
    { en: 'Painting', zh: '绘画', href: 'gallery-painting.html' },
    { en: 'Drawing', zh: '素描', href: 'gallery-drawing.html' },
    { en: 'Mixed Media', zh: '综合材料', href: 'gallery-mixed-media.html' },
    { en: 'Photography', zh: '摄影', href: 'gallery-photography.html' },
    { en: 'Printmaking', zh: '版画', href: 'gallery-printmaking.html' },
    { en: 'Sculpture', zh: '雕塑', href: 'gallery-sculpture.html' },
    { en: 'Work on Paper', zh: '纸本作品', href: 'gallery-work-on-paper.html' },
  ];

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
