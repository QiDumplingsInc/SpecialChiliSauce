#!/bin/sh
#
# Test script for the pre-commit hook.
#
# What it does:
#   Proves the pre-commit guard rejects a commit that stages a
#   package-lock.json resolving from a non-public registry host, and accepts a
#   commit whose staged lockfile resolves only from the public npm registry.
# Input:
#   None. It locates the hook next to itself and builds throwaway git
#   repositories in a private temp directory.
# Output:
#   Prints one PASS/FAIL line per case and a summary. Exits 0 only when every
#   case behaves as expected; exits 1 on the first failing expectation.
# How:
#   The pre-commit hook reads staged content from the git index, not a message
#   file, so every case drives a real "git commit" in a throwaway repository.
#   Each repo sets core.hooksPath to a copy of this hook (except the baseline
#   "no hook" case, which points at an empty hooks directory to disable hooks),
#   stages a crafted lockfile, commits, and compares the resulting commit count
#   to the expectation. Cases cover: the poisoned lockfile landing WITHOUT the
#   hook (proves the guard is what blocks it), the poisoned lockfile blocked
#   WITH the hook, a clean lockfile accepted, a nested poisoned lockfile
#   blocked, and a commit with no staged lockfile accepted.
#
# Dependencies: plain sh plus git and awk only. No new dependencies.

set -u

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
hook="$script_dir/pre-commit"

if [ ! -x "$hook" ]; then
	echo "FAIL: hook not found or not executable at $hook" >&2
	exit 1
fi

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

failures=0

# Lockfile that resolves from internal mirror hosts (the poisoned shape).
poisoned_lock=$(cat <<'JSON'
{
  "name": "sample",
  "lockfileVersion": 3,
  "packages": {
    "node_modules/left-pad": {
      "version": "1.3.0",
      "resolved": "https://artifacts.apple.com/left-pad/-/left-pad-1.3.0.tgz",
      "integrity": "sha512-placeholder"
    },
    "node_modules/right-pad": {
      "version": "1.0.0",
      "resolved": "https://npm.apple.com/right-pad/-/right-pad-1.0.0.tgz"
    }
  }
}
JSON
)

# Lockfile that resolves only from the public npm registry (the clean shape).
clean_lock=$(cat <<'JSON'
{
  "name": "sample",
  "lockfileVersion": 3,
  "packages": {
    "node_modules/left-pad": {
      "version": "1.3.0",
      "resolved": "https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz",
      "integrity": "sha512-placeholder"
    }
  }
}
JSON
)

# make_repo <dir> <with_hook: yes|no>
# Creates a throwaway git repo. With the hook, core.hooksPath points at a copy
# of the hook under test; without it, core.hooksPath points at an empty dir so
# the machine's global hooks path cannot interfere with the baseline case.
make_repo() {
	repo="$1"
	with_hook="$2"
	mkdir -p "$repo"
	git init -q "$repo" >/dev/null 2>&1
	git -C "$repo" config user.name "Hook Test"
	git -C "$repo" config user.email "hook-test@example.invalid"
	git -C "$repo" config commit.gpgsign false
	if [ "$with_hook" = "yes" ]; then
		mkdir -p "$repo/.githooks"
		cp "$hook" "$repo/.githooks/pre-commit"
		chmod +x "$repo/.githooks/pre-commit"
		git -C "$repo" config core.hooksPath .githooks
	else
		mkdir -p "$repo/.nohooks"
		git -C "$repo" config core.hooksPath .nohooks
	fi
}

check_commits() {
	# $1 = case name, $2 = repo, $3 = expected commit count
	name="$1"
	repo="$2"
	expected="$3"
	commits=$(git -C "$repo" rev-list --count HEAD 2>/dev/null || echo 0)
	if [ "$commits" -eq "$expected" ]; then
		echo "PASS: $name (commit count $commits as expected)"
	else
		echo "FAIL: $name (expected $expected commit(s), got $commits)"
		failures=$((failures + 1))
	fi
}

# Case 1: poisoned lockfile committed WITHOUT the hook -> commit is created.
# This proves the guard is what blocks the leak; nothing else does.
repo1="$tmp_dir/no-hook-poisoned"
make_repo "$repo1" "no"
printf '%s\n' "$poisoned_lock" > "$repo1/package-lock.json"
git -C "$repo1" add package-lock.json >/dev/null 2>&1
git -C "$repo1" commit -q -m "Add lockfile" >/dev/null 2>&1
check_commits "poisoned lockfile without hook" "$repo1" 1

# Case 2: poisoned lockfile committed WITH the hook -> commit is rejected.
repo2="$tmp_dir/hook-poisoned"
make_repo "$repo2" "yes"
printf '%s\n' "$poisoned_lock" > "$repo2/package-lock.json"
git -C "$repo2" add package-lock.json >/dev/null 2>&1
git -C "$repo2" commit -q -m "Add lockfile" >/dev/null 2>&1
check_commits "poisoned lockfile with hook" "$repo2" 0

# Case 3: clean lockfile committed WITH the hook -> commit is created.
repo3="$tmp_dir/hook-clean"
make_repo "$repo3" "yes"
printf '%s\n' "$clean_lock" > "$repo3/package-lock.json"
git -C "$repo3" add package-lock.json >/dev/null 2>&1
git -C "$repo3" commit -q -m "Add lockfile" >/dev/null 2>&1
check_commits "clean lockfile with hook" "$repo3" 1

# Case 4: nested poisoned lockfile committed WITH the hook -> commit rejected.
repo4="$tmp_dir/hook-nested-poisoned"
make_repo "$repo4" "yes"
mkdir -p "$repo4/packages/widget"
printf '%s\n' "$poisoned_lock" > "$repo4/packages/widget/package-lock.json"
git -C "$repo4" add packages/widget/package-lock.json >/dev/null 2>&1
git -C "$repo4" commit -q -m "Add nested lockfile" >/dev/null 2>&1
check_commits "nested poisoned lockfile with hook" "$repo4" 0

# Case 5: no lockfile staged WITH the hook -> commit is created (exit 0 path).
repo5="$tmp_dir/hook-no-lockfile"
make_repo "$repo5" "yes"
echo content > "$repo5/file.txt"
git -C "$repo5" add file.txt >/dev/null 2>&1
git -C "$repo5" commit -q -m "Add unrelated file" >/dev/null 2>&1
check_commits "no lockfile staged with hook" "$repo5" 1

echo ""
if [ "$failures" -eq 0 ]; then
	echo "All cases passed."
	exit 0
fi

echo "$failures case(s) failed."
exit 1
