import { prisma } from '@/lib/prisma'
import { resolveCurrentWeekForLeague } from './currentWeek'
import { asIds, rosterCandidates } from './dash3aPanels'
import { leagueDisplayName } from './leagueHome'
import { winProbabilityFor, type SideProjections } from './matchupProjections'
import { loadMatchupSides, matchupCurrentPoints } from './matchupWinInputs'

/**
 * "What does this one player do to my week, league by league?" — the portfolio
 * exposure breakdown.
 *
 * User decisions, 2026-09-14: per league, your win chance now vs. with him scoring 0,
 * from the SAME model the Matchup screen and the swing alerts use; shown when a player
 * in the home exposure card is tapped; any player on 2+ of your rosters.
 *
 * ⚠ "SCORES 0" MEANS "ADDS NOTHING MORE FROM HERE". The sides carry each starter's
 * league-rescored projection but not his own points so far — current points arrive as
 * a TEAM total, which `winProbabilityFor` banks on the first starter. So his remaining
 * projection is removed and whatever the team has already banked stays. Before kickoff
 * that is exactly "he scores 0"; mid-game it is "he adds nothing more", which is the
 * question a manager deciding whether to bench him is actually asking.
 *
 * ⚠ HE STAYS IN THE LINEUP AT ZERO, NOT DROPPED. Removing him would change the starter
 * set the model's coverage guards look at; a starter who scores nothing is still a slot,
 * and that is the scenario being priced.
 */

export type WinImpact =
  /** Both numbers from the same model, the same week, the same current points. */
  | { kind: 'priced'; now: number; without: number }
  /** He is on this roster but not in this week's starting lineup, so he changes nothing. */
  | { kind: 'not_starting' }
  /** The matchup cannot be priced — the model's own reason, surfaced verbatim. */
  | { kind: 'unpriced'; reason: string }

/** Where he sits on your roster in that league. */
export type ImpactSlot = 'starter' | 'bench' | 'ir' | 'taxi'

export type LeagueImpactRow = {
  leagueId: string
  leagueName: string
  platform: string | null
  slot: ImpactSlot
  /** `no_matchup`: no current-week matchup could be resolved for this league (the reason says why). */
  impact: WinImpact | { kind: 'no_matchup'; reason: string }
}

export type PlayerLeagueImpact = {
  /** The roster id the breakdown was built for. */
  playerId: string
  /** One row per league of yours holding him — starters first, then by win-chance drop. */
  rows: LeagueImpactRow[]
  /** Leagues holding him that were left unpriced by the per-request bound, stated rather than hidden. */
  notPriced: number
}

/** Your side with this player's remaining projection set to zero. Never mutates `sides`. */
export function sidesWithoutPlayer(sides: SideProjections, rosterPlayerId: string): SideProjections {
  return {
    ...sides,
    you: {
      ...sides.you,
      starters: sides.you.starters.map((p) =>
        p.playerId === rosterPlayerId ? { ...p, projectedPoints: 0 } : p,
      ),
    },
  }
}

/**
 * The impact of one of YOUR starters on one matchup.
 *
 * `rosterPlayerId` is the id as the roster stores it (`lineup[].playerId`), which is
 * the platform's own id — the same key `loadSideProjections` keeps on purpose.
 */
export function winImpactFor(
  sides: SideProjections,
  currentPoints: { you: number; opponent: number },
  rosterPlayerId: string,
): WinImpact {
  if (!sides.you.lineup.some((slot) => slot.playerId === rosterPlayerId)) {
    return { kind: 'not_starting' }
  }
  const now = winProbabilityFor(sides, currentPoints)
  if (!now.available) return { kind: 'unpriced', reason: now.reason }
  const without = winProbabilityFor(sidesWithoutPlayer(sides, rosterPlayerId), currentPoints)
  if (!without.available) return { kind: 'unpriced', reason: without.reason }
  return { kind: 'priced', now: now.data.pWin, without: without.data.pWin }
}

/**
 * Leagues priced per request. Each costs a week resolve, a matchup read, a roster read
 * and a projection read; past this the rest are counted in `notPriced`, not dropped.
 */
export const MAX_PRICED_LEAGUES = 8

/** Where he sits on one roster, by the same `playerData` lists the exposure count reads. */
export function slotOf(playerData: unknown, rosterPlayerId: string): ImpactSlot | null {
  const pd = (playerData ?? {}) as Record<string, unknown>
  if (asIds(pd.starters).includes(rosterPlayerId)) return 'starter'
  if (asIds(pd.reserve).includes(rosterPlayerId)) return 'ir'
  if (asIds(pd.taxi).includes(rosterPlayerId)) return 'taxi'
  if (asIds(pd.players).includes(rosterPlayerId)) return 'bench'
  return null
}

type ClaimedTeam = { leagueId: string; platformUserId: string | null; externalId: string | null }

/** This week's impact in one league where he starts for you — the Matchup screen's own steps. */
async function priceLeague(
  league: { id: string; platformLeagueId: string | null },
  team: ClaimedTeam,
  userId: string,
  rosterPlayerId: string,
): Promise<LeagueImpactRow['impact']> {
  if (!league.platformLeagueId) {
    return { kind: 'no_matchup', reason: 'this league has no platform id, so its weekly results cannot be located' }
  }
  if (!team.externalId) {
    return { kind: 'no_matchup', reason: 'we cannot tell which team in this league is yours' }
  }
  const latest = await resolveCurrentWeekForLeague(league.platformLeagueId, null)
  if (!latest) return { kind: 'no_matchup', reason: 'no weekly results stored for this league' }

  const rows = await prisma.weeklyMatchup.findMany({
    where: { leagueId: league.platformLeagueId, seasonYear: latest.seasonYear, week: latest.week },
    select: { rosterId: true, matchupId: true, pointsFor: true, pointsAgainst: true },
  })
  const mine = rows.find((r) => r.rosterId === team.externalId)
  if (!mine) return { kind: 'no_matchup', reason: `your team has no result stored for week ${latest.week}` }
  const opponentRow =
    mine.matchupId != null ? rows.find((r) => r.matchupId === mine.matchupId && r.rosterId !== mine.rosterId) : undefined
  if (!opponentRow) return { kind: 'no_matchup', reason: `no opponent is paired with your team in week ${latest.week}` }

  const oppTeam = await prisma.leagueTeam.findFirst({
    where: { leagueId: league.id, externalId: String(opponentRow.rosterId) },
    select: { platformUserId: true },
  })

  const sides = await loadMatchupSides({
    leagueId: league.id,
    season: latest.seasonYear,
    week: latest.week,
    userId,
    you: { platformUserId: team.platformUserId, externalId: team.externalId },
    opponent: { platformUserId: oppTeam?.platformUserId ?? null, rosterId: String(opponentRow.rosterId) },
  })
  if (!sides) {
    return { kind: 'unpriced', reason: 'we could not match both sides of this matchup to an imported roster' }
  }
  return winImpactFor(sides, matchupCurrentPoints(mine, opponentRow), rosterPlayerId)
}

const dropOf = (row: LeagueImpactRow) => (row.impact.kind === 'priced' ? row.impact.now - row.impact.without : -1)

/**
 * For each of the signed-in user's claimed teams holding this player: where he sits,
 * and — where he starts — this week's win chance now vs. with him adding nothing more.
 *
 * Only YOUR claimed teams are read, so no other manager's roster can appear. A league
 * where he is on the bench, IR or taxi needs no matchup read: he changes nothing there.
 */
export async function getPlayerLeagueImpact(args: {
  userId: string
  rosterPlayerId: string
}): Promise<PlayerLeagueImpact> {
  const { userId, rosterPlayerId } = args
  const empty: PlayerLeagueImpact = { playerId: rosterPlayerId, rows: [], notPriced: 0 }

  const teams: ClaimedTeam[] = await prisma.leagueTeam.findMany({
    where: { claimedByUserId: userId },
    select: { leagueId: true, platformUserId: true, externalId: true },
  })
  if (teams.length === 0) return empty

  const rosters = await prisma.roster.findMany({
    where: {
      OR: teams.map((t) => ({ leagueId: t.leagueId, platformUserId: { in: rosterCandidates(t, userId) } })),
    },
    select: { leagueId: true, playerData: true },
  })

  // One roster per league, as the exposure count reads them.
  const slotByLeague = new Map<string, ImpactSlot>()
  const seen = new Set<string>()
  for (const r of rosters) {
    if (seen.has(r.leagueId)) continue
    seen.add(r.leagueId)
    const slot = slotOf(r.playerData, rosterPlayerId)
    if (slot) slotByLeague.set(r.leagueId, slot)
  }
  if (slotByLeague.size === 0) return empty

  const leagues = await prisma.league.findMany({
    where: { id: { in: [...slotByLeague.keys()] } },
    select: { id: true, name: true, platform: true, platformLeagueId: true },
  })
  const teamByLeague = new Map(teams.map((t) => [t.leagueId, t]))

  const holding = leagues
    .map((league) => ({ league, slot: slotByLeague.get(league.id)!, team: teamByLeague.get(league.id)! }))
    .sort((a, b) => leagueDisplayName(a.league.name).localeCompare(leagueDisplayName(b.league.name)))
  const starting = holding.filter((h) => h.slot === 'starter')
  const priced = starting.slice(0, MAX_PRICED_LEAGUES)
  const notPriced = starting.length - priced.length

  const startingRows = await Promise.all(
    priced.map(async ({ league, slot, team }): Promise<LeagueImpactRow> => ({
      leagueId: league.id,
      leagueName: leagueDisplayName(league.name),
      platform: league.platform ?? null,
      slot,
      impact: await priceLeague(league, team, userId, rosterPlayerId).catch(() => ({
        kind: 'no_matchup' as const,
        reason: 'this league’s matchup could not be read just now',
      })),
    })),
  )
  const otherRows: LeagueImpactRow[] = holding
    .filter((h) => h.slot !== 'starter')
    .map(({ league, slot }) => ({
      leagueId: league.id,
      leagueName: leagueDisplayName(league.name),
      platform: league.platform ?? null,
      slot,
      impact: { kind: 'not_starting' },
    }))

  // Starters first, biggest drop first; a stable name order underneath from the sort above.
  startingRows.sort((a, b) => dropOf(b) - dropOf(a))
  return { playerId: rosterPlayerId, rows: [...startingRows, ...otherRows], notPriced }
}
