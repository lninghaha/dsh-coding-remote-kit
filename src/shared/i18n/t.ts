import {
	applyDocumentLang,
	resolveLocale,
	type Locale,
	type ResolveLocaleInput,
	writeStoredLocale,
	type StorageLike,
} from "./locales.js";
import { isMessageKey, MESSAGES, type MessageKey } from "./messages.js";

export type { Locale, MessageKey, StorageLike };
export {
	LOCALE_STORAGE_KEY,
	LOCALES,
	applyDocumentLang,
	isLocale,
	localeFromSearch,
	localeFromTag,
	readStoredLocale,
	resolveLocale,
	writeStoredLocale,
} from "./locales.js";
export { MESSAGES, isMessageKey } from "./messages.js";

let activeLocale: Locale = "en";
const listeners = new Set<() => void>();

export function getLocale(): Locale {
	return activeLocale;
}

export function setLocale(locale: Locale, storage?: StorageLike | null): void {
	if (activeLocale === locale) {
		writeStoredLocale(storage, locale);
		return;
	}
	activeLocale = locale;
	writeStoredLocale(storage, locale);
	if (typeof document !== "undefined") {
		applyDocumentLang(locale, document);
	}
	for (const listener of listeners) listener();
}

export function subscribeLocale(listener: () => void): () => void {
	listeners.add(listener);
	return () => {
		listeners.delete(listener);
	};
}

/** Bootstrap locale from query / storage / navigator and apply `<html lang>`. */
export function bootstrapLocale(input: ResolveLocaleInput = {}): Locale {
	const resolved = resolveLocale({
		search: input.search ?? (typeof location !== "undefined" ? location.search : null),
		storage: input.storage ?? (typeof localStorage !== "undefined" ? localStorage : null),
		navigatorLanguage:
			input.navigatorLanguage ?? (typeof navigator !== "undefined" ? navigator.language : null),
	});
	activeLocale = resolved;
	if (typeof document !== "undefined") {
		applyDocumentLang(resolved, document);
	}
	return resolved;
}

export type Vars = Record<string, string | number>;

export function translate(key: MessageKey, locale: Locale, vars?: Vars): string {
	const entry = MESSAGES[key];
	let text = entry[locale] ?? entry.en ?? String(key);
	if (vars !== undefined) {
		for (const [name, value] of Object.entries(vars)) {
			text = text.split(`{${name}}`).join(String(value));
		}
	}
	return text;
}

/** Translate using the active locale. Unknown keys fall back to the key string. */
export function t(key: MessageKey | string, vars?: Vars, locale: Locale = activeLocale): string {
	if (!isMessageKey(key)) return key;
	return translate(key, locale, vars);
}

/** Map pairing API error codes to localized copy (ignores server message language). */
export function pairErrorMessage(code: string | undefined, fallbackKey: MessageKey = "pair.form.invalid"): string {
	switch (code) {
		case "invalid_params":
			return t("pair.form.badFormat");
		case "rate_limited":
			return t("pair.form.rateLimited");
		case "not-found":
			return t("pair.form.invalid");
		default:
			return t(fallbackKey);
	}
}

export function formatAgo(timestamp: number, locale: Locale = activeLocale): string {
	if (timestamp <= 0) return "";
	const delta = Date.now() - timestamp;
	if (delta < 60_000) return translate("common.ago.justNow", locale);
	if (delta < 3_600_000) {
		return translate("common.ago.minutes", locale, { n: Math.floor(delta / 60_000) });
	}
	if (delta < 86_400_000) {
		return translate("common.ago.hours", locale, { n: Math.floor(delta / 3_600_000) });
	}
	return translate("common.ago.days", locale, { n: Math.floor(delta / 86_400_000) });
}
