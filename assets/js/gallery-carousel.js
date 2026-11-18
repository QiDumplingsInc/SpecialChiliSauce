// Artwork carousel for the medium pages.
//
// What it does: turns each multi-photograph artwork card into a browsable
// carousel. A work can carry a face-on photograph, the work where it hangs, and
// close details; this moves between them.
//
// Input: the markup build.mjs renders -- an .artwork-carousel scroll strip of
// .artwork-slide children, a hidden previous/next button pair, and a hidden row
// of .artwork-carousel-dot buttons.
//
// Output: nothing returned. The buttons and dots are unhidden and wired up, and
// the strip scrolls to the selected slide.
//
// How: the strip is a CSS scroll-snap row, so touch and trackpad swiping work
// before this script runs at all. The script holds the selected index per
// carousel, scrolls the strip when that index changes, reads the index back out
// of scrollLeft when the reader swipes instead of clicking, and moves the index
// on a left/right arrow key while the strip has focus. Both arrows wrap around,
// so no control is ever a dead end that needs disabling.
document.addEventListener('DOMContentLoaded', function () {
  document.querySelectorAll('.artwork-carousel').forEach((carousel) => {
    const slides = [...carousel.querySelectorAll('.artwork-slide')];
    if (slides.length < 2) return;

    const wrap = carousel.closest('.artwork-image-wrap');
    const previous = wrap.querySelector('.artwork-carousel-prev');
    const next = wrap.querySelector('.artwork-carousel-next');
    const dots = [...wrap.querySelectorAll('.artwork-carousel-dot')];
    let index = 0;

    [previous, next, wrap.querySelector('.artwork-carousel-dots')].forEach((control) => {
      if (control) control.hidden = false;
    });

    function showSlide(target, scroll) {
      index = (target + slides.length) % slides.length;
      dots.forEach((dot, dotIndex) => {
        if (dotIndex === index) dot.setAttribute('aria-current', 'true');
        else dot.removeAttribute('aria-current');
      });
      // scrollTo is guarded because a non-layout environment (the test suite's
      // jsdom) does not implement it; the selected index still has to track.
      if (scroll && typeof carousel.scrollTo === 'function') {
        carousel.scrollTo({ left: index * carousel.clientWidth, behavior: 'smooth' });
      }
    }

    if (previous) previous.addEventListener('click', () => showSlide(index - 1, true));
    if (next) next.addEventListener('click', () => showSlide(index + 1, true));
    dots.forEach((dot) => {
      dot.addEventListener('click', () => showSlide(Number(dot.dataset.slide), true));
    });

    carousel.addEventListener('keydown', (event) => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      showSlide(event.key === 'ArrowLeft' ? index - 1 : index + 1, true);
    });

    // A reader who swipes moves the strip without touching a control, so the
    // dots follow the scroll position rather than only the last click.
    let pending = false;
    carousel.addEventListener('scroll', () => {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => {
        pending = false;
        if (carousel.clientWidth === 0) return;
        showSlide(Math.round(carousel.scrollLeft / carousel.clientWidth), false);
      });
    });
  });
});
