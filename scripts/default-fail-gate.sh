#!/bin/bash
# default-fail-gate.sh — Default-FAIL verification gate
# Inspired by Anthropic's cwc-long-running-agents (2026-05)
#
# Core principle: All criteria start FALSE. Each can only become TRUE
# when an evidence file exists and is non-empty. The agent cannot
# "claim" verification — it must produce artifacts.
#
# Usage:
#   default-fail-gate.sh init <evidence-dir>        — create checklist, all false
#   default-fail-gate.sh record <evidence-dir> <criterion> <file-or-stdin>
#                                                    — save evidence, flip to true
#   default-fail-gate.sh verify <evidence-dir>       — gate check, exit 1 if any false
#
# Criteria:
#   test-output    — test/lint command output
#   diff-stat      — git diff --stat output
#   verify-claims  — verify-claims.sh output
#   interface-check — mock/stub grep or "no interface changes" declaration
#
# Workflow integration:
#   implement node:  init → record each criterion as work proceeds
#   pre_push_audit:  verify → only passes if all criteria are TRUE

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

CRITERIA=("test-output" "diff-stat" "verify-claims" "interface-check")

usage() {
  echo "Usage:"
  echo "  $0 init <evidence-dir>"
  echo "  $0 record <evidence-dir> <criterion> [evidence-file]"
  echo "  $0 verify <evidence-dir>"
  echo ""
  echo "Criteria: ${CRITERIA[*]}"
  exit 1
}

ACTION="${1:-}"
EVIDENCE_DIR="${2:-}"

[ -z "$ACTION" ] || [ -z "$EVIDENCE_DIR" ] && usage

case "$ACTION" in
  init)
    mkdir -p "$EVIDENCE_DIR"
    # Create checklist with all criteria FALSE
    for c in "${CRITERIA[@]}"; do
      echo "false" > "$EVIDENCE_DIR/$c.status"
      rm -f "$EVIDENCE_DIR/$c.evidence"
    done
    echo -e "${YELLOW}Default-FAIL gate initialized: $EVIDENCE_DIR${NC}"
    echo "All ${#CRITERIA[@]} criteria set to FALSE."
    echo "Criteria: ${CRITERIA[*]}"
    ;;

  record)
    CRITERION="${3:-}"
    EVIDENCE_FILE="${4:-}"

    [ -z "$CRITERION" ] && { echo "Missing criterion name"; usage; }

    # Validate criterion name
    VALID=false
    for c in "${CRITERIA[@]}"; do
      [ "$c" = "$CRITERION" ] && VALID=true
    done
    $VALID || { echo -e "${RED}Unknown criterion: $CRITERION${NC}"; echo "Valid: ${CRITERIA[*]}"; exit 1; }

    # Check status file exists (init was called)
    [ -f "$EVIDENCE_DIR/$CRITERION.status" ] || { echo -e "${RED}Gate not initialized. Run: $0 init $EVIDENCE_DIR${NC}"; exit 1; }

    # Record evidence — from file or stdin
    if [ -n "$EVIDENCE_FILE" ] && [ -f "$EVIDENCE_FILE" ]; then
      cp "$EVIDENCE_FILE" "$EVIDENCE_DIR/$CRITERION.evidence"
    elif [ -n "$EVIDENCE_FILE" ] && [ "$EVIDENCE_FILE" != "-" ]; then
      # Treat as inline text
      echo "$EVIDENCE_FILE" > "$EVIDENCE_DIR/$CRITERION.evidence"
    else
      # Read from stdin
      cat > "$EVIDENCE_DIR/$CRITERION.evidence"
    fi

    # Verify evidence is non-empty
    if [ -s "$EVIDENCE_DIR/$CRITERION.evidence" ]; then
      echo "true" > "$EVIDENCE_DIR/$CRITERION.status"
      LINES=$(wc -l < "$EVIDENCE_DIR/$CRITERION.evidence" | tr -d ' ')
      echo -e "${GREEN}✅ $CRITERION → TRUE ($LINES lines of evidence)${NC}"
    else
      echo -e "${RED}❌ $CRITERION — evidence file is empty, stays FALSE${NC}"
      rm -f "$EVIDENCE_DIR/$CRITERION.evidence"
      exit 1
    fi
    ;;

  verify)
    [ -d "$EVIDENCE_DIR" ] || { echo -e "${RED}Evidence directory not found: $EVIDENCE_DIR${NC}"; exit 1; }

    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    echo "Default-FAIL Gate Verification"
    echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

    PASS=0
    FAIL=0

    for c in "${CRITERIA[@]}"; do
      STATUS_FILE="$EVIDENCE_DIR/$c.status"
      EVIDENCE="$EVIDENCE_DIR/$c.evidence"

      if [ ! -f "$STATUS_FILE" ]; then
        echo -e "${RED}❌ $c — not initialized${NC}"
        ((FAIL++))
        continue
      fi

      STATUS=$(cat "$STATUS_FILE")
      if [ "$STATUS" = "true" ] && [ -s "$EVIDENCE" ]; then
        LINES=$(wc -l < "$EVIDENCE" | tr -d ' ')
        echo -e "${GREEN}✅ $c — TRUE ($LINES lines)${NC}"
        ((PASS++))
      else
        echo -e "${RED}❌ $c — FALSE (no evidence)${NC}"
        ((FAIL++))
      fi
    done

    echo ""
    echo -e "Results: ${GREEN}$PASS pass${NC} / ${RED}$FAIL fail${NC}"
    echo ""

    if [ "$FAIL" -gt 0 ]; then
      echo -e "${RED}DEFAULT-FAIL GATE: BLOCKED${NC}"
      echo "Cannot proceed — $FAIL criteria still FALSE."
      echo "Record evidence with: $0 record $EVIDENCE_DIR <criterion> <file>"
      exit 1
    else
      echo -e "${GREEN}DEFAULT-FAIL GATE: ALL PASSED${NC}"
      exit 0
    fi
    ;;

  *)
    echo "Unknown action: $ACTION"
    usage
    ;;
esac
