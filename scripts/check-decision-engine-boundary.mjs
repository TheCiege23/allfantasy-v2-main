#!/usr/bin/env node
/**
 * Decision-engine boundary guard — Phase 0 of the "One Engine, One Answer" plan.
 *
 * ── Why this exists ───────────────────────────────────────────────────────────────────────────
 *
 * Measured 2026-09-04 against main: THIRTEEN modules grade a trade, four recommend waivers, four
 * optimise a lineup. Decision OS owns one of each. The reason there are thirteen is that nothing
 * stopped the thirteenth — so consolidating before closing that door is bailing a boat with the
 * hole still open. This guard closes the door. It does not fix the backlog.
 *
 * ── What it does NOT do, deliberately ─────────────────────────────────────────────────────────
 *
 * 🛑 IT DOES NOT ALLOWLIST THE EXISTING VIOLATIONS. A full scan prints every one of them, and the
 * count is the backlog. Hiding them behind an allowlist would make the guard green and the problem
 * permanent — the same reasoning `check-db-first-api-boundary.mjs` records for its own 81.
 *
 * Like that guard, CI runs this in `--changed` mode, so `main` stays green and only a change that
 * TOUCHES a violating file is stopped. A pre-existing violation surfacing in your PR is the guard
 * working, not a regression you introduced — check whether it predates your change.
 *
 * ── What counts as a violation ────────────────────────────────────────────────────────────────
 *
 * An EXPORTED function, const or class whose name says it answers a domain question — grading a
 * trade, recommending a waiver, optimising a lineup — declared outside the engine directories.
 * Naming is the signal on purpose: a module that calls itself `gradeTrade` is claiming to be an
 * authority, and that claim is what has to be centralised. A helper that computes an input
 * (`pricePlayer`, `computeLineupDelta`) is NOT a violation — inputs are meant to be many, verdicts
 * are meant to be one.
 *
 * Usage:
 *   node scripts/check-decision-engine-boundary.mjs                  # full scan, lists the backlog
 *   node scripts/check-decision-engine-boundary.mjs --changed <base> <head>
 */
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

/**
 * Verdict-shaped exports, by domain. Each pattern must match a NAME that claims to answer the
 * question, not one that supplies a fact toward it.
 */
const VERDICT_PATTERNS = [
  { domain: "trade", re: /^(analyze|analyse|grade|evaluate|score|assess|rate)Trade[A-Za-z]*$/ },
  { domain: "trade", re: /^Trade(Analyzer|Analyser|Grader|Evaluator)[A-Za-z]*$/, classOnly: true },
  { domain: "waiver", re: /^(generate|recommend|score|rank|suggest)Waiver[A-Za-z]*$/ },
  { domain: "waiver", re: /^Waiver(Recommender|Scorer|Engine)[A-Za-z]*$/, classOnly: true },
  // ⚠ `build` is deliberately NOT a verdict verb for lineups. The first draft of this guard used
  // it and reported `buildLineupAlert`, `buildLineupSectionsFromPicks` and
  // `buildLineupForSimulationPreset` — all construction, none a recommendation. A guard that
  // cries wolf gets switched off, so precision beats recall here. `buildOptimalLineup` is named
  // explicitly because that one IS a claim to authority.
  { domain: "lineup", re: /^(optimize|optimise|recommend|suggest)Lineup[A-Za-z]*$/ },
  { domain: "lineup", re: /^buildOptimalLineup[A-Za-z]*$/ },
  { domain: "lineup", re: /^Lineup(Optimizer|Optimiser|Recommender)[A-Za-z]*$/, classOnly: true },
  // ⚠ `Pick` alone matched `evaluatePickValue`, which is pick VALUATION — an input to a draft
  // decision, not the decision. Inputs are meant to be many; verdicts are meant to be one.
  { domain: "draft", re: /^(recommend|suggest|grade|evaluate)Draft[A-Za-z]*$/ },
  { domain: "draft", re: /^(recommend|suggest)(Draft)?Pick[A-Za-z]*$/ },
  { domain: "start-sit", re: /^(decide|recommend|resolve)Start(Sit|OrSit)[A-Za-z]*$/ },
];

/**
 * The engines. A verdict-shaped export belongs in exactly one of these.
 *
 * `core` is included because the shared decision kernel legitimately declares the generic
 * machinery the per-domain engines build on.
 */
const ENGINE_PATH_PATTERNS = [
  /^lib\/decision-os\/trade\//,
  /^lib\/decision-os\/waiver\//,
  /^lib\/decision-os\/lineup\//,
  /^lib\/decision-os\/commissioner-health\//,
  /^lib\/decision-os\/draft\//,
  /^lib\/decision-os\/core\//,
];

/**
 * Paths where a verdict-shaped export is not a competing authority.
 *
 * Tests assert against engines and must be able to name what they assert. Scripts that COMPARE
 * implementations cannot compare without calling both — the same reasoning that put `compare` on
 * the DB-first guard's script verb list. Neither is reachable from a request path.
 */
const EXEMPT_PATH_PATTERNS = [
  /^__tests__\//,
  /^tests?\//,
  /^e2e\//,
  /^scripts\//,
  /\.test\.tsx?$/,
  /\.spec\.tsx?$/,
  /\.d\.ts$/,
  // UI renders a verdict; it does not produce one. A page or component named for a domain is a
  // screen, not a competing authority.
  /^components\//,
  /\/page\.tsx$/,
  /\/layout\.tsx$/,
];

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);

const EXCLUDED_DIRS = new Set([
  ".git", ".next", "node_modules", "dist", "build", "coverage",
  ".vercel", ".turbo", "public", ".claude", ".tmp-pr671",
]);

/** `export function x`, `export async function x`, `export const x =`, `export class X`. */
const EXPORT_DECL =
  /^\s*export\s+(?:default\s+)?(?:async\s+)?(function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/;

function toPosix(p) {
  return p.replaceAll(path.sep, "/");
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function argAfter(flag) {
  const i = process.argv.indexOf(flag);
  return i === -1 ? null : (process.argv[i + 1] ?? null);
}

function isEnginePath(rel) {
  return ENGINE_PATH_PATTERNS.some((re) => re.test(rel));
}

function isExemptPath(rel) {
  return EXEMPT_PATH_PATTERNS.some((re) => re.test(rel));
}

function matchVerdict(name, kind) {
  for (const { domain, re, classOnly } of VERDICT_PATTERNS) {
    // A noun pattern is an authority claim only as a CLASS. The same name as a const is a zod
    // schema and as a function is a React component — both were false positives in the first
    // version of this guard (LineupOptimizerInputSchema, LineupOptimizerPage).
    if (classOnly && kind !== "class") continue;
    if (re.test(name)) return domain;
  }
  return null;
}

function getAllSourceFiles(rootDir) {
  const out = [];
  const stack = [rootDir];
  while (stack.length) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) stack.push(full);
      } else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        out.push(full);
      }
    }
  }
  return out;
}

function getChangedFiles(base, head) {
  let output;
  try {
    output = execSync(`git diff --name-only --diff-filter=ACMRTUXB ${base}..${head}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch (err) {
    // A ref that will not resolve must name itself rather than dump a node stack. Exit 2, not 1:
    // this is neither a pass nor a violation, and the difference matters — the same three-valued
    // discipline this repo already applies to `merge-base --is-ancestor`, where a status that is
    // neither 0 nor 1 is not a verdict.
    console.error(`Decision-engine boundary: cannot diff ${base}..${head}`);
    console.error(String(err?.stderr || err?.message || err).trim());
    process.exit(2);
  }
  if (!output) return [];
  return output
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((f) => SOURCE_EXTENSIONS.has(path.extname(f).toLowerCase()));
}

function collectViolations(rootDir, files) {
  const violations = [];
  for (const file of files) {
    const abs = path.isAbsolute(file) ? file : path.join(rootDir, file);
    const rel = toPosix(path.relative(rootDir, abs));
    if (!rel || rel.startsWith("..")) continue;
    if (isEnginePath(rel) || isExemptPath(rel)) continue;

    let text;
    try {
      text = fs.readFileSync(abs, "utf8");
    } catch {
      continue;
    }

    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
      const m = EXPORT_DECL.exec(lines[i]);
      if (!m) continue;
      const domain = matchVerdict(m[2], m[1]);
      if (!domain) continue;
      violations.push({ file: rel, line: i + 1, symbol: m[2], domain });
    }
  }
  return violations;
}

function main() {
  const rootDir = process.cwd();
  const changedOnly = hasFlag("--changed");

  // TWO invocation forms, deliberately. The sibling guard
  // (scripts/check-db-first-api-boundary.mjs) takes `--base X --head Y`, and its workflow is the
  // obvious thing to copy when wiring this one up. Accepting only the positional form meant a
  // copied workflow parsed the literal string "--base" AS the base ref.
  const namedBase = argAfter("--base");
  const namedHead = argAfter("--head");
  const posBase = argAfter("--changed");
  const posHead = process.argv[process.argv.indexOf("--changed") + 2] ?? null;
  const notAFlag = (v) => (v && !v.startsWith("--") ? v : null);

  const base = namedBase ?? notAFlag(posBase);
  const head = namedHead ?? notAFlag(posHead) ?? "HEAD";

  // 🛑 `--changed` WITH NO BASE USED TO MEAN "EVERYTHING CHANGED". It fell through to the full
  // scan, then skipped the backlog branch below because `changedOnly` was set, and printed all 30
  // pre-existing violations under the heading "violation(s) in changed files" with exit 1. A
  // malformed invocation produced a confident, specific, wrong red — and the fix a reader would
  // reach for is to allowlist history that was never the problem. Refuse the run instead.
  if (changedOnly && !base) {
    console.error("Decision-engine boundary: --changed requires a base commit.");
    console.error("  usage: --changed --base <sha> --head <sha>");
    console.error("     or: --changed <base> <head>");
    console.error("Omit --changed entirely for a full backlog scan.");
    process.exit(2);
  }

  let files;
  if (changedOnly) {
    files = getChangedFiles(base, head);
    if (files.length === 0) {
      console.log("Decision-engine boundary: no changed source files.");
      process.exit(0);
    }
  } else {
    files = getAllSourceFiles(rootDir);
  }

  const violations = collectViolations(rootDir, files);

  if (violations.length === 0) {
    console.log("Decision-engine boundary check passed.");
    process.exit(0);
  }

  const byDomain = new Map();
  for (const v of violations) byDomain.set(v.domain, (byDomain.get(v.domain) ?? 0) + 1);

  if (!changedOnly) {
    // A full scan REPORTS the backlog. It does not fail the build on history — the count is
    // the number to drive down, and it is printed so it cannot quietly grow.
    console.log(`Decision-engine boundary: ${violations.length} pre-existing violation(s).`);
    for (const [domain, count] of [...byDomain.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${domain.padEnd(10)} ${count}`);
    }
    console.log("");
    for (const v of violations) {
      console.log(`- ${v.file}:${v.line}  ${v.symbol}  [${v.domain}]`);
    }
    console.log(
      "\nThese are the backlog, deliberately NOT allowlisted. CI runs --changed, so main stays " +
        "green and only a change touching one of these is stopped.",
    );
    process.exit(0);
  }

  console.error("Decision-engine boundary violation(s) in changed files:");
  for (const v of violations) {
    console.error(`- ${v.file}:${v.line}  ${v.symbol}  [${v.domain}]`);
  }
  console.error(
    "\nA verdict-shaped export belongs in lib/decision-os/<domain>/. If this violation predates " +
      "your change, it is the guard working rather than a regression you introduced — check with " +
      "git log before assuming otherwise. If you are adding a new one, that is the thing this " +
      "guard exists to stop: call the engine instead.",
  );
  process.exit(1);
}

main();
