/**
 * Hard gate for the DSH-loaded ESM entry (`lib/server/index.js`).
 *
 * Packing CJS packages (tweetnacl's conditional `require("crypto")`, ws native
 * addons) into this file makes Node throw `Dynamic require of "crypto" is not
 * supported` and DSH's plugin tree fail-fasts the whole `dsh web` process.
 */

const REQUIRED_EXTERNAL_IMPORTS = Object.freeze(["tweetnacl", "ws", "zod", "js-sha256"]);

/**
 * @param {string} source
 * @param {string} [label]
 */
export function assertServerBundle(source, label = "lib/server/index.js") {
	if (source.includes("Dynamic require of")) {
		throw new Error(`${label} contains an esbuild dynamic-require stub (Dynamic require of)`);
	}
	if (/\bfunction __require\b/.test(source) || /\b__require2\b/.test(source)) {
		throw new Error(`${label} contains an esbuild __require stub; CJS was inlined into ESM`);
	}
	if (source.includes("nacl-fast") || source.includes("nacl.randomBytes = function")) {
		throw new Error(`${label} appears to inline tweetnacl source; it must stay an external import`);
	}
	for (const name of REQUIRED_EXTERNAL_IMPORTS) {
		const pattern = new RegExp(`from\\s+["']${name}["']`);
		if (!pattern.test(source)) {
			throw new Error(`${label} must keep \`${name}\` as an external ESM import`);
		}
	}
}
