#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { parseChangedLineNumbers } from "./db-first-diff-lines.mjs";

const DATA_API_HOST_PATTERNS = [
  /(^|\.)api\.sleeper\.app$/i,
  /(^|\.)fantasysports\.yahooapis\.com$/i,
  /(^|\.)newsapi\.org$/i,
  /(^|\.)api\.sportsdata\.io$/i,
  /(^|\.)the-odds-api\.com$/i,
  /(^|\.)api\.espn\.com$/i,
  /(^|\.)site\.api\.espn\.com$/i,
  // TheSportsDB was missing from this list entirely, so every direct read of it
  // — schedules, teams, headshots, player search — bypassed the DB-first rule
  // without ever tripping the guard. It is now the provider behind teams, games,
  // rosters and player stats, which makes an unguarded read path a live risk:
  // a page that calls it directly gets provider latency and rate limits on the
  // request path, and goes blank when the provider blips.
  /(^|\.)thesportsdb\.com$/i,
  // Rolling Insights was the LAST monitored provider still missing, and the most exposed one:
  // per contracts/rolling-insights/INTEGRATION.md it is the scoring source, and it passes
  // `RSC_token` as a QUERY PARAMETER — so a direct call from a request path both bypasses the
  // DB-first rule and puts a long-lived credential into any URL that gets logged or surfaced in
  // an error. CLAUDE.md called this gap out explicitly.
  //
  // Covers every subdomain seen in this repo: rest.datafeeds., datafeeds., accounts., auth.,
  // api., and the bare domain.
  /(^|\.)rolling-insights\.com$/i,
];

/**
 * Exported constants that RESOLVE to a monitored host, treated exactly like a URL literal.
 *
 * WHY THIS EXISTS. This guard finds direct provider calls by scanning for `https://` literals, so
 * the moment a base URL is hoisted into a shared constant every consumer becomes invisible to it.
 * That is not hypothetical: consolidating ESPN onto one constant removed the literal from 15 files
 * in a single commit, and without this rule all 15 would have gone quiet while still calling ESPN
 * exactly as before. DRY at the call site must not cost coverage.
 *
 * Matching an identifier is weaker than matching a URL — a file could alias or re-export it — but
 * it restores the common case, and the definition sites below are few enough to review by hand.
 */
const DATA_API_IDENTIFIERS = [
  'ESPN_SITE_API_BASE',
  'THE_SPORTS_DB_V1_JSON_BASE',
  'THE_SPORTS_DB_V2_JSON_BASE',
];

/**
 * Files that NAME a provider host by definition rather than calling one.
 *
 * Two kinds, and both have to be here or the rule eats its own tail:
 *   - URL builders, whose only job is to build provider URL strings — no fetch, no credentials in
 *     flight. They must hold the literal somewhere, so flagging the definition site says nothing;
 *     what matters is who CONSUMES it, and DATA_API_IDENTIFIERS keeps those consumers visible.
 *   - This guard itself, which lists every monitored host and identifier as data. Without the
 *     entry it reports three violations against its own DATA_API_IDENTIFIERS array — which it did,
 *     the first time this rule ran.
 *
 * Scoped to explicit filenames rather than a `lib/providers/*` glob, so a real fetching client
 * dropped into that directory is still caught.
 */
const HOST_DEFINITION_FILES = [
  /^lib\/providers\/espnUrls\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /^lib\/providers\/theSportsDbUrls\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /^scripts\/check-db-first-api-boundary\.mjs$/i,
];

const SOURCE_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
]);

const ALLOWED_PATH_PATTERNS = [
  /*
   * `audit` joins this list because an audit script's whole purpose is comparing what a provider
   * says against what we stored — it cannot do that without calling the provider, and a script is
   * never a request path. scripts/audit-playoff-provider-data.ts documents itself as read-only,
   * writes nothing, and is invoked by hand (absent from package.json and CI).
   */
  /^scripts\/.*(audit|ingest|ingestion|sync|backfill|import|migrate|worker|seed|hydrate|refresh)/i,
  /^lib\/.*(ingest|ingestion|sync)/i,
  /^app\/api\/sports\/news\/sync-helper\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /^app\/api\/cron\//i,
  /*
   * Two sync modules the `lib/.*(ingest|sync)` pattern above misses purely
   * because of how they are NAMED, not because of what they do. Listed by exact
   * path rather than by widening that pattern, so this stays an allowlist of two
   * audited files instead of a hole any future `lib/scores/*` file falls through.
   *
   * `sports-live-scores-service.ts` DEFINES `syncLiveScoresToDb` and is the
   * db-first service itself — the module every other surface is supposed to go
   * through. Forbidding it from calling a provider would leave nothing able to
   * populate the cache the rule insists everyone reads.
   *
   * `scores/gameScoreProviders.ts` is provider fetchers only, consumed by
   * `/api/cron/import-scores` (already allowed above) and `lib/api-sports.ts`.
   * It has no request-path caller.
   *
   * ⚠ THIS IS NOT A LICENCE FOR PAGES. Both files were already flagged the moment
   * TheSportsDB joined the host list on 2026-08-16; they had simply not been
   * touched since, because the guard only scans CHANGED files. Anything on a
   * request path must still go through `getLiveScoresForSport`.
   */
  /^lib\/sports-live-scores-service\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /^lib\/scores\/gameScoreProviders\.(ts|tsx|js|jsx|mjs|cjs)$/i,
  /*
   * The provider ADAPTER layer — modules that exist to speak one vendor's API and nothing else.
   * Forbidding the provider layer from calling a provider is incoherent; what the rule protects is
   * everything ABOVE it.
   *
   * Same profile as `scores/gameScoreProviders.ts` two lines up, and checked the same way — by its
   * callers, not by its name. `lib/workers/providers/espn.ts` is reached from exactly two app
   * files, `app/api/cron/import-projections` and `app/api/health/data-providers`: a cron and a
   * health probe. No request path.
   *
   * ⚠ RE-CHECK THE CALLERS BEFORE ADDING A FILE HERE. This is a directory pattern rather than a
   * filename, so a new module dropped into lib/workers/providers/ inherits the exemption. That is
   * intended for adapters and wrong for anything a page can reach.
   */
  /^lib\/workers\/providers\//i,
];

function parseArg(flag) {
  const index = process.argv.indexOf(flag);
  if (index === -1) {
    return null;
  }
  return process.argv[index + 1] ?? null;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function toPosixPath(filePath) {
  return filePath.replaceAll(path.sep, "/");
}

function getChangedFiles(base, head) {
  const range = `${base}..${head}`;
  const command = `git diff --name-only --diff-filter=ACMRTUXB ${range}`;
  const output = execSync(command, { encoding: "utf8" }).trim();
  if (!output) {
    return [];
  }

  return output
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .filter((filePath) => SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase()));
}

function getAllSourceFiles(rootDir) {
  const files = [];
  const stack = [rootDir];
  const EXCLUDED_DIRS = new Set([
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    'playwright-report',
    'test-results',
  ]);

  /**
   * Any Next build output, matched by PREFIX rather than by name.
   *
   * `.next`, `.next-dev-local` and `.next-dev-local-uifix` were listed literally, which missed
   * `.next-dev-3101` — a build directory that is COMMITTED to this repo. Its compiled bundles
   * inline every provider URL from the source they were built from, so the weekly full scan was
   * reporting hundreds of duplicate violations from build artefacts and burying the real ones.
   * A prefix test also covers whatever the next `.next-*` variant is called.
   *
   * Excluding build output loses nothing: the source it was compiled from is scanned directly,
   * and a bundle is never itself a caller anyone can fix.
   */
  const isBuildOutputDir = (name) => name.startsWith('.next');

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (EXCLUDED_DIRS.has(entry.name) || isBuildOutputDir(entry.name)) {
        continue;
      }

      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }

      if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        files.push(path.relative(rootDir, fullPath));
      }
    }
  }

  return files;
}

function isMonitoredHost(hostname) {
  return DATA_API_HOST_PATTERNS.some((pattern) => pattern.test(hostname));
}

function isAllowedCaller(filePath) {
  const normalized = toPosixPath(filePath);
  return ALLOWED_PATH_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isHostDefinitionFile(filePath) {
  const normalized = toPosixPath(filePath);
  return HOST_DEFINITION_FILES.some((pattern) => pattern.test(normalized));
}

/**
 * Line numbers touched per file, parsed from `git diff -U0`.
 *
 * WHY CHANGED-MODE IS LINE-SCOPED. This guard's job is "do not ADD a violation". Reporting a
 * whole file meant editing one unrelated line in `lib/sports-router.ts` inherited its four
 * pre-existing TheSportsDB calls, and the only ways out were to fix architecture you did not come
 * to fix, or to paste `db-first-exception` onto lines you did not write. The second is what
 * actually happens, and it hollows out the marker for everyone: it is reserved for a TEMPORARY
 * violation with a migration plan, and once it means "the guard was in my way" it means nothing.
 *
 * Measured on the ESPN host swap: 10 whole-file violations, ZERO of them introduced by the change.
 *
 * The full scan (no `--changed`) is deliberately NOT line-scoped — the weekly audit exists to
 * report the entire debt, and that number should stay honest.
 */
function getChangedLineNumbers(base, head) {
  return parseChangedLineNumbers(
    execSync(`git diff -U0 --diff-filter=ACMRTUXB ${base}..${head}`, { encoding: "utf8" }),
  );
}

function collectViolations(rootDir, filesToScan, changedLines = null) {
  const violations = [];

  for (const relativePath of filesToScan) {
    const normalizedPath = toPosixPath(relativePath);
    const absolutePath = path.join(rootDir, relativePath);
    // null => full scan, report every line. A Set => only lines this change touched.
    const touched = changedLines ? changedLines.get(normalizedPath) ?? new Set() : null;

    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const content = fs.readFileSync(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

      // Line-scoped in changed mode: a violation on a line this change did not touch is
      // pre-existing debt, not something this PR added. See getChangedLineNumbers.
      if (touched && !touched.has(i + 1)) {
        continue;
      }

      if (line.includes("db-first-exception")) {
        continue;
      }

      const matches = line.matchAll(/https?:\/\/[^\s"'`\\)\]}]+/gi);
      for (const match of matches) {
        const rawUrl = match[0];
        let hostname;

        try {
          hostname = new URL(rawUrl).hostname;
        } catch {
          continue;
        }

        if (!isMonitoredHost(hostname)) {
          continue;
        }

        if (isAllowedCaller(normalizedPath) || isHostDefinitionFile(normalizedPath)) {
          continue;
        }

        violations.push({
          file: normalizedPath,
          line: i + 1,
          url: rawUrl,
        });
      }

      // A constant that resolves to a monitored host counts as the URL it stands for — otherwise
      // hoisting the literal into a shared module silently retires this check for every consumer.
      // Skipped in the builder modules themselves, where the constant is DEFINED rather than used.
      // An IMPORT is not a call. Flagging the import line as well as the use double-reports every
      // consumer and, worse, reports a line that no `db-first-exception` would ever sensibly sit
      // on. What matters is the line that builds the URL.
      const isImportLine = /^\s*(import\s|export\s+\{|\}?\s*from\s)/.test(line);

      if (!isImportLine && !isAllowedCaller(normalizedPath) && !isHostDefinitionFile(normalizedPath)) {
        for (const identifier of DATA_API_IDENTIFIERS) {
          // Word-bounded so a longer name that merely contains this one does not match.
          if (!new RegExp(`\\b${identifier}\\b`).test(line)) continue;
          violations.push({
            file: normalizedPath,
            line: i + 1,
            url: `${identifier} (resolves to a monitored provider host)`,
          });
        }
      }
    }
  }

  return violations;
}

function main() {
  const rootDir = process.cwd();
  const changedOnly = hasFlag("--changed");
  const base = parseArg("--base");
  const head = parseArg("--head");

  let filesToScan = [];

  let changedLines = null;
  if (changedOnly && base && head) {
    filesToScan = getChangedFiles(base, head);
    changedLines = getChangedLineNumbers(base, head);
  } else {
    filesToScan = getAllSourceFiles(rootDir);
  }

  const violations = collectViolations(rootDir, filesToScan, changedLines);

  if (violations.length === 0) {
    console.log("DB-first boundary check passed.");
    process.exit(0);
  }

  console.error("DB-first boundary violation(s) detected:");
  for (const item of violations) {
    console.error(`- ${item.file}:${item.line} -> ${item.url}`);
  }
  console.error(
    "Direct monitored data API calls are only allowed in ingestion/sync modules. Add 'db-first-exception: reason' only for temporary exceptions with a migration plan."
  );
  process.exit(1);
}

/**
 * Only run when executed directly.
 *
 * Without this, importing the module to unit-test parseChangedLineNumbers starts a FULL-TREE scan
 * — the slow path, because an import passes no `--changed` flag — and then calls process.exit on
 * the test runner. Found by doing exactly that.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
