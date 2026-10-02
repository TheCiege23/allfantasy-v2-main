const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const { identifyTarget } = require("./db-target-identity.cjs");

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
  execFileSync(process.execPath, [path.join(__dirname, "prisma-migrate-deploy.cjs"), "--prod"], {
    cwd: repoRoot,
    env: { ...process.env, ALLOW_PROD_MIGRATION: "1" },
    stdio: "inherit",
  });
} finally {
  fs.rmSync(envPath, { force: true });
}

