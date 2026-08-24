// Shared filter-bar interactivity for gallery.html category pages
// (gallery-<medium>.html). Not wired to real filtering logic yet
// since there's no real artwork catalog to filter — this only
// handles the dropdown open/close and checkmark toggle UI.

document.addEventListener('DOMContentLoaded', function () {
  function closeDropdown(dropdown) {
    // If focus is currently inside the panel being closed, move it
    // back to the toggle button first — otherwise closing the panel
    // (display: none) strands focus and the browser resets it to
    // <body>, disorienting keyboard/screen-reader users.
    if (dropdown.contains(document.activeElement)) {
      dropdown.querySelector('.filter-dropdown-toggle').focus();
    }
    dropdown.classList.remove('open');
    dropdown.querySelector('.filter-dropdown-toggle').setAttribute('aria-expanded', 'false');
  }

  function closeAllExcept(except) {
    document.querySelectorAll('.filter-dropdown.open').forEach((d) => {
      if (d !== except) closeDropdown(d);
    });
  }

  document.querySelectorAll('.filter-dropdown').forEach((dropdown) => {
    const toggle = dropdown.querySelector('.filter-dropdown-toggle');
    toggle.addEventListener('click', () => {
      const isOpen = dropdown.classList.contains('open');
      closeAllExcept(dropdown);
      if (isOpen) {
        closeDropdown(dropdown);
      } else {
        dropdown.classList.add('open');
        toggle.setAttribute('aria-expanded', 'true');
      }
    });
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.filter-dropdown')) {
      closeAllExcept(null);
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeAllExcept(null);
    }
  });

  // Toggle a filter option's selected state (multi-select checklist,
  // not wired to real filtering logic yet).
  document.querySelectorAll('.filter-option').forEach((option) => {
    option.addEventListener('click', () => {
      const nowSelected = !option.classList.contains('selected');
      option.classList.toggle('selected', nowSelected);
      option.setAttribute('aria-checked', String(nowSelected));
    });
  });
});
