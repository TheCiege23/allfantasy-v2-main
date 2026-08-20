/**
 * TypeScript access to `scripts/db-target-identity.cjs`, the single source of truth for
 * "which database does this connection string point at", plus the fail-closed guard that
 * non-production scripts call before touching a database.
 *
 * WHY THIS EXISTS
 * Every `scripts/decision-os-*-nonprod.ts` and its siblings used to carry their own copy of
 *
 *     const PROD_HOST_MARKER = 'ep-spring-tooth'
 *
 * and refuse to run when the resolved host contained it. `ep-spring-tooth-adaoi9x1` is the
 * `claude-dashboard-local-dev` FORK. Production is `ep-curly-block-ad0dlt9o` (verified
 * 2026-08-20 against `.env.local`). So every one of those guards refused the SAFE target and
 * permitted the real one: a script named `-nonprod`, documenting a hard refusal of production,
 * was free to write to production and printed nothing to suggest otherwise.
 *
 * The literal was duplicated across ~23 files, which is why it went stale in the first place --
 * nothing made the copies move together. Identity now lives in exactly one place and these
 * scripts ask it a question rather than re-deciding for themselves.
 *
 * WHY NOT JUST SWAP THE STRING
 * A host substring cannot express this repo topology. Production and the dev shadow share the
 * SAME Neon compute and differ only by database name (`ep-curly-block-ad0dlt9o/neondb` is
 * production; `ep-curly-block-ad0dlt9o/mydb_shadow` is safe), while `neondb` alone is used by
 * staging, test and redraft-test too. Identity is the (endpoint, database) PAIR -- see the long
 * comment in `db-target-identity.cjs`.
 *
 * FAIL-CLOSED
 * Anything not positively recognised as safe is refused, production included. The bug this
 * replaces was a guard that allowed what it did not recognise; a guard that only refuses one
 * known-bad string is one rename away from being decorative again.
 */

import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

const require = createRequire(import.meta.url)

export type DbTargetKind = 'production' | 'safe' | 'unknown' | 'unparseable'

export interface DbTarget {
  kind: DbTargetKind
  label: string
  endpoint: string | null
  database: string | null
  hostname: string | null
}

interface TargetIdentityModule {
  PRODUCTION_ENDPOINT: string
  PRODUCTION_DATABASE: string
  endpointOf(hostname: string): string
  identifyTarget(url: string | null | undefined): DbTarget
  describeTarget(url: string | null | undefined): string
  isProductionTarget(url: string | null | undefined): boolean
}

/** Read a `KEY=value` env file without pulling in dotenv. */
export function readEnvFile(file: string): Record<string, string> {
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
 * Walk up until we find the checkout that holds the identity module.
 *
 * A git worktree has no `.env` or `node_modules` of its own -- both live in the primary
 * checkout -- so a single-directory read finds nothing and the guard would refuse with
 * "unparseable" instead of naming production. Still fail-closed, but a guard that cannot say
 * what it is protecting against invites someone to reach for an override to quiet it.
 */
export function findRepoRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start)
  for (let i = 0; i < 8; i++) {
    if (fs.existsSync(path.join(dir, 'scripts', 'db-target-identity.cjs'))) return dir
    const up = path.dirname(dir)
    if (up === dir) break
    dir = up
  }
  throw new Error('Could not locate scripts/db-target-identity.cjs')
}

let cached: TargetIdentityModule | null = null

/** Load the CJS single source of truth. Cached -- it is pure and has no per-call state. */
export function loadTargetIdentity(): TargetIdentityModule {
  if (cached) return cached
  cached = require(
    path.join(findRepoRoot(process.cwd()), 'scripts', 'db-target-identity.cjs'),
  ) as TargetIdentityModule
  return cached
}

/**
 * Resolve the URL the way the Prisma client in this process will, walking up from `startDir`
 * so worktrees resolve against the primary checkout env files.
 */
export function resolveDatabaseUrlFromDisk(startDir: string = process.cwd()): string | undefined {
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

/** Classify a connection string as production / safe / unknown / unparseable. */
export function identifyDbTarget(url: string | null | undefined): DbTarget {
  return loadTargetIdentity().identifyTarget(url)
}

/**
 * Credential-free description for logs and refusal messages -- `endpoint/database (label)`.
 * This repo is public; never log a raw connection string.
 */
export function describeDbTarget(url: string | null | undefined): string {
  return loadTargetIdentity().describeTarget(url)
}

/** True only for a target positively identified as production. */
export function isProductionDbTarget(url: string | null | undefined): boolean {
  return loadTargetIdentity().isProductionTarget(url)
}

export interface NonProductionGuardOptions {
  /** Script name, shown in log and refusal messages so the operator knows what stopped. */
  script: string
  /**
   * The resolved connection string. Omit to resolve it from the environment/env files the
   * same way Prisma would.
   */
  url?: string | null
  /**
   * What this script does to the database, e.g. `writes activity rows`. Used in the refusal
   * message so the operator understands the stakes of the target being wrong.
   */
  action?: string
  /** Exit code used when refusing. Defaults to 1. */
  exitCode?: number
  /**
   * Opt-in escape hatch for scripts that are PROVABLY read-only (no create/update/upsert/delete,
   * no `$executeRaw`/`$queryRaw`), where inspecting real production data is a legitimate operator
   * task. When true, `ALLOW_PROD_READONLY=1` downgrades a production refusal to a loud warning.
   *
   * Deliberately narrow:
   *  - Unknown and unparseable targets are STILL refused. The opt-in means "I know this is
   *    production", not "let anything through" — fail-closed is the property being preserved.
   *  - It must be set per run, matching the existing ALLOW_PROD_MIGRATION / ALLOW_PROD_SEED
   *    convention, so touching production stays a deliberate act rather than a default.
   */
  readOnlyProdOptIn?: boolean
}

/** Env var that permits a provably read-only script to run against production. */
export const PROD_READONLY_OPT_IN_ENV = 'ALLOW_PROD_READONLY'

/**
 * Refuse to continue unless the target is positively identified as a safe (non-production)
 * database. Call this before the first query in any `*-nonprod` / conformance / probe script.
 *
 * Exits the process on refusal rather than throwing, matching the existing call sites -- these
 * are CLI entry points whose contract is a non-zero exit, not a stack trace.
 *
 * @returns the identified target, for callers that want to log the endpoint they ended up on.
 */
export function assertNonProductionDbTarget(options: NonProductionGuardOptions): DbTarget {
  const { script, action, exitCode = 1, readOnlyProdOptIn = false } = options
  const url = options.url ?? resolveDatabaseUrlFromDisk()
  const target = identifyDbTarget(url)

  // Credential-free only -- this repo is public.
  const described = describeDbTarget(url)
  if (target.kind === 'safe') {
    console.log(`[${script}] target: ${described}`)
    return target
  }

  // Read-only opt-in: production only, never an unidentified target.
  if (
    target.kind === 'production' &&
    readOnlyProdOptIn &&
    process.env[PROD_READONLY_OPT_IN_ENV] === '1'
  ) {
    console.warn(
      `[${script}] ⚠ ${PROD_READONLY_OPT_IN_ENV}=1 — reading PRODUCTION (${described}). ` +
        `Permitted because this script performs no writes. Do not add writes to it.`,
    )
    return target
  }

  // A script with the read-only opt-in CAN be pointed at production deliberately, so the flat
  // "must NEVER touch production" line would contradict the hint printed below it.
  const subject = action ? `This runner ${action} and` : 'This runner'
  const doing = readOnlyProdOptIn
    ? `${subject} does not run against production by default.`
    : `${subject} must NEVER touch production.`
  const reason =
    target.kind === 'production'
      ? 'this is PRODUCTION'
      : target.kind === 'unparseable'
        ? 'the connection string could not be parsed, and unrecognised targets are refused'
        : 'this target is unrecognised, and unrecognised targets are refused'

  const optInHint =
    target.kind === 'production' && readOnlyProdOptIn
      ? `  This script performs no writes, so if you intend to inspect production data, re-run it\n` +
        `  with ${PROD_READONLY_OPT_IN_ENV}=1.\n`
      : ''

  console.error(
    `\n[${script}] REFUSED: ${reason} (${described}).\n` +
      `  ${doing}\n\n` +
      `  Point at a safe database first -- see KNOWN_SAFE_TARGETS in scripts/db-target-identity.cjs\n` +
      `  (\`.env.test\` is the usual choice) and confirm with \`npm run db:target\`.\n` +
      `  If this target is genuinely safe, add it to KNOWN_SAFE_TARGETS deliberately.\n` +
      optInHint,
  )
  process.exit(exitCode)
}
