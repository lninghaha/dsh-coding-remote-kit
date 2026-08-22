/**
 * Minimal browser-global declarations shared by the mobile page and the client
 * settings panel. The project tsconfig compiles against `lib: ES2022` +
 * `types: node` only, so the DOM surface is declared here rather than pulling
 * in the full DOM lib (which fights `@types/node` over `setTimeout`).
 *
 * This file has no top-level import/export, so its declarations are global.
 */

interface CanvasRenderingContext2D {
	fillStyle: string;
	fillRect(x: number, y: number, width: number, height: number): void;
	clearRect(x: number, y: number, width: number, height: number): void;
}

interface DOMTokenListLike {
	add(...tokens: string[]): void;
	remove(...tokens: string[]): void;
}

interface HTMLElement {
	textContent: string;
	innerHTML: string;
	id: string;
	className: string;
	classList: DOMTokenListLike;
	style: Record<string, string>;
	value: string;
	disabled: boolean;
	checked: boolean;
	hidden: boolean;
	placeholder: string;
	type: string;
	name: string;
	scrollTop: number;
	scrollHeight: number;
	dataset: Record<string, string>;
	readonly children: { readonly length: number; item(index: number): HTMLElement | null };
	appendChild(child: HTMLElement): HTMLElement;
	append(...nodes: Array<HTMLElement | string>): void;
	removeChild(child: HTMLElement): HTMLElement;
	replaceChildren(...nodes: Array<HTMLElement | string>): void;
	setAttribute(name: string, value: string): void;
	getAttribute(name: string): string | null;
	addEventListener(type: string, listener: (event: EventLike) => void): void;
	remove(): void;
	focus(): void;
}

interface EventLike {
	preventDefault(): void;
	readonly target: HTMLElement | null;
	readonly key?: string;
}

interface HTMLCanvasElement extends HTMLElement {
	width: number;
	height: number;
	getContext(contextId: "2d"): CanvasRenderingContext2D | null;
}

interface Document {
	getElementById(id: string): HTMLElement | null;
	createElement(tag: string): HTMLElement;
	readonly body: HTMLElement;
	readonly activeElement?: HTMLElement | null;
	addEventListener(type: string, listener: (event: EventLike) => void): void;
	removeEventListener(type: string, listener: (event: EventLike) => void): void;
}

interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem(key: string): void;
}

interface LocationLike {
	readonly href: string;
	readonly hash: string;
	readonly origin: string;
	readonly host: string;
	reload(): void;
}

interface WebSocketMessageEvent {
	readonly data: string | ArrayBuffer;
}

interface WebSocketLike {
	readonly OPEN: number;
	readonly readyState: number;
	onopen: ((event: unknown) => void) | null;
	onmessage: ((event: WebSocketMessageEvent) => void) | null;
	onerror: ((event: unknown) => void) | null;
	onclose: ((event: { readonly code: number; readonly reason: string }) => void) | null;
	send(data: string | ArrayBuffer): void;
	close(code?: number, reason?: string): void;
}

declare const WebSocket: {
	new (url: string): WebSocketLike;
	readonly OPEN: number;
};

declare const document: Document;
declare const localStorage: StorageLike;
declare const location: LocationLike;
declare const window: {
	readonly location: LocationLike;
	readonly localStorage: StorageLike;
	setInterval(callback: () => void, ms: number): number;
	clearInterval(id: number): void;
};

declare function setInterval(callback: () => void, ms: number): number;
declare function clearInterval(id: number): void;

interface ResponseLike {
	readonly ok: boolean;
	readonly status: number;
	json(): Promise<unknown>;
}

declare function fetch(
	url: string,
	init?: { method?: string; headers?: Record<string, string>; body?: string },
): Promise<ResponseLike>;
