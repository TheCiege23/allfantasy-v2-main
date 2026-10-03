/**
 * `npm run db:resolve:prod -- --applied <migration>` (or `--rolled-back <migration>`)
 *
 * The production-safe way to run `prisma migrate resolve`. Before this existed, resolve was run by
 * hand with `npx prisma`, outside every guard in scripts/prisma-migrate-deploy.cjs — and on
 * 2026-10-03 two of the four production `_prisma_migrations` rows with CRLF checksums came from
 * exactly that (a Codex session and a Railway-run session, both from Windows checkouts).
 *
 * In order, refusing at the first failure:
 *   1. ALLOW_PROD_MIGRATION=1, and exactly one `--applied <name>` or `--rolled-back <name>`.
 *   2. `prisma/migrations/<name>/migration.sql` exists and holds NO CR byte — checked before any
 *      credential is read. Prisma hashes the bytes on disk; CRLF here becomes a CRLF checksum in
 *      production (scripts/migration-line-endings.cjs).
 *   3. The URL in `.env.prod-deploy` is positively production (scripts/db-target-identity.cjs).
 *      Ambient DATABASE_URL/DIRECT_URL are ignored, exactly as `prisma-migrate-deploy.cjs --prod`
 *      ignores them. `railway run node scripts/railway-prod-migrate.cjs resolve --applied <name>`
 *      writes that file from Railway's variables and removes it afterwards.
 *   4. After `--applied`, the ledger row is READ BACK and its checksum must equal the sha256 of the
 *      LF file. A mismatch exits 1 — a resolve that recorded the wrong bytes is not a success.
 *
 * ⚠ `--applied` asserts the migration's effects are ALREADY in production; it runs no SQL. Verify
 * the objects by effect first. Nothing here can check that for you.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const { identifyTarget, describeTarget } = require("./db-target-identity.cjs");
const { findCrMigrations } = require("./migration-line-endings.cjs");

const NAME_RE = /^\d{8,14}_[A-Za-z0-9_]+$/;

/** Exactly one mode and one well-formed name, or an error string. Pure. */
function parseResolveArgs(argv) {
  const modes = argv.filter((a) => a === "--applied" || a === "--rolled-back");
  if (modes.length !== 1) return { error: "pass exactly one of --applied <migration> or --rolled-back <migration>" };
  const i = argv.indexOf(modes[0]);
  const name = argv[i + 1];
  if (!name || name.startsWith("--")) return { error: `${modes[0]} needs a migration name` };
  if (!NAME_RE.test(name)) return { error: `"${name}" is not a migration folder name` };
  const extra = argv.filter((a, j) => j !== i && j !== i + 1);
  if (extra.length) return { error: `unexpected argument(s): ${extra.join(" ")}` };
  return { mode: modes[0], name };
}

function readEnvFileValue(filePath, key) {
  if (!fs.existsSync(filePath)) return null;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line.startsWith(`${key}=`)) continue;
    const v = line.slice(key.length + 1).trim();
    return (v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")) ? v.slice(1, -1) : v;
  }
  return null;
}

function refuse(message) {
  console.error(`\n[db:resolve:prod] REFUSING — ${message}\n`);
  process.exit(1);
}

async function main() {
  if (process.env.ALLOW_PROD_MIGRATION !== "1") {
    refuse("ALLOW_PROD_MIGRATION=1 is not set.\nRun: ALLOW_PROD_MIGRATION=1 npm run db:resolve:prod -- --applied <migration>");
  }
  const args = parseResolveArgs(process.argv.slice(2));
  if (args.error) refuse(`${args.error}.\nUsage: ALLOW_PROD_MIGRATION=1 npm run db:resolve:prod -- --applied <migration>`);

  const migrationsDir = path.join(process.cwd(), "prisma", "migrations");
  const sqlPath = path.join(migrationsDir, args.name, "migration.sql");
  if (!fs.existsSync(sqlPath)) {
    refuse(`prisma/migrations/${args.name}/migration.sql does not exist. Prisma resolves only migrations in prisma/migrations/.`);
  }
  const crlf = findCrMigrations(migrationsDir).find((m) => m.name === args.name);
  if (crlf) {
    refuse(
      `prisma/migrations/${args.name}/migration.sql has ${crlf.crBytes} CR byte(s).\n` +
        `Prisma would record the CRLF sha256, which no Linux checkout matches. Fix the checkout first\n` +
        `(only if \`git status --porcelain -- prisma/migrations\` prints nothing):\n\n` +
        `    git ls-files -z -- prisma/migrations | xargs -0 rm -f\n` +
        `    git -c core.autocrlf=false checkout -- prisma/migrations`
    );
  }

  const url = readEnvFileValue(path.join(process.cwd(), ".env.prod-deploy"), "DIRECT_URL");
  if (!url) refuse("no DIRECT_URL in .env.prod-deploy. Ambient DATABASE_URL/DIRECT_URL are ignored on purpose.");
  if (identifyTarget(url).kind !== "production") {
    refuse(`.env.prod-deploy does not point at production (${describeTarget(url)}).`);
  }
  console.log(`[db:resolve:prod] Target: ${describeTarget(url)}`);
  console.log(`[db:resolve:prod] prisma migrate resolve ${args.mode} ${args.name}`);

  const bin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");
  const r = spawnSync(bin, ["migrate", "resolve", args.mode, args.name], {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: url },
  });
  if (r.status !== 0) process.exit(typeof r.status === "number" ? r.status : 1);
  if (args.mode !== "--applied") return;

  /* Postcondition: the row Prisma wrote must carry the LF file's checksum. */
  const expected = crypto.createHash("sha256").update(fs.readFileSync(sqlPath)).digest("hex");
  const { Client } = require("pg");
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const rows = (
      await c.query(
        `SELECT checksum FROM _prisma_migrations WHERE migration_name = $1 AND finished_at IS NOT NULL AND rolled_back_at IS NULL`,
        [args.name]
      )
    ).rows;
    if (rows.length !== 1 || rows[0].checksum !== expected) {
      console.error(
        `\n[db:resolve:prod] 🛑 LEDGER MISMATCH — expected one live row with checksum ${expected.slice(0, 12)}…, ` +
          `found ${rows.length ? rows.map((x) => x.checksum.slice(0, 12) + "…").join(", ") : "none"}.\n`
      );
      process.exit(1);
    }
    console.log(`[db:resolve:prod] Recorded; ledger checksum ${expected.slice(0, 12)}… matches the LF file.`);
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(`[db:resolve:prod] ERROR: ${e && e.message ? e.message : e}`);
    process.exit(1);
  });
}

module.exports = { parseResolveArgs };
