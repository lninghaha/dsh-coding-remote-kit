/**
 * dshmr-e2ee v1 — frozen protocol constants.
 *
 * Shared verbatim by the server (node) and the mobile page (browser) so that
 * both ends derive identical bytes. Keep this file dependency-free.
 */

/** Mobile-side wire protocol version (the version `MOBILE_PROTOCOL_VERSION`). */
export const MOBILE_PROTOCOL_VERSION = 1;
/** Oldest mobile version this desktop accepts. */
export const MIN_COMPATIBLE_MOBILE_VERSION = 1;
/** Oldest desktop version the mobile page accepts. */
export const MIN_COMPATIBLE_DESKTOP_VERSION = 1;
/** E2EE handshake/session version tag. */
export const E2EE_VERSION = 1;

/** WS close: handshake or authentication failure. */
export const CLOSE_AUTH_FAILED = 4001;
/** WS close: handshake did not complete within 10s. */
export const CLOSE_HANDSHAKE_TIMEOUT = 4002;
/** WS close: >=5 consecutive decryption failures. */
export const CLOSE_DECRYPT_FAILURES = 4003;
/** WS close: connection limit exceeded or outbound buffer overflow. */
export const CLOSE_OVERLOAD = 1013;

/** RPC error codes (machine-readable). */
export const RPC_ERROR_CODES = [
	"forbidden",
	"unauthenticated",
	"unknown_method",
	"invalid_params",
	"version_incompatible",
	"upstream_error",
] as const;
export type RpcErrorCode = (typeof RPC_ERROR_CODES)[number];

/** Frame header `direction` byte. */
export const DIRECTION_MOBILE_TO_SERVER = 0;
export const DIRECTION_SERVER_TO_MOBILE = 1;

/** Frame header `payloadKind` byte. */
export const PAYLOAD_KIND_TEXT = 0;
export const PAYLOAD_KIND_BINARY = 1;

/** Sealed frame layout constants (bytes). */
export const SESSION_ID_LENGTH = 32;
export const HEADER_LENGTH = 42; // sessionId(32) + direction(1) + payloadKind(1) + counter_be64(8)
export const NONCE_LENGTH = 24; // 12 + 1 + 1 + 1 + 1 + 8
export const KEY_LENGTH = 32;

/** Connection governance (data plane). */
export const HANDSHAKE_TIMEOUT_MS = 10_000;
export const UNAUTHENTICATED_TIMEOUT_MS = 10_000;
export const HEARTBEAT_INTERVAL_MS = 15_000;
export const MAX_CONNECTIONS = 128;
export const MAX_DECRYPT_FAILURES = 5;
export const MAX_WS_PAYLOAD = 1 * 1024 * 1024;

/** Outbound backpressure (per connection). */
export const SOFT_BUFFER_LIMIT = 8 * 1024 * 1024;
export const HARD_QUEUE_LIMIT = 64 * 1024 * 1024;
export const MAX_QUEUED_FRAMES = 4096;
export const DRAIN_POLL_MS = 25;

/** Pairing offer limits. */
export const MAX_PENDING_OFFERS = 5;
export const DEFAULT_OFFER_TTL_MS = 600_000;
export const MAX_ENDPOINT_BYTES = 2 * 1024;
export const MAX_DEVICE_TOKEN_CHARS = 128;
export const MAX_PUBLIC_KEY_B64 = 64;
export const MAX_OFFER_CODE_BYTES = 16 * 1024;

/** Device metadata. */
export const DEVICE_SCOPE = "mobile";

/** Version stamps reported by `status.get`. */
export const PLUGIN_VERSION = "0.5.1";
export const DSH_VERSION = "0.1.0-rc.7";

/**
 * RPC methods the mobile data plane exposes. Anything outside this set is
 * answered `forbidden`. M3 is the full v0 surface (observe + short write).
 */
export const MOBILE_RPC_METHOD_ALLOWLIST = [
	"status.get",
	"session.list",
	"session.history",
	"session.subscribe",
	"session.unsubscribe",
	"host.subscribe",
	"session.prompt",
	"session.cancel",
	"session.create",
	"respond",
	"device.name",
] as const;
export type MobileRpcMethod = (typeof MOBILE_RPC_METHOD_ALLOWLIST)[number];

/** Domain-separation labels for the E2EE key schedule. */
export const TRANSCRIPT_DOMAIN = "dshmr-e2ee/v1/transcript";
export const SALT_LABEL = "dshmr-e2ee/v1/salt";
export const INFO_LABEL = "dshmr-e2ee/v1/session";

/** Capabilities / selection frames exchanged during the handshake. */
export const FRAMING = 1;
export const PAYLOAD_KINDS = ["text", "binary"] as const;

/** Context descriptor asserted equal on both ends of the handshake. */
export const HANDSHAKE_CONTEXT = {
	protocol: "dshmr-e2ee",
	initiator: "mobile",
	responder: "plugin",
	transport: "direct",
} as const;
