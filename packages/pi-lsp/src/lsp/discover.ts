import { type Dirent, readdirSync } from "node:fs";
import { extname, join } from "node:path";
import { pickServer } from "./servers.js";

const SKIP = new Set([
	"node_modules",
	".git",
	"dist",
	"build",
	"out",
	"target",
	"vendor",
	".venv",
	"venv",
	"__pycache__",
	".next",
	".cache",
]);

const MAX_FILES = 2000;

/** workspace/symbol needs a live server, and the server is chosen by file type: pick the dominant one. */
export function seedFile(cwd: string): string {
	const counts = new Map<string, { count: number; first: string }>();
	const queue = [cwd];
	let seen = 0;

	while (queue.length > 0 && seen < MAX_FILES) {
		const dir = queue.shift() as string;
		let entries: Dirent[];
		try {
			entries = readdirSync(dir, { withFileTypes: true }) as Dirent[];
		} catch {
			continue;
		}
		for (const entry of entries) {
			const full = join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!SKIP.has(entry.name) && !entry.name.startsWith(".")) queue.push(full);
				continue;
			}
			if (!entry.isFile()) continue;
			seen++;
			const ext = extname(entry.name).toLowerCase();
			if (!ext) continue;
			const bucket = counts.get(ext);
			if (bucket) bucket.count++;
			else counts.set(ext, { count: 1, first: full });
		}
	}

	const ranked = [...counts.entries()].sort((a, b) => b[1].count - a[1].count);
	for (const [, bucket] of ranked) {
		try {
			pickServer(bucket.first, cwd);
			return bucket.first;
		} catch {}
	}
	throw new Error(
		"no file with an available language server found under the working directory; pass an explicit path",
	);
}
