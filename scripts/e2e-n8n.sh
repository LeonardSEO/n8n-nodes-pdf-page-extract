#!/usr/bin/env bash
# Installs the packed npm tarball into a real n8n container and runs a workflow through it.
# Usage: scripts/e2e-n8n.sh [n8n image tag, default: stable]
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tag="${1:-stable}"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

cd "$root"
npm pack --silent --pack-destination "$work" >/dev/null

mkdir -p "$work/nodes" "$work/files"
(cd "$work/nodes" && npm init -y >/dev/null && npm install --omit=dev --silent "$work"/*.tgz)
node scripts/e2e-fixture.mjs "$work/files/e2e.pdf"
cp test/e2e/workflow.json "$work/files/workflow.json"
chmod -R a+rwX "$work"

output="$(docker run --rm \
	-v "$work/nodes:/home/node/.n8n/nodes" \
	-v "$work/files:/home/node/.n8n-files" \
	-e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=false \
	-e N8N_RESTRICT_FILE_ACCESS_TO=/home/node/.n8n-files \
	--entrypoint sh "n8nio/n8n:$tag" -c \
	'n8n import:workflow --input=/home/node/.n8n-files/workflow.json >/dev/null 2>&1 &&
	 n8n execute --id=freePdfToTextE2e --rawOutput' 2>&1)" || {
	echo "$output"
	echo "n8n execution failed" >&2
	exit 1
}

node scripts/e2e-assert.mjs "$output"
