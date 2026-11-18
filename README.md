# my_store

https://qidumplingsinc.github.io/SpecialChiliSauce/

## Gallery build

Every `gallery*.html` page at the repo root is generated. Do not hand-edit them. Edit the data or the templates and rerun the build:

- `content/gallery.json` -- nav tabs, the medium pages, the section pages
- `content/artworks.json` -- the artwork catalog (display only; no price, no purchase path)
- `templates/page-*.html` -- one template per page shape
- `templates/partials/` -- the header, nav tabs, footers, filter bar and placeholder card, each defined once

```
npm run build          # rewrite the 13 gallery pages
npm run build:check    # fail if the committed HTML has drifted from templates/content
```

The rendered HTML stays committed so GitHub Pages serves the site with no build step at deploy time. `npm test` runs `build:check`, so drift fails the test suite.

## Adding artwork

Artwork images go in `assets/gallery/`, one web-ready file per work, each referenced by an entry in `content/artworks.json`. Original files are not committed. `assets/gallery/README.md` has the filename rules, the `sips` resize and dimension commands, and the metadata needed per work.

## Testing

Behavioral tests for interactive JS (e.g. the newsletter signup forms and gallery search) run against the real `index.html` and `gallery.html` via jsdom, with network calls mocked.

```
npm install
npm test
```

## Newsletter signups

Both `index.html` and `gallery.html` post to the same Google Apps Script Web App endpoint, which writes each submission as a row in a Google Sheet. A hidden `source` field (`chili-sauce` or `gallery`) tells the two pages' signups apart in the Sheet.

Artwork in the gallery is display only. There is no price, no wishlist and no purchase path, so do not reintroduce one without changing this line first.

## Gallery search

The gallery pages include a client-side search box (`assets/js/gallery-search.js`) over `assets/js/gallery-search-index.js`, which the build generates from `content/gallery.json` and `content/artworks.json`. It matches page titles and artwork titles, not full page text.

## Admin edit mode: editing in the browser

The way in is `edit.html` -- <https://qidumplingsinc.github.io/SpecialChiliSauce/edit.html>. Bookmark it. It has one button, **Turn on edit mode**, which puts you on the gallery with the mode on. The mode stays on while you move between gallery pages, and turns off from the **Exit edit mode** button in the toolbar or from `edit.html` again. Adding `?edit=1` to any gallery URL by hand still works and is what `edit.html` falls back to when a browser refuses site storage.

Edit mode is a mode toggle, not a login. There is no password and none is needed: the site is static with no server, edit mode changes nothing on the live site, and its only output is a file you download. A password checked in browser JavaScript would protect nothing while implying it did, so `edit.html` has no field to type into and says plainly that it is not a sign-in. `edit.html` is not linked from the public site -- not as a boundary, since it is none, but so the gallery does not advertise an admin screen that locks nothing.

How an editor uses it:

1. Click any text with a pencil beside it. That text becomes editable in place on the real page, so you see the result in context.
2. Press Enter to keep the change or Escape to cancel. A value the gate would refuse is refused here too, with a message, and the text is put back the way it was.
3. Click **Review changes** to see every pending change as the old value next to the new one, and discard any single one.
4. Click **Download edit-patch.json** and send that file to whoever maintains the repository.

What is editable: the English and Chinese titles of a medium page, the titles and body copy of a section page, and the titles and dimensions of an artwork. Alt text, meta descriptions and the year are in the gate's whitelist but are not inline-editable yet, because none of them renders as visible text on the page.

Editing copy on a medium or section page applies today, as does artwork wording: both `content/gallery.json` and `content/artworks.json` round-trip through the gate's formatter, and the build fails if either stops doing so.

Implementation notes:

- `edit.html` is hand-written and is the only HTML at the repo root that edit mode owns; the `gallery*.html` pages are generated. It links to `gallery.html?edit=1` in the markup, so the front door works with no JavaScript at all, and its script replaces that with a clean `gallery.html` once it has confirmed the browser will hold the `sessionStorage` flag that carries the mode between pages. Turning the mode off there leaves unsubmitted edits alone, the same promise the toolbar's **Exit edit mode** button makes.
- `build.mjs` emits `data-edit-field="file|collection|key|field"` on every editable element, using the same address string the gate uses internally. The contract the overlay depends on is that such an element's `textContent` is exactly the raw value on disk, which is why an artwork title is rendered in its own span instead of being composed with the year. The build fails if any emitted address is malformed or names something the gate would refuse, so the whitelist is enforced rather than documented.
- `assets/js/edit-mode-rules.js` is generated from `EDITABLE_CONTENT`, so the length limits the browser reports cannot drift from the ones the gate enforces. `npm run build:check` fails if it has.
- `assets/js/edit-mode.js` and `assets/css/edit-mode.css` load only when edit mode is asked for, so an ordinary page view costs one conditional and no extra requests.
- The overlay makes no network call and holds nothing durable. Pending edits live in `sessionStorage` so one patch can span several pages.

## Admin edit mode: the content patch gate

`scripts/content-patch.mjs` is the only write path from the browser admin edit mode into this repository. The browser never patches HTML and never touches git: it collects an editor's wording changes into a patch document and submits it to this module, which validates the patch and writes `content/*.json`. The gallery build then regenerates the HTML, so a one-word edit in the browser lands as a one-line JSON diff in a pull request.

The gate fails closed and is all or nothing. One bad edit rejects the whole submission and writes nothing.

- `EDITABLE_CONTENT` in that file is the complete whitelist of what an editor can reach: titles, alt text, dimensions and year on an artwork, plus titles, meta descriptions and body copy on a gallery page. Ids, slugs, image paths, pixel dimensions and facet values are deliberately absent, so edit mode can change wording but cannot break a page or re-point an image.
- Records can only be updated, never created or deleted.
- Values must be single-line plain text within a per-field length limit, with no control characters and no `<` or `>`.
- A content file is refused unless it round-trips through `JSON.stringify(data, null, 4)` byte for byte. Both content files do today, and `build.mjs` fails if either drifts, because a file the gate cannot reproduce exactly would be reformatted end to end and bury the real edit.

`applyContentPatch(patch, { contentRoot, dryRun })` returns `{ ok, errors, changed, files, summary }`. Call it with `dryRun` to show an editor a review screen before they submit; `changed: false` means every edit already matched what is on disk, so no pull request should be opened. `tests/content-patch.test.mjs` covers the whitelist and every rejection case and runs as part of `npm test`.
