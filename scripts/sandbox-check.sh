#!/usr/bin/env bash
# Host-side wrapper: build Docker sandbox targets. Does not bind host 3080/7890,
# does not mount ~/.dsh, and does not start a long-running container.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"

cleanup() {
	local ids
	ids="$(docker ps -aq --filter "name=test-dsh-mobile-remote" || true)"
	if [[ -n "${ids}" ]]; then
		# shellcheck disable=SC2086
		docker rm -f ${ids} >/dev/null
	fi
}
trap cleanup EXIT

docker build --target check --tag test-dsh-mobile-remote:check .
docker build --target isolated-install --tag test-dsh-mobile-remote:isolated-install .
docker build --target verify --tag test-dsh-mobile-remote:verify .
echo "sandbox verify ok: test-dsh-mobile-remote:verify"
