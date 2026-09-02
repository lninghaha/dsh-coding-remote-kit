/**
 * Connected mobile UI: session list, transcript, short reply, approval / question cards.
 */

import { formatAgo, getLocale, setLocale, subscribeLocale, t } from "../shared/i18n/index.js";
import { asRecord, extractText, type MobilePush, type MobileRpcClient } from "./rpc.js";
import {
	activeTools,
	earliestSeq,
	historyCursorFromResult,
	historyPageSize,
	mergeHistoryPage,
} from "./session-ui.js";

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

export type PromptMode = "queue" | "steer";

export interface ApprovalFocusTarget {
	readonly sessionId: string;
	readonly approvalId: string;
}

const SEARCH_DEBOUNCE_MS = 200;

export function startConnectedApp(
	root: HTMLElement,
	rpc: MobileRpcClient,
	options: { focusApproval?: ApprovalFocusTarget | null } = {},
): () => void {
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
		filterQuery: "",
		hintHidden: readHintHidden(),
		expanded: new Set<string>(),
		showAll: new Set<string>(),
		approvals: [] as PendingApproval[],
		questions: [] as PendingQuestion[],
		pendingActions: new Set<string>(),
		scrollSessionToEnd: false,
		listState: "loading" as "loading" | "ready" | "empty" | "unavailable" | "permissionDenied" | "stale",
		retry: null as (() => void) | null,
		promptMode: "queue" as PromptMode,
		focusApprovalId: options.focusApproval?.approvalId ?? null,
		historyHasMore: false,
		historyLoadingOlder: false,
	};

	let disposed = false;
	let toastTimer: ReturnType<typeof setTimeout> | null = null;
	let searchTimer: ReturnType<typeof setTimeout> | null = null;
	let sheetTriggerKey: string | null = null;

	const showToast = (message: string): void => {
		if (disposed) return;
		state.toast = message;
		render();
		if (toastTimer !== null) clearTimeout(toastTimer);
		toastTimer = setTimeout(() => {
			if (disposed) return;
			state.toast = null;
			render();
		}, 2200);
	};

	const sessionContext = (sessionId: string): { title: string; workspace: string } => {
		const session = state.sessions.find((row) => row.sessionId === sessionId);
		if (session === undefined) return { title: t("app.unknownTask"), workspace: t("app.unknownWorkspace") };
		return {
			title: session.title ?? t("app.untitledSession"),
			workspace: session.cwd === undefined ? t("app.unboundWorkspace") : basenameOf(session.cwd),
		};
	};

	const appendLanguageSwitcher = (container: HTMLElement): void => {
		const wrap = document.createElement("div");
		wrap.className = "lang-switch";
		const locales = [
			{ locale: "zh-CN" as const, labelKey: "common.lang.zh" as const },
			{ locale: "en" as const, labelKey: "common.lang.en" as const },
		];
		for (const [index, entry] of locales.entries()) {
			if (index > 0) wrap.appendChild(document.createTextNode(" | "));
			const button = document.createElement("button");
			button.type = "button";
			button.className = getLocale() === entry.locale ? "active" : "";
			button.textContent = t(entry.labelKey);
			button.addEventListener("click", () => {
				setLocale(entry.locale, localStorage);
			});
			wrap.appendChild(button);
		}
		container.appendChild(wrap);
	};

	const render = (): void => {
		if (disposed) return;
		const preserved = capturePreservedControls(root);
		const list = root.querySelector(".col:not(.session)");
		const transcript = root.querySelector(".transcript");
		const listTop = list instanceof HTMLElement ? list.scrollTop : 0;
		const trans = transcript instanceof HTMLElement ? transcript : null;
		const stickBottom =
			trans !== null && trans.scrollHeight - trans.scrollTop - trans.clientHeight < 96;
		const transTop = trans?.scrollTop ?? 0;
		root.replaceChildren();
		root.appendChild(renderChrome());
		const live = el("div", { className: "sr-only", "aria-live": "polite", "aria-atomic": "true" });
		live.textContent = state.error ?? state.toast ?? "";
		root.appendChild(live);
		if (state.error !== null) {
			const error = el("div", { className: "bar-err", role: "alert" }, state.error);
			if (state.retry !== null) {
				const retry = el("button", { type: "button", className: "ghost" }, t("common.retry"));
				retry.addEventListener("click", state.retry);
				error.appendChild(retry);
			}
			root.appendChild(error);
		}
		const view = state.view;
		if (view.name === "list") root.appendChild(renderList());
		else root.appendChild(renderSession(view.sessionId));
		if (state.sheet) root.appendChild(renderSheet());
		if (state.toast !== null) {
			const toast = el("div", { className: "toast show", role: "status" }, state.toast);
			root.appendChild(toast);
		}
		restorePreservedControls(root, preserved);
		const nextList = root.querySelector(".col:not(.session)");
		const nextTrans = root.querySelector(".transcript");
		if (nextList instanceof HTMLElement) nextList.scrollTop = listTop;
		if (nextTrans instanceof HTMLElement) {
			nextTrans.scrollTop = state.scrollSessionToEnd || stickBottom ? nextTrans.scrollHeight : transTop;
			state.scrollSessionToEnd = false;
		}
	};

	const renderChrome = (): HTMLElement => {
		const header = el("header", { className: "bar" });
		const view = state.view;
		if (view.name === "session") {
			const back = el("button", { className: "ghost", type: "button" }, t("common.back"));
			back.addEventListener("click", () => {
				void leaveSession();
			});
			header.appendChild(back);
			const current = state.sessions.find((row) => row.sessionId === view.sessionId);
			const titles = el("div", { className: "bar-title" });
			titles.appendChild(el("strong", {}, current?.title ?? t("app.untitledSession")));
			const sub =
				current?.running === true
					? t("app.sessionRunning")
					: current?.cwd !== undefined
						? t("app.sessionIdleCwd", { cwd: basenameOf(current.cwd) })
						: t("app.session");
			titles.appendChild(el("div", { className: "sub" }, sub));
			header.appendChild(titles);
			const actions = el("div", { className: "bar-actions" });
			appendLanguageSwitcher(actions);
			const more = el("button", { className: "ghost", type: "button" }, t("app.info"));
			more.setAttribute("data-sheet-trigger", "session-info");
			more.addEventListener("click", () => {
				sheetTriggerKey = "session-info";
				state.sheet = true;
				render();
			});
			actions.appendChild(more);
			header.appendChild(actions);
		} else {
			const block = el("div", { className: "bar-title" });
			block.appendChild(el("strong", {}, t("brand.title")));
			const pending = state.approvals.length + state.questions.length;
			block.appendChild(
				el(
					"div",
					{ className: "sub" },
					pending > 0 ? t("app.connectedPending", { n: pending }) : t("app.connectedWindow"),
				),
			);
			header.appendChild(block);
			const actions = el("div", { className: "bar-actions" });
			appendLanguageSwitcher(actions);
			const refresh = el("button", { className: "ghost", type: "button" }, t("common.refresh"));
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
			hero.appendChild(el("p", {}, t("app.hint")));
			const dismiss = el("button", { className: "ghost", type: "button" }, t("common.gotIt"));
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
		search.setAttribute("data-preserve-key", "session-search");
		search.placeholder = t("app.filterPlaceholder");
		search.value = state.query;
		search.addEventListener("input", () => {
			state.query = search.value;
			if (searchTimer !== null) clearTimeout(searchTimer);
			searchTimer = setTimeout(() => {
				state.filterQuery = state.query;
				render();
				const next = root.querySelector("input.search");
				if (next instanceof HTMLInputElement) {
					next.focus();
					const end = next.value.length;
					next.setSelectionRange(end, end);
				}
			}, SEARCH_DEBOUNCE_MS);
		});
		wrap.appendChild(search);
		const groups = filterGroups(groupByCwd(state.sessions), state.filterQuery);
		const section = el("div", { className: "section-h" });
		section.appendChild(el("h2", {}, t("app.workspacesTasks")));
		section.appendChild(
			el("span", { className: "muted" }, t("app.workspaceCount", { workspaces: groups.length, tasks: state.sessions.length })),
		);
		wrap.appendChild(section);
		if (state.listState === "loading") {
			wrap.appendChild(el("p", { className: "empty-hint", role: "status" }, t("app.loadingSessions")));
			return wrap;
		}
		if (state.listState === "permissionDenied" || state.listState === "unavailable" || state.listState === "stale") {
			const status = el("div", {
				className: "empty-hint",
				role: state.listState === "permissionDenied" ? "alert" : "status",
			});
			status.appendChild(el("p", {}, t(`app.state.${state.listState}`)));
			const retry = el("button", { type: "button" }, t("common.retry"));
			retry.addEventListener("click", () => void refreshList());
			status.appendChild(retry);
			wrap.appendChild(status);
			if (state.listState !== "stale") return wrap;
		}
		if (state.sessions.length === 0) {
			wrap.appendChild(
				el(
					"p",
					{ className: "empty-hint" },
					t("app.emptyDesktop"),
				),
			);
			return wrap;
		}
		if (groups.length === 0) {
			wrap.appendChild(el("p", { className: "empty-hint" }, t("app.filterEmpty", { query: state.filterQuery.trim() })));
			return wrap;
		}
		for (const group of groups) {
			wrap.appendChild(renderWorkspace(group));
		}
		return wrap;
	};

	const pendingForGroup = (group: WorkspaceGroup): number => {
		const ids = new Set(group.sessions.map((session) => session.sessionId));
		let count = 0;
		for (const item of [...state.approvals, ...state.questions]) {
			if (ids.has(item.sessionId)) count += 1;
		}
		return count;
	};

	const renderWorkspace = (group: WorkspaceGroup): HTMLElement => {
		const card = el("div", { className: "ws" });
		const open = state.expanded.has(group.key);
		const pending = pendingForGroup(group);
		const head = el("div", { className: "ws-head" });
		const toggle = el("button", { className: "ws-toggle", type: "button" });
		const name = el("div");
		const titleLine = el("div");
		titleLine.appendChild(el("span", { className: "ws-name" }, group.label));
		titleLine.appendChild(el("span", { className: "badge" }, group.cwd === undefined ? t("app.unbound") : t("common.local")));
		if (pending > 0) {
			titleLine.appendChild(el("span", { className: "badge pending" }, t("app.pendingShort", { n: pending })));
		}
		name.appendChild(titleLine);
		if (group.cwd !== undefined) name.appendChild(el("div", { className: "ws-path" }, group.cwd));
		name.appendChild(
			el("div", { className: "muted" }, `${open ? "▾" : "▸"}  ${t("app.taskCount", { n: group.sessions.length })}`),
		);
		toggle.appendChild(name);
		toggle.addEventListener("click", () => {
			if (state.expanded.has(group.key)) state.expanded.delete(group.key);
			else state.expanded.add(group.key);
			render();
		});
		const add = el("button", { className: "icon-btn", type: "button" }, "+");
		add.setAttribute("aria-label", t("app.newTask"));
		add.addEventListener("click", () => {
			void createSession(group.cwd);
		});
		head.appendChild(toggle);
		head.appendChild(add);
		card.appendChild(head);
		if (open) {
			if (group.sessions.length === 0) {
				card.appendChild(el("p", { className: "muted" }, t("app.noTasksInWorkspace")));
			}
			const limit = state.showAll.has(group.key) ? group.sessions.length : 5;
			const visible = group.sessions.slice(0, limit);
			for (const session of visible) {
				const row = el("button", { className: "task", type: "button" });
				const left = el("div", { className: "task-main" });
				left.appendChild(el("div", { className: "title" }, session.title ?? t("app.untitledSession")));
				left.appendChild(el("div", { className: "muted" }, formatAgo(session.updatedAt)));
				row.appendChild(left);
				row.appendChild(
					el("span", { className: session.running ? "pill run" : "pill" }, session.running ? t("app.running") : t("app.idle")),
				);
				row.addEventListener("click", () => {
					void openSession(session.sessionId);
				});
				card.appendChild(row);
			}
			if (group.sessions.length > 5 && !state.showAll.has(group.key)) {
				const more = el("button", { className: "more-tasks", type: "button" }, t("app.showAllTasks", { n: group.sessions.length }));
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
		const mask = el("div", { className: "sheet-mask", "aria-hidden": "true" });
		mask.addEventListener("click", closeSheet);
		const sheet = el("div", { className: "sheet", role: "dialog", "aria-modal": "true", "aria-label": t("app.connectionInfo") });
		const view = state.view;
		if (view.name === "session") {
			const current = state.sessions.find((row) => row.sessionId === view.sessionId);
			sheet.appendChild(el("h3", {}, t("app.sessionInfo")));
			const dl = el("dl", { className: "sheet-dl" });
			const addRow = (label: string, value: string): void => {
				const row = el("div");
				row.appendChild(el("dt", {}, label));
				row.appendChild(el("dd", {}, value));
				dl.appendChild(row);
			};
			addRow(t("app.task"), current?.title ?? t("app.untitledSession"));
			addRow(t("app.workspace"), current?.cwd ?? t("app.unbound"));
			addRow(t("app.status"), current?.running === true ? t("app.running") : t("app.idle"));
			addRow(t("app.sessionId"), view.sessionId.slice(0, 12) + "…");
			sheet.appendChild(dl);
			sheet.appendChild(
				el(
					"p",
					{ className: "muted" },
					t("app.desktopOnly"),
				),
			);
		} else {
			sheet.appendChild(el("h3", {}, t("app.connectionInfo")));
			sheet.appendChild(
				el("p", { className: "muted" }, t("app.connectionBody")),
			);
		}
		const close = el("button", { type: "button", className: "ghost" }, t("common.close"));
		close.addEventListener("click", closeSheet);
		sheet.appendChild(close);
		wrap.appendChild(mask);
		wrap.appendChild(sheet);
		queueMicrotask(() => {
			if (!disposed && state.sheet) close.focus();
		});
		return wrap;
	};

	const closeSheet = (): void => {
		if (!state.sheet) return;
		state.sheet = false;
		const restoreKey = sheetTriggerKey;
		render();
		queueMicrotask(() => {
			if (disposed || restoreKey === null) return;
			const trigger = root.querySelector(`[data-sheet-trigger="${restoreKey}"]`);
			if (trigger instanceof HTMLElement) trigger.focus();
		});
	};

	const renderSession = (sessionId: string): HTMLElement => {
		const current = state.sessions.find((row) => row.sessionId === sessionId);
		const running = current?.running === true;
		const wrap = el("div", { className: "col session" });
		wrap.appendChild(renderInbox(sessionId));
		wrap.appendChild(renderActivityStrip(running));
		const scroller = el("div", { className: "transcript" });
		if (state.historyHasMore) {
			const older = el(
				"button",
				{
					type: "button",
					className: "load-older",
					"aria-busy": String(state.historyLoadingOlder),
				},
				state.historyLoadingOlder ? t("app.history.loadingOlder") : t("app.history.loadOlder"),
			);
			older.disabled = state.historyLoadingOlder || state.busy;
			older.addEventListener("click", () => {
				void loadOlderHistory(sessionId);
			});
			scroller.appendChild(older);
		}
		for (const line of foldTranscript(state.events)) {
			scroller.appendChild(renderBubbleRow(line, false));
		}
		wrap.appendChild(scroller);
		const composer = el("form", { className: "composer" });
		if (running) {
			const stop = el("button", { type: "button", className: "ghost danger" }, state.busy ? t("app.stopping") : t("app.stop"));
			stop.disabled = state.busy;
			stop.addEventListener("click", () => {
				void run(async () => {
					await rpc.request("session.cancel", { sessionId });
				});
			});
			composer.appendChild(stop);
		}
		const modeRow = el("div", {
			className: "mode-toggle",
			role: "group",
			"aria-label": t("app.mode.label"),
		});
		const queueBtn = el(
			"button",
			{ type: "button", className: state.promptMode === "queue" ? "mode active" : "mode" },
			t("app.mode.queue"),
		);
		const steerBtn = el(
			"button",
			{ type: "button", className: state.promptMode === "steer" ? "mode active" : "mode" },
			t("app.mode.steer"),
		);
		queueBtn.addEventListener("click", () => {
			state.promptMode = "queue";
			render();
		});
		steerBtn.addEventListener("click", () => {
			state.promptMode = "steer";
			render();
		});
		modeRow.appendChild(queueBtn);
		modeRow.appendChild(steerBtn);
		composer.appendChild(modeRow);
		composer.appendChild(
			el("p", { className: "mode-hint" }, state.promptMode === "steer" ? t("app.mode.steerHint") : t("app.mode.queueHint")),
		);
		const row = el("div", { className: "composer-row" });
		const input = el("textarea") as HTMLTextAreaElement;
		input.setAttribute("data-preserve-key", `composer:${sessionId}`);
		input.placeholder = t("app.composerPlaceholder");
		input.addEventListener("input", () => {
			input.style.height = "auto";
			input.style.height = `${String(Math.min(input.scrollHeight, 120))}px`;
		});
		const send = el("button", { type: "submit" }, state.busy ? "…" : t("app.send"));
		send.disabled = state.busy;
		composer.addEventListener("submit", (event) => {
			event.preventDefault();
			const text = input.value.trim();
			if (text.length === 0) return;
			const mode = state.promptMode;
			input.value = "";
			input.style.height = "";
			void run(async () => {
				await rpc.request("session.prompt", { sessionId, mode, text });
			});
		});
		row.appendChild(input);
		row.appendChild(send);
		composer.appendChild(row);
		wrap.appendChild(composer);
		return wrap;
	};

	const renderActivityStrip = (running: boolean): HTMLElement => {
		const tools = activeTools(state.events);
		const strip = el("div", {
			className: tools.length > 0 || running ? "activity-strip active" : "activity-strip",
			role: "status",
			"aria-live": "polite",
		});
		if (tools.length > 0) {
			const names = tools.map((tool) => tool.name).join(", ");
			strip.appendChild(el("span", { className: "activity-dot", "aria-hidden": "true" }, ""));
			strip.appendChild(
				el(
					"span",
					{},
					tools.length === 1
						? t("app.activity.tool", { tool: names })
						: t("app.activity.tools", { tools: names, n: tools.length }),
				),
			);
		} else if (running) {
			strip.appendChild(el("span", { className: "activity-dot", "aria-hidden": "true" }, ""));
			strip.appendChild(el("span", {}, t("app.activity.running")));
		} else {
			strip.appendChild(el("span", { className: "muted" }, t("app.activity.idle")));
		}
		return strip;
	};

	const renderInbox = (sessionId?: string): HTMLElement => {
		const box = el("div", { className: "inbox" });
		for (const approval of state.approvals) {
			if (sessionId !== undefined && approval.sessionId !== sessionId) continue;
			box.appendChild(renderApproval(approval, sessionId === undefined));
		}
		for (const question of state.questions) {
			if (sessionId !== undefined && question.sessionId !== sessionId) continue;
			box.appendChild(renderQuestion(question));
		}
		return box;
	};

	const renderApproval = (approval: PendingApproval, showContext: boolean): HTMLElement => {
		const pending = state.pendingActions.has(`approval:${approval.rpcId}`);
		const focused = state.focusApprovalId === approval.approvalId;
		const card = el("div", {
			className: focused ? "card focus-target" : "card",
			"aria-busy": String(pending),
			"data-approval-id": approval.approvalId,
		});
		card.appendChild(el("strong", {}, t("app.approval.title", { tool: approval.toolName })));
		if (showContext) {
			const ctx = sessionContext(approval.sessionId);
			const ctxRow = el("p", { className: "ctx" });
			ctxRow.textContent = `${ctx.workspace} · ${ctx.title}`;
			const link = el("button", { type: "button", className: "ctx-link" }, t("app.openTask"));
			link.addEventListener("click", () => {
				void openSession(approval.sessionId);
			});
			card.appendChild(ctxRow);
			card.appendChild(link);
		}
		if (approval.reason !== undefined) card.appendChild(el("p", {}, approval.reason));
		const actions = el("div", { className: "actions" });
		const allow = el("button", { type: "button" }, pending ? t("app.submitting") : t("app.allowOnce"));
		const reject = el("button", { type: "button", className: "ghost" }, t("app.deny"));
		allow.disabled = pending;
		reject.disabled = pending;
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
		const pending = state.pendingActions.has(`question:${question.rpcId}`);
		const card = el("form", { className: "card", "aria-busy": String(pending) });
		const ctx = sessionContext(question.sessionId);
		card.appendChild(el("p", { className: "ctx" }, `${ctx.workspace} · ${ctx.title}`));
		for (const item of question.questions) {
			card.appendChild(el("strong", {}, item.header ?? item.question));
			if (item.header !== undefined) card.appendChild(el("p", {}, item.question));
			if (item.options.length === 0) {
				const other = el("textarea") as HTMLTextAreaElement;
				other.placeholder = t("app.answer");
				other.setAttribute("data-qid", item.id);
				other.setAttribute("data-kind", "custom");
				other.setAttribute("data-preserve-key", `question:${question.rpcId}:${item.id}:custom`);
				other.disabled = pending;
				card.appendChild(other);
			} else {
				for (const option of item.options) {
					const label = el("label", { className: "opt" });
					const input = el("input") as HTMLInputElement;
					input.type = item.multiSelect ? "checkbox" : "radio";
					input.name = `q-${question.rpcId}-${item.id}`;
					input.value = option.label;
					input.setAttribute("data-qid", item.id);
					input.setAttribute("data-preserve-key", `question:${question.rpcId}:${item.id}:${option.label}`);
					input.disabled = pending;
					label.appendChild(input);
					label.appendChild(el("span", {}, option.label));
					if (option.description !== undefined) {
						label.appendChild(el("span", { className: "opt-description" }, option.description));
					}
					card.appendChild(label);
				}
			}
		}
		const submit = el("button", { type: "submit" }, pending ? t("app.submitting") : t("app.submit"));
		submit.disabled = pending;
		card.addEventListener("submit", (event) => {
			event.preventDefault();
			void answerQuestion(question, card);
		});
		card.appendChild(submit);
		return card;
	};

	const answerApproval = async (approval: PendingApproval, outcome: "allowed-once" | "rejected"): Promise<void> => {
		await runAction(`approval:${approval.rpcId}`, async () => {
			await rpc.request("respond", {
				rpcId: approval.rpcId,
				sessionId: approval.sessionId,
				approvalId: approval.approvalId,
				outcome,
			});
			state.approvals = state.approvals.filter((item) => item.rpcId !== approval.rpcId);
			showToast(outcome === "allowed-once" ? t("app.allowed") : t("app.denied"));
		});
	};

	const answerQuestion = async (question: PendingQuestion, form: HTMLElement): Promise<void> => {
		await runAction(`question:${question.rpcId}`, async () => {
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
			showToast(t("app.answered"));
		});
	};

	const refreshList = async (): Promise<void> => {
		await run(async () => {
			const listed = asRecord(await rpc.request("session.list", {}));
			state.sessions = Array.isArray(listed?.items)
				? listed.items.map(parseSession).filter((row): row is SessionRow => row !== null && !row.blank)
				: [];
			state.listState = state.sessions.length === 0 ? "empty" : "ready";
			showToast(t("app.refreshed"));
		}, () => void refreshList());
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
		const history = asRecord(
			await rpc.request("session.history", {
				sessionId,
				maxMessages: historyPageSize(),
			}),
		);
		const events = Array.isArray(history?.events) ? history.events : [];
		state.events = events;
		const cursor = historyCursorFromResult(events, history?.hasMore === true);
		state.historyHasMore = cursor.hasMore;
		state.historyLoadingOlder = false;
		await rpc.request("session.subscribe", { sessionId });
		state.view = { name: "session", sessionId };
		state.scrollSessionToEnd = true;
	};

	const loadOlderHistory = async (sessionId: string): Promise<void> => {
		if (disposed || state.historyLoadingOlder || !state.historyHasMore) return;
		const beforeSeq = earliestSeq(state.events);
		if (beforeSeq === null) {
			state.historyHasMore = false;
			render();
			return;
		}
		const scroller = root.querySelector(".transcript");
		const previousHeight = scroller instanceof HTMLElement ? scroller.scrollHeight : 0;
		const previousTop = scroller instanceof HTMLElement ? scroller.scrollTop : 0;
		state.historyLoadingOlder = true;
		render();
		try {
			const history = asRecord(
				await rpc.request("session.history", {
					sessionId,
					beforeSeq,
					maxMessages: historyPageSize(),
				}),
			);
			if (disposed) return;
			const older = Array.isArray(history?.events) ? history.events : [];
			state.events = mergeHistoryPage(state.events, older);
			state.historyHasMore = history?.hasMore === true && older.length > 0;
		} catch (error) {
			if (disposed) return;
			state.error = error instanceof Error ? error.message : t("app.requestFailed");
		} finally {
			if (disposed) return;
			state.historyLoadingOlder = false;
			render();
			const next = root.querySelector(".transcript");
			if (next instanceof HTMLElement && previousHeight > 0) {
				next.scrollTop = previousTop + (next.scrollHeight - previousHeight);
			}
		}
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
		state.historyHasMore = false;
		state.historyLoadingOlder = false;
		render();
	};

	const run = async (work: () => Promise<void>, retry: (() => void) | null = null): Promise<void> => {
		if (disposed || state.busy) return;
		state.busy = true;
		state.error = null;
		state.retry = null;
		render();
		try {
			await work();
			if (disposed) return;
		} catch (error) {
			if (disposed) return;
			state.error = error instanceof Error ? error.message : t("app.requestFailed");
			state.retry = retry;
			if (state.view.name === "list") {
				const code = error instanceof Error ? error.message.split(":", 1)[0] : "";
				state.listState = code === "forbidden" || code === "unauthenticated"
					? "permissionDenied"
					: state.sessions.length > 0 ? "stale" : "unavailable";
			}
		} finally {
			if (disposed) return;
			state.busy = false;
			render();
		}
	};

	const runAction = async (key: string, work: () => Promise<void>): Promise<void> => {
		if (disposed || state.pendingActions.has(key)) return;
		state.pendingActions.add(key);
		state.error = null;
		render();
		try {
			await work();
			if (disposed) return;
		} catch (error) {
			if (disposed) return;
			state.error = error instanceof Error ? error.message : t("app.requestFailed");
		} finally {
			if (disposed) return;
			state.pendingActions.delete(key);
			render();
		}
	};

	const handlePush = (push: MobilePush): void => {
		if (disposed) return;
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

	const disposePush = rpc.onPush(handlePush);
	const onKeyDown = (event: EventLike): void => {
		if (!state.sheet) return;
		if (event.key === "Escape") {
			event.preventDefault();
			closeSheet();
			return;
		}
		if (event.key === "Tab") {
			const dialogButton = root.querySelector(".sheet button");
			if (dialogButton instanceof HTMLElement) {
				event.preventDefault();
				dialogButton.focus();
			}
		}
	};
	document.addEventListener("keydown", onKeyDown);
	const disposeLocale = subscribeLocale(() => {
		render();
	});
	const applyApprovalFocus = async (): Promise<void> => {
		const target = options.focusApproval;
		if (target === undefined || target === null) return;
		state.focusApprovalId = target.approvalId;
		await loadSession(target.sessionId);
		queueMicrotask(() => {
			const cards = root.querySelectorAll("[data-approval-id]");
			for (const card of cards) {
				if (!(card instanceof HTMLElement)) continue;
				if (card.getAttribute("data-approval-id") !== target.approvalId) continue;
				card.scrollIntoView({ block: "nearest", behavior: "smooth" });
				break;
			}
		});
	};

	void run(async () => {
		await rpc.request("host.subscribe", {});
		const listed = asRecord(await rpc.request("session.list", {}));
		state.sessions = Array.isArray(listed?.items)
			? listed.items.map(parseSession).filter((row): row is SessionRow => row !== null && !row.blank)
			: [];
		state.listState = state.sessions.length === 0 ? "empty" : "ready";
		await applyApprovalFocus();
	}, () => void refreshList());
	render();
	return () => {
		if (disposed) return;
		disposed = true;
		disposePush();
		disposeLocale();
		document.removeEventListener("keydown", onKeyDown);
		if (toastTimer !== null) clearTimeout(toastTimer);
		if (searchTimer !== null) clearTimeout(searchTimer);
	};
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
	if (role === "user") return t("app.role.you");
	if (role === "assistant") return t("app.role.assistant");
	if (role === "tool") return t("app.role.tool");
	return "";
}

function renderBubbleRow(line: TranscriptLine, streaming: boolean): HTMLElement {
	const row = el("div", { className: `bubble-row ${line.role}` });
	if (line.role !== "tool") {
		row.appendChild(el("div", { className: "bubble-label" }, labelOf(line.role)));
	}
	const bubble = el("div", { className: `bubble ${line.role}${streaming ? " streaming" : ""}` });
	if (line.role === "tool") bubble.textContent = `⚙ ${line.text}`;
	else appendMarkdown(bubble, line.text);
	row.appendChild(bubble);
	return row;
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
	const streaming = event?.type === "assistant/chunk";
	if (streaming && line.role === "assistant") {
		let last = scroller.lastElementChild;
		if (
			last instanceof HTMLElement &&
			last.classList.contains("bubble-row") &&
			last.classList.contains("assistant")
		) {
			const bubble = last.querySelector(".bubble");
			if (bubble instanceof HTMLElement) {
				bubble.replaceChildren();
				appendMarkdown(bubble, line.text);
				bubble.classList.add("streaming");
			}
		} else {
			scroller.appendChild(renderBubbleRow(line, true));
		}
	} else {
		scroller.appendChild(renderBubbleRow(line, false));
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
				label: session.cwd === undefined ? t("app.unboundWorkspace") : basenameOf(session.cwd),
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
			const pre = el("pre");
			const code = el("code");
			const body = part.replace(/^[^\n]*\n/, "");
			code.textContent = body.length > 0 ? body : part;
			pre.appendChild(code);
			root.appendChild(pre);
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

interface PreservedControl {
	readonly value: string;
	readonly checked: boolean;
	readonly selectionStart: number | null;
	readonly selectionEnd: number | null;
}

interface PreservedControls {
	readonly values: Map<string, PreservedControl>;
	readonly focusKey: string | null;
}

/** Keep in-progress answers intact when background pushes rebuild the UI. */
function capturePreservedControls(root: HTMLElement): PreservedControls {
	const values = new Map<string, PreservedControl>();
	let focusKey: string | null = null;
	collectInputs(root, (node) => {
		const key = node.getAttribute("data-preserve-key");
		if (key === null) return;
		values.set(key, {
			value: node.value,
			checked: node.checked,
			selectionStart: node.selectionStart,
			selectionEnd: node.selectionEnd,
		});
		if (document.activeElement === node) focusKey = key;
	});
	return { values, focusKey };
}

function restorePreservedControls(root: HTMLElement, preserved: PreservedControls): void {
	let focusTarget: HTMLInputElement | HTMLTextAreaElement | null = null;
	let focusValue: PreservedControl | null = null;
	collectInputs(root, (node) => {
		const key = node.getAttribute("data-preserve-key");
		if (key === null) return;
		const value = preserved.values.get(key);
		if (value === undefined) return;
		node.value = value.value;
		node.checked = value.checked;
		if (key === preserved.focusKey) {
			focusTarget = node;
			focusValue = value;
		}
	});
	if (focusTarget !== null) {
		const target = focusTarget;
		const value = focusValue;
		queueMicrotask(() => {
			target.focus();
			if (value !== null && value.selectionStart !== null && value.selectionEnd !== null) {
				target.setSelectionRange(value.selectionStart, value.selectionEnd);
			}
		});
	}
}

function el(tag: string, attrs: Record<string, string> = {}, text?: string): HTMLElement {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(attrs)) {
		if (key === "className") node.className = value;
		else if (key === "type") (node as HTMLInputElement).type = value;
		else node.setAttribute(key, value);
	}
	if (text !== undefined) node.textContent = text;
	return node;
}

function collectInputs(root: HTMLElement, visit: (node: HTMLInputElement | HTMLTextAreaElement) => void): void {
	const walker = [root];
	while (walker.length > 0) {
		const current = walker.pop();
		if (current === undefined) break;
		if (current instanceof HTMLInputElement || current instanceof HTMLTextAreaElement) {
			visit(current);
		}
		const list = current.children;
		for (let index = 0; index < list.length; index += 1) {
			const child = list.item(index);
			if (child !== null) walker.push(child as HTMLElement);
		}
	}
}
