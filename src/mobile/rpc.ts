/**
 * Mobile RPC client: request/response correlation + push dispatch.
 *
 * The data-plane envelope is `{id, method, params?}` → `{id, ok, result|error}`.
 * Server pushes arrive as `{push, data, rpcId?}` on the same encrypted channel.
 */

export interface MobileRpcError {
	readonly code: string;
	readonly message: string;
}

export interface MobilePush {
	readonly push: string;
	readonly data: unknown;
	readonly rpcId?: string;
}

export type MobilePushHandler = (push: MobilePush) => void;

interface Pending {
	readonly resolve: (value: unknown) => void;
	readonly reject: (error: Error) => void;
}

export class MobileRpcClient {
	readonly #send: (value: unknown) => void;
	readonly #pending = new Map<string | number, Pending>();
	#nextId = 1;
	readonly #pushHandlers = new Set<MobilePushHandler>();
	#failureReason: string | null = null;

	constructor(send: (value: unknown) => void) {
		this.#send = send;
	}

	onPush(handler: MobilePushHandler): () => void {
		this.#pushHandlers.add(handler);
		let subscribed = true;
		return () => {
			if (!subscribed) return;
			subscribed = false;
			this.#pushHandlers.delete(handler);
		};
	}

	request(method: string, params?: Record<string, unknown>): Promise<unknown> {
		if (this.#failureReason !== null) return Promise.reject(new Error(this.#failureReason));
		const id = this.#nextId;
		this.#nextId += 1;
		return new Promise((resolve, reject) => {
			this.#pending.set(id, { resolve, reject });
			try {
				this.#send(params === undefined ? { id, method } : { id, method, params });
			} catch (error) {
				this.#pending.delete(id);
				reject(error instanceof Error ? error : new Error("request send failed"));
			}
		});
	}

	handleMessage(message: Record<string, unknown>): void {
		if (typeof message.push === "string") {
			const rpcId = typeof message.rpcId === "string" ? message.rpcId : undefined;
			const push: MobilePush = {
				push: message.push,
				data: message.data,
				...(rpcId === undefined ? {} : { rpcId }),
			};
			for (const handler of [...this.#pushHandlers]) handler(push);
			return;
		}
		const id = message.id;
		if (typeof id !== "string" && typeof id !== "number") return;
		const pending = this.#pending.get(id);
		if (pending === undefined) return;
		this.#pending.delete(id);
		if (message.ok === true) {
			pending.resolve(message.result);
			return;
		}
		const err = message.error as { code?: string; message?: string } | undefined;
		const code = typeof err?.code === "string" ? err.code : "upstream_error";
		const text = typeof err?.message === "string" ? err.message : "request failed";
		pending.reject(new Error(`${code}: ${text}`));
	}

	failAll(reason: string): void {
		this.#failureReason = reason;
		for (const pending of this.#pending.values()) pending.reject(new Error(reason));
		this.#pending.clear();
	}
}

export function asRecord(value: unknown): Record<string, unknown> | null {
	if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

export function extractText(value: unknown): string {
	if (typeof value === "string") return value;
	const record = asRecord(value);
	if (record === null) {
		if (Array.isArray(value)) return value.map(extractText).filter((part) => part.length > 0).join("");
		return "";
	}
	if (typeof record.text === "string") return record.text;
	if (typeof record.content === "string") return record.content;
	if (Array.isArray(record.content)) return record.content.map(extractText).filter((part) => part.length > 0).join("");
	if (record.message !== undefined) return extractText(record.message);
	if (record.chunk !== undefined) return extractText(record.chunk);
	if (record.delta !== undefined) return extractText(record.delta);
	return "";
}
