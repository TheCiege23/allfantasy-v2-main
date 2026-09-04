import 'server-only'

import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { HOURS } from '../domain-os/types'
import { listProfilesByLeague } from '@/lib/psychological-profiles/ManagerBehaviorQueryService'
import type { PsychDimension } from '@/lib/psychological-profiles/ProfileEvidenceFloor'
import { readLeagueTrajectories, summariseTrajectory, type TrajectorySummary } from '@/lib/psychological-profiles/ProfileSeasonSnapshot'

/**
 * Psychology OS — maintained fact state for manager behavioural profiles (R4b).
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-ui/*` points the other way.
 *
 * ── 🛑 THE ENGINE WAS NEVER THE MISSING PIECE. THE SEAM WAS. ────────────────────────────────
 * `lib/psychological-profiles/` is 16 modules covering all seven sports, with migrated tables,
 * 15 profile labels, 10 evidence types, an evidence floor, a viewer-scoped cross-league rollup,
 * eight API routes and two user-facing pages. It is refreshed on the `fantasy-os-exec-sync` cron.
 *
 * And there were **zero references to it anywhere in `lib/decision-os/`**. A complete subsystem,
 * sitting outside the hub that is supposed to reason over it. This file is the connection, not a
 * reimplementation — the same lesson §2.14 and §2.16 record about rewriting working producers.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ──────────────────────────────────────────────────────
 *
 * ❌ IT DOES NOT RE-DERIVE THE EVIDENCE FLOOR. `gateScores` already nulls any score whose
 *    dimension is below it, and its own comment is explicit that a profile written before the
 *    counts existed is "reported as unmeasured rather than assumed sufficient". Carrying that
 *    decision through is correct; a second floor here would be two implementations of one rule,
 *    which this repo has already paid for more than once.
 *
 * ❌ IT DOES NOT CACHE THE CROSS-LEAGUE OR CROSS-SPORT ROLL-UP. Those are VIEWER-SCOPED — the
 *    answer covers the intersection of leagues the viewer and subject share, so it differs for
 *    every viewer. A per-subject cache would leak behaviour from leagues the viewer has no
 *    relationship with; a per-viewer cache is almost always cold. They stay derived at read.
 *
 * ✅ R4b.5 — IT NOW CARRIES A TRAJECTORY. `manager_psych_profile_seasons` exists and is written
 *    on every refresh (R4b.2); `readLeagueTrajectories` + `summariseTrajectory` turn its rows into
 *    a `TrajectorySummary` per manager, batched into ONE query for the whole league rather than
 *    one per manager. Trajectory is NOT viewer-scoped — "he was a rebuilder in 2023, win-now since
 *    2024" is exactly as true for every viewer — so it belongs in this cached, league-level feed
 *    unlike cross-league/cross-sport below.
 */

/** One manager's profile, in the shape Decision OS reasons over. */
export interface PsychologyProfileFact {
  managerId: string
  sport: string
  /** The 15-term vocabulary. Empty is a real answer: observed, and nothing clears the bar. */
  labels: string[]
  /**
   * ⚠ THE GATED SCORES, NOT THE RAW ONES. Null means "not enough evidence to say", and a consumer
   * must render it as such. A raw score behind a null gate is the confident-wrong-number failure
   * the whole packet exists to prevent — `DevyPlayer.devyValue` being zero-not-null is the same
   * bug in a different subsystem.
   */
  scores: {
    aggressionScore: number | null
    activityScore: number | null
    tradeFrequencyScore: number | null
    waiverFocusScore: number | null
    riskToleranceScore: number | null
  }
  /** Observations behind the profile. Zero is a real answer. */
  evidenceCount: number
  /** Named, so an answer can say WHICH read is unavailable rather than hedging the whole profile. */
  unmeasuredDimensions: PsychDimension[]
  /** True when at least one dimension clears its floor — i.e. anything may be asserted at all. */
  anySufficient: boolean
  updatedAt: string
  /** How this manager's recorded seasons have moved, or an honest refusal — never invented. */
  trajectory: TrajectorySummary
}

export type PsychologyOsArgs = { leagueId: string; sport: string }

/**
 * Profiles for one league.
 *
 * ⚠ 12h TTL. This is the slowest-moving fact in the system — a profile is rebuilt from seasons of
 * transactions and the writer runs on the 30-minute exec-sync heartbeat at best. A short TTL would
 * spend the derive re-reading rows that provably have not moved, which is the cost
 * `domain-os/types.ts` warns about when a TTL is tuned to the fastest-moving input.
 *
 * ⚠ SCHEDULABLE by the three-part rule 1.1b had to retrofit onto Waiver OS and Trade OS: the
 * derive is satisfiable from a league id alone, the scope key IS the league id, and the TTL
 * outlives the 30-minute refresh cycle. It is not wired into `/api/cron/domain-os-refresh` yet —
 * that walk is NFL-only because `draftRulesSource.sport` is hardcoded, and this source is
 * genuinely all-sport, so adding it needs that constraint lifted rather than inherited.
 */
export const psychologyProfileSource: OsFactSource<PsychologyOsArgs, PsychologyProfileFact[]> = {
  kind: 'profiles',
  level: 'league',
  ttlMs: 12 * HOURS,
  scopeKey: (a) => a.leagueId,
  sport: (a) => a.sport,
  derive: async (a) => {
    const rows = await listProfilesByLeague(a.leagueId, { sport: a.sport }).catch(() => [])
    // An empty array is not a fact. Returning it would cache "this league has no managers" for
    // 12 hours over one failed read, and the feed deliberately never stores an unavailable result.
    if (rows.length === 0) return null

    // One query for the whole league rather than one per manager — see readLeagueTrajectories'
    // own comment. A read failure degrades to an empty map, which summariseTrajectory already
    // reports as "no season history has been recorded", the same honest answer as a genuinely
    // empty trajectory.
    const trajectoriesByManager = await readLeagueTrajectories(a.leagueId)

    return rows.map((r): PsychologyProfileFact => {
      const summary = r.evidenceSummary
      return {
        managerId: r.managerId,
        sport: r.sport,
        labels: Array.isArray(r.profileLabels) ? [...r.profileLabels] : [],
        // `displayScores` is the gated view. Falling back to the raw fields when it is absent
        // would silently defeat the floor, so an ungated profile reports every score as unmeasured.
        scores: r.displayScores ?? {
          aggressionScore: null,
          activityScore: null,
          tradeFrequencyScore: null,
          waiverFocusScore: null,
          riskToleranceScore: null,
        },
        evidenceCount: r.evidenceCount ?? 0,
        unmeasuredDimensions: summary?.missingDimensions ?? [],
        anySufficient: summary?.anySufficient ?? false,
        updatedAt: r.updatedAt.toISOString(),
        trajectory: summariseTrajectory(trajectoriesByManager.get(r.managerId) ?? []),
      }
    })
  },
  /**
   * Honesty metadata, mirroring the app/league/user learning trio.
   *
   * 🛑 CONFIDENCE IS NULL WHEN NOTHING CLEARS THE FLOOR, NEVER ZERO. Zero reads as a measured
   * certainty that the manager is unpredictable; null reads as "we do not express one", which is
   * the truth. `CanonicalValue.confidence` carries the same rule for the same reason.
   */
  measure: (facts) => {
    const sampleSize = facts.reduce((n, f) => n + (f.evidenceCount ?? 0), 0)
    const gradable = facts.filter((f) => f.anySufficient).length
    return {
      sampleSize,
      confidence: gradable === 0 ? null : gradable / facts.length,
    }
  },
}

export function createPsychologyOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('psychology', deps)
}

/**
 * Read-through loader.
 *
 * Null means the league has no profiles at all — not that its managers are unremarkable. The
 * distinction matters to a caller deciding whether to say "nothing yet" or to say nothing.
 */
export function createPsychologyOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createPsychologyOs(deps)
  return {
    loadProfiles: (args: PsychologyOsArgs) => feed.get(psychologyProfileSource, args),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const psychologyOsSources = [psychologyProfileSource] as const
