/**
 * Per-connection outbound backpressure.
 *
 * Frames are encrypted only when they are actually written (dequeue time), so
 * a frame that never drains never consumes a counter. Above 8MiB of kernel
 * buffering the queue absorbs frames; a 25ms timer drains it. A queue larger
 * than 64MiB or 4096 frames trips the hard limit and the connection is closed
 * with 1013.
 */

import { DRAIN_POLL_MS, HARD_QUEUE_LIMIT, MAX_QUEUED_FRAMES, SOFT_BUFFER_LIMIT } from "../shared/constants.js";

/** True once the socket's own buffer exceeds the soft (queue) threshold. */
export function exceedsSoftLimit(bufferedAmount: number): boolean {
	return bufferedAmount > SOFT_BUFFER_LIMIT;
}

/** True once the outbound queue exceeds a hard (close) threshold. */
export function exceedsHardLimit(queuedBytes: number, queuedFrames: number): boolean {
	return queuedBytes > HARD_QUEUE_LIMIT || queuedFrames > MAX_QUEUED_FRAMES;
}

export interface OutboundSink {
	readonly bufferedAmount: number;
	send(data: Uint8Array, isBinary?: boolean): void;
	close(code: number, reason?: string): void;
}

export type FrameEncode = (payload: Uint8Array) => Uint8Array;

interface QueuedFrame {
	readonly payload: Uint8Array;
}

export class FrameQueue {
	readonly #sink: OutboundSink;
	readonly #encode: FrameEncode;
	readonly #frames: QueuedFrame[] = [];
	#bytes = 0;
	#timer: ReturnType<typeof setInterval> | null = null;

	constructor(sink: OutboundSink, encode: FrameEncode) {
		this.#sink = sink;
		this.#encode = encode;
	}

	get queuedFrames(): number {
		return this.#frames.length;
	}

	get queuedBytes(): number {
		return this.#bytes;
	}

	/**
	 * Enqueue a plaintext payload. Returns "sent" when written immediately,
	 * "queued" when buffered, or "overflow" after closing the socket (1013).
	 */
	enqueue(payload: Uint8Array): "sent" | "queued" | "overflow" {
		if (exceedsHardLimit(this.#bytes, this.#frames.length)) {
			this.#sink.close(1013, "outbound queue overflow");
			return "overflow";
		}
		if (this.#frames.length > 0 || exceedsSoftLimit(this.#sink.bufferedAmount)) {
			this.#frames.push({ payload });
			this.#bytes += payload.length;
			return "queued";
		}
		this.#sink.send(this.#encode(payload));
		return "sent";
	}

	/** Flush as many queued frames as the socket will accept. */
	drain(): void {
		while (this.#frames.length > 0 && !exceedsSoftLimit(this.#sink.bufferedAmount)) {
			const frame = this.#frames[0]!;
			this.#sink.send(this.#encode(frame.payload));
			this.#bytes -= frame.payload.length;
			this.#frames.shift();
		}
	}

	/** Start the 25ms drain poll. */
	start(): void {
		if (this.#timer !== null) return;
		this.#timer = setInterval(() => this.drain(), DRAIN_POLL_MS);
	}

	/** Stop the drain poll. */
	stop(): void {
		if (this.#timer !== null) {
			clearInterval(this.#timer);
			this.#timer = null;
		}
	}
}
