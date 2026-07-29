#!/usr/bin/env bash
set -euo pipefail

cd /workspace/agizahub

NODE_MAJOR="$(node -p 'process.versions.node.split(`.`)[0]')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node >=20 required (node-cron@4). Current: $(node -v)"
  exit 1
fi

npm install --include=dev --no-audit --no-fund

node - <<'NODE'
const pkgs = ["express", "pg", "openai", "axios", "node-cron", "nodemon"];
for (const p of pkgs) require.resolve(p);
console.log("Dependency check OK:", pkgs.join(", "));
NODE

npm run check
