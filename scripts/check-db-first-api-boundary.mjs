#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";

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
  /^scripts\/.*(ingest|ingestion|sync|backfill|import|migrate|worker|seed|hydrate|refresh)/i,
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

function collectViolations(rootDir, filesToScan) {
  const violations = [];

  for (const relativePath of filesToScan) {
    const normalizedPath = toPosixPath(relativePath);
    const absolutePath = path.join(rootDir, relativePath);

    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const content = fs.readFileSync(absolutePath, "utf8");
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];

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

        if (isAllowedCaller(normalizedPath)) {
          continue;
        }

        violations.push({
          file: normalizedPath,
          line: i + 1,
          url: rawUrl,
        });
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

  if (changedOnly && base && head) {
    filesToScan = getChangedFiles(base, head);
  } else {
    filesToScan = getAllSourceFiles(rootDir);
  }

  const violations = collectViolations(rootDir, filesToScan);

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

main();
