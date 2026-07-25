#!/usr/bin/env bash
# Deploy dynamo-submission/task to the Dynamo fork from a cloud agent or CI.
# Requires: DYNAMO_DEPLOY_TOKEN (PAT with repo scope on ramma755/dynamo-... fork)
set -euo pipefail

FORK="ramma755/dynamo-342b8ef-build-dependency-and-release-management"
UPSTREAM="handshake-project-dynamo/dynamo-342b8ef-build-dependency-and-release-management"
BRANCH="submission"
TASK_SRC="${TASK_SRC:-$(cd "$(dirname "$0")/.." && pwd)/dynamo-submission/task}"
WORKDIR="${WORKDIR:-/tmp/dynamo-fork-deploy}"

if [ ! -d "$TASK_SRC" ]; then
  echo "ERROR: task source not found at $TASK_SRC" >&2
  exit 1
fi

TOKEN="${DYNAMO_DEPLOY_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "ERROR: set DYNAMO_DEPLOY_TOKEN to a PAT that can push to $FORK" >&2
  exit 1
fi

export GH_TOKEN="$TOKEN"

rm -rf "$WORKDIR"
git clone "https://x-access-token:${TOKEN}@github.com/${FORK}.git" "$WORKDIR"
cd "$WORKDIR"

git show main:task/task.toml > /tmp/scaffold-task.toml

git checkout "$BRANCH" 2>/dev/null || git checkout -b "$BRANCH"

cp -r "$TASK_SRC/"* task/
chmod +x task/solution/solve.sh task/tests/test.sh

python3 << 'PY'
from pathlib import Path

scaffold = Path("/tmp/scaffold-task.toml").read_text().splitlines()
ours = Path("task/task.toml").read_text().splitlines()
cat = next(l for l in scaffold if l.startswith("category"))
sub = next(l for l in scaffold if l.startswith("subcategory"))
out = []
for line in ours:
    if line.startswith("category"):
        out.append(cat)
    elif line.startswith("subcategory"):
        out.append(sub)
    else:
        out.append(line)
Path("task/task.toml").write_text("\n".join(out) + "\n")
PY

git add -A
if git diff --cached --quiet; then
  echo "No changes to deploy."
  exit 0
fi

git -c user.name="cursor-agent" -c user.email="cursor-agent@users.noreply.github.com" \
  commit -m "Task submission: dynamo/release-gate (agent deploy)"

git push -u origin "$BRANCH"

gh pr create \
  --repo "$UPSTREAM" \
  --head "ramma755:${BRANCH}" \
  --title "Task submission: dynamo/release-gate" \
  --body "Automated deploy from ramma755/ra cloud agent." 2>/dev/null || true

echo "Deployed to ${FORK}:${BRANCH} — PR: https://github.com/${UPSTREAM}/pull/1"
