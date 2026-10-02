/**
 * Commissioner OS League-Specific Intelligence Wiring phase — Part 2, the
 * single canonical commissioner coordinator. Reuses the SAME
 * `LeagueRecommendationBundle` contract the User OS coordinator populates
 * (`lib/shared-services/league-hub/userOsRecommendations.ts`) — writes only
 * into the `commissioner` bucket, never a second contract.
 */
import { assembleCommissionerOsContext, type CommissionerOsContext } from './commissionerOsContext'
import { getEmptyRecommendationBundle } from './recommendationContract'
import { generateLeagueHealthRecommendations } from './generators/commissioner/leagueHealthRecommendations'
import { generateEngagementRecommendations } from './generators/commissioner/engagementRecommendations'
import { generateRankingsRecommendations } from './generators/commissioner/rankingsRecommendations'
import { generateStorylineRecommendations } from './generators/commissioner/storylineRecommendations'
import { generateRivalryRecommendations } from './generators/commissioner/rivalryRecommendations'
import { generateDraftGradeRecommendations } from './generators/commissioner/draftGradeRecommendations'
import { generateTradeGradeRecommendations } from './generators/commissioner/tradeGradeRecommendations'
import { generateIntegrityRecommendations } from './generators/commissioner/integrityRecommendations'
import type { LeagueRecommendation, LeagueRecommendationBundle, SyncFreshness } from './types'

export type CommissionerDomainKey =
  | 'health'
  | 'engagement'
  | 'rankings'
  | 'storylines'
  | 'rivalries'
  | 'draft'
  | 'trades'
  | 'integrity'

export type DomainStatus = 'ok' | 'unavailable' | 'unsupported' | 'stale_blocked' | 'engine_error'

export interface CommissionerOsRecommendationResult {
  bundle: LeagueRecommendationBundle
  domainStatus: Partial<Record<CommissionerDomainKey, DomainStatus>>
  generatedAt: string
  /** True when the caller is not a real, verified commissioner — the API route must map this to 404/403, never leak whether the league exists. */
  accessDenied: boolean
}

type Generator = (context: CommissionerOsContext, generatedAt: string) => LeagueRecommendation[]

const GENERATORS: Record<CommissionerDomainKey, Generator> = {
  health: generateLeagueHealthRecommendations,
  engagement: generateEngagementRecommendations,
  rankings: generateRankingsRecommendations,
  storylines: generateStorylineRecommendations,
  rivalries: generateRivalryRecommendations,
  draft: generateDraftGradeRecommendations,
  trades: generateTradeGradeRecommendations,
  integrity: generateIntegrityRecommendations,
}

const ALL_DOMAINS: readonly CommissionerDomainKey[] = [
  'health',
  'engagement',
  'rankings',
  'storylines',
  'rivalries',
  'draft',
  'trades',
  'integrity',
]

/**
 * The coordinator. Never trusts a client-supplied commissioner flag — the
 * ONLY inputs are `appUserId` (from the caller's own resolved session) and
 * `canonicalLeagueId` (revalidated server-side by `assembleCommissionerOsContext`,
 * which itself fails closed via `resolveActiveLeagueContext.isCommissioner`).
 * A normal league member calling this function gets `accessDenied: true`,
 * never partial commissioner-only data.
 */
export async function assembleCommissionerOsRecommendations(args: {
  appUserId: string
  canonicalLeagueId: string
  requestedDomains?: CommissionerDomainKey[]
  requestTime?: Date
}): Promise<CommissionerOsRecommendationResult> {
  const generatedAt = (args.requestTime ?? new Date()).toISOString()
  const context = await assembleCommissionerOsContext({
    appUserId: args.appUserId,
    canonicalLeagueId: args.canonicalLeagueId,
  })

  if (!context) {
    return {
      bundle: getEmptyRecommendationBundle(),
      domainStatus: {},
      generatedAt,
      accessDenied: true,
    }
  }

  const domainsToRun = args.requestedDomains?.length ? args.requestedDomains : ALL_DOMAINS

  // Maps this coordinator's domain keys to the real, honest "why is this domain unsupported for
  // this specific league" reasons `assembleCommissionerOsContext` already computed — never guessed
  // again here.
  //
  // `storylines` only maps to `storylines_weekly_cadence` (non-NFL sport) — deliberately, NOT also to
  // "zero DramaEvent rows this season" the way `rivalries`/`draft` map to zero-rows-ever. Physical
  // validation against a real disposable-branch fixture (Part 21) surfaced this asymmetry and it was
  // evaluated, not blindly "fixed" to match: rivalry history and a draft each happen at most a handful
  // of times per league, so zero rows really does mean "this feature has never been engaged for this
  // league" (a genuine capability gap → `unsupported`). Drama detection is a recurring, per-week scan —
  // zero rows most weeks is the ordinary, expected steady state ("nothing dramatic happened"), not a
  // capability gap, so it correctly reports `ok` with an empty list — the coordinator's own "an empty
  // array is a real 'no action needed'" rule (see below) applies here, not the unsupported rule.
  const UNAVAILABLE_REASON: Partial<Record<CommissionerDomainKey, string>> = {
    storylines: 'storylines_weekly_cadence',
    rivalries: 'rivalries_history',
    draft: 'draft_grades',
  }

  const bundle = getEmptyRecommendationBundle()
  const domainStatus: CommissionerOsRecommendationResult['domainStatus'] = {}
  const allCommissionerRecs: LeagueRecommendation[] = []

  for (const domain of domainsToRun) {
    const reason = UNAVAILABLE_REASON[domain]
    if (reason && context.unavailableDomains.includes(reason)) {
      domainStatus[domain] = 'unsupported'
      continue
    }
    try {
      const recs = GENERATORS[domain](context, generatedAt)
      allCommissionerRecs.push(...recs)
      // An empty array here is a real "no action needed" — distinct from `unsupported` above.
      domainStatus[domain] = 'ok'
    } catch (err) {
      console.error(`[commissionerOsRecommendations] generator failed for domain "${domain}":`, err)
      domainStatus[domain] = 'engine_error'
    }
  }

  bundle.commissioner = allCommissionerRecs
  bundle.totalCount =
    bundle.lineup.length +
    bundle.waiver.length +
    bundle.trade.length +
    bundle.roster.length +
    bundle.playoff.length +
    bundle.strategy.length +
    bundle.commissioner.length

  return { bundle, domainStatus, generatedAt, accessDenied: false }
}

/**
 * Part 13 — deterministic prioritization, per the phase's own suggested
 * homepage order: critical governance issue, inactive/illegal-lineup,
 * upcoming deadline, league-health, engagement opportunity, copy-ready
 * content — in that order, not just by raw priority level.
 */
const HOMEPAGE_ORDER: Record<string, number> = {
  integrity_review_recommended: 0,
  engagement_lineup_attention_carryover: 1,
  mission_control_action: 2,
  league_health_score: 3,
  // Everything else (engagement categories, rankings, storylines, rivalries, draft, trade) falls
  // through to the default bucket below, ordered by priority only.
}

const PRIORITY_RANK: Record<LeagueRecommendation['priority'], number> = {
  critical: 3,
  high: 2,
  medium: 1,
  low: 0,
}

export function selectTopCommissionerActions(bundle: LeagueRecommendationBundle, maxCount = 5): LeagueRecommendation[] {
  return [...bundle.commissioner]
    .sort((a, b) => {
      const orderA = HOMEPAGE_ORDER[a.type] ?? 10
      const orderB = HOMEPAGE_ORDER[b.type] ?? 10
      if (orderA !== orderB) return orderA - orderB
      return PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority]
    })
    .slice(0, maxCount)
}

export interface ChimmyCommissionerOsSummary {
  canonicalLeagueId: string
  provider: string
  sport: string
  season: number | string | null
  syncFreshness: SyncFreshness
  isSnapshotOnly: boolean
  /** Real, already-computed `LeagueHealthAssessment` reduced to what a conversational answer needs — never a second health model. */
  healthSummary: { band: string; score: number; confidence: number } | null
  /** Each entry already carries real evidence + (where a generator produced it) copy-ready content — no separate shape needed. */
  topActions: LeagueRecommendation[]
}

/**
 * Part 20 — the focused seam Chimmy can consume to answer questions like
 * "How healthy is my league?" / "What should I post this week?" / "Which
 * managers are inactive?" / "Write a rivalry-week announcement." /
 * "Summarize this trade." / "What commissioner action needs attention?".
 * Mirrors `getChimmyUserOsSummary`'s exact shape and scope: deliberately
 * narrower than `assembleCommissionerOsRecommendations`'s own result (no
 * full bundle, no per-domain diagnostics) — only active league, real
 * commissioner authorization (fails closed the same way the coordinator
 * already does — `accessDenied`/`null` context both return `null` here,
 * never partial commissioner-only data to a non-commissioner caller),
 * league-health summary, freshness, and a short prioritized action list
 * whose entries already carry evidence + copy-ready content. This phase
 * does not wire it into Chimmy itself (`lib/chimmy-context/*` untouched) —
 * only exposes the function, same scoping decision as the User OS seam.
 */
export async function getChimmyCommissionerOsSummary(args: {
  appUserId: string
  canonicalLeagueId: string
}): Promise<ChimmyCommissionerOsSummary | null> {
  const result = await assembleCommissionerOsRecommendations({
    appUserId: args.appUserId,
    canonicalLeagueId: args.canonicalLeagueId,
  })
  if (result.accessDenied) return null

  const context: CommissionerOsContext | null = await assembleCommissionerOsContext({
    appUserId: args.appUserId,
    canonicalLeagueId: args.canonicalLeagueId,
  })
  if (!context) return null

  return {
    canonicalLeagueId: context.canonicalLeagueId,
    provider: context.provider,
    sport: context.sport,
    season: context.season,
    syncFreshness: context.syncFreshness,
    isSnapshotOnly: context.isSnapshotOnly,
    healthSummary: { band: context.health.category, score: context.health.score, confidence: context.health.confidence },
    topActions: selectTopCommissionerActions(result.bundle, 5),
  }
}
