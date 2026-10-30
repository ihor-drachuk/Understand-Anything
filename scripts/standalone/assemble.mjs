#!/usr/bin/env node
/**
 * Assemble a standalone plugin bundle from a built checkout.
 *
 * Usage:
 *   node scripts/standalone/assemble.mjs <repo-root> <bundle-dir>
 *
 * Expects core and viewer to be built already (see .github/workflows/standalone.yml).
 * Copies the tracked plugin files plus build outputs into <bundle-dir>, names the
 * plugin after the <bundle-dir> folder, installs production dependencies offline
 * from the plugin lockfile, replaces every symlink with a real copy, and writes
 * BUILD-INFO.json and SHA256SUMS.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve, sep } from "node:path";

const [repoArg, bundleArg] = process.argv.slice(2);
if (!repoArg || !bundleArg) {
  console.error("Usage: node scripts/standalone/assemble.mjs <repo-root> <bundle-dir>");
  process.exit(1);
}
const repo = resolve(repoArg);
const plugin = join(repo, "understand-anything-plugin");
const bundle = resolve(bundleArg);

const BUILD_OUTPUTS = ["packages/core/dist", "packages/viewer/dist", "packages/viewer/bin/dist"];

function sh(command, args, cwd) {
  return execFileSync(command, args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "inherit"] });
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isSymbolicLink()) return [full];
    return entry.isDirectory() ? [full, ...walk(full)] : [full];
  });
}

if (existsSync(bundle)) {
  console.error(`Error: ${bundle} already exists; pass an empty path.`);
  process.exit(1);
}

for (const output of BUILD_OUTPUTS) {
  if (!existsSync(join(plugin, output))) {
    console.error(`Error: ${output} is missing; build core and viewer first.`);
    process.exit(1);
  }
}

const tracked = sh("git", ["ls-files", "-z", "--", "."], plugin).split("\0").filter(Boolean);
for (const relPath of tracked) {
  mkdirSync(dirname(join(bundle, relPath)), { recursive: true });
  cpSync(join(plugin, relPath), join(bundle, relPath));
}
for (const output of BUILD_OUTPUTS) {
  cpSync(join(plugin, output), join(bundle, output), { recursive: true });
}

// We name the plugin after its folder, otherwise the folder and the installed plugin could carry different names.
const manifestPath = join(bundle, ".claude-plugin", "plugin.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, name: basename(bundle) }, null, 2)}\n`);

// We install with the hoisted layout, because it keeps packages as real directories that survive copying and archiving.
sh("pnpm", [
  "install", "--prod", "--frozen-lockfile", "--ignore-scripts", "--offline", "--config.node-linker=hoisted",
  "--filter", "@understand-anything/skill...", "--fail-if-no-match",
], bundle);

// pnpm still creates symlinks for workspace packages and `.bin` shims. Symlinks break on Windows and in archives,
// so we replace each package link with a copy and delete the shims, which nothing runs.
for (;;) {
  const links = walk(bundle).filter((path) => lstatSync(path).isSymbolicLink());
  if (links.length === 0) break;
  for (const link of links) {
    const target = realpathSync(link);
    rmSync(link, { force: true });
    if (!link.split(sep).includes(".bin")) cpSync(target, link, { recursive: true, dereference: true });
  }
}
for (const binDir of walk(bundle).filter((path) => path.endsWith(`${sep}.bin`))) {
  rmSync(binDir, { recursive: true, force: true });
}

const lockfile = readFileSync(join(bundle, "pnpm-lock.yaml"));
const buildInfo = {
  upstreamBase: process.env.UPSTREAM_BASE ?? null,
  commit: sh("git", ["rev-parse", "HEAD"], repo).trim(),
  run: process.env.GITHUB_RUN_ID
    ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
    : null,
  node: process.version,
  pnpm: sh("pnpm", ["--version"], bundle).trim(),
  lockfileSha256: createHash("sha256").update(lockfile).digest("hex"),
};
writeFileSync(join(bundle, "BUILD-INFO.json"), `${JSON.stringify(buildInfo, null, 2)}\n`);

const files = walk(bundle)
  .filter((path) => lstatSync(path).isFile())
  .map((path) => relative(bundle, path).split(sep).join("/"))
  .sort();
const sums = files.map((relPath) => {
  const hash = createHash("sha256").update(readFileSync(join(bundle, relPath))).digest("hex");
  return `${hash}  ${relPath}`;
});
writeFileSync(join(bundle, "SHA256SUMS"), `${sums.join("\n")}\n`);
console.log(`Assembled ${files.length} files into ${bundle}`);
