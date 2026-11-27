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
  /** How many games the two teams play each other this week (a league that plays several a week); points add up. */
  games: number
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

  /*
   * One card per pairing. A league that plays several games a week (live check, 2026-11-27: a 16-team NBA league
   * whose week-7 schedule pairs each team with the same opponent three times — 24 games, 8 pairings) would
   * otherwise draw three identical cards. The pairing's points are its games' points added up; the projection
   * is already the week's, so it is not multiplied.
   */
  type Group = { games: typeof board.games }
  const groups = new Map<string, Group>()
  for (const g of board.games) {
    const key = [g.home.rosterId, g.away?.rosterId ?? 'bye'].sort().join('|') + (g.label ? `|${g.label}` : '')
    const group = groups.get(key) ?? { games: [] }
    group.games.push(g)
    groups.set(key, group)
  }
  const sumPoints = (vals: Array<number | null>): number | null =>
    vals.some((v) => v != null) ? Math.round(vals.reduce<number>((t, v) => t + (v ?? 0), 0) * 100) / 100 : null

  const cards = [...groups.values()].map(({ games }): LeagueWeekCard => {
    const g = games[0]
    const status: NativeGameStatus = games.some((x) => x.status === 'live')
      ? 'live'
      : games.every((x) => x.status === 'final')
        ? 'final'
        : games.some((x) => x.status === 'final') ? 'live' : 'upcoming'
    const sideOf = (rosterId: string) => (x: (typeof games)[number]) => (x.home.rosterId === rosterId ? x.home : x.away)
    const homeSide = { ...g.home, totalPoints: sumPoints(games.map((x) => (x.status === 'upcoming' ? null : sideOf(g.home.rosterId)(x)?.totalPoints ?? null))) }
    const awaySide = g.away ? { ...g.away, totalPoints: sumPoints(games.map((x) => (x.status === 'upcoming' ? null : sideOf(g.away!.rosterId)(x)?.totalPoints ?? null))) } : null
    const home = team(homeSide, status)
    const away = awaySide ? team(awaySide, status) : null
    const homeWinProbability =
      status !== 'final' && away && home.projected != null && away.projected != null
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
      status,
      home: flip && away ? away : home,
      away: flip ? home : away,
      homeWinProbability: homeWinProbability == null ? null : flip ? 1 - homeWinProbability : homeWinProbability,
      mine: games.some((x) => x.mine),
      games: games.length,
    }
  })
  // Your game first, then the rest in schedule order.
  cards.sort((a, b) => Number(b.mine) - Number(a.mine))
  return { season: board.season, week, cards }
}
