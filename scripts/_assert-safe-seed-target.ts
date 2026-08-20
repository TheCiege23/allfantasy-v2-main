/**
 * Fail-closed guard for seed/fixture scripts. Import and call it before the first write.
 *
 * WHY THIS EXISTS
 * The war-room runtime seeds had no target check of any kind. They resolve `DATABASE_URL` the
 * way Prisma does — from `.env` — and in this repo that points at PRODUCTION. They are also
 * package scripts (`npm run seed:*`), so a one-word typo runs them against real data.
 *
 * It already happened. As of 2026-08-17 production held 22 fixture login accounts from six
 * different seed families, 10 fixture leagues, 79 rosters, 5 of the 7 rows in
 * `user_subscriptions`, and 52 `Player` rows tagged with a runtime-seed provider key. Every one
 * of those 22 accounts accepted the password hardcoded in these scripts — a password published
 * in a public repository. That is not messy test data, it is working credentials to a live
 * environment.
 *
 * DESIGN NOTES
 *  - Unknown targets are REFUSED, not allowed. The guard this repo replaced failed OPEN against
 *    real production while looking like a working safety check; see `db-target-identity.cjs`.
 *  - Identity comes from `db-target-identity.cjs`, the single source of truth, rather than a
 *    fresh host-substring test that can silently go stale.
 *  - The override is deliberately awkward (`ALLOW_PROD_SEED=1`) and logs loudly, because there
 *    is no ordinary reason to seed fixtures into production.
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)

interface TargetIdentity {
  identifyTarget(url: string | undefined): {
    kind: 'production' | 'safe' | 'unknown' | 'unparseable'
    label: string
  }
  describeTarget(url: string | undefined): string
}

/** Read a `KEY=value` env file without pulling in dotenv. */
function readEnvFile(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {}
  const out: Record<string, string> = {}
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 0) continue
    out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
  }
  return out
}

/**
 * Resolve the URL the way the Prisma client in this process will.
 *
 * Walks UP from the starting directory rather than reading only one checkout. A git worktree has
 * no `.env` of its own — both the env files and `node_modules` live in the primary checkout — so
 * a single-directory read finds nothing there and the guard would refuse with "unparseable"
 * instead of naming production. That is still fail-closed, but a safety guard that cannot
 * identify what it is protecting against tells the operator the wrong thing, and "unparseable"
 * invites someone to reach for ALLOW_PROD_SEED to make the noise stop.
 */
function resolveDatabaseUrl(startDir: string): string | undefined {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL
  let dir = path.resolve(startDir)
  for (let i = 0; i < 8; i++) {
    const local = readEnvFile(path.join(dir, '.env.local'))
    const base = readEnvFile(path.join(dir, '.env'))
    const url = local.DATABASE_URL || base.DATABASE_URL
    if (url) return url
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  return undefined
}

/** Walk up until we find the checkout that holds the identity module. */
function findRepoRoot(start: string): string {
  let dir = path.resolve(start)
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts', 'db-target-identity.cjs'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('Could not locate scripts/db-target-identity.cjs')
}

/**
 * Refuse to continue unless the target is positively identified as a safe (non-production)
 * database. Call this at the top of `main()` in any script that writes fixture data.
 *
 * @param seedName Shown in the refusal message so the operator knows which script stopped.
 */
export function assertSafeSeedTarget(seedName: string): void {
  const repoRoot = findRepoRoot(process.cwd())
  const identity = require(
    path.join(repoRoot, 'scripts', 'db-target-identity.cjs'),
  ) as TargetIdentity

  const url = resolveDatabaseUrl(process.cwd())
  const target = identity.identifyTarget(url)
  // Credential-free description only — this repo is public.
  console.log(`[${seedName}] target: ${identity.describeTarget(url)}`)

  if (target.kind === 'safe') return

  if (process.env.ALLOW_PROD_SEED === '1') {
    console.warn(
      `[${seedName}] ⚠ ALLOW_PROD_SEED=1 — writing FIXTURE data to a ${target.kind} target ` +
        `(${identity.describeTarget(url)}). These fixtures use a password that is published in ` +
        `a public repo; anything you create here is a live credential.`,
    )
    return
  }

  const reason =
    target.kind === 'production'
      ? 'this is PRODUCTION'
      : `this target is ${target.kind} and unrecognised targets are refused`

  throw new Error(
    `\n[${seedName}] REFUSED TO SEED: ${reason} (${identity.describeTarget(url)}).\n\n` +
      `  Fixture seeds create login accounts whose password is hardcoded in this public repo,\n` +
      `  so seeding a real environment publishes working credentials for it. Production already\n` +
      `  holds 22 such accounts from earlier unguarded runs.\n\n` +
      `  Point at a safe database first — see KNOWN_SAFE_TARGETS in scripts/db-target-identity.cjs\n` +
      `  (\`.env.test\` is the usual choice) and confirm with \`npm run db:target\`.\n` +
      `  If you genuinely intend to write fixtures to this target, set ALLOW_PROD_SEED=1.\n`,
  )
}

/**
 * Fail-closed guard for seed scripts that create objects in STRIPE rather than the database.
 *
 * `seed-bracket-products.ts` calls `stripe.products.create` / `stripe.prices.create`, so the
 * hazard is not a database at all — it is which Stripe account the key belongs to. `.env` here
 * holds a test key but `.env.local` holds a LIVE one, and `.env.local` wins in the same
 * resolution order everything else uses, so the default path creates real billable products.
 *
 * Only the key's PREFIX is ever inspected or logged. The value is never printed.
 */
export function assertSafeStripeTarget(seedName: string): void {
  const repoRoot = findRepoRoot(process.cwd())

  let key = process.env.STRIPE_SECRET_KEY
  if (!key) {
    let dir = path.resolve(repoRoot)
    for (let i = 0; i < 8; i++) {
      const local = readEnvFile(path.join(dir, '.env.local'))
      const base = readEnvFile(path.join(dir, '.env'))
      key = local.STRIPE_SECRET_KEY || base.STRIPE_SECRET_KEY
      if (key) break
      const up = path.dirname(dir)
      if (up === dir) break
      dir = up
    }
  }

  // Classify by prefix only. Anything unrecognised is refused, not assumed safe.
  const mode = !key
    ? 'missing'
    : key.startsWith('sk_live_') || key.startsWith('rk_live_')
      ? 'LIVE'
      : key.startsWith('sk_test_') || key.startsWith('rk_test_')
        ? 'test'
        : 'unrecognised'

  console.log(`[${seedName}] stripe key mode: ${mode}`)
  if (mode === 'test') return

  if (process.env.ALLOW_LIVE_STRIPE_SEED === '1') {
    console.warn(
      `[${seedName}] ⚠ ALLOW_LIVE_STRIPE_SEED=1 — creating Stripe objects with a ${mode} key. ` +
        `Products and prices created here are real and chargeable.`,
    )
    return
  }

  throw new Error(
    `\n[${seedName}] REFUSED: Stripe key mode is ${mode}, not test.\n\n` +
      `  This script creates Stripe products and prices. With a live key those are real,\n` +
      `  chargeable objects in your actual account, and Stripe products cannot simply be\n` +
      `  un-created. Note that \`.env.local\` in this repo holds a LIVE key and takes\n` +
      `  precedence over \`.env\`, so the default path is the dangerous one.\n\n` +
      `  Export a test key for this run, or set ALLOW_LIVE_STRIPE_SEED=1 to override.\n`,
  )
}
