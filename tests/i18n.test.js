import assert from "node:assert/strict";
import test from "node:test";
import {
	formatAgo,
	isMessageKey,
	localeFromSearch,
	localeFromTag,
	pairErrorMessage,
	resolveLocale,
	setLocale,
	t,
	translate,
} from "../lib/shared/i18n/index.js";

test("localeFromTag maps zh* to zh-CN and everything else to en", () => {
	assert.equal(localeFromTag("zh-CN"), "zh-CN");
	assert.equal(localeFromTag("zh"), "zh-CN");
	assert.equal(localeFromTag("zh-Hans-CN"), "zh-CN");
	assert.equal(localeFromTag("en-US"), "en");
	assert.equal(localeFromTag("fr"), "en");
	assert.equal(localeFromTag(""), "en");
	assert.equal(localeFromTag(null), "en");
});

test("localeFromSearch reads ?lang=", () => {
	assert.equal(localeFromSearch("?lang=zh-CN"), "zh-CN");
	assert.equal(localeFromSearch("lang=zh"), "zh-CN");
	assert.equal(localeFromSearch("?lang=en"), "en");
	assert.equal(localeFromSearch("?foo=1"), null);
});

test("resolveLocale priority: query > storage > navigator", () => {
	const storage = {
		store: /** @type {Record<string, string>} */ ({}),
		getItem(key) {
			return this.store[key] ?? null;
		},
		setItem(key, value) {
			this.store[key] = value;
		},
	};
	storage.setItem("dshmr.locale", "zh-CN");
	assert.equal(
		resolveLocale({ search: "?lang=en", storage, navigatorLanguage: "zh-CN" }),
		"en",
	);
	assert.equal(resolveLocale({ storage, navigatorLanguage: "fr-FR" }), "zh-CN");
	assert.equal(resolveLocale({ navigatorLanguage: "zh-TW" }), "zh-CN");
	assert.equal(resolveLocale({ navigatorLanguage: "de" }), "en");
});

test("translate interpolates and falls back", () => {
	assert.equal(translate("common.ago.minutes", "en", { n: 3 }), "3m ago");
	assert.equal(translate("common.ago.minutes", "zh-CN", { n: 3 }), "3 分钟前");
	assert.equal(isMessageKey("missing.key"), false);
});

test("P0 tunnel / diagnostics message keys exist in zh-CN and en", () => {
	for (const key of [
		"settings.tunnel.disclaimer",
		"settings.tunnel.disclaimerRequired",
		"settings.tunnel.binaryUntrusted",
		"settings.diagnostics.title",
		"settings.diagnostics.offerActive",
		"settings.diagnostics.offerNone",
		"settings.diagnostics.devices",
	]) {
		assert.equal(isMessageKey(key), true, key);
		assert.ok(translate(key, "en").length > 0, key);
		assert.ok(translate(key, "zh-CN").length > 0, key);
	}
});

test("t uses active locale from setLocale", () => {
	setLocale("en");
	assert.equal(t("settings.nav"), "Mobile Remote");
	setLocale("zh-CN");
	assert.equal(t("settings.nav"), "移动远程");
});

test("pairErrorMessage maps codes independently of server message language", () => {
	setLocale("en");
	assert.equal(pairErrorMessage("invalid_params"), "Invalid pairing code format");
	assert.equal(pairErrorMessage("rate_limited"), "Too many attempts — try again later");
	assert.equal(pairErrorMessage("not-found"), "Pairing code invalid or expired");
	assert.equal(pairErrorMessage("other"), "Pairing code invalid or expired");
	setLocale("zh-CN");
	assert.equal(pairErrorMessage("invalid_params"), "配对码格式不对");
});

test("formatAgo returns localized relative times", () => {
	const now = Date.now();
	assert.equal(formatAgo(now - 1_000, "en"), "Just now");
	assert.equal(formatAgo(now - 120_000, "en"), "2m ago");
	assert.match(formatAgo(now - 120_000, "zh-CN"), /分钟前/);
});
