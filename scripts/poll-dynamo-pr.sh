#!/usr/bin/env bash
# Poll Dynamo PR #1 until pass@2 pre-check finishes or timeout.
# Requires: DYNAMO_DEPLOY_TOKEN (read access to upstream PR checks/comments)
set -euo pipefail

UPSTREAM="handshake-project-dynamo/dynamo-342b8ef-build-dependency-and-release-management"
PR_NUMBER="${PR_NUMBER:-1}"
TIMEOUT_SEC="${TIMEOUT_SEC:-2700}"
INTERVAL_SEC="${INTERVAL_SEC:-60}"

TOKEN="${DYNAMO_DEPLOY_TOKEN:-${GH_TOKEN:-}}"
if [ -z "$TOKEN" ]; then
  echo "ERROR: set DYNAMO_DEPLOY_TOKEN (or GH_TOKEN)" >&2
  exit 1
fi

export GH_TOKEN="$TOKEN"

deadline=$((SECONDS + TIMEOUT_SEC))

echo "Polling https://github.com/${UPSTREAM}/pull/${PR_NUMBER} (timeout ${TIMEOUT_SEC}s)..."

while [ "$SECONDS" -lt "$deadline" ]; do
  # pass@2 job status
  pass2_status=$(gh api "repos/${UPSTREAM}/commits/$(gh pr view "$PR_NUMBER" --repo "$UPSTREAM" --json headRefOid -q .headRefOid)/check-runs" \
    --jq '.check_runs[] | select(.name | test("pass2"; "i")) | .conclusion' 2>/dev/null | head -1 || true)

  if [ "$pass2_status" = "success" ] || [ "$pass2_status" = "failure" ]; then
    echo "pass@2 check concluded: $pass2_status"
    latest=$(gh api "repos/${UPSTREAM}/issues/${PR_NUMBER}/comments" \
      --jq '[.[] | select(.user.login == "github-actions[bot]") | select(.body | test("pass@2"; "i"))] | last | .body' 2>/dev/null || true)
    if [ -n "$latest" ] && [ "$latest" != "null" ]; then
      echo "$latest" | head -40
      if echo "$latest" | grep -q "pass@2: 2/2 passed"; then
        echo "VERDICT: TOO_EASY (need at least one valid fail)"
        exit 2
      fi
      if echo "$latest" | grep -qE "pass@2: [01]/2 passed"; then
        echo "VERDICT: PASS2_OK"
        exit 0
      fi
      if echo "$latest" | grep -qi "Blocked — no valid fail"; then
        echo "VERDICT: TOO_EASY"
        exit 2
      fi
    fi
    echo "VERDICT: PASS2_DONE (parse comment manually)"
    exit 0
  fi

  running=$(gh pr checks "$PR_NUMBER" --repo "$UPSTREAM" 2>/dev/null | grep -i pass2 || true)
  echo "[$(date -u +%H:%M:%S)] waiting... ${running:-checks pending}"
  sleep "$INTERVAL_SEC"
done

echo "TIMEOUT waiting for pass@2"
exit 3
