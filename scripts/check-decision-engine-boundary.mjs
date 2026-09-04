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
  const output = execSync(`git diff --name-only --diff-filter=ACMRTUXB ${base}..${head}`, {
    encoding: "utf8",
  }).trim();
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
  const base = argAfter("--changed");
  const head = process.argv[process.argv.indexOf("--changed") + 2] ?? "HEAD";

  let files;
  if (changedOnly && base) {
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
