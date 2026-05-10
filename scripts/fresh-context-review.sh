#!/bin/bash
# fresh-context-review.sh — Fresh-Context Evaluator
# Inspired by Anthropic cwc-long-running-agents "Fresh-context evaluator" pattern.
#
# Core principle: The builder should not grade its own work. A separate agent
# reviews the diff from a clean context with NO write tools — it can only
# observe and report. This catches self-grading bias and premature "done" claims.
#
# Usage:
#   fresh-context-review.sh <repo-dir> [base-ref]
#
# Requirements:
#   - claude CLI available (Claude Code)
#   - Git repo with commits to review
#
# Output:
#   Prints PASS or NEEDS_WORK with findings to stdout.
#   Exit 0 = PASS, Exit 1 = NEEDS_WORK, Exit 2 = error

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

REPO_DIR="${1:-}"
BASE_REF="${2:-HEAD~1}"

if [ -z "$REPO_DIR" ]; then
  echo "Usage: $0 <repo-dir> [base-ref]"
  echo "  base-ref defaults to HEAD~1"
  exit 2
fi

if [ ! -d "$REPO_DIR/.git" ]; then
  echo -e "${RED}Error: $REPO_DIR is not a git repository${NC}"
  exit 2
fi

cd "$REPO_DIR" || exit 2

# Generate the diff
DIFF=$(git diff "$BASE_REF"..HEAD 2>/dev/null)
if [ -z "$DIFF" ]; then
  echo -e "${YELLOW}No changes to review (diff is empty)${NC}"
  echo "PASS (no changes)"
  exit 0
fi

DIFF_STAT=$(git diff --stat "$BASE_REF"..HEAD 2>/dev/null)
COMMIT_MSG=$(git log --oneline "$BASE_REF"..HEAD 2>/dev/null)
FILES_CHANGED=$(git diff --name-only "$BASE_REF"..HEAD 2>/dev/null)

# Count total lines changed
LINES_ADDED=$(echo "$DIFF" | grep -c '^+[^+]' || true)
LINES_REMOVED=$(echo "$DIFF" | grep -c '^-[^-]' || true)

echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}Fresh-Context Code Review${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo "Repo: $REPO_DIR"
echo "Base: $BASE_REF"
echo "Files: $(echo "$FILES_CHANGED" | wc -l | tr -d ' ')"
echo "Lines: +$LINES_ADDED / -$LINES_REMOVED"
echo ""

# Build the review prompt
REVIEW_PROMPT="You are a code reviewer. Review the following git diff with fresh eyes.
You have NO context about why these changes were made — judge them purely on code quality.

Your job is to find:
1. **Bugs**: Logic errors, off-by-one, null/undefined risks, race conditions
2. **Missing tests**: New behavior without test coverage
3. **Incomplete changes**: Files that should have been updated but weren't (imports, types, docs)
4. **Silent failures**: Error handling that swallows errors, empty catch blocks
5. **Regression risk**: Changes that could break existing functionality

Commits:
$COMMIT_MSG

Diff stat:
$DIFF_STAT

Full diff:
$DIFF

Respond with EXACTLY one of:
- PASS — if the changes look correct and complete
- NEEDS_WORK — if you found issues

If NEEDS_WORK, list each finding as:
- [severity: HIGH/MEDIUM/LOW] file:line — description

Be strict. When in doubt, flag it."

# Run Claude Code in print mode (read-only, no tools)
if command -v claude &>/dev/null; then
  echo "Running fresh-context review via Claude Code..."
  echo ""
  RESULT=$(echo "$REVIEW_PROMPT" | claude --print 2>/dev/null)
  REVIEW_EXIT=$?
else
  echo -e "${RED}Error: claude CLI not found${NC}"
  exit 2
fi

if [ $REVIEW_EXIT -ne 0 ]; then
  echo -e "${RED}Claude Code review failed (exit $REVIEW_EXIT)${NC}"
  exit 2
fi

echo "$RESULT"
echo ""

# Parse verdict
if echo "$RESULT" | grep -q "^PASS\|PASS —\|PASS$"; then
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}FRESH-CONTEXT REVIEW: PASS${NC}"
  echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 0
elif echo "$RESULT" | grep -q "NEEDS_WORK"; then
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${RED}FRESH-CONTEXT REVIEW: NEEDS_WORK${NC}"
  echo -e "${RED}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 1
else
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${YELLOW}FRESH-CONTEXT REVIEW: UNCLEAR VERDICT${NC}"
  echo -e "${YELLOW}Review output did not contain PASS or NEEDS_WORK.${NC}"
  echo -e "${YELLOW}Treating as NEEDS_WORK (default-fail principle).${NC}"
  echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  exit 1
fi
