/**
 * Response headers for the mobile shell (`/m`, `/m/*`) on every delivery
 * surface: the data plane (`src/server/dataplane.ts`) and the rendezvous
 * Worker assets (`relay/src/index.ts`).
 *
 * The shell ships no inline scripts, so `script-src 'self'` holds; the inline
 * `<style>` block in `index.html` is the only reason styles allow inline. The
 * WebSocket target comes from the pairing offer (`offer.endpoint`), which may
 * name a LAN candidate that differs from the page origin or the rendezvous
 * origin, so `connect-src` allows same-origin plus `ws:` / `wss:`. CSP does
 * not close the LAN MITM delivery gap in `docs/04-threat-model.md`; it bounds
 * what an injection into a legitimately delivered page can do.
 */
export const MOBILE_SHELL_CSP = [
	"default-src 'none'",
	"script-src 'self'",
	"style-src 'self' 'unsafe-inline'",
	"img-src 'self'",
	"connect-src 'self' ws: wss:",
	"manifest-src 'self'",
	"worker-src 'self'",
	"base-uri 'none'",
	"form-action 'none'",
	"frame-ancestors 'none'",
].join("; ");

export const MOBILE_SHELL_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
	"content-security-policy": MOBILE_SHELL_CSP,
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
});
