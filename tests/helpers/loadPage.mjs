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
  const dom = new JSDOM(html, {
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
