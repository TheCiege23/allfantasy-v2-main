const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { identifyTarget } = require("./db-target-identity.cjs");

/**
 * Which production script to run with Railway's database URL. Pure.
 *
 *   railway run node scripts/railway-prod-migrate.cjs                         → migrate deploy
 *   railway run node scripts/railway-prod-migrate.cjs resolve --applied <name>  → migrate resolve
 *
 * `resolve` exists because a hand-run `npx prisma migrate resolve` bypasses every guard; it goes
 * through scripts/prisma-resolve-prod.cjs instead (LF-only, production-only, ledger read-back).
 * Any other argument is refused rather than ignored: this script used to ignore its arguments, so
 * `… resolve --applied x` would silently have run a full `migrate deploy`.
 */
function childFor(argv) {
  if (argv.length === 0) return { script: "prisma-migrate-deploy.cjs", args: ["--prod"] };
  if (argv[0] === "resolve") return { script: "prisma-resolve-prod.cjs", args: argv.slice(1) };
  return { error: `unknown arguments: ${argv.join(" ")} (use none for deploy, or "resolve --applied <migration>")` };
}

function main() {
  const child = childFor(process.argv.slice(2));
  if (child.error) throw new Error(child.error);

  const databaseUrl =
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.DATABASE_URL;

  if (!databaseUrl || /[\r\n]/.test(databaseUrl)) {
    throw new Error("A valid production database URL is required for Railway migrations.");
  }

  if (identifyTarget(databaseUrl).kind !== "production") {
    throw new Error("Railway migration target is not the known production database.");
  }

  const repoRoot = path.dirname(__dirname);
  const envPath = path.join(repoRoot, ".env.prod-deploy");
  if (fs.existsSync(envPath)) {
    throw new Error("Refusing to overwrite an existing .env.prod-deploy file.");
  }

  try {
    fs.writeFileSync(envPath, `DIRECT_URL=${databaseUrl}\n`, { mode: 0o600 });
    execFileSync(process.execPath, [path.join(__dirname, child.script), ...child.args], {
      cwd: repoRoot,
      env: { ...process.env, ALLOW_PROD_MIGRATION: "1" },
      stdio: "inherit",
    });
  } finally {
    fs.rmSync(envPath, { force: true });
  }
}

if (require.main === module) main();

module.exports = { childFor };
