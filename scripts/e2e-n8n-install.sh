#!/usr/bin/env bash
# Installs the package published on npm through a real n8n server, the way a user does.
# n8n installs from the registry, so this covers the published version, not local changes.
#
# Fails when the node cannot be installed or run with unverified packages enabled.
# Only warns when n8n's handling of unverified packages differs from what the README describes,
# because that needs a documentation update rather than a code fix.
#
# Usage: scripts/e2e-n8n-install.sh [n8n image tag, default: stable]
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
tag="${1:-stable}"
image="n8nio/n8n:$tag"
port=15678
base="http://127.0.0.1:$port"
suffix="$$"
container="free-pdf-e2e-$suffix"
volume="free-pdf-e2e-$suffix"
work="$(mktemp -d)"
jar="$work/cookies"
email=e2e@example.test
password="Aa1$(openssl rand -hex 12)"
unverified_setting=N8N_UNVERIFIED_PACKAGES_ENABLED

cleanup() {
	docker rm -f "$container" >/dev/null 2>&1 || true
	docker volume rm "$volume" >/dev/null 2>&1 || true
	rm -rf "$work"
}
trap cleanup EXIT

warn() {
	if [ -n "${GITHUB_ACTIONS:-}" ]; then
		echo "::warning title=n8n $tag::$1"
	else
		echo "WARNING: $1"
	fi
}

start_server() {
	docker rm -f "$container" >/dev/null 2>&1 || true
	docker run -d --name "$container" -p "127.0.0.1:$port:5678" \
		-v "$volume:/home/node/.n8n" -v "$work/files:/home/node/.n8n-files" \
		-e N8N_SECURE_COOKIE=false -e N8N_RESTRICT_FILE_ACCESS_TO=/home/node/.n8n-files \
		"$@" "$image" >/dev/null

	for _ in $(seq 1 90); do
		if [ "$(curl -s -o /dev/null -w '%{http_code}' "$base/healthz/readiness")" = 200 ]; then
			return 0
		fi
		sleep 2
	done
	docker logs --tail 30 "$container"
	echo 'n8n did not become ready' >&2
	exit 1
}

post() {
	curl -s -b "$jar" -c "$jar" -H 'Content-Type: application/json' -H 'browser-id: e2e' \
		-o "$work/response" -w '%{http_code}' -d "$2" "$base$1"
}

install_package() {
	post /rest/community-packages '{"name":"n8n-nodes-free-pdf-to-text"}'
}

node_is_listed() {
	# n8n can need a moment to load a package. The list is saved first because `grep -q` on a pipe
	# would end curl early, which `pipefail` reports as a failure.
	for _ in $(seq 1 15); do
		curl -s -b "$jar" -H 'browser-id: e2e' -o "$work/nodes.json" "$base/types/nodes.json"
		if grep -q freePdfToText "$work/nodes.json"; then
			return 0
		fi
		sleep 2
	done
	return 1
}

workflow_passes() {
	docker exec "$container" n8n import:workflow \
		--input=/home/node/.n8n-files/workflow.json >/dev/null 2>&1
	local output
	output="$(docker exec "$container" sh -c \
		'N8N_RUNNERS_BROKER_PORT=5690 N8N_PORT=5691 n8n execute --id=freePdfToTextE2e --rawOutput' 2>&1)"
	(cd "$root" && node scripts/e2e-assert.mjs "$output")
}

mkdir -p "$work/files"
node "$root/scripts/e2e-fixture.mjs" "$work/files/e2e.pdf"
cp "$root/test/e2e/workflow.json" "$work/files/workflow.json"
chmod -R a+rwX "$work"
docker volume create "$volume" >/dev/null

echo "Testing the published package in $image"

start_server
post /rest/owner/setup \
	"{\"email\":\"$email\",\"firstName\":\"E2E\",\"lastName\":\"Test\",\"password\":\"$password\"}" >/dev/null
if [ "$(install_package)" = 400 ]; then
	echo 'Default settings: installation refused, as the README describes for n8n 3.'
else
	echo 'Default settings: installation was not refused.'
	case "$tag" in
	3.*) warn "n8n no longer refuses this unverified package by default. Review the README." ;;
	esac
fi

start_server -e "$unverified_setting=true"
post /rest/login "{\"emailOrLdapLoginId\":\"$email\",\"password\":\"$password\"}" >/dev/null
status="$(install_package)"
# 400 means the first step of this test already installed the package.
if [ "$status" != 200 ] && ! grep -q 'already installed' "$work/response"; then
	cut -c1-400 "$work/response" >&2
	echo "Installation with $unverified_setting=true failed with HTTP $status." >&2
	exit 1
fi
if ! node_is_listed; then
	echo 'The node is not available in n8n after installation.' >&2
	exit 1
fi
workflow_passes
echo "$unverified_setting=true: installed through n8n and the workflow ran."

start_server
post /rest/login "{\"emailOrLdapLoginId\":\"$email\",\"password\":\"$password\"}" >/dev/null
if node_is_listed && workflow_passes >/dev/null 2>&1; then
	echo 'Restart with default settings: the installed node keeps working.'
else
	warn "An installed unverified package stops working with default settings. Review the README."
fi

echo 'n8n installation test passed.'
