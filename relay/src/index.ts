import { RELAY_PROTOCOL } from "../../src/shared/relay.ts";
import { PLUGIN_VERSION } from "../../src/shared/constants.ts";
import { MOBILE_SHELL_SECURITY_HEADERS } from "../../src/shared/mobile-shell-headers.ts";
import { json, RendezvousRoom, type RelayEnv } from "./rendezvous.ts";

export { RendezvousRoom };

function room(env: RelayEnv) {
	return env.RENDEZVOUS.get(env.RENDEZVOUS.idFromName("singleton"));
}

/** Mirror the data plane's shell headers on Worker-served `/m` assets. */
function withMobileShellHeaders(asset: Response): Response {
	const headers = new Headers(asset.headers);
	for (const [name, value] of Object.entries(MOBILE_SHELL_SECURITY_HEADERS)) headers.set(name, value);
	return new Response(asset.body, { status: asset.status, statusText: asset.statusText, headers });
}

export default {
	async fetch(request: Request, env: RelayEnv): Promise<Response> {
		const url = new URL(request.url);
		if (url.pathname === "/health") {
			return json({ ok: true, protocol: RELAY_PROTOCOL, pluginVersion: PLUGIN_VERSION });
		}
		if (url.pathname === "/m/claim") {
			if (request.method !== "POST") {
				return json({ ok: false, error: { code: "method-not-allowed", message: "POST only" } }, 405);
			}
			const forwarded = new Request(new URL("/internal/claim", url.origin), {
				method: "POST",
				headers: {
					"content-type": "application/json",
					"x-claim-ip": request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for") ?? "unknown",
				},
				body: request.body,
			});
			return room(env).fetch(forwarded);
		}
		if (request.headers.get("Upgrade") === "websocket") {
			if (url.pathname === "/v1/host" || url.pathname.startsWith("/v1/phone/") || url.pathname.startsWith("/v1/accept/")) {
				return room(env).fetch(request);
			}
			return json({ ok: false, error: { code: "not-found", message: "unknown socket" } }, 404);
		}
		if (url.pathname === "/m" || url.pathname.startsWith("/m/")) {
			if (env.ASSETS === undefined) {
				return new Response("mobile assets missing; run pnpm build before wrangler deploy", {
					status: 503,
					headers: { "cache-control": "no-store" },
				});
			}
			return withMobileShellHeaders(await env.ASSETS.fetch(request));
		}
		return json({ ok: false, error: { code: "not-found", message: "not found" } }, 404);
	},
};
