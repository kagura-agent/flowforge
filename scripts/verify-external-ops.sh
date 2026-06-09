#!/bin/bash
# verify-external-ops.sh — Verify subagent claims about external API operations
# Usage: verify-external-ops.sh <operation> <args...>
#
# Operations:
#   unassign <owner/repo> <issue#> <user>   — verify user is NOT in assignees
#   assign <owner/repo> <issue#> <user>     — verify user IS in assignees
#   close <owner/repo> <issue#>             — verify issue state is CLOSED
#   merge <owner/repo> <pr#>                — verify PR state is MERGED
#   comment <owner/repo> <issue#> <substr>  — verify comment containing substr exists
#   label <owner/repo> <issue#> <label>     — verify label is present
#
# Exit: 0 = verified, 1 = NOT verified (claim is false), 2 = usage error
#
# Lesson: NemoClaw #3836 — subagent claimed unassign but GitHub still showed assigned.
# Memory recorded false state for days. Trust API, not text.

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

die() { echo -e "${RED}ERROR: $1${NC}" >&2; exit 2; }

OP="${1:-}"
[ -z "$OP" ] && die "Usage: verify-external-ops.sh <operation> <args...>"
shift

case "$OP" in
  unassign)
    [ $# -lt 3 ] && die "Usage: verify-external-ops.sh unassign <owner/repo> <issue#> <user>"
    REPO="$1" ISSUE="$2" USER="$3"
    ASSIGNEES=$(gh issue view "$ISSUE" --repo "$REPO" --json assignees -q '.assignees[].login' 2>/dev/null)
    if echo "$ASSIGNEES" | grep -qxi "$USER"; then
      echo -e "${RED}FAILED: $USER is still assigned to $REPO#$ISSUE${NC}"
      echo "  Actual assignees: $ASSIGNEES"
      exit 1
    else
      echo -e "${GREEN}VERIFIED: $USER is NOT assigned to $REPO#$ISSUE${NC}"
      exit 0
    fi
    ;;
  assign)
    [ $# -lt 3 ] && die "Usage: verify-external-ops.sh assign <owner/repo> <issue#> <user>"
    REPO="$1" ISSUE="$2" USER="$3"
    ASSIGNEES=$(gh issue view "$ISSUE" --repo "$REPO" --json assignees -q '.assignees[].login' 2>/dev/null)
    if echo "$ASSIGNEES" | grep -qxi "$USER"; then
      echo -e "${GREEN}VERIFIED: $USER is assigned to $REPO#$ISSUE${NC}"
      exit 0
    else
      echo -e "${RED}FAILED: $USER is NOT assigned to $REPO#$ISSUE${NC}"
      echo "  Actual assignees: ${ASSIGNEES:-<none>}"
      exit 1
    fi
    ;;
  close)
    [ $# -lt 2 ] && die "Usage: verify-external-ops.sh close <owner/repo> <issue#>"
    REPO="$1" ISSUE="$2"
    STATE=$(gh issue view "$ISSUE" --repo "$REPO" --json state -q '.state' 2>/dev/null)
    if [ "$STATE" = "CLOSED" ]; then
      echo -e "${GREEN}VERIFIED: $REPO#$ISSUE is CLOSED${NC}"
      exit 0
    else
      echo -e "${RED}FAILED: $REPO#$ISSUE state is $STATE (expected CLOSED)${NC}"
      exit 1
    fi
    ;;
  merge)
    [ $# -lt 2 ] && die "Usage: verify-external-ops.sh merge <owner/repo> <pr#>"
    REPO="$1" PR="$2"
    STATE=$(gh pr view "$PR" --repo "$REPO" --json state -q '.state' 2>/dev/null)
    if [ "$STATE" = "MERGED" ]; then
      echo -e "${GREEN}VERIFIED: $REPO#$PR is MERGED${NC}"
      exit 0
    else
      echo -e "${RED}FAILED: $REPO#$PR state is $STATE (expected MERGED)${NC}"
      exit 1
    fi
    ;;
  comment)
    [ $# -lt 3 ] && die "Usage: verify-external-ops.sh comment <owner/repo> <issue#> <substring>"
    REPO="$1" ISSUE="$2" SUBSTR="$3"
    COMMENTS=$(gh issue view "$ISSUE" --repo "$REPO" --json comments -q '.comments[].body' 2>/dev/null)
    if echo "$COMMENTS" | grep -qi "$SUBSTR"; then
      echo -e "${GREEN}VERIFIED: Comment containing '$SUBSTR' found on $REPO#$ISSUE${NC}"
      exit 0
    else
      echo -e "${RED}FAILED: No comment containing '$SUBSTR' on $REPO#$ISSUE${NC}"
      exit 1
    fi
    ;;
  label)
    [ $# -lt 3 ] && die "Usage: verify-external-ops.sh label <owner/repo> <issue#> <label>"
    REPO="$1" ISSUE="$2" LABEL="$3"
    LABELS=$(gh issue view "$ISSUE" --repo "$REPO" --json labels -q '.labels[].name' 2>/dev/null)
    if echo "$LABELS" | grep -qxi "$LABEL"; then
      echo -e "${GREEN}VERIFIED: Label '$LABEL' present on $REPO#$ISSUE${NC}"
      exit 0
    else
      echo -e "${RED}FAILED: Label '$LABEL' NOT on $REPO#$ISSUE${NC}"
      echo "  Actual labels: ${LABELS:-<none>}"
      exit 1
    fi
    ;;
  *)
    die "Unknown operation: $OP. Supported: unassign, assign, close, merge, comment, label"
    ;;
esac
