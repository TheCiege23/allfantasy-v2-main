/**
 * Wraps interactive `prisma` CLI subcommands (migrate dev, migrate reset, db push, db
 * seed) with a refusal check, so none of them can run against production.
 *
 * Root cause this defuses: the Prisma CLI reads `.env` directly (not `.env.local`) and
 * ignores shell-exported DATABASE_URL overrides on this Windows/Git-Bash setup — confirmed
 * 2026-07-14 when an inline `DATABASE_URL=<dev> npx prisma migrate deploy` still connected to
 * prod.
 *
 * `.env` points at ep-curly-block-ad0dlt9o/mydb_shadow — which is production's COMPUTE but a
 * separate DATABASE. That is exactly why classification lives in db-target-identity.cjs and is
 * keyed on (endpoint, database): a host-only check here would have to either refuse normal
 * local dev or permit production. See that module for the full rationale.
 *
 * Usage: node scripts/prisma-cli-guard.cjs <prisma subcommand and args...>
 *   e.g. node scripts/prisma-cli-guard.cjs migrate dev
 *
 * Escape hatches:
 *   ALLOW_PROD_MIGRATION=1     — "I accept this may be production" (rare; for a real production
 *                                migration deploy prefer `npm run db:migrate:deploy:prod`).
 *   AF_NONPROD_ENDPOINT_ACK=<endpoint-id>
 *                              — "this unlisted endpoint is a disposable non-prod branch".
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { classifyDatabaseTarget } = require("./db-target-identity.cjs");

function stripQuotes(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function readEnvFileValue(filePath, key) {
  if (!fs.existsSync(filePath)) return null;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || line.trim().startsWith("#")) continue;
    if (!line.startsWith(`${key}=`)) continue;
    return stripQuotes(line.slice(key.length + 1));
  }
  return null;
}

// Same resolution the real Prisma CLI uses: process.env first, else `.env` (never `.env.local`
// — that's the whole gotcha this guard exists to catch).
const envPath = path.join(process.cwd(), ".env");
function resolve(key) {
  return process.env[key] || readEnvFileValue(envPath, key) || null;
}

const directUrl = resolve("DIRECT_URL");
const databaseUrl = resolve("DATABASE_URL");
const target = classifyDatabaseTarget(directUrl || databaseUrl);
const label = `${target.endpointId || target.host || "?"}/${target.database || "?"}`;

// Fails closed: refuse `production` AND `unknown`. An endpoint nobody has listed is an
// endpoint nobody has verified, and this wrapper fronts destructive commands.
if (target.classification !== "non-production" && process.env.ALLOW_PROD_MIGRATION !== "1") {
  const what = target.classification === "production" ? "PRODUCTION" : "an UNRECOGNISED database";
  console.error(
    `\n[prisma-cli-guard] REFUSING — resolved target is ${what} (${label}).\n` +
      `  ${target.reason}\n\n` +
      `If you really mean to run an interactive Prisma command against production, set\n` +
      `ALLOW_PROD_MIGRATION=1 explicitly. For a real production migration deploy, prefer\n` +
      `\`npm run db:migrate:deploy:prod\` instead of this interactive path.\n`
  );
  process.exit(1);
}

const suffix =
  target.classification === "non-production" ? "" : ` (${target.classification.toUpperCase()} — explicitly allowed)`;
console.log(`[prisma-cli-guard] Target: ${label}${suffix}`);

const prismaArgs = process.argv.slice(2);
const prismaBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
const hasLocalPrisma = fs.existsSync(prismaBin);
const command = hasLocalPrisma ? prismaBin : "npx";
const args = hasLocalPrisma ? prismaArgs : ["prisma", ...prismaArgs];

const result = spawnSync(command, args, {
  stdio: "inherit",
  env: process.env,
  shell: process.platform === "win32",
});

process.exit(typeof result.status === "number" ? result.status : 1);
