#!/bin/bash
# preflight-repo.sh — Mechanical pre-flight check for workloop find_work
# Inspired by APM triage-panel's batch allow-list pattern:
#   compute scope constraints BEFORE reading untrusted issue content.
#
# Usage: preflight-repo.sh <owner/repo> [issue_number]
#
# Checks:
# 1. ≤ 3 open PRs from kagura-agent in this repo
# 2. Repo activity: last commit within 14 days
# 3. No competing PR for the specified issue (if provided)
# 4. Repo size ≤ 500MB (GitHub API disk_usage)
# 5. Wiki blocklist check (repos known to not merge external PRs)
#
# All checks run on METADATA only (API calls, no body reads).
# This enforces the "scope before content" principle.

set -uo pipefail

REPO="${1:-}"
ISSUE="${2:-}"

if [[ -z "$REPO" ]]; then
  echo "Usage: preflight-repo.sh <owner/repo> [issue_number]"
  exit 1
fi

OWNER="${REPO%%/*}"
REPONAME="${REPO##*/}"
MY_LOGIN="kagura-agent"
WIKI_DIR="$HOME/.openclaw/workspace/wiki/projects"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

PASSED=0
FAILED=0
WARNINGS=0

pass() { echo -e "  ${GREEN}✅ PASS${NC}: $1"; ((PASSED++)); }
fail() { echo -e "  ${RED}❌ FAIL${NC}: $1"; ((FAILED++)); }
warn() { echo -e "  ${YELLOW}⚠️  WARN${NC}: $1"; ((WARNINGS++)); }

echo "═══════════════════════════════════════════"
echo "  PREFLIGHT CHECK: ${REPO}"
[[ -n "$ISSUE" ]] && echo "  Issue: #${ISSUE}"
echo "═══════════════════════════════════════════"
echo ""

# --- Check 1: Open PR count ---
echo "📋 Check 1: Open PR count (limit ≤ 3)"
OPEN_PRS=$(gh pr list --repo "$REPO" --author="$MY_LOGIN" --state=open --json number -q 'length' 2>/dev/null || echo "ERROR")
if [[ "$OPEN_PRS" == "ERROR" ]]; then
  fail "Could not query open PRs (API error)"
elif [[ "$OPEN_PRS" -gt 3 ]]; then
  fail "Too many open PRs: ${OPEN_PRS} (limit 3). This repo is saturated."
elif [[ "$OPEN_PRS" -ge 2 ]]; then
  warn "Already ${OPEN_PRS} open PRs — approaching limit"
  pass "Open PRs: ${OPEN_PRS}/3"
else
  pass "Open PRs: ${OPEN_PRS}/3"
fi

# --- Check 2: Repo activity ---
echo "📋 Check 2: Repo activity (last 14 days)"
LAST_PUSH=$(gh api "repos/${REPO}" --jq '.pushed_at // empty' 2>/dev/null)
if [[ -z "$LAST_PUSH" || "$LAST_PUSH" == *"Not Found"* ]]; then
  fail "Could not query repo metadata (repo may not exist or be private)"
else
  LAST_PUSH_TS=$(date -d "$LAST_PUSH" +%s 2>/dev/null || echo "0")
  NOW_TS=$(date +%s)
  DAYS_AGO=$(( (NOW_TS - LAST_PUSH_TS) / 86400 ))
  if [[ "$DAYS_AGO" -gt 14 ]]; then
    fail "Last push ${DAYS_AGO} days ago (${LAST_PUSH}). Repo appears inactive."
  elif [[ "$DAYS_AGO" -gt 7 ]]; then
    warn "Last push ${DAYS_AGO} days ago — slowing down"
    pass "Active: last push ${DAYS_AGO}d ago"
  else
    pass "Active: last push ${DAYS_AGO}d ago (${LAST_PUSH})"
  fi
fi

# --- Check 3: Competing PRs ---
if [[ -n "$ISSUE" ]]; then
  echo "📋 Check 3: Competing PRs for #${ISSUE}"
  COMPETING=$(gh pr list --repo "$REPO" --search "$ISSUE" --state=open --json number,author -q '[.[] | select(.author.login != "'"$MY_LOGIN"'")] | length' 2>/dev/null || echo "ERROR")
  if [[ "$COMPETING" == "ERROR" ]]; then
    warn "Could not check competing PRs"
  elif [[ "$COMPETING" -gt 0 ]]; then
    fail "Found ${COMPETING} competing open PR(s) for #${ISSUE}"
    # Show them
    gh pr list --repo "$REPO" --search "$ISSUE" --state=open --json number,author,title -q '.[] | select(.author.login != "'"$MY_LOGIN"'") | "#\(.number) by @\(.author.login): \(.title)"' 2>/dev/null | while read -r line; do
      echo "       → $line"
    done
  else
    pass "No competing PRs for #${ISSUE}"
  fi
else
  echo "📋 Check 3: Competing PRs — skipped (no issue specified)"
fi

# --- Check 4: Repo size ---
echo "📋 Check 4: Repo size (limit 500MB)"
SIZE_KB=$(gh api "repos/${REPO}" --jq '.size // empty' 2>/dev/null)
if [[ -z "$SIZE_KB" || ! "$SIZE_KB" =~ ^[0-9]+$ ]]; then
  warn "Could not query repo size"
else
  SIZE_MB=$((SIZE_KB / 1024))
  if [[ "$SIZE_MB" -gt 500 ]]; then
    fail "Repo too large: ${SIZE_MB}MB (limit 500MB)"
  elif [[ "$SIZE_MB" -gt 200 ]]; then
    warn "Large repo: ${SIZE_MB}MB — clone will be slow"
    pass "Size: ${SIZE_MB}MB"
  else
    pass "Size: ${SIZE_MB}MB"
  fi
fi

# --- Check 5: Wiki blocklist ---
echo "📋 Check 5: Wiki blocklist"
WIKI_FILE="${WIKI_DIR}/${REPONAME}.md"
if [[ -f "$WIKI_FILE" ]]; then
  # Look for explicit blocklist markers only (not broad pattern matching)
  if grep -qi '\[BLOCKLIST\]\|⛔.*不提.*PR\|DO NOT CONTRIBUTE\|internal.only.repo' "$WIKI_FILE" 2>/dev/null; then
    fail "Wiki notes explicitly blocklist this repo"
    grep -i '\[BLOCKLIST\]\|⛔.*不提\|DO NOT CONTRIBUTE\|internal.only' "$WIKI_FILE" | head -3 | while read -r line; do
      echo "       → $line"
    done
  elif grep -qi '不.*merge.*外部' "$WIKI_FILE" 2>/dev/null; then
    warn "Wiki mentions external PR merge concerns — review wiki notes before proceeding"
  else
    pass "Wiki notes exist, no blocklist flags"
  fi
else
  pass "No wiki blocklist entry (new repo)"
fi

# --- Summary ---
echo ""
echo "═══════════════════════════════════════════"
if [[ "$FAILED" -gt 0 ]]; then
  echo -e "  ${RED}PREFLIGHT FAILED${NC}: ${PASSED} passed, ${FAILED} failed, ${WARNINGS} warnings"
  echo "  ⛔ Do NOT proceed with this repo/issue."
  echo "═══════════════════════════════════════════"
  exit 1
else
  echo -e "  ${GREEN}PREFLIGHT PASSED${NC}: ${PASSED} passed, ${FAILED} failed, ${WARNINGS} warnings"
  echo "═══════════════════════════════════════════"
  exit 0
fi
