/**
 * Fetch league standings for weighted draft lottery.
 * Maps each LeagueTeam (standings) to the Roster it owns (slotOrder rosterId).
 */

import { prisma } from '@/lib/prisma'
import { buildRosterIdResolver } from '@/lib/league/league-settings-draft-sync'
import type { LotteryEligibleTeam, LotteryEligibilityMode, LotteryWeightingMode, LotteryTiebreakMode } from './types'

export interface StandingsRow {
  rosterId: string
  displayName: string
  teamIndex: number
  rank: number
  wins: number
  losses: number
  ties: number
  pointsFor: number
  /** Max PF if available (dynasty); else pointsFor. */
  maxPf: number
}

/**
 * Get standings for a league: one row per team, carrying the id of the roster that team owns.
 *
 * 🛑 THIS USED TO SORT TEAMS AND ROSTERS BY ID AND ZIP THEM BY INDEX. Ids are random, so the
 * pairing was arbitrary: a team's record set its lottery odds, and the pick it won was seated on
 * whichever roster id happened to sort alongside it — another manager's.
 *
 * Now each team resolves to its own roster (`externalId`, then its claimant, then its platform
 * user — `buildRosterIdResolver`, the same mapping the draft order uses). A team that cannot be
 * resolved keeps the old positional pairing, but only over rosters no other team owns, so it can
 * never duplicate one; when nothing resolves the output is exactly what it was.
 *
 * Rows follow team order (teams by id), and `teamIndex` / the `currentRank` fallback keep their
 * meaning. A roster no team points at still gets a row after the teams. Padding to `leagueSize`
 * with `placeholder-N` ids happens only for a league with no team rows at all, as before.
 */
export async function getStandingsForLottery(leagueId: string): Promise<StandingsRow[]> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      leagueSize: true,
      rosters: { select: { id: true, platformUserId: true }, orderBy: { id: 'asc' } },
      teams: {
        select: {
          id: true,
          externalId: true,
          claimedByUserId: true,
          platformUserId: true,
          ownerName: true,
          teamName: true,
          wins: true,
          losses: true,
          ties: true,
          pointsFor: true,
          currentRank: true,
        },
        orderBy: { id: 'asc' },
      },
    },
  })
  if (!league) return []

  const rosters = league.rosters ?? []
  const teams = league.teams ?? []

  if (teams.length === 0) {
    const teamCount = league.leagueSize ?? rosters.length
    const rows: StandingsRow[] = []
    for (let i = 0; i < teamCount; i++) {
      rows.push(emptyRow(rosters[i]?.id ?? `placeholder-${i + 1}`, i))
    }
    return rows
  }

  const resolveRosterId = buildRosterIdResolver(rosters, teams)
  const owned = teams.map((t) => resolveRosterId(t.id))
  const taken = new Set(owned.filter((id): id is string => Boolean(id)))
  // Rosters nobody owns, in id order: the positional fallback draws from these in turn.
  const unowned = rosters.map((r) => r.id).filter((id) => !taken.has(id))

  const rows: StandingsRow[] = teams.map((t, i) => {
    const rosterId = owned[i] ?? unowned.shift() ?? t.id
    return {
      rosterId,
      displayName: t.teamName || t.ownerName || `Team ${i + 1}`,
      teamIndex: i,
      rank: t.currentRank ?? i + 1,
      wins: t.wins ?? 0,
      losses: t.losses ?? 0,
      ties: t.ties ?? 0,
      pointsFor: t.pointsFor ?? 0,
      maxPf: t.pointsFor ?? 0,
    }
  })
  for (const rosterId of unowned) rows.push(emptyRow(rosterId, rows.length))

  return rows
}

/** A roster with no team row: no standings to weigh, but it still holds a pick. */
function emptyRow(rosterId: string, index: number): StandingsRow {
  return {
    rosterId,
    displayName: `Team ${index + 1}`,
    teamIndex: index,
    rank: index + 1,
    wins: 0,
    losses: 0,
    ties: 0,
    pointsFor: 0,
    maxPf: 0,
  }
}

/**
 * Apply tiebreak to a list of standings rows (mutates sort).
 */
export function applyTiebreak(
  rows: StandingsRow[],
  tiebreakMode: LotteryTiebreakMode,
  seed: string
): void {
  if (tiebreakMode === 'lower_points_for') {
    rows.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      return a.pointsFor - b.pointsFor
    })
    return
  }
  if (tiebreakMode === 'lower_max_pf') {
    rows.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      return a.maxPf - b.maxPf
    })
    return
  }
  if (tiebreakMode === 'seeded_random') {
    const rng = seededRandom(seed)
    rows.sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank
      if (a.pointsFor !== b.pointsFor) return a.pointsFor - b.pointsFor
      return rng() - 0.5
    })
  }
}

function seededRandom(seed: string): () => number {
  let state = 0
  for (let i = 0; i < seed.length; i++) {
    state = (state << 5) - state + seed.charCodeAt(i)
    state |= 0
  }
  let n = 0
  return () => {
    n++
    const x = Math.sin((state >>> 0) / 0xffffffff * 997 + n * 9999) * 10000
    return x - Math.floor(x)
  }
}

/**
 * Select eligible teams for lottery based on config.
 */
export function selectEligibleTeams(
  rows: StandingsRow[],
  eligibilityMode: LotteryEligibilityMode,
  lotteryTeamCount: number,
  playoffTeamCount: number
): StandingsRow[] {
  const mode = eligibilityMode === 'custom' ? 'all_teams' : eligibilityMode
  if (mode === 'all_teams') {
    return rows.slice(0, lotteryTeamCount)
  }
  if (mode === 'bottom_n') {
    return rows.slice(-lotteryTeamCount)
  }
  const nonPlayoffCount = Math.max(0, rows.length - playoffTeamCount)
  const eligible = rows.slice(playoffTeamCount, playoffTeamCount + nonPlayoffCount)
  return eligible.slice(0, lotteryTeamCount)
}

/**
 * Compute weight for a team (higher = better lottery odds).
 */
export function computeWeight(
  row: StandingsRow,
  weightingMode: LotteryWeightingMode,
  worstRankInPool: number,
  bestRankInPool: number
): number {
  if (weightingMode === 'inverse_standings') {
    const range = Math.max(1, bestRankInPool - worstRankInPool + 1)
    const inverseRank = bestRankInPool - row.rank + 1
    return Math.max(1, inverseRank)
  }
  if (weightingMode === 'inverse_points_for' || weightingMode === 'inverse_max_pf') {
    const pf = weightingMode === 'inverse_max_pf' ? row.maxPf : row.pointsFor
    return Math.max(0.1, 1000 - pf)
  }
  return 1
}

/**
 * Build lottery-eligible teams with weights and odds for display.
 */
export function buildEligibleTeamsWithOdds(
  eligible: StandingsRow[],
  weightingMode: LotteryWeightingMode
): LotteryEligibleTeam[] {
  if (eligible.length === 0) return []
  const worstRank = Math.max(...eligible.map((r) => r.rank))
  const bestRank = Math.min(...eligible.map((r) => r.rank))
  const withWeight = eligible.map((r) => ({
    ...r,
    weight: computeWeight(r, weightingMode, worstRank, bestRank),
  }))
  const totalWeight = withWeight.reduce((s, r) => s + r.weight, 0)
  return withWeight.map((r) => ({
    rosterId: r.rosterId,
    displayName: r.displayName,
    teamIndex: r.teamIndex,
    rank: r.rank,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: r.pointsFor,
    weight: r.weight,
    oddsPercent: totalWeight > 0 ? (r.weight / totalWeight) * 100 : 0,
  }))
}
