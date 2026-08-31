import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * Import OS → the four assertions Decision OS needs to call a league CONCLUSIVE (3.2, D7).
 *
 * 🛑 THIS IS THE HALF THAT WAS ALREADY COMPUTED AND UNREADABLE. `externalMatchupParity` and
 * `fantraxMatchupParity` have been running on the exec-sync heartbeat and producing a per-league
 * verdict — `status: 'synced' | 'skipped' | 'failed' | 'not_due'` — that NO SURFACE COULD READ.
 * `LeagueSyncState` has been carrying per-scope checkpoints and a certified freshness timestamp
 * for just as long. A Commissioner OS card would happily report on a league whose last successful
 * sync failed four days ago, because nothing in the read path could see that it had.
 *
 * The four assertions, per D7:
 *
 *   1. FRESHNESS PER SCOPE     which scopes completed, which are still incomplete, and when the
 *                              last SUCCESSFUL collection was — per scope, not per league.
 *   2. PARITY VERDICT          does our copy still match the provider.
 *   3. COVERAGE                what fraction of the league's expected entities we actually hold.
 *   4. IDENTITY CONFIDENCE     how confidently external managers map to real accounts.
 *
 * ⚠ NOTHING HERE COMPUTES A SYNC. It reads what the collectors already recorded. A second
 * implementation of freshness would be the three-health-scorers shape in a new place.
 */

/** The scopes a Sleeper sync fills. Mirrors `SLEEPER_SYNC_SCOPES` — kept as data, not imported,
 *  so this read layer does not drag the collector's server-only graph in behind it. */
export const IMPORT_SCOPES = ['league_state', 'teams_rosters', 'traded_picks'] as const
export type ImportScope = (typeof IMPORT_SCOPES)[number]

export interface ScopeFreshness {
  scope: string
  /** Completed on the LAST run. Not the same as "ever completed". */
  completedLastRun: boolean
  /** Still incomplete or failed after the last run — a resume target. */
  incomplete: boolean
  hasCheckpoint: boolean
}

export type ParityVerdict = 'matched' | 'diverged' | 'unchecked' | 'failed'

export interface ImportAssertions {
  leagueId: string
  provider: string
  externalLeagueId: string
  season: number

  // ── 1. Freshness ──────────────────────────────────────────────────────────────────────────
  /**
   * ⚠ TWO TIMESTAMPS, AND CONFLATING THEM IS THE WHOLE RISK. `lastAttemptedSyncAt` advances on
   * EVERY run, success or not. `lastSuccessfulSyncAt` advances only when all required mutable
   * scopes complete — the schema calls it "certified freshness". A surface that shows the first
   * one tells a user their league synced two minutes ago when it has actually been failing for
   * four days. Both are carried here so a consumer cannot pick the flattering one by accident.
   */
  lastAttemptedSyncAt: string | null
  lastSuccessfulSyncAt: string | null
  /** Age of the CERTIFIED freshness, not the attempt. Null when never successfully synced. */
  staleMs: number | null
  syncStatus: string | null
  consecutiveFailures: number
  scopes: ScopeFreshness[]

  // ── 2. Parity ─────────────────────────────────────────────────────────────────────────────
  /**
   * ⚠ `unchecked` IS NOT `matched`. Parity runs for espn/yahoo/fantrax only; a Sleeper league has
   * never been parity-checked and saying "matched" about it would be an unearned assurance.
   */
  parity: ParityVerdict
  parityNote: string | null

  // ── 3. Coverage ───────────────────────────────────────────────────────────────────────────
  /** Rosters we hold against the league's declared team count. Null when the count is unknown. */
  rosterCoverage: number | null
  rostersHeld: number
  rostersExpected: number | null

  // ── 4. Identity ───────────────────────────────────────────────────────────────────────────
  /**
   * Fraction of rosters whose manager maps to a real account.
   *
   * An external manager with no AF account is NORMAL and not a defect — `DecisionOsImportedActivity`
   * is deliberately not FK'd to AppUser for exactly this reason. It still bounds what Decision OS
   * may claim: "this team's owner is not someone we know" is a real limit on a manager-level answer.
   */
  managerIdentityCoverage: number | null
  managersMapped: number
  managersTotal: number
}

/**
 * Nothing recorded is `unchecked`, never `matched` — see the field comment.
 *
 * Exported so the distinction is pinned by a test. It is one `return` away from becoming an
 * unearned "everything is fine" for every league that was never checked, and that failure would
 * be completely invisible: a `matched` verdict looks identical whether it was earned or defaulted.
 */
export function verdictFrom(syncStatus: string | null, failures: number): ParityVerdict {
  if (failures > 0) return 'failed'
  if (syncStatus === 'completed') return 'matched'
  if (syncStatus === 'partial' || syncStatus === 'failed') return 'diverged'
  return 'unchecked'
}

function asArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}
function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

/**
 * Read every assertion for one league.
 *
 * Returns null only when the league itself is missing. A league with NO sync state is a real and
 * common answer — a native AF league was never imported — and it comes back with
 * `parity: 'unchecked'` and null freshness rather than as an error.
 */
export async function loadImportAssertions(leagueId: string): Promise<ImportAssertions | null> {
  const league = await prisma.league
    .findUnique({
      where: { id: leagueId },
      select: { id: true, platform: true, platformLeagueId: true, season: true, leagueSize: true },
    })
    .catch(() => null)
  if (!league) return null

  const provider = String(league.platform ?? '').toLowerCase()
  const externalLeagueId = String(league.platformLeagueId ?? '')
  const season = Number(league.season ?? 0)
  const runKey = `${provider}:${externalLeagueId}:${season}`

  const [state, rosters] = await Promise.all([
    prisma.leagueSyncState.findUnique({ where: { runKey } }).catch(() => null),
    prisma.roster
      .findMany({ where: { leagueId }, select: { platformUserId: true } })
      .catch(() => [] as { platformUserId: string | null }[]),
  ])

  const completed = asArray(state?.completedScopes)
  const incomplete = asArray(state?.incompleteScopes)
  const checkpoints = asRecord(state?.checkpoints)

  const scopes: ScopeFreshness[] = IMPORT_SCOPES.map((scope) => ({
    scope,
    completedLastRun: completed.includes(scope),
    incomplete: incomplete.includes(scope),
    hasCheckpoint: checkpoints[scope] != null,
  }))

  const lastSuccess = state?.lastSuccessfulSyncAt ?? null
  const failures = state?.consecutiveFailures ?? 0

  const rostersHeld = rosters.length
  const rostersExpected = typeof league.leagueSize === "number" && league.leagueSize > 0 ? league.leagueSize : null
  // Null expected → null coverage. A ratio against an unknown denominator is not a measurement.
  const rosterCoverage = rostersExpected ? Math.min(1, rostersHeld / rostersExpected) : null

  const managersMapped = rosters.filter((r) => typeof r.platformUserId === 'string' && r.platformUserId.length > 0).length
  const managerIdentityCoverage = rostersHeld > 0 ? managersMapped / rostersHeld : null

  return {
    leagueId,
    provider,
    externalLeagueId,
    season,
    lastAttemptedSyncAt: state?.lastAttemptedSyncAt?.toISOString() ?? null,
    lastSuccessfulSyncAt: lastSuccess?.toISOString() ?? null,
    staleMs: lastSuccess ? Date.now() - lastSuccess.getTime() : null,
    syncStatus: state?.syncStatus ?? null,
    consecutiveFailures: failures,
    scopes,
    parity: state ? verdictFrom(state.syncStatus ?? null, failures) : 'unchecked',
    parityNote: state
      ? null
      : 'No sync state for this league. Native AF leagues are never imported, so this is normal rather than a failure.',
    rosterCoverage,
    rostersHeld,
    rostersExpected,
    managerIdentityCoverage,
    managersMapped,
    managersTotal: rostersHeld,
  }
}
