#!/usr/bin/env bash
# Browser e2e: nginx + headless Chrome on a user-defined docker network.
# Host only maps CDP 19082. No 3080/7890, no --network host.
set -euo pipefail
cd "$(dirname "$0")/.."
node build/build-mobile.mjs
chmod a+rX lib/mobile lib/mobile/*
NET=test-dsh-mr-e2e
cleanup() {
	docker rm -f test-dsh-mobile-scroll test-dsh-mobile-static >/dev/null 2>&1 || true
	docker network rm "$NET" >/dev/null 2>&1 || true
}
trap cleanup EXIT
cleanup
docker network create "$NET" >/dev/null
docker run -d --name test-dsh-mobile-static --network "$NET" \
	-v "$PWD/lib/mobile:/usr/share/nginx/html:ro" \
	-v "$PWD/tests/e2e-nginx.conf:/etc/nginx/conf.d/default.conf:ro" \
	nginx:alpine >/dev/null
docker run -d --name test-dsh-mobile-scroll --network "$NET" \
	-p 19082:9222 \
	chromedp/headless-shell:latest >/dev/null
ok=0
for _ in $(seq 1 40); do
	if curl -sf -m 1 http://127.0.0.1:19082/json/version >/dev/null; then
		ok=1
		break
	fi
	sleep 0.25
done
if [[ "$ok" != 1 ]]; then
	echo "chrome CDP did not come up on 19082" >&2
	docker logs test-dsh-mobile-scroll >&2 || true
	exit 1
fi
export CHROME_CDP=http://127.0.0.1:19082
export E2E_NO_SERVE=1
export E2E_PAGE_URL='http://test-dsh-mobile-static/?e2e=list'
node tests/e2e-mobile-scroll.mjs
