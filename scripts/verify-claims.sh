#!/bin/bash
# verify-claims.sh — Mechanical verification of code change claims
# Inspired by lazar's [VERIFY] contract pattern
# Usage: verify-claims.sh <repo-dir> [expected-files...]
#
# Checks:
# 1. Working directory is a git repo with changes
# 2. Expected files (if provided) are actually modified
# 3. No unstaged changes left behind
# 4. Modified files are non-empty
# 5. No merge conflict markers in changed files

set -uo pipefail

REPO_DIR="${1:-.}"
shift || true
EXPECTED_FILES=("$@")

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

check() {
  local label="$1" result="$2"
  if [ "$result" = "pass" ]; then
    echo -e "${GREEN}✅ $label${NC}"
    ((PASS++))
  elif [ "$result" = "warn" ]; then
    echo -e "${YELLOW}⚠️  $label${NC}"
    ((WARN++))
  else
    echo -e "${RED}❌ $label${NC}"
    ((FAIL++))
  fi
}

cd "$REPO_DIR"

# 1. Is this a git repo?
if ! git rev-parse --is-inside-work-tree &>/dev/null; then
  check "Is a git repo" "fail"
  echo "Not a git repository: $REPO_DIR"
  exit 1
fi
check "Is a git repo" "pass"

# 2. Are there any changes (staged, unstaged, or committed)?
CHANGED_FILES=$(
  { git diff --name-only HEAD~1 2>/dev/null || true;
    git diff --name-only --cached 2>/dev/null || true;
    git diff --name-only 2>/dev/null || true;
  } | sort -u
)

if [ -z "$CHANGED_FILES" ]; then
  check "Has changes" "fail"
  echo "No changes detected in repo"
  exit 1
fi
FILE_COUNT=$(echo "$CHANGED_FILES" | wc -l | tr -d ' ')
check "Has changes ($FILE_COUNT files)" "pass"

# 3. Expected files check
if [ ${#EXPECTED_FILES[@]} -gt 0 ]; then
  for f in "${EXPECTED_FILES[@]}"; do
    if echo "$CHANGED_FILES" | grep -qF "$f"; then
      check "Expected file modified: $f" "pass"
    else
      check "Expected file modified: $f" "fail"
    fi
  done
fi

# 4. No unstaged changes left behind
UNSTAGED=$(git diff --name-only 2>/dev/null || echo "")
if [ -n "$UNSTAGED" ]; then
  check "No unstaged changes (found: $(echo "$UNSTAGED" | wc -l | tr -d ' ') files)" "warn"
  echo "  Unstaged: $UNSTAGED"
else
  check "No unstaged changes" "pass"
fi

# 5. Modified files are non-empty
while IFS= read -r f; do
  if [ -f "$f" ] && [ ! -s "$f" ]; then
    check "Non-empty: $f" "fail"
  fi
done <<< "$CHANGED_FILES"
check "All modified files non-empty" "pass"

# 6. No merge conflict markers
CONFLICT_FILES=""
while IFS= read -r f; do
  if [ -f "$f" ] && grep -qE '^(<<<<<<<|=======|>>>>>>>)' "$f" 2>/dev/null; then
    CONFLICT_FILES="$CONFLICT_FILES $f"
  fi
done <<< "$CHANGED_FILES"

if [ -n "$CONFLICT_FILES" ]; then
  check "No conflict markers (found in:$CONFLICT_FILES)" "fail"
else
  check "No conflict markers" "pass"
fi

# Summary
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo -e "Results: ${GREEN}$PASS pass${NC} / ${RED}$FAIL fail${NC} / ${YELLOW}$WARN warn${NC}"

if [ "$FAIL" -gt 0 ]; then
  echo -e "${RED}VERIFICATION FAILED${NC} — do not proceed to push"
  exit 1
else
  echo -e "${GREEN}VERIFICATION PASSED${NC}"
  exit 0
fi
