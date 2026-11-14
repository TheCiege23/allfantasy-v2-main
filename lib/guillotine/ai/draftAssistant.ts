import {
  computeDraftRecommendation,
  type RecommendationPlayer,
  type RecommendationResult,
} from '@/lib/draft-helper/RecommendationEngine'

/**
 * Guillotine draft advice, through the ONE draft engine (2026-11-14).
 *
 * This file used to return `availablePlayers[0..2]` with three canned sentences — not a ranking
 * at all. It now asks `computeDraftRecommendation` (lib/draft-helper/RecommendationEngine.ts, the
 * engine behind /api/draft/recommend and the Decision OS `manager.draft.pick` decision), so a
 * guillotine drafter gets the same ranking every other draft screen gives, framed for the format:
 *
 *   - survivalPick — the engine's top choice in NEEDS mode. In a guillotine league the lowest
 *     score each week is cut, so a full, startable lineup (the floor) is the first job.
 *   - ceilingPick  — the engine's top choice in BEST-AVAILABLE mode, when it differs: the most
 *     talent left regardless of need. Otherwise the next alternative.
 *   - depthPick    — the next needs-mode alternative not already named: injury and bye cover.
 *
 * Every reason is the engine's own, never a canned line. `byeWeekAlert` is the engine's bye note.
 * Optional ADP/team/bye/projection fields are passed through when the caller has them; without
 * ADP the engine orders on its own prior and — by its honesty rules — makes no market claims.
 */

export type DraftedPlayer = { playerId: string; name: string; pos: string; team?: string | null; byeWeek?: number | null }
export type DraftPlayer = {
  playerId: string
  name: string
  pos: string
  team?: string | null
  adp?: number | null
  byeWeek?: number | null
  projectedPoints?: number | null
}

type Pick = { playerId: string; name: string; reasoning: string }

export type GuillotineDraftRec = {
  survivalPick: Pick
  depthPick: Pick
  ceilingPick: Pick
  byeWeekAlert: string | null
}

const NONE: Pick = { playerId: 'x', name: '—', reasoning: 'No player available to rank.' }

function engineInput(
  currentRoster: DraftedPlayer[],
  availablePlayers: DraftPlayer[],
  sport: string,
  pickNumber: number,
  leagueSize: number,
  mode: 'needs' | 'bpa',
) {
  const totalTeams = Math.max(2, Math.floor(leagueSize) || 12)
  const overall = Math.max(1, Math.floor(pickNumber) || 1)
  const available: RecommendationPlayer[] = availablePlayers.map((p) => ({
    name: p.name,
    position: p.pos,
    team: p.team ?? null,
    adp: p.adp ?? null,
    byeWeek: p.byeWeek ?? null,
    projectedPoints: p.projectedPoints ?? null,
  }))
  return {
    available,
    teamRoster: currentRoster.map((p) => ({ position: p.pos, team: p.team ?? null, byeWeek: p.byeWeek ?? null })),
    round: Math.ceil(overall / totalTeams),
    pick: overall,
    totalTeams,
    sport,
    mode,
  }
}

export async function getGuillotineDraftRecommendation(
  currentRoster: DraftedPlayer[],
  availablePlayers: DraftPlayer[],
  sport: string,
  _draftSlot: number,
  pickNumber: number,
  leagueSize: number,
): Promise<GuillotineDraftRec> {
  if (availablePlayers.length === 0) {
    return { survivalPick: NONE, depthPick: NONE, ceilingPick: NONE, byeWeekAlert: null }
  }

  const needs: RecommendationResult = computeDraftRecommendation(
    engineInput(currentRoster, availablePlayers, sport, pickNumber, leagueSize, 'needs'),
  )
  const bpa: RecommendationResult = computeDraftRecommendation(
    engineInput(currentRoster, availablePlayers, sport, pickNumber, leagueSize, 'bpa'),
  )

  // The engine returns players by name/position/team; map back to the caller's ids.
  const idFor = (p: RecommendationPlayer): string =>
    availablePlayers.find((a) => a.name === p.name && a.pos === p.position && (a.team ?? null) === (p.team ?? null))
      ?.playerId ??
    availablePlayers.find((a) => a.name === p.name && a.pos === p.position)?.playerId ??
    'x'
  const toPick = (row: { player: RecommendationPlayer; reason: string } | null | undefined, frame: string): Pick | null =>
    row ? { playerId: idFor(row.player), name: row.player.name, reasoning: `${frame} ${row.reason}`.trim() } : null

  const used = new Set<string>()
  const take = (pick: Pick | null): Pick | null => {
    if (!pick || used.has(pick.playerId)) return null
    used.add(pick.playerId)
    return pick
  }

  const survival = take(toPick(needs.recommendation, 'Fills a starting need — in a guillotine league the floor comes first.'))
  const ceilingCandidates = [bpa.recommendation, ...bpa.alternatives, ...needs.alternatives]
  let ceiling: Pick | null = null
  for (const row of ceilingCandidates) {
    ceiling = take(toPick(row, 'Most talent left on the board.'))
    if (ceiling) break
  }
  let depth: Pick | null = null
  for (const row of needs.alternatives) {
    depth = take(toPick(row, 'Depth for byes and injuries.'))
    if (depth) break
  }

  const fallback = survival ?? ceiling ?? depth ?? NONE
  return {
    survivalPick: survival ?? fallback,
    depthPick: depth ?? fallback,
    ceilingPick: ceiling ?? fallback,
    byeWeekAlert: needs.byeNote ?? null,
  }
}
