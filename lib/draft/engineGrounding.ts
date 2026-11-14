import {
  computeDraftRecommendation,
  computeNeeds,
  type RecommendationPlayer,
  type RecommendationResult,
} from '@/lib/draft-helper/RecommendationEngine'
import type { ScoringWindow } from '@/lib/draft-helper/draftContextSignals'

/**
 * Ground Chimmy's draft tips (`/api/draft/ai/*`) in the ONE draft engine (2026-11-14).
 *
 * 🛑 BEFORE THIS, CLAUDE NEVER SAW THE PLAYER POOL. The draft chat posts `{ sessionId, userName,
 * state, picks }` — no available players — so "Best Pick Available" asked Claude to name players
 * from memory: someone already drafted, someone retired, someone the board does not carry. It also
 * disagreed with the draft room's own recommendation, which comes from
 * `lib/draft-helper/RecommendationEngine.ts`.
 *
 * Now the routes load the session's live board and the user's own picks on the server, run the
 * engine, and hand Claude three things: the engine's top choice and alternatives with its reasons,
 * the roster needs it scored, and the players actually available. The prompt rule is that Claude
 * explains and adds news/injury colour, recommends only listed players, and may depart from the
 * engine's top choice only by naming the report item that justifies it. `keepAvailable` then drops
 * any name Claude returns that is not on the board, whatever the prompt said.
 *
 * This file is PURE (formatting and filtering). The I/O lives in `engineGroundingLoader.ts`.
 */

export type EngineGroundingPick = {
  player: string
  position: string
  team: string | null
  adp: number | null
  reason: string
}

export type DraftEngineGrounding = {
  /** False when the board or draft could not be read — the prompt then says so. */
  available: boolean
  topPick: EngineGroundingPick | null
  alternatives: EngineGroundingPick[]
  needs: Record<string, number>
  /** Lower-cased names on the board right now; the filter for Claude's output. */
  poolNames: ReadonlySet<string>
  promptSection: string
}

/** How many available players the prompt lists. Enough for any realistic tip, small enough to stay cheap. */
export const GROUNDING_POOL_LIMIT = 40

export const ENGINE_GROUNDING_RULES =
  'A "DRAFT ENGINE" section below is AllFantasy\'s own ranking for this pick, computed from the live board and this user\'s roster. ' +
  'Recommend ONLY players listed under "Available now". Lead with the engine\'s top choice unless an item in the news/injury report ' +
  'is a concrete reason to differ — then name that item. Never invent ADP, rankings or availability.'

const UNAVAILABLE_SECTION =
  'DRAFT ENGINE: unavailable for this draft (the board or picks could not be read). Say that live rankings are unavailable and do not ' +
  'claim any specific player is still on the board.'

function pickOf(row: { player: RecommendationPlayer; reason: string }): EngineGroundingPick {
  return {
    player: row.player.name,
    position: row.player.position,
    team: row.player.team ?? null,
    adp: row.player.adp != null && Number.isFinite(Number(row.player.adp)) ? Number(row.player.adp) : null,
    reason: row.reason,
  }
}

function describe(p: { player?: string; name?: string; position: string; team?: string | null; adp?: number | null }): string {
  const name = p.player ?? p.name ?? ''
  const bits = [p.position, p.team || null, p.adp != null ? `ADP ${Math.round(p.adp * 10) / 10}` : null].filter(Boolean)
  return `${name} (${bits.join(', ')})`
}

export function unavailableGrounding(): DraftEngineGrounding {
  return { available: false, topPick: null, alternatives: [], needs: {}, poolNames: new Set(), promptSection: UNAVAILABLE_SECTION }
}

export function groundingFromEngine(args: {
  result: RecommendationResult
  available: RecommendationPlayer[]
  needs: Record<string, number>
  overallPick: number
  totalTeams: number
}): DraftEngineGrounding {
  const { result, available, needs, overallPick, totalTeams } = args
  if (available.length === 0) return { ...unavailableGrounding(), promptSection: 'DRAFT ENGINE: the board is empty — no players are left to recommend.' }

  const topPick = result.recommendation ? pickOf(result.recommendation) : null
  const alternatives = result.alternatives.slice(0, 4).map(pickOf)
  const byAdp = [...available].sort((a, b) => (a.adp ?? Number.POSITIVE_INFINITY) - (b.adp ?? Number.POSITIVE_INFINITY))
  const needLine = Object.entries(needs)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([pos, score]) => `${pos} ${Math.round(score)}`)
    .join(', ')

  const lines = [
    `DRAFT ENGINE (pick ${overallPick}, ${totalTeams} teams):`,
    topPick ? `Top choice: ${describe(topPick)} — ${topPick.reason}` : 'Top choice: none could be ranked.',
    ...(alternatives.length ? ['Alternatives:', ...alternatives.map((a) => `- ${describe(a)} — ${a.reason}`)] : []),
    ...(needLine ? [`Roster need (0-100, higher = more needed): ${needLine}`] : []),
    ...(result.scoringWindowInsight ? [result.scoringWindowInsight] : []),
    ...(result.runInsight ? [result.runInsight] : []),
    ...(result.scarcityInsight ? [`Scarcity: ${result.scarcityInsight}`] : []),
    ...(result.byeNote ? [`Bye weeks: ${result.byeNote}`] : []),
    `Available now (best ADP first, ${Math.min(GROUNDING_POOL_LIMIT, byAdp.length)} of ${byAdp.length}):`,
    ...byAdp.slice(0, GROUNDING_POOL_LIMIT).map((p) => `- ${describe(p)}${p.byeWeek != null ? `, bye wk ${p.byeWeek}` : ''}`),
  ]

  return {
    available: true,
    topPick,
    alternatives,
    needs,
    poolNames: new Set(available.map((p) => p.name.trim().toLowerCase())),
    promptSection: lines.join('\n'),
  }
}

/** Run the engine for one roster on one board — the same call the draft room's recommendation makes. */
export function runEngineForGrounding(args: {
  available: RecommendationPlayer[]
  teamRoster: Array<{ position: string; team?: string | null; byeWeek?: number | null }>
  overallPick: number
  totalTeams: number
  sport: string
  /** This draft's scoring window and recent picks, when known — see draftContextSignals.ts. */
  scoringWindow?: ScoringWindow | null
  recentPickPositions?: string[]
}): DraftEngineGrounding {
  const { available, teamRoster, overallPick, totalTeams, sport } = args
  const result = computeDraftRecommendation({
    available,
    teamRoster,
    scoringWindow: args.scoringWindow ?? null,
    recentPickPositions: args.recentPickPositions,
    round: Math.ceil(overallPick / Math.max(1, totalTeams)),
    // The engine's `pick` is the pick WITHIN the round; it derives the overall pick itself.
    pick: ((overallPick - 1) % Math.max(1, totalTeams)) + 1,
    totalTeams,
    sport,
    mode: 'needs',
  })
  const needs = computeNeeds(teamRoster, [], false, available, sport)
  return groundingFromEngine({ result, available, needs, overallPick, totalTeams })
}

/**
 * Drop any player Claude named who is not on the board. Matching is on the trimmed, lower-cased
 * name — the same key `poolNames` is built from. With no grounding (board unreadable) nothing is
 * dropped, because there is nothing to check against; the prompt already told Claude not to claim
 * availability.
 */
export function keepAvailable<T>(
  items: readonly T[] | null | undefined,
  nameOf: (item: T) => unknown,
  grounding: DraftEngineGrounding,
): T[] {
  const list = Array.isArray(items) ? [...items] : []
  if (!grounding.available) return list
  return list.filter((item) => {
    const name = nameOf(item)
    return typeof name === 'string' && grounding.poolNames.has(name.trim().toLowerCase())
  })
}

/** The engine's own answer in the best-pick shape, for when Claude is down or named nobody valid. */
export function engineBestPickFallback(grounding: DraftEngineGrounding): {
  recommendations: Array<{ player: string; position: string; reason: string }>
  summary: string
} | null {
  if (!grounding.available || !grounding.topPick) return null
  const rows = [grounding.topPick, ...grounding.alternatives].slice(0, 3)
  return {
    recommendations: rows.map((r) => ({ player: r.player, position: r.position, reason: r.reason })),
    summary: 'These come straight from the AllFantasy draft engine; Chimmy’s commentary is unavailable right now.',
  }
}
