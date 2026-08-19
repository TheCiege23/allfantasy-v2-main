const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { identifyTarget, describeTarget } = require("./db-target-identity.cjs");

function stripQuotes(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvFileValue(filePath, key) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    if (!line.startsWith(`${key}=`)) continue;
    return stripQuotes(line.slice(key.length + 1));
  }
  return null;
}

function hasSupportedPostgresScheme(value) {
  return /^(postgres|postgresql):\/\//i.test(value.trim());
}

function readCandidate(envRuntime, envFile, key) {
  const runtime = envRuntime[key] ? stripQuotes(envRuntime[key]) : null;
  const file = envFile[key] ? stripQuotes(envFile[key]) : null;
  return { runtime, file };
}

function selectDatabaseUrl(envRuntime, envFile) {
  const preferenceOrder = [
    "DIRECT_URL",
    "POSTGRES_URL_NON_POOLING",
    "POSTGRES_URL",
    "DATABASE_URL",
    "POSTGRES_PRISMA_URL",
  ];

  const invalid = [];
  let selected = null;

  for (const key of preferenceOrder) {
    const candidate = readCandidate(envRuntime, envFile, key);
    const value = candidate.runtime || candidate.file;
    if (!value) continue;
    if (!hasSupportedPostgresScheme(value)) {
      invalid.push(`${key} uses unsupported scheme`);
      continue;
    }
    selected = { key, value };
    break;
  }

  if (!selected) {
    return {
      url: null,
      reason: invalid.length > 0 ? invalid.join("; ") : "No valid Postgres database URL was found in env",
    };
  }

  const poolerCandidate =
    preferenceOrder
      .map((key) => ({ key, ...readCandidate(envRuntime, envFile, key) }))
      .flatMap((entry) => [entry.runtime, entry.file].filter(Boolean))
      .find((value) => {
        if (!value || !hasSupportedPostgresScheme(value)) return false;
        try {
          const parsed = new URL(value);
          return parsed.hostname.endsWith("pooler.supabase.com") && parsed.port === "6543";
        } catch {
          return false;
        }
      }) || null;

  return normalizeDatabaseUrl(selected.value, poolerCandidate, selected.key);
}

function normalizeDatabaseUrl(candidate, poolerUrl, sourceKey) {
  if (!candidate) {
    return { url: null, reason: "DATABASE_URL is not set" };
  }

  try {
    const parsed = new URL(candidate);
    const parsedPooler = poolerUrl ? new URL(poolerUrl) : null;

    if (
      parsed.hostname.endsWith("pooler.supabase.com") &&
      parsed.port === "6543"
    ) {
      parsed.port = "5432";
      return {
        url: parsed.toString(),
        reason: `${sourceKey}: switched Supabase pooler from :6543 to :5432`,
      };
    }

    if (
      parsedPooler &&
      parsedPooler.hostname.endsWith("pooler.supabase.com") &&
      parsedPooler.port === "6543" &&
      /^db\..+\.supabase\.co$/i.test(parsed.hostname) &&
      parsed.port === "5432"
    ) {
      parsed.hostname = parsedPooler.hostname;
      parsed.port = "5432";
      parsed.username = parsedPooler.username;
      parsed.password = parsedPooler.password;
      parsed.pathname = parsedPooler.pathname;
      if (!parsed.search && parsedPooler.search) {
        parsed.search = parsedPooler.search;
      }
      return {
        url: parsed.toString(),
        reason: `${sourceKey}: replaced direct Supabase host with reachable pooler host`,
      };
    }

    return { url: parsed.toString(), reason: `${sourceKey}: using valid Postgres URL` };
  } catch (error) {
    return {
      url: null,
      reason: `${sourceKey}: failed to parse database URL (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

// --prod: explicit, deliberate production deploy. Loads .env.prod-deploy (git-ignored,
// never auto-loaded by anything else) instead of the default .env, which as of 2026-07-14
// points at the safe dev branch. Requires ALLOW_PROD_MIGRATION=1 as a second, independent
// confirmation — `--prod` alone is not enough. See prisma-cli-env-override-danger memory.
const targetsProd = process.argv.includes("--prod");
if (targetsProd && process.env.ALLOW_PROD_MIGRATION !== "1") {
  console.error(
    "\n[db:migrate:deploy] REFUSING --prod without ALLOW_PROD_MIGRATION=1 set explicitly.\n" +
      "Run: ALLOW_PROD_MIGRATION=1 npm run db:migrate:deploy:prod\n"
  );
  process.exit(1);
}
const envPath = path.join(process.cwd(), targetsProd ? ".env.prod-deploy" : ".env");
const envKeys = [
  "DATABASE_URL",
  "DIRECT_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "POSTGRES_URL_NON_POOLING",
];
const fileEnv = Object.fromEntries(
  envKeys.map((key) => [key, readEnvFileValue(envPath, key)])
);
// In --prod mode, ignore ambient runtime env vars entirely so a stray local DATABASE_URL
// (dev branch, from .env.local having been sourced into the shell) can't silently override
// the deliberately-loaded prod file — .env.prod-deploy is the sole source of truth here.
const runtimeEnv = targetsProd
  ? Object.fromEntries(envKeys.map((key) => [key, null]))
  : Object.fromEntries(envKeys.map((key) => [key, process.env[key] || null]));

const { url: databaseUrl, reason } = selectDatabaseUrl(runtimeEnv, fileEnv);

if (!databaseUrl) {
  console.error(`db:migrate:deploy error: ${reason || "No valid database URL found."}`);
  process.exit(1);
}

// ── Target identity gate ─────────────────────────────────────────────────────
// Verify what we actually resolved, rather than trusting which file it came from.
// Both directions matter: `.env.prod-deploy` once pointed at the CLONE, so --prod
// migrated dev while production silently fell behind — a mismatch this catches.
const deployTarget = identifyTarget(databaseUrl);

if (deployTarget.kind === "production" && !(targetsProd && process.env.ALLOW_PROD_MIGRATION === "1")) {
  console.error(
    `\n[db:migrate:deploy] REFUSING — resolved target is PRODUCTION ` +
      `(${describeTarget(databaseUrl)}) without an explicit production deploy.\n` +
      `Run: ALLOW_PROD_MIGRATION=1 npm run db:migrate:deploy:prod\n`
  );
  process.exit(1);
}

if (targetsProd && deployTarget.kind !== "production") {
  console.error(
    `\n[db:migrate:deploy] REFUSING — --prod was requested but the resolved target is NOT\n` +
      `production (${describeTarget(databaseUrl)}). Check .env.prod-deploy: it has pointed at\n` +
      `a clone before, which silently migrated dev while production fell behind.\n`
  );
  process.exit(1);
}

if (
  (deployTarget.kind === "unknown" || deployTarget.kind === "unparseable") &&
  process.env.ALLOW_UNKNOWN_DB_TARGET !== "1"
) {
  console.error(
    `\n[db:migrate:deploy] REFUSING — cannot identify the resolved database ` +
      `(${describeTarget(databaseUrl)}).\n` +
      `Add it to KNOWN_SAFE_TARGETS in scripts/db-target-identity.cjs, or set\n` +
      `ALLOW_UNKNOWN_DB_TARGET=1 for a one-off.\n`
  );
  process.exit(1);
}

console.log(`[db:migrate:deploy] Target: ${describeTarget(databaseUrl)}`);

process.env.DATABASE_URL = databaseUrl;
process.env.DIRECT_URL = databaseUrl;
process.env.POSTGRES_PRISMA_URL = databaseUrl;

if (
  databaseUrl.includes("pooler.supabase.com:5432") &&
  !process.env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK
) {
  process.env.PRISMA_SCHEMA_DISABLE_ADVISORY_LOCK = "1";
}

try {
  const host = new URL(databaseUrl).host;
  if (reason) {
    console.log(`[db:migrate:deploy] Using ${host} (${reason}).`);
  } else {
    console.log(`[db:migrate:deploy] Using ${host}.`);
  }
} catch {
  if (reason) {
    console.log(`[db:migrate:deploy] ${reason}.`);
  }
}

const prismaBin = path.join(
  process.cwd(),
  "node_modules",
  ".bin",
  process.platform === "win32" ? "prisma.cmd" : "prisma"
);

const hasLocalPrisma = fs.existsSync(prismaBin);
const command = hasLocalPrisma ? prismaBin : "npx";
const recoverableFailedMigrations = new Set([
  "20260363000000_add_ai_memory_and_chat_history",
  "20260401000000_add_devy_c2c_rollout_foundation",
  /** Survivor backend: transient DB timeouts / advisory locks / Neon — resolve rolled back and redeploy. */
  "20260405000000_add_survivor_backend_engine",
  /** Zombie rules engine: missing base table / partial apply — idempotent SQL + resolve rolled back. */
  "20260405020000_add_zombie_rules_engine",
]);

function buildArgs(prismaArgs) {
  return hasLocalPrisma ? prismaArgs : ["prisma", ...prismaArgs];
}

function runPrisma(prismaArgs) {
  return spawnSync(command, buildArgs(prismaArgs), {
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
}

function runPrismaWithInput(prismaArgs, input) {
  return spawnSync(command, buildArgs(prismaArgs), {
    stdio: "pipe",
    encoding: "utf8",
    input,
    env: process.env,
    shell: process.platform === "win32",
  });
}

function runExternal(commandName, commandArgs) {
  return spawnSync(commandName, commandArgs, {
    stdio: "pipe",
    encoding: "utf8",
    env: process.env,
    shell: process.platform === "win32",
  });
}

function writeOutput(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function readCombinedOutput(result) {
  return `${result.stdout || ""}\n${result.stderr || ""}`;
}

function isAdvisoryLockTimeout(output) {
  return (
    output.includes("P1002") &&
    (
      output.includes("pg_advisory_lock") ||
      output.includes("postgres advisory lock") ||
      output.includes("migrate-advisory-locking")
    )
  );
}

function isDatabaseReachabilityError(output) {
  return (
    output.includes("P1001") &&
    (
      output.includes("Can't reach database server") ||
      output.includes("Please make sure your database server is running")
    )
  );
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function runMigrateDeployWithRetries() {
  const retryDelaysMs = [15000, 30000, 45000, 60000];

  for (let attempt = 0; ; attempt += 1) {
    const deployResult = runPrisma(["migrate", "deploy"]);
    writeOutput(deployResult);

    const output = readCombinedOutput(deployResult);
    const failed =
      typeof deployResult.status === "number" &&
      deployResult.status !== 0;
    const advisoryLockBusy = isAdvisoryLockTimeout(output);
    const databaseUnreachable = isDatabaseReachabilityError(output);

    if (!failed || (!advisoryLockBusy && !databaseUnreachable) || attempt >= retryDelaysMs.length) {
      return deployResult;
    }

    const baseDelayMs = retryDelaysMs[attempt];
    const jitterMs = Math.floor(Math.random() * 5000);
    const waitMs = baseDelayMs + jitterMs;

    const retryReason = advisoryLockBusy
      ? "Prisma advisory lock is busy"
      : "Database host was temporarily unreachable";

    console.warn(
      `[db:migrate:deploy] ${retryReason}; retrying migrate deploy in ${Math.ceil(waitMs / 1000)}s (attempt ${attempt + 2}/${retryDelaysMs.length + 1}).`
    );

    sleepMs(waitMs);
  }
}

let result = runMigrateDeployWithRetries();

/**
 * P3005 recovery: the database schema is not empty but has no
 * `_prisma_migrations` table. This happens in CI when a foundation SQL
 * file (e.g. ALLFANTASY_BACKEND_FOUNDATION.sql) runs before
 * `prisma migrate deploy`. We baseline every existing migration as
 * already applied so deploy can continue with truly pending ones.
 */
function isSchemaNotEmptyError(output) {
  return (
    output.includes("P3005") ||
    output.includes("The database schema is not empty")
  );
}

function listMigrationDirs() {
  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  if (!fs.existsSync(migrationsDir)) return [];
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) =>
      fs.existsSync(path.join(migrationsDir, name, "migration.sql"))
    )
    .sort();
}

if (
  typeof result.status === "number" &&
  result.status !== 0 &&
  isSchemaNotEmptyError(readCombinedOutput(result))
) {
  console.warn(
    "[db:migrate:deploy] P3005 detected — baselining existing migrations as applied (foundation SQL pre-populated schema)."
  );

  const migrationNames = listMigrationDirs();
  let baselineFailed = false;

  for (const name of migrationNames) {
    const resolveResult = runPrisma([
      "migrate",
      "resolve",
      "--applied",
      name,
    ]);
    writeOutput(resolveResult);
    if (resolveResult.status !== 0) {
      const out = readCombinedOutput(resolveResult);
      // Ignore "already recorded" — treat any other non-zero as fatal.
      if (!out.includes("already recorded") && !out.includes("is already")) {
        console.error(
          `[db:migrate:deploy] Failed to baseline migration ${name}.`
        );
        baselineFailed = true;
        break;
      }
    }
  }

  if (!baselineFailed) {
    result = runMigrateDeployWithRetries();
  }
}

function outputMentionsFailedMigration(output, migrationName) {
  return (
    output.includes(`Migration name: ${migrationName}`) ||
    output.includes(`The \`${migrationName}\` migration`) ||
    output.includes(migrationName)
  );
}

function extractFailedMigrationName(output) {
  const trim = (s) => (typeof s === "string" ? s.trim() : s);

  const migrationNameMatch = output.match(/Migration name:\s*(\S+)/);
  if (migrationNameMatch?.[1]) return trim(migrationNameMatch[1]);

  const backtickMigration = output.match(/The `([^`]+)` migration/);
  if (backtickMigration?.[1]) return trim(backtickMigration[1]);

  // P3009 (some CLI / locales): "The migration `name` started" or "migration name started"
  const startedMatch = output.match(
    /(?:The\s+)?`?([0-9]{14}_[a-z0-9_]+)`?\s+migration\s+started/i
  );
  if (startedMatch?.[1]) return trim(startedMatch[1]);

  for (const migrationName of recoverableFailedMigrations) {
    if (outputMentionsFailedMigration(output, migrationName)) {
      return migrationName;
    }
  }

  return null;
}

function ensureC2CLeagueConfigTable() {
  const sql = `
CREATE TABLE IF NOT EXISTS "c2c_league_configs" (
  "id" TEXT NOT NULL,
  "leagueId" VARCHAR(64) NOT NULL,
  "dynastyOnly" BOOLEAN NOT NULL DEFAULT true,
  "supportsMergedCollegeAndProAssets" BOOLEAN NOT NULL DEFAULT true,
  "supportsCollegeScoring" BOOLEAN NOT NULL DEFAULT true,
  "supportsBestBall" BOOLEAN NOT NULL DEFAULT true,
  "supportsSnakeDraft" BOOLEAN NOT NULL DEFAULT true,
  "supportsLinearDraft" BOOLEAN NOT NULL DEFAULT true,
  "supportsTaxi" BOOLEAN NOT NULL DEFAULT true,
  "supportsFuturePicks" BOOLEAN NOT NULL DEFAULT true,
  "supportsTradeableCollegeAssets" BOOLEAN NOT NULL DEFAULT true,
  "supportsTradeableCollegePicks" BOOLEAN NOT NULL DEFAULT true,
  "supportsTradeableRookiePicks" BOOLEAN NOT NULL DEFAULT true,
  "supportsPromotionRules" BOOLEAN NOT NULL DEFAULT true,
  "startupFormat" VARCHAR(24) NOT NULL DEFAULT 'merged',
  "mergedStartupDraft" BOOLEAN NOT NULL DEFAULT true,
  "separateStartupCollegeDraft" BOOLEAN NOT NULL DEFAULT false,
  "collegeRosterSize" INTEGER NOT NULL DEFAULT 20,
  "collegeSports" JSONB,
  "collegeScoringSystem" VARCHAR(24) NOT NULL DEFAULT 'ppr',
  "mixProPlayers" BOOLEAN NOT NULL DEFAULT true,
  "collegeActiveLineupSlots" JSONB,
  "taxiSize" INTEGER NOT NULL DEFAULT 6,
  "rookieDraftRounds" INTEGER NOT NULL DEFAULT 4,
  "collegeDraftRounds" INTEGER NOT NULL DEFAULT 6,
  "bestBallPro" BOOLEAN NOT NULL DEFAULT true,
  "bestBallCollege" BOOLEAN NOT NULL DEFAULT false,
  "promotionTiming" VARCHAR(48) NOT NULL DEFAULT 'manager_choice_before_rookie_draft',
  "maxPromotionsPerYear" INTEGER,
  "earlyDeclareBehavior" VARCHAR(24) NOT NULL DEFAULT 'allow',
  "returnToSchoolHandling" VARCHAR(32) NOT NULL DEFAULT 'restore_rights',
  "rookiePickTradeRules" VARCHAR(24) NOT NULL DEFAULT 'allowed',
  "collegePickTradeRules" VARCHAR(24) NOT NULL DEFAULT 'allowed',
  "collegeScoringUntilDeadline" BOOLEAN NOT NULL DEFAULT true,
  "standingsModel" VARCHAR(24) NOT NULL DEFAULT 'unified',
  "mergedRookieCollegeDraft" BOOLEAN NOT NULL DEFAULT false,
  "nflCollegeExcludeKDST" BOOLEAN NOT NULL DEFAULT true,
  "proLineupSlots" JSONB,
  "proBenchSize" INTEGER NOT NULL DEFAULT 12,
  "proIRSize" INTEGER NOT NULL DEFAULT 3,
  "startupDraftType" VARCHAR(16) NOT NULL DEFAULT 'snake',
  "rookieDraftType" VARCHAR(16) NOT NULL DEFAULT 'snake',
  "collegeDraftType" VARCHAR(16) NOT NULL DEFAULT 'snake',
  "rookiePickOrderMethod" VARCHAR(32) NOT NULL DEFAULT 'reverse_standings',
  "collegePickOrderMethod" VARCHAR(32) NOT NULL DEFAULT 'reverse_standings',
  "hybridProWeight" INTEGER NOT NULL DEFAULT 60,
  "hybridPlayoffQualification" VARCHAR(32) NOT NULL DEFAULT 'weighted',
  "hybridChampionshipTieBreaker" VARCHAR(32) NOT NULL DEFAULT 'total_points',
  "collegeFAEnabled" BOOLEAN NOT NULL DEFAULT false,
  "collegeFAABSeparate" BOOLEAN NOT NULL DEFAULT false,
  "collegeFAABBudget" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "c2c_league_configs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "c2c_league_configs_leagueId_key"
ON "c2c_league_configs"("leagueId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'c2c_league_configs_leagueId_fkey'
  ) THEN
    ALTER TABLE "c2c_league_configs"
    ADD CONSTRAINT "c2c_league_configs_leagueId_fkey"
      FOREIGN KEY ("leagueId") REFERENCES "leagues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
`;

  return runPrismaWithInput(
    ["db", "execute", "--stdin", "--schema", "prisma/schema.prisma"],
    sql
  );
}

const maxRecoverableResolvePasses = 4;
let resolvePass = 0;

while (resolvePass < maxRecoverableResolvePasses) {
  const output = readCombinedOutput(result);
  const failedMigrationName = extractFailedMigrationName(output);
  const shouldRetryFailedMigration =
    typeof result.status === "number" &&
    result.status !== 0 &&
    (output.includes("P3018") || output.includes("P3009")) &&
    !!failedMigrationName &&
    recoverableFailedMigrations.has(failedMigrationName);

  if (!shouldRetryFailedMigration || !failedMigrationName) {
    break;
  }

  resolvePass += 1;
  console.warn(
    `[db:migrate:deploy] Detected failed migration ${failedMigrationName}; marking it rolled back and retrying deploy (pass ${resolvePass}/${maxRecoverableResolvePasses}).`
  );

  const resolveResult = runPrisma([
    "migrate",
    "resolve",
    "--rolled-back",
    failedMigrationName,
  ]);
  writeOutput(resolveResult);

  if (resolveResult.status !== 0) {
    process.exit(typeof resolveResult.status === "number" ? resolveResult.status : 1);
  }

  if (failedMigrationName === "20260401000000_add_devy_c2c_rollout_foundation") {
    const bootstrapResult = ensureC2CLeagueConfigTable();
    writeOutput(bootstrapResult);

    if (bootstrapResult.status !== 0) {
      process.exit(typeof bootstrapResult.status === "number" ? bootstrapResult.status : 1);
    }
  }

  result = runMigrateDeployWithRetries();
}

if (result.status === 0) {
  const supplementalSqlPath = path.join(
    process.cwd(),
    "scripts",
    "sql",
    "platform-backend-indexes.sql"
  );

  if (fs.existsSync(supplementalSqlPath)) {
    console.log("[db:migrate:deploy] Applying supplemental platform-backend indexes.");
    const supplementalResult = runPrisma([
      "db",
      "execute",
      "--file",
      supplementalSqlPath,
      "--schema",
      "prisma/schema.prisma",
    ]);
    writeOutput(supplementalResult);
    if (supplementalResult.status !== 0) {
      process.exit(typeof supplementalResult.status === "number" ? supplementalResult.status : 1);
    }

    console.log("[db:migrate:deploy] Verifying supplemental platform-backend indexes.");
    const verifyResult = runExternal("npx", [
      "tsx",
      "scripts/verify-platform-backend-indexes.ts",
    ]);
    writeOutput(verifyResult);
    if (verifyResult.status !== 0) {
      process.exit(typeof verifyResult.status === "number" ? verifyResult.status : 1);
    }
  }
}

if (typeof result.status === "number") {
  process.exit(result.status);
}

if (result.error) {
  console.error(result.error.message);
}

process.exit(1);
