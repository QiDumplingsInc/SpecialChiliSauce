#!/bin/sh
#
# Test script for the commit-msg hook.
#
# What it does:
#   Proves the commit-msg guard rejects any commit message that carries a
#   Co-Authored-By trailer and accepts a message that does not.
# Input:
#   None. It locates the hook next to itself and builds message files in a
#   private temp directory.
# Output:
#   Prints one PASS/FAIL line per case and a summary. Exits 0 only when every
#   case behaves as expected; exits 1 on the first failing expectation.
# How:
#   For each case it writes a commit message to a temp file, runs the hook with
#   that file as $1, captures the exit status, and compares it to the expected
#   status (0 = accept, non-zero = reject). Cases 1-5 cover the canonical
#   trailer, a lowercase variant (case-insensitive match), a leading-whitespace
#   variant, a clean single-line message, and a clean multi-line message.
#   Cases 6-7 then drive a real "git commit" in a throwaway repository whose
#   core.hooksPath points at a copy of the hook, so the suite also proves the
#   documented install step wires the guard rather than only that the script
#   returns the right exit status when called directly.
#
# Dependencies: plain sh plus git only. No new dependencies.

set -u

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
hook="$script_dir/commit-msg"

if [ ! -x "$hook" ]; then
	echo "FAIL: hook not found or not executable at $hook" >&2
	exit 1
fi

tmp_dir=$(mktemp -d)
trap 'rm -rf "$tmp_dir"' EXIT INT TERM

failures=0

run_case() {
	# $1 = case name, $2 = expected result ("accept"|"reject"), $3 = message file
	name="$1"
	expected="$2"
	file="$3"

	"$hook" "$file" >/dev/null 2>&1
	status=$?

	if [ "$expected" = "accept" ]; then
		if [ "$status" -eq 0 ]; then
			echo "PASS: $name (accepted, exit 0)"
		else
			echo "FAIL: $name (expected exit 0, got $status)"
			failures=$((failures + 1))
		fi
	else
		if [ "$status" -ne 0 ]; then
			echo "PASS: $name (rejected, exit $status)"
		else
			echo "FAIL: $name (expected non-zero exit, got 0)"
			failures=$((failures + 1))
		fi
	fi
}

# Case 1: canonical Paperclip trailer -> reject
printf 'Add a feature\n\nCo-Authored-By: Paperclip <noreply@paperclip.ing>\n' > "$tmp_dir/canonical"
run_case "canonical trailer" "reject" "$tmp_dir/canonical"

# Case 2: lowercase trailer (case-insensitive match) -> reject
printf 'Add a feature\n\nco-authored-by: Kona <kona@noreply.local>\n' > "$tmp_dir/lowercase"
run_case "lowercase trailer (case-insensitive)" "reject" "$tmp_dir/lowercase"

# Case 3: leading-whitespace trailer -> reject
printf 'Add a feature\n\n\tCo-Authored-By: Someone <x@example.com>\n' > "$tmp_dir/leading-ws"
run_case "leading-whitespace trailer" "reject" "$tmp_dir/leading-ws"

# Case 4: clean single-line message -> accept
printf 'Add a feature\n' > "$tmp_dir/clean-single"
run_case "clean single-line message" "accept" "$tmp_dir/clean-single"

# Case 5: clean multi-line message with a body -> accept
printf 'Add a feature\n\nThis body explains the change in detail.\nIt mentions co-authoring as a concept but carries no trailer.\n' > "$tmp_dir/clean-multi"
run_case "clean multi-line message" "accept" "$tmp_dir/clean-multi"

# Cases 6 and 7 drive a real "git commit" in a throwaway repository that has
# core.hooksPath set to a copy of this hook. Cases 1-5 prove the script's logic;
# these two prove the documented install step actually wires it, which is the
# failure mode a hook in .git/hooks/ has on a machine with a global hooks path.
e2e_repo="$tmp_dir/e2e"
mkdir -p "$e2e_repo/.githooks"
cp "$hook" "$e2e_repo/.githooks/commit-msg"
git init -q "$e2e_repo" >/dev/null 2>&1
git -C "$e2e_repo" config user.name "Hook Test"
git -C "$e2e_repo" config user.email "hook-test@example.invalid"
git -C "$e2e_repo" config commit.gpgsign false
git -C "$e2e_repo" config core.hooksPath .githooks
echo content > "$e2e_repo/file.txt"
git -C "$e2e_repo" add file.txt >/dev/null 2>&1

trailer_msg=$(printf 'Add file\n\nCo-Authored-By: Paperclip <noreply@paperclip.ing>\n')
git -C "$e2e_repo" commit -q -m "$trailer_msg" >/dev/null 2>&1
commits=$(git -C "$e2e_repo" rev-list --count HEAD 2>/dev/null || echo 0)
if [ "$commits" -eq 0 ]; then
	echo "PASS: end-to-end git commit with trailer (rejected, no commit created)"
else
	echo "FAIL: end-to-end git commit with trailer (commit was created)"
	failures=$((failures + 1))
fi

git -C "$e2e_repo" commit -q -m "Add file" >/dev/null 2>&1
commits=$(git -C "$e2e_repo" rev-list --count HEAD 2>/dev/null || echo 0)
if [ "$commits" -eq 1 ]; then
	echo "PASS: end-to-end git commit without trailer (accepted, commit created)"
else
	echo "FAIL: end-to-end git commit without trailer (expected 1 commit, got $commits)"
	failures=$((failures + 1))
fi

echo ""
if [ "$failures" -eq 0 ]; then
	echo "All cases passed."
	exit 0
fi

echo "$failures case(s) failed."
exit 1
