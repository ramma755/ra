#!/usr/bin/env bash
# Run this on YOUR machine (not the cloud agent) — uses your GitHub login.
set -euo pipefail

REPO="handshake-project-dynamo/dynamo-342b8ef-build-dependency-and-release-management"
FORK="ramma755/dynamo-342b8ef-build-dependency-and-release-management"
BRANCH="submission"
TASK_REF="cursor/release-gate-pass2-harder-27b6"
RA_REPO="ramma755/ra"

WORKDIR="${1:-$HOME/dynamo-task-deploy}"
TASK_SRC="$WORKDIR/.task-files"

echo "==> Working in $WORKDIR"
mkdir -p "$WORKDIR"
cd "$WORKDIR"

if [ ! -d dynamo-342b8ef-build-dependency-and-release-management ]; then
  gh repo clone "$FORK" dynamo-342b8ef-build-dependency-and-release-management
fi

cd dynamo-342b8ef-build-dependency-and-release-management

if git show-ref --verify --quiet refs/heads/"$BRANCH"; then
  git checkout "$BRANCH"
else
  git checkout -b "$BRANCH"
fi

echo "==> Downloading task files from $RA_REPO"
rm -rf "$TASK_SRC"
mkdir -p "$TASK_SRC"
gh api "repos/$RA_REPO/tarball/$TASK_REF" --jq . >/dev/null 2>&1 || true
curl -sL "https://github.com/$RA_REPO/archive/refs/heads/$TASK_REF.tar.gz" | tar -xz --strip-components=1 -C "$TASK_SRC"

cp -r "$TASK_SRC/dynamo-submission/task/"* task/
chmod +x task/solution/solve.sh task/tests/test.sh

echo "==> Validating with Harbor (optional — skip if not installed)"
if command -v harbor >/dev/null 2>&1; then
  (cd task && harbor run -p . --agent oracle)
  (cd task && harbor run -p . --agent nop)
fi

git add -A
if git diff --cached --quiet; then
  echo "No changes to commit."
else
  git commit -m "Task submission: dynamo/release-gate

Audit a staged Python release bundle against manifest and policy.
Oracle passes; nop fails."
fi

git push -u origin "$BRANCH"

echo ""
echo "==> Open PR:"
gh pr create --repo "$REPO" --head "$FORK:$BRANCH" \
  --title "Task submission: dynamo/release-gate" \
  --body "## One-sentence problem
The task is done when the agent audits the staged release bundle and writes a correct gate report to /app/release_gate.json.

## Success criteria (numbered, mirror instruction.md)
1. Write /app/release_gate.json with all six required keys.
2. Copy release_version from manifest.json.
3. Emit blocking issues for every rule violation (8 issue types defined in instruction).
4. Sort blocking_issues by (code, path, detail).
5. Set gate_passed true only when blocking_issue_count is zero.
6. Report manifested_artifact_count and disk_artifact_count.

## Calibration results
- Golden solve.sh: reward 1.0
- Bad / nop solution: reward < 1.0

## How to run
harbor run -p . --agent oracle
harbor run -p . --agent nop"

echo "Done."
