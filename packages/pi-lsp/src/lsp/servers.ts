import { accessSync, constants, existsSync, readFileSync, statSync } from "node:fs";
import { delimiter, dirname, extname, join, resolve } from "node:path";

export interface ServerSpec {
	id: string;
	command: string;
	args: string[];
	extensions: string[];
	rootMarkers: string[];
	languageIds?: Record<string, string>;
	initializationOptions?: unknown;
	languageId: (path: string) => string;
}

interface ServerConfig extends Omit<ServerSpec, "languageId"> {}

const DEFAULTS: ServerConfig[] = [
	{
		id: "typescript-language-server",
		command: "typescript-language-server",
		args: ["--stdio"],
		extensions: [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"],
		rootMarkers: ["tsconfig.json", "jsconfig.json", "package.json"],
		languageIds: {
			".ts": "typescript",
			".mts": "typescript",
			".cts": "typescript",
			".tsx": "typescriptreact",
			".js": "javascript",
			".mjs": "javascript",
			".cjs": "javascript",
			".jsx": "javascriptreact",
		},
	},
	{
		id: "pyright",
		command: "pyright-langserver",
		args: ["--stdio"],
		extensions: [".py", ".pyi"],
		rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"],
	},
	{
		id: "pylsp",
		command: "pylsp",
		args: [],
		extensions: [".py", ".pyi"],
		rootMarkers: ["pyproject.toml", "setup.py", "setup.cfg", "requirements.txt"],
	},
	{
		id: "rust-analyzer",
		command: "rust-analyzer",
		args: [],
		extensions: [".rs"],
		rootMarkers: ["Cargo.toml"],
	},
	{
		id: "gopls",
		command: "gopls",
		args: [],
		extensions: [".go"],
		rootMarkers: ["go.mod", "go.work"],
	},
	{
		id: "clangd",
		command: "clangd",
		args: [],
		extensions: [".c", ".h", ".cc", ".cpp", ".hpp", ".cxx", ".hh"],
		rootMarkers: ["compile_commands.json", "CMakeLists.txt", "Makefile"],
	},
	{
		id: "sourcekit-lsp",
		command: "sourcekit-lsp",
		args: [],
		extensions: [".swift"],
		rootMarkers: ["Package.swift", "buildServer.json", "compile_commands.json"],
	},
	{
		id: "lua-language-server",
		command: "lua-language-server",
		args: [],
		extensions: [".lua"],
		rootMarkers: [".luarc.json"],
	},
];

const FALLBACK_LANGUAGE_IDS: Record<string, string> = {
	".swift": "swift",
	".py": "python",
	".pyi": "python",
	".rs": "rust",
	".go": "go",
	".lua": "lua",
	".c": "c",
	".h": "c",
	".cc": "cpp",
	".cpp": "cpp",
	".cxx": "cpp",
	".hh": "cpp",
	".hpp": "cpp",
};

function withLanguageId(config: ServerConfig): ServerSpec {
	return {
		...config,
		languageId(path: string): string {
			const ext = extname(path).toLowerCase();
			return (
				config.languageIds?.[ext] ??
				FALLBACK_LANGUAGE_IDS[ext] ??
				ext.replace(".", "")
			);
		},
	};
}

function onPath(command: string): boolean {
	if (command.includes("/") || command.includes("\\")) {
		return existsSync(command);
	}
	const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
	for (const dir of (process.env.PATH ?? "").split(delimiter)) {
		if (!dir) continue;
		for (const ext of exts) {
			try {
				accessSync(join(dir, command + ext), constants.X_OK);
				return true;
			} catch {}
		}
	}
	return false;
}

function loadOverrides(cwd: string): ServerConfig[] {
	const file = join(cwd, ".pi", "lsp.json");
	if (!existsSync(file)) return [];
	try {
		const parsed = JSON.parse(readFileSync(file, "utf8")) as {
			servers?: ServerConfig[];
		};
		return parsed.servers ?? [];
	} catch {
		return [];
	}
}

export function pickServer(path: string, cwd: string): ServerSpec {
	const ext = extname(path).toLowerCase();
	const configs = [...loadOverrides(cwd), ...DEFAULTS];
	const matching = configs.filter((config) => config.extensions.includes(ext));
	if (matching.length === 0) {
		throw new Error(`no language server configured for "${ext || path}"`);
	}
	const available = matching.find((config) => onPath(config.command));
	if (!available) {
		const names = [...new Set(matching.map((config) => config.command))];
		throw new Error(
			`no language server found on PATH for "${ext}" (tried: ${names.join(", ")})`,
		);
	}
	return withLanguageId(available);
}

export function findRoot(path: string, spec: ServerSpec, cwd: string): string {
	const markers = [...spec.rootMarkers, ".git"];
	let dir = statSync(path).isDirectory() ? path : dirname(path);
	let fallback: string | undefined;
	while (true) {
		for (const marker of markers) {
			if (existsSync(join(dir, marker))) {
				if (marker === ".git") fallback ??= dir;
				else return dir;
			}
		}
		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}
	return fallback ?? cwd;
}

export function resolvePath(path: string, cwd: string): string {
	const full = resolve(cwd, path);
	if (!existsSync(full)) throw new Error(`file not found: ${path}`);
	return full;
}
