#!/usr/bin/env bash
set -euo pipefail

cd /workspace/agizahub
npm install --include=dev --prefer-offline --no-audit --no-fund
echo "AgizaHub environment ready in /workspace/agizahub"
