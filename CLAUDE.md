# Repository hygiene for coding agents

This is a public repository. Before writing, editing, or committing any file
(code, web page, docs, lockfile, config), you MUST keep prohibited identifiers
out of tracked content.

## Sensitive-term denylist

The prohibited terms live in a local, git-ignored file at the repo root:

    .sensitive-terms.local

It is intentionally NOT committed: the list itself names what we keep out of a
public repo, so publishing it would defeat the purpose. The file uses:

- `# ...`      comment
- `!<regex>`   ALLOW: a line matching this is exempt (e.g. standard CSS tokens)
- `<regex>`    DENY : a line matching this must never enter a tracked file

### Rules for the agent

1. Load `.sensitive-terms.local` at the start of any editing task. If it is
   missing, recreate it before you continue (ask the maintainer for the current
   list rather than guessing).
2. Never emit a value that matches a DENY pattern into any file you write.
   This includes URLs, email addresses, author names, host names, and comments.
3. Watch package manager lockfiles specifically. A private/internal registry in
   the shell environment can rewrite every `resolved` URL in a lockfile to an
   internal host. Always regenerate lockfiles against the public registry and
   verify no internal host survived before staging.
4. If a DENY pattern genuinely needs an exception (a standards token, the public
   business contact), add an `!` ALLOW line to `.sensitive-terms.local` with a
   comment — do not weaken a DENY pattern.

## Enforcement

`.githooks/pre-commit` reads the denylist and rejects any commit whose staged
diff adds a denied term (unless an ALLOW line exempts that line). Enable it once
per clone:

    git config core.hooksPath .githooks

Verify the guard with:

    sh .githooks/test-sensitive-scan.sh

The hook is a local authoring aid (fail-open if the denylist is absent). It does
not replace CI checks or the committed lockfile registry guard, which remain the
source of truth for pushed history.
