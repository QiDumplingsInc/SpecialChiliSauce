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
#   status (0 = accept, non-zero = reject). Cases cover the canonical trailer,
#   a lowercase variant (case-insensitive match), a leading-whitespace variant,
#   a clean single-line message, and a clean multi-line message.
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

echo ""
if [ "$failures" -eq 0 ]; then
	echo "All cases passed."
	exit 0
fi

echo "$failures case(s) failed."
exit 1
