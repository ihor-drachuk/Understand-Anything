#!/usr/bin/env node
/**
 * Smoke test for a standalone plugin bundle built by `assemble.mjs`.
 *
 * Usage:
 *   node scripts/standalone/smoke.mjs <bundle-dir>
 *
 * Exits non-zero on the first failed check.
 */

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const bundleArg = process.argv[2];
if (!bundleArg) {
  console.error("Usage: node scripts/standalone/smoke.mjs <bundle-dir>");
  process.exit(1);
}
const bundle = resolve(bundleArg);
const skillDir = join(bundle, "skills", "understand");

// `TreeSitterPlugin` silently skips a grammar that fails to load, so every fixture code file defines `ua_smoke`
// and we check that each one parsed.
const FIXTURE = {
  "src/util.ts": "export function ua_smoke(x: number): number { return x + 1; }\n",
  "src/main.ts": "import { ua_smoke } from './util';\nexport function ua_smoke_main() { return ua_smoke(1); }\n",
  "src/view.tsx": "export function ua_smoke() { return <div />; }\n",
  "src/app.js": "export function ua_smoke(x) { return x + 1; }\n",
  "src/app.py": "def ua_smoke(x):\n    return x + 1\n",
  "src/app.go": "package main\n\nfunc ua_smoke(x int) int { return x + 1 }\n",
  "src/app.rs": "pub fn ua_smoke(x: i32) -> i32 { x + 1 }\n",
  "src/App.java": "class App { int ua_smoke(int x) { return x + 1; } }\n",
  "src/App.cs": "class App { int ua_smoke(int x) { return x + 1; } }\n",
  "src/app.c": "int ua_smoke(int x) { return x + 1; }\n",
  "src/app.cpp": "int ua_smoke(int x) { return x + 1; }\n",
  "src/app.php": "<?php\nfunction ua_smoke($x) { return $x + 1; }\n",
  "src/app.rb": "def ua_smoke(x)\n  x + 1\nend\n",
  "src/App.kt": "fun ua_smoke(x: Int): Int = x + 1\n",
  "src/App.scala": "object App { def ua_smoke(x: Int): Int = x + 1 }\n",
  "src/App.swift": "func ua_smoke(x: Int) -> Int { return x + 1 }\n",
  "src/app.dart": "int ua_smoke(int x) { return x + 1; }\n",
  "README.md": "# Smoke fixture\n",
};

function check(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exit(1);
  }
  console.log(`ok: ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: "utf-8", ...options });
  if (result.status !== 0) {
    console.error(`FAIL: ${command} ${args.join(" ")} exited with ${result.status}`);
    console.error(result.error ?? "");
    console.error(result.stdout);
    console.error(result.stderr);
    process.exit(1);
  }
  return result;
}

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

function checkIntegrity() {
  const files = walk(bundle);
  const links = files.filter((file) => lstatSync(file).isSymbolicLink());
  check(links.length === 0, `bundle has no symlinks (${links.slice(0, 3).join(", ")})`);

  // Claude Code runs `npm install` in a copied plugin whose root has one of these lockfiles,
  // so we fail the bundle if it ships one.
  const npmLockfiles = ["package-lock.json", "npm-shrinkwrap.json", "bun.lock"]
    .filter((name) => existsSync(join(bundle, name)));
  check(npmLockfiles.length === 0, `bundle root has no npm or bun lockfile (${npmLockfiles.join(", ")})`);

  const { name } = JSON.parse(readFileSync(join(bundle, ".claude-plugin", "plugin.json"), "utf-8"));
  check(name === basename(bundle), `plugin.json names the plugin after its folder (${name})`);

  const sums = readFileSync(join(bundle, "SHA256SUMS"), "utf-8").trim().split("\n");
  const listed = new Set();
  const mismatched = [];
  for (const line of sums) {
    const [hash, relPath] = [line.slice(0, 64), line.slice(66)];
    const actual = createHash("sha256").update(readFileSync(join(bundle, relPath))).digest("hex");
    if (actual !== hash) mismatched.push(relPath);
    listed.add(relPath);
  }
  check(mismatched.length === 0, `${listed.size} files match SHA256SUMS (${mismatched.slice(0, 3).join(", ")})`);
  const unlisted = files
    .map((file) => relative(bundle, file).split(sep).join("/"))
    .filter((relPath) => relPath !== "SHA256SUMS" && !listed.has(relPath));
  check(unlisted.length === 0, `every bundle file is in SHA256SUMS (${unlisted.slice(0, 3).join(", ")})`);
}

async function checkResolution() {
  const require = createRequire(join(bundle, "package.json"));
  const specifiers = ["@understand-anything/core", "@understand-anything/core/figma", "graphology", "web-tree-sitter"];
  for (const specifier of specifiers) {
    check(require.resolve(specifier).startsWith(bundle + sep), `${specifier} resolves inside bundle`);
  }

  const coreEntry = require.resolve("@understand-anything/core");
  const coreRequire = createRequire(coreEntry);
  const { builtinLanguageConfigs } = await import(pathToFileURL(coreEntry).href);
  const grammars = builtinLanguageConfigs
    .filter((config) => config.treeSitter)
    .flatMap(({ id, treeSitter: { wasmPackage, wasmFile } }) =>
      id === "typescript" ? [`${wasmPackage}/${wasmFile}`, `${wasmPackage}/tree-sitter-tsx.wasm`]
        : [`${wasmPackage}/${wasmFile}`]);
  for (const grammar of grammars) {
    check(coreRequire.resolve(grammar).startsWith(bundle + sep), `${grammar} resolves inside bundle`);
  }
}

function git(root, ...args) {
  return run("git", ["-c", "user.name=smoke", "-c", "user.email=smoke@localhost", ...args], { cwd: root }).stdout.trim();
}

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "ua-smoke-project-"));
  for (const [relPath, content] of Object.entries(FIXTURE)) {
    mkdirSync(dirname(join(root, relPath)), { recursive: true });
    writeFileSync(join(root, relPath), content);
  }
  git(root, "init", "-q");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  return root;
}

function checkAnalysis(root) {
  const work = mkdtempSync(join(tmpdir(), "ua-smoke-work-"));
  const scanPath = join(work, "scan.json");
  run(process.execPath, [join(skillDir, "scan-project.mjs"), root, scanPath]);
  const scan = JSON.parse(readFileSync(scanPath, "utf-8"));
  const codeFiles = scan.files.filter((file) => file.fileCategory === "code");
  check(codeFiles.length === Object.keys(FIXTURE).length - 1, `scan-project found ${codeFiles.length} code files`);

  const importInput = join(work, "imports-in.json");
  const importOutput = join(work, "imports-out.json");
  writeFileSync(importInput, JSON.stringify({ projectRoot: root, files: scan.files }));
  run(process.execPath, [join(skillDir, "extract-import-map.mjs"), importInput, importOutput]);
  const { importMap } = JSON.parse(readFileSync(importOutput, "utf-8"));
  check((importMap["src/main.ts"] ?? []).includes("src/util.ts"), "extract-import-map resolved src/main.ts -> src/util.ts");

  const structureInput = join(work, "structure-in.json");
  const structureOutput = join(work, "structure-out.json");
  writeFileSync(structureInput, JSON.stringify({ projectRoot: root, batchFiles: codeFiles, batchImportData: {} }));
  run(process.execPath, [join(skillDir, "extract-structure.mjs"), structureInput, structureOutput]);
  const structure = JSON.parse(readFileSync(structureOutput, "utf-8"));
  check(structure.filesSkipped.length === 0, `extract-structure skipped nothing (${structure.filesSkipped.join(", ")})`);
  for (const file of codeFiles) {
    const result = structure.results.find((entry) => entry.path === file.path);
    check(JSON.stringify(result ?? {}).includes("ua_smoke"), `tree-sitter parsed ${file.path} (${file.language})`);
  }

  const scanResultPath = join(work, "scan-result.json");
  const batchesPath = join(work, "batches.json");
  writeFileSync(scanResultPath, JSON.stringify({ ...scan, importMap }));
  const batches = run(process.execPath, [
    join(skillDir, "compute-batches.mjs"), root, `--scan-result=${scanResultPath}`, `--output=${batchesPath}`,
  ]);
  check(!/Louvain failed|tree-sitter init failed/.test(batches.stderr), "compute-batches ran Louvain and tree-sitter");
  check(JSON.parse(readFileSync(batchesPath, "utf-8")).batches.length > 0, "compute-batches wrote batches");
}

function checkPython() {
  const python = spawnSync("python3", ["-c", ""]).status === 0 ? "python3" : "python";
  const scripts = walk(join(bundle, "skills")).filter((file) => file.endsWith(".py"));
  const work = mkdtempSync(join(tmpdir(), "ua-smoke-py-"));
  for (const script of scripts) {
    const copy = join(work, relative(bundle, script).split(sep).join("_"));
    copyFileSync(script, copy);
    run(python, ["-m", "py_compile", copy]);
  }
  check(scripts.length > 0, `${scripts.length} Python scripts compile`);
}

function startViewer(root) {
  const viewerBin = join(bundle, "packages", "viewer", "bin", "viewer.mjs");
  const viewer = spawn(process.execPath, [viewerBin, root, "--no-open", "--port", "0"]);
  const url = new Promise((resolveUrl, rejectUrl) => {
    let output = "";
    const timer = setTimeout(() => rejectUrl(new Error(`viewer printed no URL: ${output}`)), 15000);
    viewer.stdout.on("data", (chunk) => {
      output += chunk;
      const match = output.match(/Dashboard URL: (\S+)/);
      if (match) {
        clearTimeout(timer);
        resolveUrl(new URL(match[1]));
      }
    });
    viewer.stderr.on("data", (chunk) => { output += chunk; });
    viewer.on("exit", (code) => rejectUrl(new Error(`viewer exited with ${code}: ${output}`)));
  });
  return { viewer, url };
}

async function checkViewer(root) {
  const head = git(root, "rev-parse", "HEAD");
  const graph = {
    version: "1.0.0",
    project: { name: "smoke", languages: [], frameworks: [], description: "", analyzedAt: "", gitCommitHash: head },
    nodes: [{ id: "file:src/util.ts", type: "file", name: "util.ts", filePath: "src/util.ts", summary: "", tags: [] }],
    edges: [],
    layers: [],
    tour: [],
  };
  mkdirSync(join(root, ".ua"), { recursive: true });
  writeFileSync(join(root, ".ua", "knowledge-graph.json"), JSON.stringify(graph));

  const { viewer, url: urlPromise } = startViewer(root);
  try {
    const url = await urlPromise;
    const token = url.searchParams.get("token");

    const index = await fetch(new URL("/", url));
    const html = await index.text();
    check(index.status === 200 && html.includes('id="root"'), "viewer serves dashboard index");
    check(!/https?:\/\/(?!127\.0\.0\.1)/.test(html), "dashboard index loads nothing from other hosts");
    const googleFonts = walk(join(bundle, "packages", "viewer", "dist"))
      .filter((file) => /fonts\.(?:googleapis|gstatic)\.com/.test(readFileSync(file, "latin1")));
    check(googleFonts.length === 0, `built dashboard references no Google Fonts (${googleFonts.join(", ")})`);

    const font = await fetch(new URL("/fonts/Inter-Regular.woff2", url));
    check(font.status === 200 && font.headers.get("content-type") === "font/woff2", "viewer serves bundled fonts");

    const denied = await fetch(new URL("/knowledge-graph.json", url));
    check(denied.status === 403, "graph without token is refused");

    const served = await fetch(new URL(`/knowledge-graph.json?token=${token}`, url));
    check(served.status === 200 && (await served.json()).nodes.length === 1, "graph with token is served");

    const staleness = await fetch(new URL(`/staleness.json?token=${token}`, url));
    const freshness = await staleness.json();
    check(freshness.graphs?.knowledge?.status === "fresh", "bundled staleness.js ran git and found graph fresh");
  } finally {
    viewer.kill();
  }
}

checkIntegrity();
await checkResolution();
const project = makeProject();
checkAnalysis(project);
checkPython();
await checkViewer(project);
checkIntegrity();
console.log("standalone bundle smoke test passed");
