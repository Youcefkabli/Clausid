#!/bin/sh
set -eu
if [ "$#" -ne 2 ]; then
  echo 'Usage: sh scripts/cloudflare-template.sh <release-tag> <new-directory>' >&2
  exit 2
fi
tag=$1
destination=$2
git rev-parse --verify "refs/tags/$tag^{commit}" >/dev/null
mkdir "$destination"
archive=$(mktemp)
trap 'rm -f "$archive"' EXIT
git archive --format=tar --output="$archive" "refs/tags/$tag" -- \
  .node-version .dev.vars.example .gitignore LICENSE THIRD_PARTY_NOTICES.md README.md AGENTS.md \
  package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json vite.config.ts \
  wrangler.jsonc apps packages/contracts packages/pdf-engine deploy/d1 docs scripts/transfer.mjs scripts/cloudflare-deploy.mjs scripts/web-assets.mjs scripts/build-pdf-engine.mjs
tar -xf "$archive" -C "$destination"
