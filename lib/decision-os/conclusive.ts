/**
 * `isConclusive` — may Decision OS assert THIS fact about THIS league? (3.3, D16)
 *
 * PURE. No prisma, no clock of its own (`now` is injected). Importable anywhere, testable without
 * a database, and deliberately separate from the assertions it consumes.
 *
 * ── 🛑 PER FACT, NOT PER LEAGUE, AND THE DIFFERENCE IS THE WHOLE DESIGN ─────────────────────
 * The tempting shape is one boolean per league. It is wrong twice over: it refuses answers that
 * are perfectly well-grounded, and it hides WHICH part is broken behind a single unhelpful flag.
 *
 * A stale matchup sync makes a start/sit claim unsafe. It says nothing at all about the league's
 * scoring rules, which were read from a settings row and are exactly as true as they were
 * yesterday. Refusing both is not caution — it is a worse answer than the truth, and it trains a
 * user to ignore the caveat.
 *
 * ── D8: NAME THE GAP *AND* THE REMEDY ───────────────────────────────────────────────────────
 * Every blocker carries `detail` (what is wrong) and `remedy` (what would fix it). "I can't tell
 * you that" is a dead end; "your Fantrax league hasn't synced since Tuesday — reconnect it and
 * I'll have this" is an answer. The remedy is not decoration, it is the half that makes the
 * refusal useful.
 */

import type { ImportAssertions } from './import/assertions'

export type ConclusivenessAssertion = 'freshness' | 'parity' | 'coverage' | 'identity'

export interface ConclusivenessBlocker {
  assertion: ConclusivenessAssertion
  /** The specific import scope at fault, when the blocker is scope-shaped. */
  scope?: string
  /** What is wrong, in terms a user would recognise. */
  detail: string
  /** What would fix it. Never empty — a refusal without a remedy is a dead end. */
  remedy: string
}

export type ConclusivenessVerdict =
  | { ok: true }
  | { ok: false; blockedBy: ConclusivenessBlocker[] }

/**
 * What a class of fact actually depends on.
 *
 * ⚠ DECLARE THE NARROWEST TRUE SET. Over-declaring dependencies quietly rebuilds the league-level
 * boolean this module exists to avoid: if every fact claims to need every scope, every fact is
 * blocked by any staleness and the per-fact machinery becomes ceremony.
 */
export interface FactDependency {
  /** Import scopes whose data this fact is built from. Empty = does not depend on a sync at all. */
  scopes: readonly string[]
  /** True when the claim is about a specific manager, so an unmapped owner makes it unsafe. */
  needsManagerIdentity: boolean
  /** True when the claim requires our copy to still match the provider. */
  needsParity: boolean
  /** How old the certified sync may be before this claim stops being safe. Null = staleness-immune. */
  maxStaleMs: number | null
  /** Minimum roster coverage this claim needs, 0..1. Null = does not depend on completeness. */
  minCoverage: number | null
}

const MINUTES = 60_000
const HOURS = 60 * MINUTES

/**
 * Named profiles for the fact classes Chimmy actually answers about.
 *
 * The staleness numbers are anchored to the collector's own cadence — the exec-sync heartbeat
 * refreshes due leagues roughly every 30 minutes in season and every 4 hours in the offseason —
 * so a claim tolerating 6h has survived several missed cycles before it refuses, and one
 * tolerating 30 minutes is asserting that it needs near-live data.
 */
export const FACT_PROFILES = {
  /**
   * "Should I start X?" — the highest-stakes read, and the one a stale roster ruins. Needs current
   * rosters, needs to know the roster is genuinely this manager's, and needs our copy to match.
   */
  lineupDecision: {
    scopes: ['teams_rosters'],
    needsManagerIdentity: true,
    needsParity: true,
    maxStaleMs: 2 * HOURS,
    minCoverage: 0.9,
  },

  /**
   * "What are my league's scoring rules?" — read from a settings row.
   *
   * ⚠ STALENESS-IMMUNE ON PURPOSE, AND THIS IS THE CASE THAT JUSTIFIES THE WHOLE MODULE. A league
   * whose matchup sync has been failing for a week still has exactly correct scoring settings, and
   * a per-league boolean would refuse to state them.
   */
  leagueRules: {
    scopes: ['league_state'],
    needsManagerIdentity: false,
    needsParity: false,
    maxStaleMs: null,
    minCoverage: null,
  },

  /** "How is my team doing?" — standings and records. Tolerates more lag than a lineup call. */
  standings: {
    scopes: ['teams_rosters'],
    needsManagerIdentity: false,
    needsParity: true,
    maxStaleMs: 12 * HOURS,
    minCoverage: 0.75,
  },

  /** "What is manager X like?" — a claim ABOUT a person, so an unmapped owner is disqualifying. */
  managerBehaviour: {
    scopes: ['teams_rosters'],
    needsManagerIdentity: true,
    needsParity: false,
    maxStaleMs: 24 * HOURS,
    minCoverage: null,
  },

  /**
   * "What is this player worth?" — market values are GLOBAL. They do not come from this league's
   * import at all, so no import assertion can block them.
   */
  globalPlayerValue: {
    scopes: [],
    needsManagerIdentity: false,
    needsParity: false,
    maxStaleMs: null,
    minCoverage: null,
  },
} as const satisfies Record<string, FactDependency>

export type FactProfileName = keyof typeof FACT_PROFILES

function human(ms: number): string {
  const h = Math.floor(ms / HOURS)
  if (h >= 24) return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? '' : 's'}`
  if (h >= 1) return `${h} hour${h === 1 ? '' : 's'}`
  return `${Math.max(1, Math.round(ms / MINUTES))} minutes`
}

/**
 * Decide whether one fact class may be asserted about one league.
 *
 * ⚠ A league with NO import (a native AF league) is CONCLUSIVE, not blocked. It was never
 * imported, so there is no sync to be stale and no provider to diverge from. Treating "never
 * imported" as "unverified" would refuse to answer anything about half the product.
 */
export function isConclusive(
  dep: FactDependency,
  assertions: ImportAssertions | null,
  now: number = Date.now(),
): ConclusivenessVerdict {
  // No import at all — nothing to be inconclusive about. See the note above.
  if (!assertions || assertions.parity === 'unchecked' && assertions.lastAttemptedSyncAt === null) {
    return { ok: true }
  }

  const blockedBy: ConclusivenessBlocker[] = []

  // ── freshness, per scope ────────────────────────────────────────────────────────────────────
  for (const scope of dep.scopes) {
    const s = assertions.scopes.find((x) => x.scope === scope)
    if (s && s.incomplete) {
      blockedBy.push({
        assertion: 'freshness',
        scope,
        detail: `The "${scope}" part of this league did not finish syncing on the last run.`,
        remedy: 'It retries automatically on the next sync; a manual refresh will also pick it up.',
      })
    }
  }

  if (dep.maxStaleMs != null) {
    if (assertions.lastSuccessfulSyncAt === null) {
      blockedBy.push({
        assertion: 'freshness',
        detail: 'This league has never completed a full sync, so its data has never been certified fresh.',
        remedy: 'Reconnect the league, or run a manual refresh, and this becomes answerable.',
      })
    } else if (assertions.staleMs != null && assertions.staleMs > dep.maxStaleMs) {
      blockedBy.push({
        assertion: 'freshness',
        detail:
          `The last successful sync was ${human(assertions.staleMs)} ago, and this answer needs data ` +
          `no older than ${human(dep.maxStaleMs)}.`,
        remedy:
          assertions.consecutiveFailures > 0
            ? `Syncing has failed ${assertions.consecutiveFailures} time(s) in a row — reconnecting the league usually clears it.`
            : 'A manual refresh will bring it current.',
      })
    }
  }

  // ── parity ──────────────────────────────────────────────────────────────────────────────────
  if (dep.needsParity && (assertions.parity === 'diverged' || assertions.parity === 'failed')) {
    blockedBy.push({
      assertion: 'parity',
      detail: `Our copy of this league no longer matches ${assertions.provider} (${assertions.parity}).`,
      remedy: 'A successful re-sync reconciles it; until then this answer could be about stale rosters.',
    })
  }

  // ── coverage ────────────────────────────────────────────────────────────────────────────────
  if (dep.minCoverage != null && assertions.rosterCoverage != null && assertions.rosterCoverage < dep.minCoverage) {
    blockedBy.push({
      assertion: 'coverage',
      detail:
        `We hold ${assertions.rostersHeld} of ${assertions.rostersExpected} teams in this league, ` +
        `which is not enough to answer this reliably.`,
      remedy: 'A full re-import usually fills the missing teams.',
    })
  }

  // ── identity ────────────────────────────────────────────────────────────────────────────────
  if (dep.needsManagerIdentity && assertions.managerIdentityCoverage != null && assertions.managerIdentityCoverage < 1) {
    const unmapped = assertions.managersTotal - assertions.managersMapped
    blockedBy.push({
      assertion: 'identity',
      detail: `${unmapped} of ${assertions.managersTotal} teams have an owner we cannot match to an account.`,
      remedy: 'Those managers joining AllFantasy, or being linked by the commissioner, closes the gap.',
    })
  }

  return blockedBy.length === 0 ? { ok: true } : { ok: false, blockedBy }
}

/** Convenience: resolve by profile name. */
export function isConclusiveFor(
  profile: FactProfileName,
  assertions: ImportAssertions | null,
  now: number = Date.now(),
): ConclusivenessVerdict {
  return isConclusive(FACT_PROFILES[profile], assertions, now)
}
