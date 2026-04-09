#!/bin/bash
# Recursive Self-Improvement Loop
# Runs continuously: audit → identify → execute → verify → commit → repeat
# Stop with Ctrl+C or when ceiling is reached

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

export ANTHROPIC_API_KEY="${ANTHROPIC_API_KEY:?Set ANTHROPIC_API_KEY}"

CYCLE=0
MAX_STALE=3  # stop after N cycles with no test count increase
STALE=0
LAST_TEST_COUNT=0
LOG_DIR="$ROOT/.self-improve/logs"
mkdir -p "$LOG_DIR"

log() { echo "[$(date '+%H:%M:%S')] $1"; }

while true; do
  CYCLE=$((CYCLE + 1))
  log "═══════════════════════════════════════════════"
  log "  CYCLE $CYCLE"
  log "═══════════════════════════════════════════════"

  # 1. AUDIT — get current state and next task
  log "Phase 1: AUDIT + IDENTIFY"
  TASK_JSON=$(cd packages/core && npx tsx ../../scripts/self-improve.ts 2>/dev/null || echo '{"task":null}')

  TASK_DESC=$(echo "$TASK_JSON" | grep -o '"description":"[^"]*"' | head -1 | sed 's/"description":"//;s/"$//')
  TASK_ID=$(echo "$TASK_JSON" | grep -o '"id":"[^"]*"' | head -1 | sed 's/"id":"//;s/"$//')
  TEST_COUNT=$(echo "$TASK_JSON" | grep -o '"testCount":[0-9]*' | head -1 | sed 's/"testCount"://')

  if [ -z "$TASK_DESC" ] || [ "$TASK_DESC" = "null" ]; then
    log "CEILING REACHED — no more tasks"
    break
  fi

  log "Task: [$TASK_ID] $TASK_DESC"
  log "Current tests: $TEST_COUNT"

  # 2. EXECUTE — run Claude to implement the task
  log "Phase 2: EXECUTE"
  LOGFILE="$LOG_DIR/cycle-${CYCLE}-${TASK_ID}.log"

  claude -p "You are improving the structured-world-model codebase at $ROOT/packages/core.

TASK: $TASK_DESC

RULES:
- Read the relevant files first to understand existing patterns
- Make the minimal change needed
- Add tests for any new functionality
- Run: cd $ROOT && pnpm test to verify all tests pass (must be 0 failures)
- Run: cd $ROOT && pnpm --filter @swm/core typecheck to verify type safety
- If tests fail, fix the issue or revert your change
- Do NOT touch files outside packages/core/ unless the task specifically requires it
- Do NOT add comments explaining what you did — the code should be self-evident

CONTEXT:
- packages/core/src/ contains the source
- packages/core/test/unit/ contains tests using a simple assert-based runner
- The test runner is at packages/core/test/run-unit.ts
- Current test count: $TEST_COUNT
- API key is set for E2E tests if needed

After completing, tell me: what you changed, how many tests now pass, and whether typecheck is clean." \
    --allowedTools 'Bash,Read,Write,Edit,Glob,Grep' \
    --output-file "$LOGFILE" \
    2>&1 | tail -5

  # 3. VERIFY
  log "Phase 3: VERIFY"
  cd "$ROOT"
  TEST_OUTPUT=$(pnpm test 2>&1 | tail -3)
  NEW_COUNT=$(echo "$TEST_OUTPUT" | grep -o '[0-9]*/[0-9]* unit tests passed' | head -1 | sed 's/\/.*//')

  if echo "$TEST_OUTPUT" | grep -q "passed"; then
    log "Tests: $NEW_COUNT passed"

    TC_OUTPUT=$(pnpm --filter @swm/core typecheck 2>&1 | tail -1)
    if echo "$TC_OUTPUT" | grep -q "error TS"; then
      log "TYPECHECK FAILED — reverting"
      git checkout -- .
      STALE=$((STALE + 1))
    else
      # 4. COMMIT
      log "Phase 4: COMMIT"
      git add -A
      git commit -m "improve: [$TASK_ID] $TASK_DESC

Automated self-improvement cycle $CYCLE.
Tests: $LAST_TEST_COUNT → $NEW_COUNT

Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>" 2>/dev/null || true

      git push origin feat/unified-monorepo 2>/dev/null || true

      # Mark task complete in state
      if [ -f "$ROOT/.self-improve/state.json" ]; then
        # Append task ID to improvements array
        python3 -c "
import json
with open('$ROOT/.self-improve/state.json') as f: s=json.load(f)
s['improvements'].append('$TASK_ID')
s['lastTestCount']=$NEW_COUNT
with open('$ROOT/.self-improve/state.json','w') as f: json.dump(s,f,indent=2)
" 2>/dev/null || true
      fi

      if [ -n "$NEW_COUNT" ] && [ "$NEW_COUNT" -gt "$LAST_TEST_COUNT" ]; then
        log "IMPROVED: $LAST_TEST_COUNT → $NEW_COUNT tests"
        STALE=0
      else
        STALE=$((STALE + 1))
        log "NO TEST INCREASE (stale: $STALE/$MAX_STALE)"
      fi
      LAST_TEST_COUNT=${NEW_COUNT:-$LAST_TEST_COUNT}
    fi
  else
    log "TESTS FAILED — reverting"
    git checkout -- .
    STALE=$((STALE + 1))
  fi

  # 5. CONVERGENCE CHECK
  if [ $STALE -ge $MAX_STALE ]; then
    log "CONVERGED — $MAX_STALE consecutive cycles without test increase"
    break
  fi

  log "Cycle $CYCLE complete. Next in 10s..."
  sleep 10
done

log "═══════════════════════════════════════════════"
log "  SELF-IMPROVEMENT COMPLETE"
log "  Cycles: $CYCLE | Tests: $LAST_TEST_COUNT | Stale: $STALE"
log "═══════════════════════════════════════════════"
