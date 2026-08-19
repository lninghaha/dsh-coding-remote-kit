/** SHA-256 then XOR-loop compare so token length is not leaked. */

export async function tokenEquals(presented: string, expected: string): Promise<boolean> {
	const encoder = new TextEncoder();
	const left = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(presented)));
	const right = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(expected)));
	let diff = 0;
	for (let index = 0; index < left.length; index += 1) diff |= left[index]! ^ right[index]!;
	return diff === 0;
}

export function randomToken(bytes: number): string {
	const buffer = new Uint8Array(bytes);
	crypto.getRandomValues(buffer);
	let out = "";
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
	for (let index = 0; index < buffer.length; index += 1) {
		out += alphabet.charAt(buffer[index]! & 63);
	}
	return out;
}
