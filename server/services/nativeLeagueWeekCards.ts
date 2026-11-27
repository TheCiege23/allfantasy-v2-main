import 'server-only'

import { prisma } from '@/lib/prisma'
import { isNflRedraftScoringStarterSlot } from '@/lib/scoring-runtime'
import { loadWeekLineups, weekSlotType } from '@/lib/redraft/weekLineupSlots'
import { afSideTotal, loadMatchupAfProjections } from '@/lib/matchup-center/afProjections'
import { computeMatchupWinProbability } from '@/lib/matchup-center/winProbability'
import { managerArtUrl } from '@/lib/core-app/leagueArt'
import type { NativeGameStatus } from '@/lib/matchup-center/nativeMatchupModel'
import { loadNativeMatchupSeason, loadNativeScoreboard } from './nativeMatchupCenter'

/**
 * The League page's matchups (owner, 2026-11-27: "those 3 things are the only things on the league page" —
 * Sleeper's League tab is every matchup this week, the standings and the activity). One card per game in
 * the week, built from the SAME reads the Matchup tab uses so the two never disagree:
 *   - the games and their points: `loadNativeScoreboard` (the league's own schedule and bracket);
 *   - each side's starters: the saved week lineup (`weekSlotType`) over the active roster;
 *   - each side's projection: AF projections for those starters (`loadMatchupAfProjections`, summed the way
 *     `afSideTotal` sums the Matchup tab's), and the win chance from `computeMatchupWinProbability`.
 * A side with no priced starter has no projection and the game no win chance, rather than a made-up one.
 */

export type LeagueWeekCardTeam = {
  rosterId: string
  name: string
  avatarUrl: string | null
  /** "3-1" or "3-1-1"; null before any game. */
  record: string | null
  /** This week's points once scoring has started; null before. */
  points: number | null
  /** AF projection for the week's starters; null when none of them is priced. */
  projected: number | null
  isYou: boolean
}

export type LeagueWeekCard = {
  id: string
  /** "Quarterfinal", a playoff round, … ; null for a regular-season game. */
  label: string | null
  status: NativeGameStatus
  home: LeagueWeekCardTeam
  /** Null on a bye. */
  away: LeagueWeekCardTeam | null
  /** Chance the HOME side wins, 0–1, before the game is final. Null when either side is unpriced. */
  homeWinProbability: number | null
  mine: boolean
}

export type LeagueWeekCards = { season: number; week: number; cards: LeagueWeekCard[] }

type LeagueArg = Parameters<typeof loadNativeScoreboard>[0]['league']

const recordOf = (r: { wins: number; losses: number; ties: number }): string | null =>
  r.wins + r.losses + r.ties === 0 ? null : r.ties > 0 ? `${r.wins}-${r.losses}-${r.ties}` : `${r.wins}-${r.losses}`

export async function loadNativeLeagueWeekCards(params: { league: LeagueArg; viewerUserId: string; week?: number }): Promise<LeagueWeekCards | null> {
  const { league, viewerUserId } = params
  const [season, board] = await Promise.all([
    loadNativeMatchupSeason(league, league.season),
    loadNativeScoreboard({ league, viewerUserId, week: params.week }),
  ])
  if (!season || !board) return null
  const { week } = board
  const rosterById = new Map(season.rosters.map((r) => [r.id, r]))
  const rosterIds = [...new Set(board.games.flatMap((g) => [g.home.rosterId, ...(g.away ? [g.away.rosterId] : [])]))]

  // Each side's starters this week: the saved lineup over the active roster, as the Matchup tab reads it.
  const [players, lineups] = rosterIds.length
    ? await Promise.all([
        prisma.redraftRosterPlayer.findMany({
          where: { rosterId: { in: rosterIds }, droppedAt: null },
          select: { rosterId: true, playerId: true, slotType: true },
        }),
        loadWeekLineups(prisma, { redraftRosterIds: rosterIds, season: season.season, week }),
      ])
    : [[], new Map()]
  const startersByRoster = new Map<string, string[]>()
  for (const p of players) {
    if (!isNflRedraftScoringStarterSlot(weekSlotType(p, lineups))) continue
    const list = startersByRoster.get(p.rosterId) ?? []
    list.push(p.playerId)
    startersByRoster.set(p.rosterId, list)
  }
  const afByPlayer = await loadMatchupAfProjections({
    leagueId: league.id,
    playerIds: [...new Set([...startersByRoster.values()].flat())],
    season: season.season,
    week,
    sport: String(league.sport ?? ''),
    platform: league.platform ?? null,
    leagueSettings: league.settings,
  }).catch(() => new Map<string, number>())
  const projectedOf = (rosterId: string): number | null =>
    afSideTotal((startersByRoster.get(rosterId) ?? []).map((id) => ({ afProjectedPoints: afByPlayer.get(id) ?? null }))).total

  const team = (side: { rosterId: string; teamName: string; totalPoints: number | null }, status: NativeGameStatus): LeagueWeekCardTeam => {
    const r = rosterById.get(side.rosterId)
    return {
      rosterId: side.rosterId,
      name: side.teamName,
      avatarUrl: r ? managerArtUrl({ avatarUrl: r.avatarUrl, platform: league.platform }) : null,
      record: r ? recordOf(r) : null,
      points: status === 'upcoming' ? null : side.totalPoints,
      projected: projectedOf(side.rosterId),
      isYou: Boolean(r && (r.ownerId === viewerUserId || r.managerUserId === viewerUserId)),
    }
  }

  const cards = board.games.map((g): LeagueWeekCard => {
    const home = team(g.home, g.status)
    const away = g.away ? team(g.away, g.status) : null
    const homeWinProbability =
      g.status !== 'final' && away && home.projected != null && away.projected != null
        ? computeMatchupWinProbability(
            { projectedTotal: home.projected, projectedTotalIncludesFallback: false },
            { projectedTotal: away.projected, projectedTotalIncludesFallback: false },
          )
        : null
    // Your side first, as on Sleeper's card.
    const flip = Boolean(away?.isYou && !home.isYou)
    return {
      id: g.id,
      label: g.label,
      status: g.status,
      home: flip && away ? away : home,
      away: flip ? home : away,
      homeWinProbability: homeWinProbability == null ? null : flip ? 1 - homeWinProbability : homeWinProbability,
      mine: g.mine,
    }
  })
  return { season: board.season, week, cards }
}
