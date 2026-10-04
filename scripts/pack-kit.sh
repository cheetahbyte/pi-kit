#!/bin/sh
# Bun's isolated node_modules can't be bundled, so the kit is packed from a clean npm install.
set -eu
root=$(cd "$(dirname "$0")/.." && pwd)
stage=$(mktemp -d)
trap 'rm -rf "$stage"' EXIT

cd "$root"
rsync -a --exclude node_modules LICENSE README.md package.json packages "$stage/"
cd "$stage"
npm pkg delete workspaces devDependencies scripts
npm install --omit=dev --omit=peer --ignore-scripts --no-audit --no-fund
npm pack --pack-destination "$root"
