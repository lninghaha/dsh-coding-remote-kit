/* DSH mobile remote: cache static shell only. Never touch fragments or WS. */
/* `__DSHMR_SHELL_VERSION__` is replaced by build/build-mobile.mjs with the package version so every release invalidates the cached shell. */
const CACHE = "dshmr-shell-__DSHMR_SHELL_VERSION__";
const PRECACHE = ["/m/", "/m/app.js", "/m/manifest.webmanifest", "/m/icons/icon-192.png", "/m/icons/icon-512.png"];

self.addEventListener("install", (event) => {
	event.waitUntil(
		caches.open(CACHE).then((cache) => cache.addAll(PRECACHE)).then(() => self.skipWaiting()),
	);
});

self.addEventListener("activate", (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
			.then(() => self.clients.claim()),
	);
});

self.addEventListener("fetch", (event) => {
	const request = event.request;
	if (request.method !== "GET") return;
	const url = new URL(request.url);
	if (url.origin !== self.location.origin || !url.pathname.startsWith("/m")) return;
	if (url.pathname === "/m/sw.js") return;
	event.respondWith(
		caches.match(request).then((hit) => {
			if (hit) return hit;
			return fetch(request);
		}),
	);
});
