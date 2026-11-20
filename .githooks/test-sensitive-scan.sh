#!/bin/sh
# Regression test for .githooks/pre-commit.
#
# Encodes the ARQ-30 vulnerability: a staged change that adds a denied term
# must be rejected, and an allow-listed line that happens to match a deny
# pattern must still pass. Uses a SYNTHETIC denylist (no real sensitive terms)
# so this test is safe to commit to a public repo and runs with no local setup.
#
# Run: sh .githooks/test-sensitive-scan.sh   (exit 0 = all cases pass)

set -eu

hook_src=$(cd "$(dirname "$0")" && pwd)/pre-commit
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT INT TERM

cd "$work"
git init -q
git config user.name Test
git config user.email test@test.local
mkdir .githooks
cp "$hook_src" .githooks/pre-commit
chmod +x .githooks/pre-commit
git config core.hooksPath .githooks

# Synthetic denylist: deny example.com, but allow one known-safe token.
cat > .sensitive-terms.local <<'EOF'
!safe-example-token
example\.com
EOF

pass=0
fail=0
check() {
    # $1 = label, $2 = expected exit (0 pass / 1 block)
    desc=$1; expect=$2
    set +e
    git commit -q -m "test" >/dev/null 2>&1
    actual=$?
    set -e
    # Normalize: hook rejects with non-zero -> treat any non-zero as 1.
    [ "$actual" -ne 0 ] && actual=1
    if [ "$actual" -eq "$expect" ]; then
        printf 'PASS: %s\n' "$desc"; pass=$((pass + 1))
    else
        printf 'FAIL: %s (expected exit %s, got %s)\n' "$desc" "$expect" "$actual"; fail=$((fail + 1))
    fi
    git reset -q HEAD >/dev/null 2>&1 || true
}

# Case 1: denied term in a staged line -> commit must be BLOCKED.
printf 'see https://files.example.com/x\n' > bad.txt
git add bad.txt
check "denied term blocks commit" 1
git rm -q -f --cached bad.txt >/dev/null 2>&1 || true
rm -f bad.txt

# Case 2: allow-listed line that also matches a deny pattern -> must PASS.
printf 'safe-example-token at example.com is exempt\n' > allowed.txt
git add allowed.txt
check "allow pattern exempts a deny match" 0

# Case 3: clean content only -> must PASS.
printf 'nothing to see here\n' > clean.txt
git add clean.txt
check "clean content passes" 0

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
