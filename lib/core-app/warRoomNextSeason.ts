import type { DynastyDirectionResult } from '@/lib/dynasty-war-room/dynastyTeamDirectionEngine'
import type { KeeperDraftPlanResult } from '@/lib/keeper-war-room/keeperDraftPlanEngine'
import type { KeeperRecommendationResult } from '@/lib/keeper-war-room/keeperRecommendationEngine'
import type { KeeperValueLine } from '@/lib/keeper-war-room/keeperValueEngine'

/**
 * War Room phase 3 — the next-season plan, for a league whose rosters carry over.
 *
 * ── 🛑 NOT A SECOND ENGINE ──────────────────────────────────────────────
 *
 * The per-format War Rooms already decide these things, deterministically and from the database:
 * `dynastyTeamDirectionEngine` (contention window and buy/sell posture, with its facts),
 * `keeperRecommendationEngine` (the best keep set by value surplus within the league's limit) and
 * `keeperDraftPlanEngine` (rounds consumed by keepers, positions to target). They were reachable only
 * from the older league tabs. This file maps their results into what the /core War Room shows and
 * decides nothing itself — so the two surfaces cannot disagree about a keeper or a window.
 *
 * ⚠ THE ENGINES' OWN "NEEDS MORE DATA" IS CARRIED, NOT SMOOTHED OVER. A keeper league with no
 * recorded costs, or a dynasty roster with no values, says so rather than showing an empty plan that
 * reads as "nothing to do".
 *
 * Pure. The loader (warRoomLeagueLoader.ts) builds the contexts and runs the engines.
 */

export type KeeperLine = {
  playerId: string
  name: string
  position: string
  /** The league's own cost label ("Round 7", "$12"), or null when no cost is recorded. */
  cost: string | null
  /** Rounds of value over cost — positive is a good keeper. Null when cost or value is missing. */
  surplusRounds: number | null
  verdict: KeeperValueLine['verdict']
}

export type NextSeasonView =
  | {
      kind: 'dynasty'
      window: DynastyDirectionResult['window']
      posture: DynastyDirectionResult['posture']
      contendScore: number | null
      avgStarterAge: number | null
      earlyPickCount: number
      /** The engine's own sentences, in its wording. */
      facts: string[]
      missing: string[]
    }
  | {
      kind: 'keeper'
      maxKeepers: number
      recommended: KeeperLine[]
      bubble: KeeperLine[]
      /** Eligible players whose cost exceeds their value — keeping them loses value. */
      avoid: KeeperLine[]
      draft: { consumedRounds: number[]; priorityPositions: string[] } | null
      needsMoreData: boolean
      missing: string[]
    }
  | {
      kind: 'none'
      /** `one_season`: nothing carries over. `unavailable`: the engine refused, with its reason. */
      why: 'one_season' | 'unavailable' | 'no_team'
      reason: string | null
    }

/** Bubble and avoid lists are capped — the plan is a decision, not an inventory. */
const LIST_CAP = 3

function line(v: KeeperValueLine): KeeperLine {
  return {
    playerId: v.playerId,
    name: v.playerName,
    position: v.position,
    cost: v.keeperCostLabel,
    surplusRounds: v.surplusRounds,
    verdict: v.verdict,
  }
}

export function dynastyView(d: DynastyDirectionResult): NextSeasonView {
  return {
    kind: 'dynasty',
    window: d.window,
    posture: d.posture,
    contendScore: d.contendScore,
    avgStarterAge: d.avgStarterAge,
    earlyPickCount: d.earlyPickCount,
    facts: d.explanationFacts,
    missing: d.missingDataFlags,
  }
}

export function keeperView(rec: KeeperRecommendationResult, plan: KeeperDraftPlanResult | null): NextSeasonView {
  return {
    kind: 'keeper',
    maxKeepers: rec.maxKeepers,
    recommended: rec.recommended.map(line),
    bubble: rec.bubble.slice(0, LIST_CAP).map(line),
    avoid: rec.avoid.slice(0, LIST_CAP).map(line),
    draft: plan ? { consumedRounds: plan.consumedRounds, priorityPositions: plan.priorityPositions } : null,
    needsMoreData: rec.needsMoreData,
    missing: [...new Set([...rec.missingDataFlags, ...(plan?.missingDataFlags ?? [])])],
  }
}

/** Which engine a league's format calls for. Salary cap carries over too, but has no engine yet. */
export function nextSeasonEngineFor(format: string | null): 'dynasty' | 'keeper' | 'none' | 'not_built' {
  if (format === 'dynasty' || format === 'devy') return 'dynasty'
  if (format === 'keeper') return 'keeper'
  if (format === 'salary_cap') return 'not_built'
  return 'none'
}
