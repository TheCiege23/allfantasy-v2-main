/**
 * Typed facade over `db-target-identity.cjs`.
 *
 * The classification table and logic deliberately live in the .cjs file, not here:
 * `prisma-cli-guard.cjs` and `prisma-migrate-deploy.cjs` run under bare `node` with no
 * tsx, so the one source of truth has to be loadable without a TypeScript runtime.
 * This module exists so TS callers get types and a normal import, never a second copy
 * of the rules — a second copy is how the marker got inverted across ~20 files in the
 * first place.
 *
 * See db-target-identity.cjs for why the guard is an allowlist that fails closed, and
 * why classification is keyed on (endpoint, database) rather than host alone.
 */

// eslint-disable-next-line @typescript-eslint/no-var-requires
const identity = require('./db-target-identity.cjs') as DbTargetIdentityModule

export type DbTargetClassification = 'production' | 'non-production' | 'unknown'

export interface DbTargetKnownEntry {
  endpoint: string
  database: string
  note: string
}

export interface DbTarget {
  host: string | null
  hostname?: string
  endpointId: string | null
  database: string | null
}

export interface DbTargetClassificationResult extends DbTarget {
  classification: DbTargetClassification
  reason: string
}

export interface AssertNonProductionOptions {
  env?: Record<string, string | undefined>
  /** Appended to the refusal message to say what was being protected. */
  action?: string
}

interface DbTargetIdentityModule {
  PRODUCTION_TARGETS: DbTargetKnownEntry[]
  NONPRODUCTION_TARGETS: DbTargetKnownEntry[]
  LOCAL_HOSTS: string[]
  NONPROD_ACK_ENV: string
  parseTarget: (url: string | null | undefined) => DbTarget
  describeTarget: (url: string | null | undefined) => string
  endpointIdFromHost: (host: string) => string
  endpointMatches: (actualEndpoint: string | null, knownEndpoint: string) => boolean
  classifyDatabaseTarget: (
    url: string | null | undefined,
    env?: Record<string, string | undefined>,
  ) => DbTargetClassificationResult
  isProductionTarget: (url: string | null | undefined, env?: Record<string, string | undefined>) => boolean
  isProductionOrUnknownTarget: (url: string | null | undefined, env?: Record<string, string | undefined>) => boolean
  assertNonProductionTarget: (url: string | null | undefined, options?: AssertNonProductionOptions) => DbTarget
}

export const PRODUCTION_TARGETS = identity.PRODUCTION_TARGETS
export const NONPRODUCTION_TARGETS = identity.NONPRODUCTION_TARGETS
export const NONPROD_ACK_ENV = identity.NONPROD_ACK_ENV

export const parseTarget = identity.parseTarget
export const describeTarget = identity.describeTarget
export const classifyDatabaseTarget = identity.classifyDatabaseTarget
export const isProductionTarget = identity.isProductionTarget
export const isProductionOrUnknownTarget = identity.isProductionOrUnknownTarget
export const assertNonProductionTarget = identity.assertNonProductionTarget

/**
 * Refuse-and-exit helper for the `scripts/*` guards, which want a hard stop rather than
 * an exception to unwind. Exit code 2 matches the convention the existing conformance
 * scripts already used for a production refusal.
 */
export function refuseIfNotNonProduction(url: string | null | undefined, action: string): DbTarget {
  const result = classifyDatabaseTarget(url)
  if (result.classification === 'non-production') {
    console.log(`[db-guard] target OK (non-production): ${result.endpointId}/${result.database}`)
    return result
  }
  const label = result.classification === 'production' ? 'PRODUCTION' : 'an UNRECOGNISED database'
  console.error(`\n[db-guard] REFUSING to run against ${label}.\n  ${result.reason}\n  ${action}\n`)
  process.exit(2)
}
