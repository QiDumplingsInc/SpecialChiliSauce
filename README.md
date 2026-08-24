# my_store

https://qidumplingsinc.github.io/SpecialChiliSauce/

## Testing

Behavioral tests for interactive JS (e.g. the newsletter signup forms and gallery search) run against the real `index.html` and `gallery.html` via jsdom, with network calls mocked.

```
npm install
npm test
```

## Newsletter signups

Both `index.html` and `gallery.html` post to the same Google Apps Script Web App endpoint, which writes each submission as a row in a Google Sheet. A hidden `source` field (`chili-sauce` or `gallery`) tells the two pages' signups apart in the Sheet.

## Gallery search

The gallery pages include a client-side search box (`assets/js/gallery-search.js`) over a small hardcoded list of page titles — not a full-text search of page content.
