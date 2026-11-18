# my_store

https://qidumplingsinc.github.io/SpecialChiliSauce/

## Testing

Behavioral tests for interactive JS (e.g. the newsletter signup forms and gallery search) run against the real `index.html` and `gallery.html` via jsdom, with network calls mocked.

```
npm install
npm test
```

## Commit hooks

This repository tracks a `commit-msg` hook in `.githooks/` that rejects any `Co-Authored-By:` trailer, as required by the commit-attribution standard in the `CLAUDE.md` one directory above this repository's checkout. Git does not read tracked hooks automatically, so a fresh clone needs this one-time command to activate them:

```
git config core.hooksPath .githooks
```

Repo-local config overrides the global hooks path, and all worktrees of a clone share `.git/config`, so one setting covers every worktree. Verify the hook with:

```
sh .githooks/commit-msg-test.sh
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

## Newsletter signups

Both `index.html` and `gallery.html` post to the same Google Apps Script Web App endpoint, which writes each submission as a row in a Google Sheet. A hidden `source` field (`chili-sauce` or `gallery`) tells the two pages' signups apart in the Sheet.

## Gallery search

The gallery pages include a client-side search box (`assets/js/gallery-search.js`) over a small hardcoded list of page titles — not a full-text search of page content.
