# my_store

https://qidumplingsinc.github.io/SpecialChiliSauce/

## Gallery build

Every `gallery*.html` page at the repo root is generated. Do not hand-edit them. Edit the data or the templates and rerun the build:

- `content/gallery.json` -- nav tabs, the medium pages, the section pages, the browse pages, the collections, the hang scenes behind Exhibitions, the filter facets
- `content/artworks.json` -- the artwork catalog (display only; no price, no purchase path)
- `templates/page-*.html` -- one template per page shape
- `templates/partials/` -- the header, nav tabs, footers and the edit-mode bootstrap, each defined once

```
npm run build          # rewrite the 16 gallery pages
npm run build:check    # fail if the committed HTML has drifted from templates/content
```

The rendered HTML stays committed so GitHub Pages serves the site with no build step at deploy time. `npm test` runs `build:check`, so drift fails the test suite.

### The artwork model

One work is one entry in `content/artworks.json`. Every field on it either drives a page or answers a question a buyer asks, and the build refuses the entry if a required one is missing:

- `medium` is the technique and must match a `mediumPages` slug. `support` is the thing the work is made on -- `paper`, `canvas` or `panel`. They are separate facts, which is how the one drawing appears under both Drawing and Work on Paper from a single entry: a medium page may carry `select: { field, value }` to gather its works on a field other than `medium`.
- `subject`, `colors` and `style` drive the filter bar. `collections` places the work in a series on the Collections page. `year` is optional, because the catalogue records an undated work as undated rather than inventing a plausible year; those render as `n.d.`.
- `dimensionsEn` / `dimensionsZh` are optional and appear wherever the work is listed once they are filled in.

Two rules keep the data and the pages honest, and both are build failures rather than review notes:

- **A facet may only declare a value some work carries.** The size facet shipped with four options that no work had, so every chip on the Painting page returned an empty result. A filter that can only ever match nothing is worse than no filter, so the facet came out and this rule keeps it out until real measurements exist. Each artwork card carries one `data-<facet key>` attribute per declared facet, generated from the same list, so a facet cannot leave a dead attribute behind or render a chip the cards do not answer.
- **Every in-situ photograph belongs to exactly one Exhibitions hang scene.** A scene in `gallery.json` `exhibitions` names its photographs and the works visible in it are derived from those photographs, so tagging a work with an in-situ image is the only step needed to place it. A scene photograph must be an in-situ view, which is the opposite of the rule for a hub or cover slot: those crop a photograph to a fixed shape, and a hang record must keep the framing it was taken with.

A medium with no works at all carries `emptyBodyEn` / `emptyBodyZh` -- a written page saying what the medium would mean here and what is true today -- plus the shared commission enquiry copy in `unrepresentedMedium`. That is the alternative to one grey line of empty state, which reads as an unfinished site rather than an honest one.

## Adding artwork

Artwork images go in `assets/gallery/`, one web-ready file per work, each referenced by an entry in `content/artworks.json`. Original files are not committed. `assets/gallery/README.md` has the filename rules, the `sips` resize and dimension commands, and the metadata needed per work.

## Testing

Behavioral tests for interactive JS (e.g. the newsletter signup forms and gallery search) run against the real `index.html` and `gallery.html` via jsdom, with network calls mocked.

```
npm install
npm test
```

`.npmrc` pins the registry to `https://registry.npmjs.org/` so the committed `package-lock.json` records tarball URLs that CI can reach. An `NPM_CONFIG_REGISTRY` environment variable overrides `.npmrc`, so if your shell sets one to an internal mirror, unset it before you run `npm install` or the regenerated lockfile will pin hosts the GitHub Actions runner cannot resolve.

## Commit hooks

This repository tracks hooks in `.githooks/`:

- `commit-msg` rejects any `Co-Authored-By:` trailer, as required by the commit-attribution standard in the `CLAUDE.md` one directory above this repository's checkout.
- `pre-commit` rejects a staged `package-lock.json` (repo root or nested) whose `resolved` URLs point at a non-public registry host, to stop an internal mirror leaking into this public repository.

Git does not read tracked hooks automatically, so a fresh clone needs this one-time command to activate them:

```
git config core.hooksPath .githooks
```

Repo-local config overrides the global hooks path, and all worktrees of a clone share `.git/config`, so one setting covers every worktree. Until you run that command the hooks are inert: the `pre-commit` lockfile guard is active only after `git config core.hooksPath .githooks`. Verify the hooks with:

```
sh .githooks/commit-msg-test.sh
sh .githooks/pre-commit-test.sh
```

### What the guard does not cover

Setting `core.hooksPath` to `.githooks` makes Git read hooks *only* from that directory for this repository, so any hooks installed at the global `core.hooksPath` stop running here. Check what you have there before you run the command:

```
git config --show-origin --get-all core.hooksPath
```

Git also skips the `commit-msg` hook entirely on some paths, so a trailer can still reach history through:

- `git commit --no-verify`, which skips the hook by design.
- `git cherry-pick`, `git rebase`, and `git am`, which reuse an existing message without running `commit-msg`.

`git commit --amend` *is* covered. Treat the guard as a safety net for the ordinary commit path, not a proof that no trailer can ever land.

The `pre-commit` lockfile guard has the same install requirement and the same `--no-verify` escape hatch. It inspects only the staged content of `package-lock.json` and only plain `http(s)` `resolved` URLs (the shape npm uses for registry tarballs), so it does not police `git+https` or other VCS `resolved` forms. The allowlist lives in `ALLOWED_HOSTS` at the top of `.githooks/pre-commit` and defaults to `registry.npmjs.org`; add a host there only for a registry this repository deliberately uses. The guard blocks new leaks at commit time but does not clean hosts already present in committed history.

## Pull requests

`.github/PULL_REQUEST_TEMPLATE.md` is the body every pull request here uses. GitHub prefills it, so fill the sections in place and do not delete a heading: a section that does not apply gets `None`, and a missing heading shows up in the diff instead of surfacing in review.

Whoever opens the pull request fills every section, and that includes an agent. **Motivation**, **Design decisions**, and **Notes to reviewers** no longer wait for a different person: the author of the work knows why it was needed, what it traded away, and what the diff does not show, so the author writes them and records who wrote what under **Agent disclosure**. That section is a transparency record, not a gate.

One gate remains, and it is a command rather than a judgement: the `pre-pr-check` line. A body still holding `pre-pr-check is not valid` is a draft, not a review request. Manual testing is still either provided with evidence or declined with a written reason -- an agent may write that reason, but only about a run it actually performed.

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

What is editable: the English and Chinese titles of a medium page, the titles and blurbs of a collection and of an Exhibitions hang scene, and the titles and dimensions of an artwork. That is the whole list, and the next section says why it stops there.

Editing page copy applies today, as does artwork wording: both `content/gallery.json` and `content/artworks.json` round-trip through the gate's formatter, and the build fails if either stops doing so.

Implementation notes:

- `edit.html` is hand-written and is the only HTML at the repo root that edit mode owns; the `gallery*.html` pages are generated. It links to `gallery.html?edit=1` in the markup, so the front door works with no JavaScript at all, and its script replaces that with a clean `gallery.html` once it has confirmed the browser will hold the `sessionStorage` flag that carries the mode between pages. Turning the mode off there leaves unsubmitted edits alone, the same promise the toolbar's **Exit edit mode** button makes.
- `build.mjs` emits `data-edit-field="file|collection|key|field"` on every editable element, using the same address string the gate uses internally. The contract the overlay depends on is that such an element's `textContent` is exactly the raw value on disk, which is why an artwork title is rendered in its own span instead of being composed with the year. The build fails if any emitted address is malformed or names something the gate would refuse, so the whitelist is enforced rather than documented.
- `assets/js/edit-mode-rules.js` is generated from `EDITABLE_CONTENT`, so the length limits the browser reports cannot drift from the ones the gate enforces. `npm run build:check` fails if it has.
- `assets/js/edit-mode.js` and `assets/css/edit-mode.css` load only when edit mode is asked for, so an ordinary page view costs one conditional and no extra requests.
- The overlay makes no network call and holds nothing durable. Pending edits live in `sessionStorage` so one patch can span several pages.

## Admin edit mode: what it deliberately does not cover

Edit mode reaches wording the build renders as the visible text of one element, and nothing else. Three content fields are wording but are not reachable, and that is a decision rather than unfinished work.

| Field | Where it lives | Why it is out |
| --- | --- | --- |
| `altEn`, `altZh` | the `alt` and `data-alt-zh` attributes of each `<img>`, one pair per entry in a work's `images` array | Two values on one element, and `assets/js/language.js` owns `alt` and swaps it on a language change. No element can carry both addresses without breaking the `textContent` contract the overlay reads. They also sit inside an array, which the gate's `file\|collection\|key\|field` address cannot name at all. |
| `metaDescription` | `<meta name="description">` in `<head>` | Renders nowhere on the page, so there is no "in place" to edit it in. |
| `year` | composed into the title line, or `n.d.` when absent | An integer, and the displayed text is not the value when it is missing. Inline editing could correct a wrong year but never add a missing one or remove a wrong one, which are the cases that come up. |

**The decision.** These three stay out of `EDITABLE_CONTENT`, and the build fails if a field is whitelisted that the overlay cannot edit, so the gate's whitelist and the pencils on the page are one set rather than two lists that drift. Changing them means editing `content/artworks.json` or `content/gallery.json` in a pull request.

The reason is lifecycle, not difficulty. All three are authored when an artwork or a page record is created, and creating a record is already a repository operation: you add the image file to `assets/gallery/`, add the record, and commit. Alt text, the year and the meta description are written in that same sitting by the same person, next to the image path and the medium slug, which are deliberately not editable either. Edit mode exists for the other job, revising copy on a site that already exists, often by someone who spots the problem while browsing it. Reaching these three would not save a trip to the repository; it would add a second way to do something the author is already in the repository to do.

**The rejected alternative** was a second editing surface: a small form panel in the overlay listing the fields on this page that have no visible element, with a labelled input for each. It was rejected for four reasons.

- It makes one feature carry two mechanisms. The inline path is one contract -- an addressed element's `textContent` is its value on disk -- and a form panel cannot use it. It needs a new build output exposing on-disk values to the client outside that contract, a second value type through client validation, and a second commit path, roughly doubling the overlay for three fields.
- The feedback that justifies editing in place does not apply. A meta description is judged against a search result, not against the page, so showing it in context buys nothing.
- Every entry in the whitelist is reach the patch gate grants. Three entries no editor could use widened the write path for no product benefit, which is the least-privilege problem the narrowing fixes.
- Alt text is an accessibility obligation, and a change to it is better reviewed by someone who knows what alt text should say than applied self-service. A pull request is the right shape for that change.

**To reverse it** the work is bounded and known: build a panel surface in `assets/js/edit-mode.js` fed by on-disk values the build emits for the page, add a `year` rule type back to the validator in `scripts/content-patch.mjs` with its own client mirror, give alt text an address scheme that can reach a field inside a record's `images` array and does not collide with `language.js`, add the fields to `EDITABLE_CONTENT`, and add the rule type to `EDITABLE_RULE_TYPES`. `tests/content-patch.test.mjs` pins the current whitelist on purpose, so that test failing is the prompt to read this section first.

## Admin edit mode: the content patch gate

`scripts/content-patch.mjs` is the only write path from the browser admin edit mode into this repository. The browser never patches HTML and never touches git: it collects an editor's wording changes into a patch document and submits it to this module, which validates the patch and writes `content/*.json`. The gallery build then regenerates the HTML, so a one-word edit in the browser lands as a one-line JSON diff in a pull request.

The gate fails closed and is all or nothing. One bad edit rejects the whole submission and writes nothing.

- `EDITABLE_CONTENT` in that file is the complete whitelist of what an editor can reach: titles and dimensions on an artwork, plus titles and body copy on a gallery page. Ids, slugs, image paths, pixel dimensions and facet values are deliberately absent, so edit mode can change wording but cannot break a page or re-point an image. Alt text, the year and meta descriptions are absent too, for the reasons in the section above.
- `EDITABLE_RULE_TYPES` is the set of rule types the browser overlay can edit, and `build.mjs` fails the build if a whitelisted field uses anything else. That is what keeps the whitelist from granting reach no editor can use.
- Records can only be updated, never created or deleted.
- Values must be single-line plain text within a per-field length limit, with no control characters and no `<` or `>`.
- A content file is refused unless it round-trips through `JSON.stringify(data, null, 4)` byte for byte. Both content files do today, and `build.mjs` fails if either drifts, because a file the gate cannot reproduce exactly would be reformatted end to end and bury the real edit.

`applyContentPatch(patch, { contentRoot, dryRun })` returns `{ ok, errors, changed, files, summary }`. Call it with `dryRun` to show an editor a review screen before they submit; `changed: false` means every edit already matched what is on disk, so no pull request should be opened. `tests/content-patch.test.mjs` covers the whitelist and every rejection case and runs as part of `npm test`.
