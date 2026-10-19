import 'server-only'

import { prisma } from '@/lib/prisma'
import { postChimmyMoment } from '@/lib/league-chat/chimmyMoments'

export type NativeRecapGame = {
  home: string
  away: string
  homeScore: number
  awayScore: number
}

const points = (value: number) => value.toFixed(1)

/** Only finalized head-to-head results enter a recap. */
export function buildNativeWeeklyRecap(input: {
  leagueName: string
  season: number
  week: number
  games: NativeRecapGame[]
  leaders: Array<{ name: string; wins: number; losses: number; ties: number }>
}): string {
  const { games } = input
  const top = [...games.flatMap((game) => [
    { name: game.home, score: game.homeScore },
    { name: game.away, score: game.awayScore },
  ])].sort((a, b) => b.score - a.score)[0]
  const lines = [
    `📺 Week ${input.week} recap — ${input.leagueName} (${input.season})`,
    '',
    '🏈 Results',
    ...games.map((game) => {
      if (game.homeScore === game.awayScore) {
        return `  ${game.home} ${points(game.homeScore)} tied ${game.away} ${points(game.awayScore)}`
      }
      const homeWins = game.homeScore > game.awayScore
      const winner = homeWins ? game.home : game.away
      const loser = homeWins ? game.away : game.home
      const winningScore = homeWins ? game.homeScore : game.awayScore
      const losingScore = homeWins ? game.awayScore : game.homeScore
      return `  ${winner} ${points(winningScore)} def. ${loser} ${points(losingScore)}`
    }),
  ]
  if (input.leaders.length > 0) {
    lines.push('', `📈 Top of the table: ${input.leaders.slice(0, 3).map((r, index) =>
      `${index + 1}. ${r.name} (${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''})`,
    ).join(' · ')}`)
  }
  if (top) lines.push('', `🏆 Top score: ${top.name}, ${points(top.score)}`)
  lines.push('', 'Every result comes from finalized AllFantasy matchups.')
  return lines.join('\n')
}

/**
 * The recap text for the league's latest fully-final week, without posting it. Split from the post
 * so the commissioner's review mode (lib/recap-review) can hold the text for editing in between.
 */
export async function buildNativeRecapForLeague(input: {
  leagueId: string
  leagueName: string
  seasonYear: number
}): Promise<{ ok: true; season: number; week: number; text: string } | { ok: false; reason: string }> {
  const season = await prisma.redraftSeason.findUnique({
    where: { leagueId_season: { leagueId: input.leagueId, season: input.seasonYear } },
    select: { id: true, season: true },
  })
  if (!season) return { ok: false, reason: 'no current season' }

  const latest = await prisma.redraftMatchup.findFirst({
    where: { seasonId: season.id, status: 'final', isMedianMatchup: false, awayRosterId: { not: null } },
    orderBy: { week: 'desc' },
    select: { week: true },
  })
  if (!latest) return { ok: false, reason: 'no finalized week' }
  const rows = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week: latest.week, isMedianMatchup: false, awayRosterId: { not: null } },
    select: {
      status: true,
      homeScore: true,
      awayScore: true,
      homeRoster: { select: { teamName: true, ownerName: true } },
      awayRoster: { select: { teamName: true, ownerName: true } },
    },
  })
  if (rows.length === 0 || rows.some((row) => row.status !== 'final' || !row.awayRoster)) {
    return { ok: false, reason: 'week is not final' }
  }
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id },
    select: { teamName: true, ownerName: true, wins: true, losses: true, ties: true, pointsFor: true },
    orderBy: [{ wins: 'desc' }, { pointsFor: 'desc' }],
    take: 3,
  })
  const name = (roster: { teamName: string | null; ownerName: string } | null) =>
    roster?.teamName?.trim() || roster?.ownerName?.trim() || 'Open team'
  const text = buildNativeWeeklyRecap({
    leagueName: input.leagueName,
    season: season.season,
    week: latest.week,
    games: rows.map((row) => ({
      home: name(row.homeRoster),
      away: name(row.awayRoster),
      homeScore: row.homeScore,
      awayScore: row.awayScore,
    })),
    leaders: rosters.map((roster) => ({
      name: name(roster), wins: roster.wins, losses: roster.losses, ties: roster.ties,
    })),
  })
  return { ok: true, season: season.season, week: latest.week, text }
}

/** Post a native recap's text as Chimmy, deduped per league per week like every weekly recap. */
export async function postNativeRecapText(input: {
  leagueId: string
  season: number | string
  week: number
  text: string
}): Promise<{ posted: boolean; reason?: string }> {
  const result = await postChimmyMoment({
    leagueId: input.leagueId,
    kind: 'weekly_awards',
    dedupeKey: `${input.season}:${input.week}`,
    text: input.text,
    card: { weeklyRecap: true, season: String(input.season), week: input.week },
    messageType: 'system',
  })
  return result.posted ? { posted: true } : { posted: false, reason: result.reason }
}

export async function postNativeWeeklyRecap(input: {
  leagueId: string
  leagueName: string
  seasonYear: number
}): Promise<{ posted: boolean; reason?: string }> {
  const built = await buildNativeRecapForLeague(input)
  if (!built.ok) return { posted: false, reason: built.reason }
  return postNativeRecapText({ leagueId: input.leagueId, season: built.season, week: built.week, text: built.text })
}
