# my_store

https://qidumplingsinc.github.io/SpecialChiliSauce/

## Testing

Behavioral tests for interactive JS (e.g. the newsletter signup forms and gallery search) run against the real `index.html` and `gallery.html` via jsdom, with network calls mocked.

```
npm install
npm test
```

## Commit hooks

This repository tracks a `commit-msg` hook in `.githooks/` that rejects any `Co-Authored-By:` trailer, as required by `/Users/graceluo/Developer/github-geren/CLAUDE.md`. Git does not read tracked hooks automatically, so a fresh clone needs this one-time command to activate them:

```
git config core.hooksPath .githooks
```

Repo-local config overrides the global hooks path, and all worktrees of a clone share `.git/config`, so one setting covers every worktree. Verify the hook with:

```
sh .githooks/commit-msg-test.sh
```

## Newsletter signups

Both `index.html` and `gallery.html` post to the same Google Apps Script Web App endpoint, which writes each submission as a row in a Google Sheet. A hidden `source` field (`chili-sauce` or `gallery`) tells the two pages' signups apart in the Sheet.

## Gallery search

The gallery pages include a client-side search box (`assets/js/gallery-search.js`) over a small hardcoded list of page titles — not a full-text search of page content.
