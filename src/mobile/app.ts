/**
 * Connected mobile UI: session list, transcript, short reply, approval / question cards.
 */

import { asRecord, extractText, type MobilePush, type MobileRpcClient } from "./rpc.js";

export interface SessionRow {
	sessionId: string;
	title?: string;
	running: boolean;
	blank: boolean;
	updatedAt: number;
	cwd?: string;
}

interface TranscriptLine {
	key: string;
	role: "user" | "assistant" | "tool" | "system";
	text: string;
}

interface PendingApproval {
	rpcId: string;
	sessionId: string;
	approvalId: string;
	toolName: string;
	reason?: string;
}

interface PendingQuestion {
	rpcId: string;
	sessionId: string;
	questions: QuestionItem[];
}

interface QuestionItem {
	id: string;
	question: string;
	header?: string;
	options: Array<{ label: string; description?: string }>;
	multiSelect: boolean;
}

type View = { name: "list" } | { name: "session"; sessionId: string };

export function startConnectedApp(root: HTMLElement, rpc: MobileRpcClient): void {
	document.body.classList.add("connected");
	const state = {
		view: { name: "list" } as View,
		sessions: [] as SessionRow[],
		events: [] as unknown[],
		busy: false,
		error: null as string | null,
		approvals: [] as PendingApproval[],
		questions: [] as PendingQuestion[],
	};

	const render = (): void => {
		root.replaceChildren();
		root.appendChild(renderChrome());
		const view = state.view;
		if (view.name === "list") root.appendChild(renderList());
		else root.appendChild(renderSession(view.sessionId));
	};

	const renderChrome = (): HTMLElement => {
		const header = el("header", { className: "bar" });
		const view = state.view;
		if (view.name === "session") {
			const back = el("button", { className: "ghost", type: "button" }, "返回");
			back.addEventListener("click", () => {
				void leaveSession();
			});
			header.appendChild(back);
			const current = state.sessions.find((row) => row.sessionId === view.sessionId);
			header.appendChild(el("strong", {}, current?.title ?? shortId(view.sessionId)));
		} else {
			header.appendChild(el("strong", {}, "会话"));
		}
		if (state.error !== null) header.appendChild(el("span", { className: "err" }, state.error));
		return header;
	};

	const renderList = (): HTMLElement => {
		const wrap = el("div", { className: "col" });
		wrap.appendChild(renderInbox());
		if (state.sessions.length === 0) {
			wrap.appendChild(el("p", { className: "muted" }, "暂无会话"));
			return wrap;
		}
		for (const session of state.sessions) {
			const row = el("button", { className: "row", type: "button" });
			row.appendChild(el("span", { className: "title" }, session.title ?? shortId(session.sessionId)));
			row.appendChild(
				el("span", { className: "meta" }, `${session.running ? "运行中" : "空闲"}${session.blank ? " · 空白" : ""}`),
			);
			row.addEventListener("click", () => {
				void openSession(session.sessionId);
			});
			wrap.appendChild(row);
		}
		return wrap;
	};

	const renderSession = (sessionId: string): HTMLElement => {
		const wrap = el("div", { className: "col session" });
		wrap.appendChild(renderInbox(sessionId));
		const scroller = el("div", { className: "transcript" });
		for (const line of foldTranscript(state.events)) {
			scroller.appendChild(el("div", { className: `bubble ${line.role}` }, `${labelOf(line.role)} ${line.text}`));
		}
		wrap.appendChild(scroller);
		const composer = el("form", { className: "composer" });
		const input = el("textarea");
		input.placeholder = "短回复…";
		const send = el("button", { type: "submit" }, state.busy ? "发送中…" : "发送");
		send.disabled = state.busy;
		const stop = el("button", { type: "button", className: "ghost" }, "停止");
		stop.disabled = state.busy;
		stop.addEventListener("click", () => {
			void run(async () => {
				await rpc.request("session.cancel", { sessionId });
			});
		});
		composer.addEventListener("submit", (event) => {
			event.preventDefault();
			const text = input.value.trim();
			if (text.length === 0) return;
			input.value = "";
			void run(async () => {
				await rpc.request("session.prompt", { sessionId, mode: "queue", text });
			});
		});
		composer.appendChild(input);
		composer.appendChild(send);
		composer.appendChild(stop);
		wrap.appendChild(composer);
		queueMicrotask(() => {
			scroller.scrollTop = scroller.scrollHeight;
		});
		return wrap;
	};

	const renderInbox = (sessionId?: string): HTMLElement => {
		const box = el("div", { className: "inbox" });
		for (const approval of state.approvals) {
			if (sessionId !== undefined && approval.sessionId !== sessionId) continue;
			box.appendChild(renderApproval(approval));
		}
		for (const question of state.questions) {
			if (sessionId !== undefined && question.sessionId !== sessionId) continue;
			box.appendChild(renderQuestion(question));
		}
		return box;
	};

	const renderApproval = (approval: PendingApproval): HTMLElement => {
		const card = el("div", { className: "card" });
		card.appendChild(el("strong", {}, `审批 · ${approval.toolName}`));
		if (approval.reason !== undefined) card.appendChild(el("p", {}, approval.reason));
		const actions = el("div", { className: "actions" });
		const allow = el("button", { type: "button" }, "允许一次");
		const reject = el("button", { type: "button", className: "ghost" }, "拒绝");
		allow.addEventListener("click", () => {
			void answerApproval(approval, "allowed-once");
		});
		reject.addEventListener("click", () => {
			void answerApproval(approval, "rejected");
		});
		actions.appendChild(allow);
		actions.appendChild(reject);
		card.appendChild(actions);
		return card;
	};

	const renderQuestion = (question: PendingQuestion): HTMLElement => {
		const card = el("form", { className: "card" });
		for (const item of question.questions) {
			card.appendChild(el("strong", {}, item.header ?? item.question));
			if (item.header !== undefined) card.appendChild(el("p", {}, item.question));
			if (item.options.length === 0) {
				const other = el("textarea");
				other.placeholder = "回答";
				other.setAttribute("data-qid", item.id);
				other.setAttribute("data-kind", "custom");
				card.appendChild(other);
			} else {
				for (const option of item.options) {
					const label = el("label", { className: "opt" });
					const input = el("input");
					input.type = item.multiSelect ? "checkbox" : "radio";
					input.name = `q-${question.rpcId}-${item.id}`;
					input.value = option.label;
					input.setAttribute("data-qid", item.id);
					label.appendChild(input);
					label.appendChild(el("span", {}, option.label));
					card.appendChild(label);
				}
			}
		}
		const submit = el("button", { type: "submit" }, "提交");
		card.addEventListener("submit", (event) => {
			event.preventDefault();
			void answerQuestion(question, card);
		});
		card.appendChild(submit);
		return card;
	};

	const answerApproval = async (approval: PendingApproval, outcome: "allowed-once" | "rejected"): Promise<void> => {
		await run(async () => {
			await rpc.request("respond", {
				rpcId: approval.rpcId,
				sessionId: approval.sessionId,
				approvalId: approval.approvalId,
				outcome,
			});
			state.approvals = state.approvals.filter((item) => item.rpcId !== approval.rpcId);
		});
	};

	const answerQuestion = async (question: PendingQuestion, form: HTMLElement): Promise<void> => {
		await run(async () => {
			const answers = question.questions.map((item) => {
				const selected: string[] = [];
				let custom: string | undefined;
				collectInputs(form, (node) => {
					if (node.getAttribute("data-qid") !== item.id) return;
					if (node.getAttribute("data-kind") === "custom") {
						if (node.value.trim().length > 0) custom = node.value.trim();
						return;
					}
					if (node.checked) selected.push(node.value);
				});
				return custom === undefined ? { id: item.id, selected } : { id: item.id, selected, custom };
			});
			await rpc.request("respond", {
				rpcId: question.rpcId,
				sessionId: question.sessionId,
				answers,
			});
			state.questions = state.questions.filter((item) => item.rpcId !== question.rpcId);
		});
	};

	const openSession = async (sessionId: string): Promise<void> => {
		await run(async () => {
			const current = state.view;
			if (current.name === "session" && current.sessionId !== sessionId) {
				await rpc.request("session.unsubscribe", { sessionId: current.sessionId }).catch(() => undefined);
			}
			const history = asRecord(await rpc.request("session.history", { sessionId }));
			state.events = Array.isArray(history?.events) ? history.events : [];
			await rpc.request("session.subscribe", { sessionId });
			state.view = { name: "session", sessionId };
		});
	};

	const leaveSession = async (): Promise<void> => {
		const current = state.view;
		if (current.name === "session") {
			await rpc.request("session.unsubscribe", { sessionId: current.sessionId }).catch(() => undefined);
		}
		state.view = { name: "list" };
		state.events = [];
		render();
	};

	const run = async (work: () => Promise<void>): Promise<void> => {
		state.busy = true;
		state.error = null;
		render();
		try {
			await work();
		} catch (error) {
			state.error = error instanceof Error ? error.message : "请求失败";
		} finally {
			state.busy = false;
			render();
		}
	};

	const handlePush = (push: MobilePush): void => {
		if (push.push === "host.event") {
			applyHostEvent(state.sessions, push.data);
			render();
			return;
		}
		if (push.push === "approval.requested" && push.rpcId !== undefined) {
			const approval = parseApproval(push.rpcId, push.data);
			if (approval !== null) {
				state.approvals = [...state.approvals.filter((item) => item.rpcId !== approval.rpcId), approval];
				render();
			}
			return;
		}
		if (push.push === "approval.resolved") {
			const record = asRecord(push.data);
			const approvalId = typeof record?.approvalId === "string" ? record.approvalId : "";
			state.approvals = state.approvals.filter((item) => item.approvalId !== approvalId);
			render();
			return;
		}
		if (push.push === "question.requested" && push.rpcId !== undefined) {
			const question = parseQuestion(push.rpcId, push.data);
			if (question !== null) {
				state.questions = [...state.questions.filter((item) => item.rpcId !== question.rpcId), question];
				render();
			}
			return;
		}
		if (push.push === "question.resolved") {
			const record = asRecord(push.data);
			const rpcId = typeof record?.questionRpcId === "string" ? record.questionRpcId : "";
			state.questions = state.questions.filter((item) => item.rpcId !== rpcId);
			render();
			return;
		}
		const view = state.view;
		if (push.push === "session.event" && view.name === "session") {
			const record = asRecord(push.data);
			if (typeof record?.sessionId === "string" && record.sessionId === view.sessionId) {
				state.events = [...state.events, record];
				render();
			}
		}
	};

	rpc.onPush(handlePush);
	void run(async () => {
		await rpc.request("host.subscribe", {});
		const listed = asRecord(await rpc.request("session.list", {}));
		state.sessions = Array.isArray(listed?.items) ? listed.items.map(parseSession).filter((row) => row !== null) : [];
	});
	render();
}

function parseSession(raw: unknown): SessionRow | null {
	const record = asRecord(raw);
	if (record === null || typeof record.sessionId !== "string") return null;
	const title = typeof record.title === "string" ? record.title : undefined;
	const cwd = typeof record.cwd === "string" ? record.cwd : undefined;
	return {
		sessionId: record.sessionId,
		...(title === undefined ? {} : { title }),
		running: record.running === true,
		blank: record.blank === true,
		updatedAt: typeof record.updatedAt === "number" ? record.updatedAt : 0,
		...(cwd === undefined ? {} : { cwd }),
	};
}

function applyHostEvent(sessions: SessionRow[], data: unknown): void {
	const record = asRecord(data);
	if (record === null || typeof record.sessionId !== "string") return;
	const sessionId = record.sessionId;
	if (record.type === "host/session-removed") {
		const index = sessions.findIndex((row) => row.sessionId === sessionId);
		if (index >= 0) sessions.splice(index, 1);
		return;
	}
	if (record.type === "host/session-added") {
		if (sessions.some((row) => row.sessionId === sessionId)) return;
		sessions.unshift({
			sessionId,
			running: false,
			blank: record.blank === true,
			updatedAt: Date.now(),
			...(typeof record.cwd === "string" ? { cwd: record.cwd } : {}),
		});
		return;
	}
	if (record.type === "host/session-status") {
		const existing = sessions.find((row) => row.sessionId === sessionId);
		if (existing !== undefined) existing.running = record.running === true;
	}
}

function parseApproval(rpcId: string, data: unknown): PendingApproval | null {
	const record = asRecord(data);
	if (record === null || typeof record.sessionId !== "string" || typeof record.approvalId !== "string") return null;
	return {
		rpcId,
		sessionId: record.sessionId,
		approvalId: record.approvalId,
		toolName: typeof record.toolName === "string" ? record.toolName : "tool",
		...(typeof record.reason === "string" ? { reason: record.reason } : {}),
	};
}

function parseQuestion(rpcId: string, data: unknown): PendingQuestion | null {
	const record = asRecord(data);
	if (record === null || typeof record.sessionId !== "string" || !Array.isArray(record.questions)) return null;
	const questions: QuestionItem[] = [];
	for (const item of record.questions) {
		const row = asRecord(item);
		if (row === null || typeof row.id !== "string" || typeof row.question !== "string") continue;
		const options: Array<{ label: string; description?: string }> = [];
		if (Array.isArray(row.options)) {
			for (const option of row.options) {
				const opt = asRecord(option);
				if (opt !== null && typeof opt.label === "string") {
					options.push({
						label: opt.label,
						...(typeof opt.description === "string" ? { description: opt.description } : {}),
					});
				}
			}
		}
		questions.push({
			id: row.id,
			question: row.question,
			...(typeof row.header === "string" ? { header: row.header } : {}),
			options,
			multiSelect: row.multiSelect === true,
		});
	}
	return { rpcId, sessionId: record.sessionId, questions };
}

function foldTranscript(entries: unknown[]): TranscriptLine[] {
	const lines: TranscriptLine[] = [];
	let chunkKey: string | null = null;
	for (const [index, entry] of entries.entries()) {
		const record = asRecord(entry);
		const event = asRecord(record?.event) ?? record;
		if (event === null) continue;
		const type = event.type;
		const data = event.data;
		if (type === "user/message") {
			chunkKey = null;
			lines.push({ key: `u-${index}`, role: "user", text: extractText(data) });
		} else if (type === "assistant/message") {
			chunkKey = null;
			lines.push({ key: `a-${index}`, role: "assistant", text: extractText(data) });
		} else if (type === "assistant/chunk") {
			const text = extractText(data);
			if (text.length === 0) continue;
			const last = lines[lines.length - 1];
			if (chunkKey !== null && last !== undefined && last.role === "assistant") last.text += text;
			else {
				chunkKey = `c-${index}`;
				lines.push({ key: chunkKey, role: "assistant", text });
			}
		} else if (type === "tool/call") {
			chunkKey = null;
			const row = asRecord(data);
			const name = typeof row?.name === "string" ? row.name : "tool";
			lines.push({ key: `t-${index}`, role: "tool", text: name });
		}
	}
	return lines;
}

function labelOf(role: TranscriptLine["role"]): string {
	if (role === "user") return "你";
	if (role === "assistant") return "助手";
	if (role === "tool") return "工具";
	return "";
}

function shortId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 8)}…` : id;
}

function el(tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (key === "className") node.className = value;
		else if (key === "type") node.type = value;
		else node.setAttribute(key, value);
	}
	if (text !== undefined) node.textContent = text;
	return node;
}

function collectInputs(root: HTMLElement, visit: (node: HTMLElement) => void): void {
	const walker = [root];
	while (walker.length > 0) {
		const current = walker.pop();
		if (current === undefined) break;
		visit(current);
		const list = current.children;
		for (let index = 0; index < list.length; index += 1) {
			const child = list.item(index);
			if (child !== null) walker.push(child);
		}
	}
}
