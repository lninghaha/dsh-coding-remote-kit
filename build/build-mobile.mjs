import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outdir = resolve(root, "lib/mobile");
const src = resolve(root, "src/mobile");
const SHELL_VERSION_PLACEHOLDER = "__DSHMR_SHELL_VERSION__";
const { version: packageVersion } = JSON.parse(await readFile(resolve(root, "package.json"), "utf8"));
if (typeof packageVersion !== "string" || packageVersion.length === 0) {
	throw new Error("package.json version is required to stamp the mobile shell service worker cache");
}

await mkdir(resolve(outdir, "icons"), { recursive: true });

await build({
	entryPoints: [resolve(src, "main.ts")],
	outfile: resolve(outdir, "app.js"),
	bundle: true,
	format: "iife",
	platform: "browser",
	target: "es2022",
	sourcemap: false,
	legalComments: "none",
	minify: true,
});

await copyFile(resolve(src, "index.html"), resolve(outdir, "index.html"));
await copyFile(resolve(src, "manifest.webmanifest"), resolve(outdir, "manifest.webmanifest"));
const serviceWorker = await readFile(resolve(src, "sw.js"), "utf8");
if (!serviceWorker.includes(SHELL_VERSION_PLACEHOLDER)) {
	throw new Error(`src/mobile/sw.js must declare its cache name with ${SHELL_VERSION_PLACEHOLDER}`);
}
await writeFile(resolve(outdir, "sw.js"), serviceWorker.replaceAll(SHELL_VERSION_PLACEHOLDER, packageVersion));
await writeFile(resolve(outdir, "icons/icon-192.png"), pngIcon(192));
await writeFile(resolve(outdir, "icons/icon-512.png"), pngIcon(512));

console.log(`built ${resolve(outdir, "app.js")}`);
console.log(`copied mobile shell + PWA assets`);

function crc32(buffer) {
	let crc = 0xffffffff;
	for (const byte of buffer) {
		crc ^= byte;
		for (let bit = 0; bit < 8; bit += 1) {
			const mask = -(crc & 1);
			crc = (crc >>> 1) ^ (0xedb88320 & mask);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const header = Buffer.alloc(8);
	header.writeUInt32BE(data.length, 0);
	header.write(type, 4, 4, "ascii");
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc32(Buffer.concat([header.subarray(4, 8), data])), 0);
	return Buffer.concat([header, data, crcBuf]);
}

function pngIcon(size) {
	const stride = size * 3 + 1;
	const raw = Buffer.alloc(stride * size);
	const radius = size * 0.22;
	const cx = size / 2;
	const cy = size / 2;
	for (let y = 0; y < size; y += 1) {
		raw[y * stride] = 0;
		for (let x = 0; x < size; x += 1) {
			const i = y * stride + 1 + x * 3;
			const dx = x - cx;
			const dy = y - cy;
			const inside = dx * dx + dy * dy <= radius * radius;
			if (inside) {
				raw[i] = 255;
				raw[i + 1] = 255;
				raw[i + 2] = 255;
			} else {
				raw[i] = 0x3b;
				raw[i + 1] = 0x82;
				raw[i + 2] = 0xf6;
			}
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	return Buffer.concat([signature, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
