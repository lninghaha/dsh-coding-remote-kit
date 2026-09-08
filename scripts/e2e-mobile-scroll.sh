#!/usr/bin/env bash
# Browser e2e stays entirely inside Docker with no host mounts or published CDP.
set -euo pipefail
cd "$(dirname "$0")/.."
IMAGE="${E2E_IMAGE:-test-dsh-mobile-remote:e2e}"
CHROME_IMAGE="chromedp/headless-shell@sha256:2d349b544a1ea6b5b5fd7c0fe99215ff662339c57407ee2e8c0a11af93516b04"
chrome_cid=""
runner_cid=""
if [[ -z "${E2E_IMAGE:-}" ]]; then
 docker build --target check --tag "$IMAGE" .
fi
cleanup() {
	[[ -n "$runner_cid" ]] && docker rm -f "$runner_cid" >/dev/null 2>&1 || true
	[[ -n "$chrome_cid" ]] && docker rm -f "$chrome_cid" >/dev/null 2>&1 || true
}
trap cleanup EXIT
chrome_cid="$(docker run -d --init --network none "$CHROME_IMAGE")"
runner_cid="$(docker run -d --init --network "container:$chrome_cid" -e CHROME_CDP=http://127.0.0.1:9222 -e E2E_PAGE_URL=http://127.0.0.1:19081/?e2e=list "$IMAGE" node tests/e2e-mobile-scroll.mjs)"
runner_status="$(docker wait "$runner_cid")"
docker logs "$runner_cid" >&2 || true
if [[ -n "${E2E_ARTIFACT_DIR:-}" ]]; then
	mkdir -p "$E2E_ARTIFACT_DIR"
	docker cp "$runner_cid:/workspace/output/." "$E2E_ARTIFACT_DIR/" 2>/dev/null || true
fi
if [[ "$runner_status" != 0 ]]; then
	docker logs "$chrome_cid" >&2 || true
	exit "$runner_status"
fi
