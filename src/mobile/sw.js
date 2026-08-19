/* DSH mobile remote: cache static shell only. Never touch fragments or WS. */
const CACHE = "dshmr-shell-v1";
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
