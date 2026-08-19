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

interface WorkspaceGroup {
	key: string;
	label: string;
	cwd?: string;
	sessions: SessionRow[];
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
	document.documentElement.classList.add("connected");
	document.body.classList.add("connected");
	const state = {
		view: { name: "list" } as View,
		sessions: [] as SessionRow[],
		events: [] as unknown[],
		busy: false,
		error: null as string | null,
		toast: null as string | null,
		sheet: false,
		query: "",
		hintHidden: readHintHidden(),
		expanded: new Set<string>(),
		showAll: new Set<string>(),
		approvals: [] as PendingApproval[],
		questions: [] as PendingQuestion[],
	};

	const render = (): void => {
		const list = root.querySelector(".col:not(.session)");
		const transcript = root.querySelector(".transcript");
		const listTop = list instanceof HTMLElement ? list.scrollTop : 0;
		const trans = transcript instanceof HTMLElement ? transcript : null;
		const stickBottom =
			trans !== null && trans.scrollHeight - trans.scrollTop - trans.clientHeight < 96;
		const transTop = trans?.scrollTop ?? 0;
		root.replaceChildren();
		root.appendChild(renderChrome());
		if (state.error !== null) root.appendChild(el("div", { className: "bar-err" }, state.error));
		const view = state.view;
		if (view.name === "list") root.appendChild(renderList());
		else root.appendChild(renderSession(view.sessionId));
		if (state.sheet) root.appendChild(renderSheet());
		const nextList = root.querySelector(".col:not(.session)");
		const nextTrans = root.querySelector(".transcript");
		if (nextList instanceof HTMLElement) nextList.scrollTop = listTop;
		if (nextTrans instanceof HTMLElement) {
			nextTrans.scrollTop = stickBottom ? nextTrans.scrollHeight : transTop;
		}
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
			const titles = el("div", { className: "bar-title" });
			titles.appendChild(el("strong", {}, current?.title ?? "未命名会话"));
			titles.appendChild(el("div", { className: "sub" }, "任务会话"));
			header.appendChild(titles);
			const actions = el("div", { className: "bar-actions" });
			const more = el("button", { className: "ghost", type: "button" }, "⋯");
			more.addEventListener("click", () => {
				state.sheet = true;
				render();
			});
			actions.appendChild(more);
			header.appendChild(actions);
		} else {
			const block = el("div", { className: "bar-title" });
			block.appendChild(el("strong", {}, "DSH 远程"));
			block.appendChild(el("div", { className: "sub" }, "已连接到当前窗口"));
			header.appendChild(block);
			const actions = el("div", { className: "bar-actions" });
			const refresh = el("button", { className: "ghost", type: "button" }, "刷新");
			refresh.addEventListener("click", () => {
				void refreshList();
			});
			actions.appendChild(refresh);
			header.appendChild(actions);
		}
		return header;
	};

	const renderList = (): HTMLElement => {
		const wrap = el("div", { className: "col" });
		if (!state.hintHidden) {
			const hero = el("div", { className: "hero" });
			hero.appendChild(el("p", {}, "只能看到桌面窗口里已打开的项目。二维码失效后请回桌面重新连接。"));
			const dismiss = el("button", { className: "ghost", type: "button" }, "知道了");
			dismiss.addEventListener("click", () => {
				state.hintHidden = true;
				writeHintHidden();
				render();
			});
			hero.appendChild(dismiss);
			wrap.appendChild(hero);
		}
		wrap.appendChild(renderInbox());
		const search = el("input") as HTMLInputElement;
		search.className = "search";
		search.type = "search";
		search.placeholder = "筛选工作区或任务";
		search.value = state.query;
		search.addEventListener("input", () => {
			state.query = search.value;
			render();
			const next = root.querySelector("input.search");
			if (next instanceof HTMLInputElement) {
				next.focus();
				const end = next.value.length;
				next.setSelectionRange(end, end);
			}
		});
		wrap.appendChild(search);
		const groups = filterGroups(groupByCwd(state.sessions), state.query);
		const section = el("div", { className: "section-h" });
		section.appendChild(el("h2", {}, "工作区和任务"));
		section.appendChild(
			el("span", { className: "muted" }, `${String(groups.length)} 个工作区 · ${String(state.sessions.length)} 个任务`),
		);
		wrap.appendChild(section);
		if (state.toast !== null) wrap.appendChild(el("p", { className: "toast" }, state.toast));
		if (groups.length === 0) {
			wrap.appendChild(el("p", { className: "muted" }, "没有匹配的会话"));
			return wrap;
		}
		for (const group of groups) {
			wrap.appendChild(renderWorkspace(group));
		}
		return wrap;
	};

	const renderWorkspace = (group: WorkspaceGroup): HTMLElement => {
		const card = el("div", { className: "ws" });
		const open = state.expanded.has(group.key);
		const head = el("div", { className: "ws-head" });
		const toggle = el("button", { className: "ws-toggle", type: "button" });
		const name = el("div");
		const titleLine = el("div");
		titleLine.appendChild(el("span", { className: "ws-name" }, group.label));
		titleLine.appendChild(el("span", { className: "badge" }, group.cwd === undefined ? "未绑定" : "本地"));
		name.appendChild(titleLine);
		if (group.cwd !== undefined) name.appendChild(el("div", { className: "ws-path" }, group.cwd));
		name.appendChild(
			el("div", { className: "muted" }, `${open ? "▾" : "▸"}  ${String(group.sessions.length)} 个任务`),
		);
		toggle.appendChild(name);
		toggle.addEventListener("click", () => {
			if (state.expanded.has(group.key)) state.expanded.delete(group.key);
			else state.expanded.add(group.key);
			render();
		});
		const add = el("button", { className: "icon-btn", type: "button" }, "+");
		add.setAttribute("aria-label", "新建任务");
		add.addEventListener("click", () => {
			void createSession(group.cwd);
		});
		head.appendChild(toggle);
		head.appendChild(add);
		card.appendChild(head);
		if (open) {
			if (group.sessions.length === 0) {
				card.appendChild(el("p", { className: "muted" }, "这个工作区暂无任务"));
			}
			const limit = state.showAll.has(group.key) ? group.sessions.length : 5;
			const visible = group.sessions.slice(0, limit);
			for (const session of visible) {
				const row = el("button", { className: "task", type: "button" });
				const left = el("div", { className: "task-main" });
				left.appendChild(el("div", { className: "title" }, session.title ?? "未命名会话"));
				left.appendChild(el("div", { className: "muted" }, formatAgo(session.updatedAt)));
				row.appendChild(left);
				row.appendChild(
					el("span", { className: session.running ? "pill run" : "pill" }, session.running ? "运行中" : "空闲"),
				);
				row.addEventListener("click", () => {
					void openSession(session.sessionId);
				});
				card.appendChild(row);
			}
			if (group.sessions.length > 5 && !state.showAll.has(group.key)) {
				const more = el("button", { className: "more-tasks", type: "button" }, `显示全部 ${String(group.sessions.length)} 个任务`);
				more.addEventListener("click", () => {
					state.showAll.add(group.key);
					render();
				});
				card.appendChild(more);
			}
		}
		return card;
	};

	const renderSheet = (): HTMLElement => {
		const wrap = el("div");
		const mask = el("div", { className: "sheet-mask" });
		mask.addEventListener("click", () => {
			state.sheet = false;
			render();
		});
		const sheet = el("div", { className: "sheet" });
		sheet.appendChild(el("h3", {}, "桌面功能"));
		sheet.appendChild(el("p", { className: "muted" }, "审查和终端只在桌面 DSH 侧栏，手机暂不支持。"));
		const review = el("button", { className: "sheet-item", type: "button" }, "审查（请用桌面）");
		const term = el("button", { className: "sheet-item", type: "button" }, "终端（请用桌面）");
		const pick = (label: string) => {
			state.sheet = false;
			state.toast = `${label}请在桌面 DSH 打开`;
			render();
		};
		review.addEventListener("click", () => {
			pick("审查");
		});
		term.addEventListener("click", () => {
			pick("终端");
		});
		sheet.appendChild(review);
		sheet.appendChild(term);
		wrap.appendChild(mask);
		wrap.appendChild(sheet);
		return wrap;
	};

	const renderSession = (sessionId: string): HTMLElement => {
		const wrap = el("div", { className: "col session" });
		wrap.appendChild(renderInbox(sessionId));
		const scroller = el("div", { className: "transcript" });
		for (const line of foldTranscript(state.events)) {
			const bubble = el("div", { className: `bubble ${line.role}` });
			if (line.role === "tool") bubble.textContent = `工具 ${line.text}`;
			else appendMarkdown(bubble, line.text);
			scroller.appendChild(bubble);
		}
		wrap.appendChild(scroller);
		const composer = el("form", { className: "composer" });
		const stop = el("button", { type: "button", className: "ghost" }, "停止生成");
		stop.disabled = state.busy;
		stop.addEventListener("click", () => {
			void run(async () => {
				await rpc.request("session.cancel", { sessionId });
			});
		});
		const row = el("div", { className: "composer-row" });
		const input = el("textarea");
		input.placeholder = "继续给 Agent 发指令";
		const send = el("button", { type: "submit" }, state.busy ? "…" : "发送");
		send.disabled = state.busy;
		composer.addEventListener("submit", (event) => {
			event.preventDefault();
			const text = input.value.trim();
			if (text.length === 0) return;
			input.value = "";
			void run(async () => {
				await rpc.request("session.prompt", { sessionId, mode: "queue", text });
			});
		});
		row.appendChild(input);
		row.appendChild(send);
		composer.appendChild(stop);
		composer.appendChild(row);
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

	const refreshList = async (): Promise<void> => {
		await run(async () => {
			const listed = asRecord(await rpc.request("session.list", {}));
			state.sessions = Array.isArray(listed?.items)
				? listed.items.map(parseSession).filter((row): row is SessionRow => row !== null && !row.blank)
				: [];
		});
	};

	const createSession = async (cwd?: string): Promise<void> => {
		await run(async () => {
			const created = asRecord(await rpc.request("session.create", cwd === undefined ? {} : { cwd }));
			const listed = asRecord(await rpc.request("session.list", {}));
			state.sessions = Array.isArray(listed?.items)
				? listed.items.map(parseSession).filter((row): row is SessionRow => row !== null && !row.blank)
				: [];
			if (typeof created?.sessionId === "string") await loadSession(created.sessionId);
		});
	};

	const loadSession = async (sessionId: string): Promise<void> => {
		const current = state.view;
		if (current.name === "session" && current.sessionId !== sessionId) {
			await rpc.request("session.unsubscribe", { sessionId: current.sessionId }).catch(() => undefined);
		}
		const history = asRecord(await rpc.request("session.history", { sessionId }));
		state.events = Array.isArray(history?.events) ? history.events : [];
		await rpc.request("session.subscribe", { sessionId });
		state.view = { name: "session", sessionId };
	};

	const openSession = async (sessionId: string): Promise<void> => {
		await run(async () => {
			await loadSession(sessionId);
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
				const scroller = root.querySelector(".transcript");
				if (scroller instanceof HTMLElement && appendTranscriptLine(scroller, state.events)) return;
				render();
			}
		}
	};

	rpc.onPush(handlePush);
	void run(async () => {
		await rpc.request("host.subscribe", {});
		const listed = asRecord(await rpc.request("session.list", {}));
		state.sessions = Array.isArray(listed?.items)
			? listed.items.map(parseSession).filter((row): row is SessionRow => row !== null && !row.blank)
			: [];
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

const HINT_KEY = "dshmr.hintDismissed";

function readHintHidden(): boolean {
	try {
		return localStorage.getItem(HINT_KEY) === "1";
	} catch {
		return false;
	}
}

function writeHintHidden(): void {
	try {
		localStorage.setItem(HINT_KEY, "1");
	} catch {
		// ignore
	}
}

function filterGroups(groups: WorkspaceGroup[], query: string): WorkspaceGroup[] {
	const needle = query.trim().toLowerCase();
	if (needle.length === 0) return groups;
	const out: WorkspaceGroup[] = [];
	for (const group of groups) {
		const groupHit =
			group.label.toLowerCase().includes(needle) || (group.cwd ?? "").toLowerCase().includes(needle);
		const sessions = groupHit
			? group.sessions
			: group.sessions.filter((session) => (session.title ?? "").toLowerCase().includes(needle));
		if (groupHit || sessions.length > 0) out.push({ ...group, sessions });
	}
	return out;
}

function appendTranscriptLine(scroller: HTMLElement, events: unknown[]): boolean {
	const lines = foldTranscript(events);
	const line = lines[lines.length - 1];
	if (line === undefined) return true;
	const lastRaw = events[events.length - 1];
	const event = asRecord(asRecord(lastRaw)?.event) ?? asRecord(lastRaw);
	const stick = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 96;
	if (event?.type === "assistant/chunk") {
		let last = scroller.lastElementChild;
		if (!(last instanceof HTMLElement) || !last.classList.contains("assistant")) {
			last = el("div", { className: "bubble assistant" });
			scroller.appendChild(last);
		}
		last.replaceChildren();
		appendMarkdown(last, line.text);
	} else {
		const bubble = el("div", { className: `bubble ${line.role}` });
		if (line.role === "tool") bubble.textContent = `工具 ${line.text}`;
		else appendMarkdown(bubble, line.text);
		scroller.appendChild(bubble);
	}
	if (stick) scroller.scrollTop = scroller.scrollHeight;
	return true;
}

function basenameOf(cwd: string): string {
	const parts = cwd.replace(/\\/g, "/").split("/").filter(Boolean);
	return parts[parts.length - 1] ?? cwd;
}

function groupByCwd(sessions: SessionRow[]): WorkspaceGroup[] {
	const map = new Map<string, WorkspaceGroup>();
	for (const session of sessions) {
		const key = session.cwd ?? "__none__";
		let group = map.get(key);
		if (group === undefined) {
			group = {
				key,
				label: session.cwd === undefined ? "未绑定工作区" : basenameOf(session.cwd),
				...(session.cwd === undefined ? {} : { cwd: session.cwd }),
				sessions: [],
			};
			map.set(key, group);
		}
		group.sessions.push(session);
	}
	for (const group of map.values()) {
		group.sessions.sort((left, right) => right.updatedAt - left.updatedAt);
	}
	return [...map.values()];
}

function appendMarkdown(root: HTMLElement, text: string): void {
	const parts = text.split("```");
	for (const [index, part] of parts.entries()) {
		if (index % 2 === 1) {
			const code = el("code");
			const body = part.replace(/^[^\n]*\n/, "");
			code.textContent = body.length > 0 ? body : part;
			root.appendChild(code);
			continue;
		}
		const chunks = part.split(/(`[^`]+`)/);
		for (const chunk of chunks) {
			if (chunk.startsWith("`") && chunk.endsWith("`") && chunk.length >= 2) {
				const code = el("span", { className: "inline-code" });
				code.textContent = chunk.slice(1, -1);
				root.appendChild(code);
			} else if (chunk.length > 0) {
				root.appendChild(document.createTextNode(chunk));
			}
		}
	}
}

function formatAgo(timestamp: number): string {
	if (timestamp <= 0) return "";
	const delta = Date.now() - timestamp;
	if (delta < 60_000) return "刚刚";
	if (delta < 3_600_000) return `${String(Math.floor(delta / 60_000))} 分钟前`;
	if (delta < 86_400_000) return `${String(Math.floor(delta / 3_600_000))} 小时前`;
	return `${String(Math.floor(delta / 86_400_000))} 天前`;
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
