import { z } from "zod";

/**
 * Bind address for the mobile data plane.
 *
 * v0 only intends `127.0.0.1` / `0.0.0.0`. The IPv4 union is reserved so M2
 * can accept Tailscale (or other overlay) addresses without a schema break.
 * Unknown values fall back to loopback.
 */
const BindAddressSchema = z
	.enum(["127.0.0.1", "0.0.0.0"])
	.or(z.string().regex(/^\d{1,3}(\.\d{1,3}){3}$/))
	.catch("127.0.0.1");

export const RuntimeConfigSchema = z
	.object({
		enabled: z.boolean().default(true),
		bind: BindAddressSchema,
		port: z.number().int().min(1024).max(65_535).default(6879),
		offerTtlMs: z.number().int().default(600_000),
		/** Extra Host names allowed when the TCP peer is loopback (Caddy). */
		trustedHosts: z.array(z.string().min(1)).default([]),
	})
	.strict();

export type RuntimeConfig = z.infer<typeof RuntimeConfigSchema>;
