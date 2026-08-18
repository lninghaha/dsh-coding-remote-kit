/**
 * Server X25519 identity key loading / generation. The keypair lives in
 * `server-key.json` (0600) and is generated on first boot via
 * `nacl.box.keyPair()`.
 */

import { join } from "node:path";
import { base64Decode, base64Encode } from "../shared/base64.js";
import { generateServerKeyPair } from "./crypto.js";
import { readJsonFile, writeFileAtomic } from "./storage.js";

export interface ServerKeyFile {
	readonly secretKeyB64: string;
	readonly publicKeyB64: string;
}

export interface ServerKeyPair {
	readonly secretKey: Uint8Array;
	readonly publicKey: Uint8Array;
}

export function loadOrCreateServerKey(storageDirectory: string): ServerKeyPair {
	const path = join(storageDirectory, "server-key.json");
	const existing = readJsonFile<ServerKeyFile>(path);
	if (
		existing !== null &&
		typeof existing.secretKeyB64 === "string" &&
		typeof existing.publicKeyB64 === "string"
	) {
		try {
			const secretKey = base64Decode(existing.secretKeyB64);
			const publicKey = base64Decode(existing.publicKeyB64);
			if (secretKey.length === 32 && publicKey.length === 32) return { secretKey, publicKey };
		} catch {
			// fall through to regeneration on a corrupt key file
		}
	}
	const keyPair = generateServerKeyPair();
	const file: ServerKeyFile = {
		secretKeyB64: base64Encode(keyPair.secretKey),
		publicKeyB64: base64Encode(keyPair.publicKey),
	};
	writeFileAtomic(path, JSON.stringify(file, null, 2));
	return keyPair;
}
