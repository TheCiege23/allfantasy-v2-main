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
  /**
   * Minimum PLAYER identity resolution this claim needs, 0..1 (R4 — Identity OS). Distinct from
   * `needsManagerIdentity`: that is "does the roster's OWNER map to a real account", this is "do
   * the PLAYERS on the roster resolve to a real `PlayerIdentityMap` row". Null = does not depend on
   * player identity at all.
   *
   * ⚠ SET LOW, DELIBERATELY. Measured 2026-09-03: a normal, healthy NFL sample resolves at ~61%
   * and NCAAF at ~24% (`scripts/audit-player-identity-coverage.ts`) — those are the ORDINARY case,
   * not a defect, and a threshold anywhere near `minCoverage`'s 0.9 would block most real leagues
   * from ever getting a lineup decision. The threshold exists to catch the measured trap — a
   * roster where EVERY player came back as `{ playerId: '6804', name: '6804' }` and still graded
   * itself `conclusive: ok` — not to demand resolution quality nothing in production has yet.
   */
  minIdentityResolution: number | null
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
    // 0.15, not 0.9 like minCoverage — see the field's own comment. This is a floor against the
    // measured trap (0% resolved), not a quality bar against the measured normal (~61% NFL,
    // ~24% NCAAF).
    minIdentityResolution: 0.15,
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
    minIdentityResolution: null,
  },

  /** "How is my team doing?" — standings and records. Tolerates more lag than a lineup call. */
  standings: {
    scopes: ['teams_rosters'],
    needsManagerIdentity: false,
    needsParity: true,
    maxStaleMs: 12 * HOURS,
    minCoverage: 0.75,
    // Records and win/loss are about TEAMS, not named players. No player identity dependency.
    minIdentityResolution: null,
  },

  /** "What is manager X like?" — a claim ABOUT a person, so an unmapped owner is disqualifying. */
  managerBehaviour: {
    scopes: ['teams_rosters'],
    needsManagerIdentity: true,
    needsParity: false,
    maxStaleMs: 24 * HOURS,
    minCoverage: null,
    // The claim is about the MANAGER's pattern of actions, not about naming the players involved.
    minIdentityResolution: null,
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
    minIdentityResolution: null,
  },
} as const satisfies Record<string, FactDependency>

export type FactProfileName = keyof typeof FACT_PROFILES

function human(ms: number): string {
  const h = Math.floor(ms / HOURS)
  if (h >= 24) return `${Math.floor(h / 24)} day${Math.floor(h / 24) === 1 ? '' : 's'}`
  if (h >= 1) return `${h} hour${h === 1 ? '' : 's'}`
  return `${Math.max(1, Math.round(ms / MINUTES))} minutes`
}

const SCOPE_LABEL: Record<string, string> = {
  league_state: 'league settings',
  teams_rosters: 'rosters',
  transactions: 'transactions',
  traded_picks: 'traded picks',
}

function scopeList(scopes: readonly string[]): string {
  const names = scopes.map((s) => SCOPE_LABEL[s] ?? s)
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export interface CertifiedFreshness {
  lastSuccessfulSyncAt: string | null
  staleMs: number | null
  /** Which certified clock this came from. */
  lane: 'full' | 'active'
}

/**
 * The certified freshness that applies to a fact built from `scopes`.
 *
 * ⚠ THE ACTIVE LANE COUNTS ONLY WHEN IT COVERS EVERY SCOPE THE FACT NEEDS. Its stamp certifies
 * league settings, rosters and transactions together; it says nothing about traded picks. So a
 * lineup call (rosters only) may be judged by it, and a fact that also needs traded picks may not —
 * otherwise a fresh roster read would vouch for a picks table nobody refreshed.
 *
 * PURE, like the rest of this module.
 */
export function certifiedFreshnessFor(scopes: readonly string[], a: ImportAssertions): CertifiedFreshness {
  const full: CertifiedFreshness = { lastSuccessfulSyncAt: a.lastSuccessfulSyncAt, staleMs: a.staleMs, lane: 'full' }
  const lane = a.activeLane
  if (!lane || lane.lastSuccessfulSyncAt == null || lane.staleMs == null) return full
  if (scopes.length === 0 || !scopes.every((s) => lane.scopes.includes(s))) return full
  if (full.staleMs != null && full.staleMs <= lane.staleMs) return full
  return { lastSuccessfulSyncAt: lane.lastSuccessfulSyncAt, staleMs: lane.staleMs, lane: 'active' }
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
  const fresh = certifiedFreshnessFor(dep.scopes, assertions)
  /*
   * A scope the full run left incomplete is not a gap once the active lane has since completed
   * it: that lane's certified stamp is later than the full run that failed on it.
   */
  const laneCompletedAfterFullRun = (scope: string): boolean => {
    const lane = assertions.activeLane
    if (!lane?.lastSuccessfulSyncAt || !lane.scopes.includes(scope)) return false
    const laneAt = Date.parse(lane.lastSuccessfulSyncAt)
    const fullAt = assertions.lastAttemptedSyncAt ? Date.parse(assertions.lastAttemptedSyncAt) : NaN
    return Number.isFinite(laneAt) && (!Number.isFinite(fullAt) || laneAt > fullAt)
  }

  // ── freshness, per scope ────────────────────────────────────────────────────────────────────
  for (const scope of dep.scopes) {
    const s = assertions.scopes.find((x) => x.scope === scope)
    if (s && s.incomplete && !laneCompletedAfterFullRun(scope)) {
      blockedBy.push({
        assertion: 'freshness',
        scope,
        detail: `The "${scope}" part of this league did not finish syncing on the last run.`,
        remedy: 'It retries automatically on the next sync; a manual refresh will also pick it up.',
      })
    }
  }

  if (dep.maxStaleMs != null) {
    if (fresh.lastSuccessfulSyncAt === null) {
      blockedBy.push({
        assertion: 'freshness',
        detail: 'This league has never completed a full sync, so its data has never been certified fresh.',
        remedy: 'Reconnect the league, or run a manual refresh, and this becomes answerable.',
      })
    } else if (fresh.staleMs != null && fresh.staleMs > dep.maxStaleMs) {
      /*
       * ⚠ SAY WHICH DATA THE CLOCK DESCRIBES. "The last successful sync was 4 hours ago" printed
       * under a header reading "synced 25 minutes ago" is a contradiction to the reader even when
       * both are true — they are different collections. Name the scopes the age belongs to.
       */
      const what = dep.scopes.length ? `this league's ${scopeList(dep.scopes)}` : 'this league'
      blockedBy.push({
        assertion: 'freshness',
        detail:
          `The last complete sync of ${what} was ${human(fresh.staleMs)} ago, and this answer needs data ` +
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

  // ── identity (manager) ─────────────────────────────────────────────────────────────────────
  if (dep.needsManagerIdentity && assertions.managerIdentityCoverage != null && assertions.managerIdentityCoverage < 1) {
    const unmapped = assertions.managersTotal - assertions.managersMapped
    blockedBy.push({
      assertion: 'identity',
      detail: `${unmapped} of ${assertions.managersTotal} teams have an owner we cannot match to an account.`,
      remedy: 'Those managers joining AllFantasy, or being linked by the commissioner, closes the gap.',
    })
  }

  // ── identity (player) — R4, Identity OS ────────────────────────────────────────────────────
  if (
    dep.minIdentityResolution != null &&
    assertions.playerIdentityCoverage != null &&
    assertions.playerIdentityCoverage < dep.minIdentityResolution
  ) {
    const unresolved = assertions.playersTotal - assertions.playersResolved
    blockedBy.push({
      assertion: 'identity',
      detail: `${unresolved} of ${assertions.playersTotal} rostered players do not resolve to a known player — this reads as counts, not names.`,
      remedy: 'A league re-sync usually resolves it; a persistently low rate means this provider needs a wider identity bridge.',
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
