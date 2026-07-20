/**
 * Wraps interactive `prisma` CLI subcommands (migrate dev, migrate reset, db push, db
 * seed) with a production refusal check.
 *
 * Identity comes from scripts/db-target-identity.cjs, which keys on the (endpoint,
 * database) PAIR. This file previously keyed on a single host substring
 * (`PROD_HOST_MARKER = "ep-spring-tooth"`) — the dev fork, not production — so it
 * refused the safe target and permitted the real one. Unrecognised targets now fail
 * closed rather than being allowed through.
 *
 * Root cause this defuses: the Prisma CLI reads `.env` directly (not `.env.local`) and
 * ignores shell-exported DATABASE_URL overrides on this Windows/Git-Bash setup — confirmed
 * 2026-07-14 when an inline `DATABASE_URL=<dev> npx prisma migrate deploy` still connected to
 * prod. `.env` now points at the safe dev branch by default (see .env's own comment), so this
 * guard is defense-in-depth for whenever `.env` gets pointed at prod again, intentionally or not.
 *
 * Usage: node scripts/prisma-cli-guard.cjs <prisma subcommand and args...>
 *   e.g. node scripts/prisma-cli-guard.cjs migrate dev
 *
 * To intentionally target prod with an interactive command (rare — prefer
 * `npm run db:migrate:deploy:prod`), set ALLOW_PROD_MIGRATION=1.
 */
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { identifyTarget, describeTarget } = require("./db-target-identity.cjs");

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
const resolvedUrl = directUrl || databaseUrl;
const target = identifyTarget(resolvedUrl);

if (target.kind === "production" && process.env.ALLOW_PROD_MIGRATION !== "1") {
  console.error(
    `\n[prisma-cli-guard] REFUSING — resolved target is PRODUCTION (${describeTarget(resolvedUrl)}).\n` +
      `If you really mean to run an interactive Prisma command against production, set\n` +
      `ALLOW_PROD_MIGRATION=1 explicitly. For a real production migration deploy, prefer\n` +
      `\`npm run db:migrate:deploy:prod\` instead of this interactive path.\n`
  );
  process.exit(1);
}

// Fail CLOSED on anything unrecognised. The guard this replaced allowed every target it
// did not specifically recognise, which is precisely how it ended up permitting production.
if (
  (target.kind === "unknown" || target.kind === "unparseable") &&
  process.env.ALLOW_UNKNOWN_DB_TARGET !== "1"
) {
  console.error(
    `\n[prisma-cli-guard] REFUSING — cannot identify the resolved database ` +
      `(${describeTarget(resolvedUrl)}).\n` +
      `This guard only permits targets it can positively recognise as safe. If this target\n` +
      `is genuinely safe, add it to KNOWN_SAFE_TARGETS in scripts/db-target-identity.cjs\n` +
      `(preferred, so the next person is protected too), or set ALLOW_UNKNOWN_DB_TARGET=1\n` +
      `for a one-off.\n`
  );
  process.exit(1);
}

console.log(
  `[prisma-cli-guard] Target: ${describeTarget(resolvedUrl)}` +
    (target.kind === "production" ? " — PRODUCTION, explicitly allowed" : "")
);

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
