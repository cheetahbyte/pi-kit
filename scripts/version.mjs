// Usage: version.mjs VERSION sets every manifest to VERSION; version.mjs --check VERSION fails unless they all match.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const check = process.argv[2] === "--check";
const version = process.argv[check ? 3 : 2]?.replace(/^v/, "");
if (!version || !/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error("Usage: version.mjs [--check] VERSION");
  process.exit(1);
}

const paths = ["package.json", ...readdirSync("packages").map((directory) => `packages/${directory}/package.json`).filter(existsSync)];
const mismatched = [];
for (const path of paths) {
  const manifest = JSON.parse(readFileSync(path, "utf8"));
  if (manifest.version === version) continue;
  mismatched.push(`${path} is ${manifest.version}`);
  if (!check) writeFileSync(path, `${JSON.stringify({ ...manifest, version }, null, 2)}\n`);
}

if (check && mismatched.length) {
  console.error(`Expected ${version} everywhere:\n${mismatched.join("\n")}`);
  process.exit(1);
}
console.log(check ? `All ${paths.length} manifests are at ${version}` : `Set ${paths.length} manifests to ${version}`);
