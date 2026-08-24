import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..', '..');

// Loads a real page (index.html by default) into jsdom and runs its
// actual inline <script>, so tests exercise the site's real logic
// rather than a reimplementation of it. Waits for 'load' so setup
// that runs inside the DOMContentLoaded handler (e.g. initial
// language sync) has settled.
export async function loadPage(filename = 'index.html') {
  const html = readFileSync(path.join(repoRoot, filename), 'utf-8');
  // jsdom does not fetch external <script src> without resources:
  // 'usable' (which would try real network/file resolution against
  // the fake page URL below). Inline local same-origin scripts here
  // instead, so they run exactly like inline scripts do and are
  // covered by tests rather than silently skipped.
  const inlinedHtml = html.replace(
    /<script src="([^"]+)"><\/script>/g,
    (match, src) => {
      if (/^https?:\/\//.test(src)) return match;
      const scriptContent = readFileSync(path.join(repoRoot, src), 'utf-8');
      return `<script>${scriptContent}</script>`;
    }
  );
  const dom = new JSDOM(inlinedHtml, {
    url: 'https://qidumplingsinc.github.io/SpecialChiliSauce/',
    runScripts: 'dangerously',
    // jsdom has no IntersectionObserver implementation. The page's own
    // script constructs one at top level (for fade-in animations); an
    // unhandled ReferenceError there would abort every statement after
    // it in the same <script> block, including the newsletter form's
    // event listener registration. Stub it so the rest of the script
    // (unrelated to fade-in visuals) still runs.
    beforeParse(window) {
      window.IntersectionObserver = class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
      // jsdom's Performance object has no legacy `.timing` (Navigation
      // Timing L1) property; the page's load-time logger reads it on
      // window 'load'. Stub it so that unrelated feature doesn't throw.
      window.performance.timing = { navigationStart: 0, loadEventEnd: 0 };
      // jsdom has no window.matchMedia. gallery.html's hero carousel
      // reads prefers-reduced-motion on init; an unhandled TypeError
      // there would abort the rest of that <script> block. Stub it to
      // report "no preference" so the carousel initializes normally.
      window.matchMedia = () => ({
        matches: false,
        addEventListener() {},
        removeEventListener() {},
      });
    },
  });

  await new Promise((resolve) => {
    if (dom.window.document.readyState === 'complete') {
      resolve();
    } else {
      dom.window.addEventListener('load', resolve);
    }
  });

  return dom;
}
