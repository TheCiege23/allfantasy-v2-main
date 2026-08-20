#!/usr/bin/env node
const fs = require("fs")
const path = require("path")
const { spawn } = require("child_process")

const DATABASE_ENV_KEYS = [
  "DATABASE_URL",
  "POSTGRES_PRISMA_URL",
  "POSTGRES_URL",
  "DIRECT_URL",
  "POSTGRES_URL_NON_POOLING",
]

const ENV_FILES = [".env.local", ".env"]

function readEnvFile(fileName) {
  try {
    const envPath = path.resolve(process.cwd(), fileName)
    const raw = fs.readFileSync(envPath, "utf8")
    const entries = {}

    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith("#")) continue
      const withoutExport = trimmed.startsWith("export ") ? trimmed.slice(7) : trimmed
      const equalsIndex = withoutExport.indexOf("=")
      if (equalsIndex <= 0) continue

      const key = withoutExport.slice(0, equalsIndex).trim()
      const rawValue = withoutExport.slice(equalsIndex + 1).trim()
      const unquoted =
        (rawValue.startsWith('"') && rawValue.endsWith('"')) ||
        (rawValue.startsWith("'") && rawValue.endsWith("'"))
          ? rawValue.slice(1, -1)
          : rawValue

      entries[key] = unquoted
    }

    return entries
  } catch {
    return {}
  }
}

function resolveDatabaseUrl() {
  for (const key of DATABASE_ENV_KEYS) {
    const value = process.env[key]
    if (typeof value === "string" && value.trim()) return value.trim()
  }

  for (const fileName of ENV_FILES) {
    const fileEnv = readEnvFile(fileName)
    for (const key of DATABASE_ENV_KEYS) {
      const value = fileEnv[key]
      if (typeof value === "string" && value.trim()) return value.trim()
    }
  }

  return undefined
}

function normalizeSupabaseSessionPooler(url) {
  if (!url) return url
  return url.replace(":6543", ":5432")
}

function resolvePort() {
  const idx = process.argv.findIndex((arg) => arg === "--port")
  if (idx >= 0 && process.argv[idx + 1]) {
    return String(process.argv[idx + 1])
  }
  if (process.env.PLAYWRIGHT_PORT) return String(process.env.PLAYWRIGHT_PORT)
  return "3000"
}

/**
 * Refuse to boot the e2e server against a database that is not positively known to be safe.
 *
 * WHY THIS EXISTS
 * `resolveDatabaseUrl()` above falls back to `.env.local`, and in this repo `.env.local` is
 * PRODUCTION (`ep-curly-block/neondb`). So `npx playwright test` with a clean shell pointed the
 * entire e2e suite at production — and the auth specs sign up real accounts there, because
 * `e2e/helpers/auth-flow.ts` registers `e2e.<Date.now()>@example.com` with a password hardcoded
 * in this PUBLIC repo.
 *
 * It already happened: production holds 108 such accounts, created across five run-days between
 * 2026-04-26 and 2026-07-02, all of which accepted that published password. Together with the
 * fixture seeds, 184 of 256 production accounts (72%) were reachable with a known credential.
 *
 * Note that `playwright.config.ts` passes `DATABASE_URL: '' ` when the shell has none, and
 * `@next/env` treats an empty string as unset — so even the explicit-looking env block in that
 * config does not stop the fallback. The check has to live here, where the URL is actually
 * resolved, and it has to fail CLOSED: an unrecognised target is refused, not allowed.
 */
function assertSafeE2ETarget(url) {
  const identity = require(path.resolve(__dirname, "db-target-identity.cjs"))
  const target = identity.identifyTarget(url)
  // Credential-free description only — this repo is public.
  console.log(`[playwright-dev-server] database target: ${identity.describeTarget(url)}`)

  if (target.kind === "safe") return

  if (process.env.ALLOW_PROD_E2E === "1") {
    console.warn(
      `[playwright-dev-server] ⚠ ALLOW_PROD_E2E=1 — running e2e against a ${target.kind} target. ` +
        `The auth specs WILL create real accounts with a password published in this repo.`,
    )
    return
  }

  const reason =
    target.kind === "production"
      ? "this is PRODUCTION"
      : `this target is ${target.kind}, and unrecognised targets are refused`

  console.error(
    `\n[playwright-dev-server] REFUSED TO START: ${reason} ` +
      `(${identity.describeTarget(url)}).\n\n` +
      `  The e2e suite signs up accounts with a password hardcoded in this public repo, so\n` +
      `  running it against a real database publishes working logins for that environment.\n` +
      `  Production already holds 108 accounts from earlier unguarded runs.\n\n` +
      `  Point at a safe database and re-run, e.g.:\n` +
      `    $env:DATABASE_URL = (Get-Content .env.test | Select-String '^DATABASE_URL=').Line.Substring(13)\n\n` +
      `  See KNOWN_SAFE_TARGETS in scripts/db-target-identity.cjs; confirm with npm run db:target.\n` +
      `  To override deliberately, set ALLOW_PROD_E2E=1.\n`,
  )
  process.exit(1)
}

const port = resolvePort()
const envDb = resolveDatabaseUrl()
const normalizedDb = normalizeSupabaseSessionPooler(envDb)
assertSafeE2ETarget(normalizedDb)
const distDir = process.env.AF_NEXT_DIST_DIR || process.env.PLAYWRIGHT_DIST_DIR || `.next-playwright-${port}`
const childEnv = {
  ...process.env,
  ...(normalizedDb ? { DATABASE_URL: normalizedDb } : {}),
  AF_NEXT_DIST_DIR: distDir,
  AUTH_TRUST_HOST: process.env.AUTH_TRUST_HOST || "true",
  NEXTAUTH_URL: process.env.NEXTAUTH_URL || `http://127.0.0.1:${port}`,
  NODE_OPTIONS: process.env.NODE_OPTIONS || "--max-old-space-size=4096",
  PORT: port,
}

/**
 * Playwright `webServer.url` (see playwright.config.ts) waits on a real
 * `/_next/static/chunks/*.js` URL — not only `/` — before tests run.
 */

const cleaner = spawn(process.execPath, ["scripts/clean-next-dev.cjs"], {
  stdio: "inherit",
  env: childEnv,
})

cleaner.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  if (code !== 0) process.exit(code == null ? 1 : code)

  const nextBin = path.resolve(process.cwd(), "node_modules", "next", "dist", "bin", "next")
  const child = spawn(process.execPath, [nextBin, "dev", "-p", port, "--hostname", "127.0.0.1"], {
    stdio: "inherit",
    env: childEnv,
  })

  child.on("exit", (childCode, childSignal) => {
    if (childSignal) process.kill(process.pid, childSignal)
    process.exit(childCode == null ? 1 : childCode)
  })
})
