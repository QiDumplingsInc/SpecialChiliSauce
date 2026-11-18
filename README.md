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
