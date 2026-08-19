/** Supported product UI locales (bilingual: zh-CN + en). */
export type Locale = "zh-CN" | "en";

export const LOCALES: readonly Locale[] = Object.freeze(["zh-CN", "en"]);

export const LOCALE_STORAGE_KEY = "dshmr.locale";

export function isLocale(value: unknown): value is Locale {
	return value === "zh-CN" || value === "en";
}

/** Map BCP-47 / navigator tags to a supported locale. */
export function localeFromTag(tag: string | null | undefined): Locale {
	if (typeof tag !== "string" || tag.length === 0) return "en";
	const lower = tag.trim().toLowerCase().replace(/_/g, "-");
	if (lower === "zh" || lower.startsWith("zh-")) return "zh-CN";
	return "en";
}

export function readStoredLocale(storage: StorageLike | null | undefined): Locale | null {
	if (storage === null || storage === undefined) return null;
	try {
		const raw = storage.getItem(LOCALE_STORAGE_KEY);
		return isLocale(raw) ? raw : null;
	} catch {
		return null;
	}
}

export function writeStoredLocale(storage: StorageLike | null | undefined, locale: Locale): void {
	if (storage === null || storage === undefined) return;
	try {
		storage.setItem(LOCALE_STORAGE_KEY, locale);
	} catch {
		/* ignore quota / private mode */
	}
}

export function localeFromSearch(search: string | null | undefined): Locale | null {
	if (typeof search !== "string" || search.length === 0) return null;
	const query = search.startsWith("?") ? search.slice(1) : search;
	const params = new URLSearchParams(query);
	const lang = params.get("lang");
	if (lang === "zh" || lang === "zh-CN" || lang === "zh-cn") return "zh-CN";
	if (lang === "en" || lang === "en-US" || lang === "en-us") return "en";
	return isLocale(lang) ? lang : null;
}

export interface ResolveLocaleInput {
	search?: string | null;
	storage?: StorageLike | null;
	navigatorLanguage?: string | null;
}

/**
 * Priority: `?lang=` → localStorage → navigator.language → en.
 */
export function resolveLocale(input: ResolveLocaleInput = {}): Locale {
	const fromQuery = localeFromSearch(input.search);
	if (fromQuery !== null) return fromQuery;
	const stored = readStoredLocale(input.storage);
	if (stored !== null) return stored;
	return localeFromTag(input.navigatorLanguage);
}

export function applyDocumentLang(locale: Locale, doc: { documentElement: { lang: string } }): void {
	doc.documentElement.lang = locale === "zh-CN" ? "zh-CN" : "en";
}

export interface StorageLike {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}
