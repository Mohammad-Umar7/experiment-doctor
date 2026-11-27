/**
 * Experiment Doctor CI Gate: the GitHub Action entry point (also runnable locally).
 *
 *   node packages/action/dist/main.js --base origin/main
 *
 * Reads .experiment-doctor.json for the flag, metric events and paths to scan, diagnoses the
 * base and the head of the pull request with the Doctor's engine, prints GitHub annotations
 * for regressions the pull request introduces and writes a job summary.
 * It never calls Flagsmith and needs no secrets.
 */
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { diagnose, scanFiles, type CodeEvidence, type Evidence, type Report, type Severity, type SourceFile } from "@experiment-doctor/core";
import { runGate, summaryMarkdown, type Annotation } from "./gate";

type RepoConfig = {
  flag?: string;
  metrics?: string[];
  variants?: string[];
  paths?: string[];
};

const CODE = /\.(?:[mc]?[jt]sx?)$/i;
const SKIP = /(^|\/)(node_modules|dist|build|\.next|out|coverage|\.git)(\/|$)/;

function input(name: string, fallback = ""): string {
  const fromEnv = process.env[`INPUT_${name.toUpperCase().replace(/ /g, "_")}`];
  const flag = process.argv.indexOf(`--${name}`);
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1];
  return (fromEnv ?? "").trim() || fallback;
}

function git(args: string[], cwd: string): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

function loadConfig(root: string): RepoConfig {
  const file = join(root, ".experiment-doctor.json");
  if (!existsSync(file)) return {};
  return JSON.parse(readFileSync(file, "utf8")) as RepoConfig;
}

function walk(dir: string, root: string, out: SourceFile[]) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const rel = relative(root, full).replace(/\\/g, "/");
    if (SKIP.test(rel)) continue;
    const st = statSync(full);
    if (st.isDirectory()) walk(full, root, out);
    else if ((CODE.test(name) || name === "package.json") && st.size < 512_000) out.push({ path: rel, content: readFileSync(full, "utf8") });
  }
}

function headFiles(root: string, paths: string[]): SourceFile[] {
  const out: SourceFile[] = [];
  for (const p of paths) {
    const dir = join(root, p);
    if (existsSync(dir)) walk(dir, root, out);
  }
  return out;
}

function baseFiles(root: string, ref: string, paths: string[]): SourceFile[] | null {
  let listing: string;
  try {
    listing = git(["ls-tree", "-r", "--name-only", ref, "--", ...paths], root);
  } catch {
    return null;
  }
  const out: SourceFile[] = [];
  for (const path of listing.split("\n").filter(Boolean)) {
    if (SKIP.test(path) || !(CODE.test(path) || path.endsWith("package.json"))) continue;
    try {
      out.push({ path, content: git(["show", `${ref}:${path}`], root) });
    } catch {
      /* binary or vanished */
    }
  }
  return out;
}

function configEvidence(cfg: RepoConfig): Evidence["config"] {
  if (!cfg.flag && !cfg.metrics?.length) return null;
  return {
    source: "file",
    flag: cfg.flag
      ? { name: cfg.flag, variants: (cfg.variants ?? []).map((key, i) => ({ id: i + 1, value: key, key })) }
      : null,
    metrics: (cfg.metrics ?? []).map((event, i) => ({ id: i + 1, name: event, event, aggregation: "occurrence" })),
  };
}

function report(code: CodeEvidence, cfg: RepoConfig): Report {
  return diagnose({
    schemaVersion: 1,
    target: cfg.flag ? { flag: cfg.flag } : undefined,
    config: configEvidence(cfg),
    code,
  });
}

function escapeData(s: string) {
  return s.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}
function escapeProp(s: string) {
  return escapeData(s).replace(/:/g, "%3A").replace(/,/g, "%2C");
}

function emit(a: Annotation) {
  console.log(`::${a.level} file=${escapeProp(a.file)},line=${a.line},title=${escapeProp(a.title)}::${escapeData(a.message)}`);
}

function main() {
  const root = process.env.GITHUB_WORKSPACE ?? process.cwd();
  const cfg = loadConfig(root);
  const paths = cfg.paths?.length ? cfg.paths : ["."];
  const baseRef =
    input("base") || (process.env.GITHUB_BASE_REF ? `origin/${process.env.GITHUB_BASE_REF}` : "HEAD~1");
  const failOn = (input("fail-on", "critical") as Severity) ?? "critical";
  const minConfidence = Number(input("min-confidence", "0.8"));

  let mergeBase = baseRef;
  try {
    mergeBase = git(["merge-base", baseRef, "HEAD"], root).trim() || baseRef;
  } catch {
    /* shallow clone: fall back to the ref itself */
  }

  const headCode = scanFiles(headFiles(root, paths), { root });
  const baseSources = baseFiles(root, mergeBase, paths);
  const baseCode = baseSources ? scanFiles(baseSources, { root }) : null;

  const head = report(headCode, cfg);
  const base = baseCode ? report(baseCode, cfg) : null;
  const result = runGate(base, head, { base: baseCode, head: headCode }, {
    metrics: cfg.metrics ?? [],
    failOn,
    minConfidence,
  });

  for (const a of result.annotations) emit(a);
  const summary = summaryMarkdown(result, head);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  else console.log("\n" + summary);

  console.log(
    `\nexperiment-doctor ci: ${result.introduced.length} introduced, ${result.fixed.length} fixed, ${result.renames.length} renamed event(s) vs ${mergeBase.slice(0, 12)}`,
  );
  process.exitCode = result.failing ? 1 : 0;
}

main();
