// Shared bilingual EN/ZH toggle for home.html and gallery.html.
// index.html keeps its own copy inline (it has page-specific bits,
// like syncing newsletter field placeholders, that don't apply here).
document.addEventListener('DOMContentLoaded', function () {
  const langButtons = document.querySelectorAll('.lang-btn');
  const body = document.body;

  const savedLang = localStorage.getItem('preferredLanguage') || 'en';
  setLanguage(savedLang);

  langButtons.forEach((button) => {
    button.addEventListener('click', function () {
      const lang = this.getAttribute('data-lang');
      setLanguage(lang);
      localStorage.setItem('preferredLanguage', lang);
    });
  });

  function setLanguage(lang) {
    langButtons.forEach((btn) => btn.classList.remove('active'));

    const activeButton = document.querySelector(`.lang-btn[data-lang="${lang}"]`);
    if (activeButton) {
      activeButton.classList.add('active');
    }

    document.documentElement.setAttribute('lang', lang === 'zh' ? 'zh' : 'en');

    if (lang === 'zh') {
      body.classList.add('chinese');
    } else {
      body.classList.remove('chinese');
    }
  }
});
