import 'server-only'

import { prisma } from '@/lib/prisma'
import { postChimmyMoment } from '@/lib/league-chat/chimmyMoments'
import { describeExtraMatchupReason, extraMatchupResults, readExtraMatchupRecord } from '@/lib/redraft/oddTeamExtraMatchupRules'
import { buildStorylineFacts, rivalryPairKey, storylineLines } from '@/lib/league-chat/nativeRecapStorylines'
import { nativeSeatMap } from '@/lib/redraft/nativePlayerWeeklyScores'

export type NativeRecapGame = {
  home: string
  away: string
  homeScore: number
  awayScore: number
  /** An odd-team league's extra matchup (home = the leftover team): "last week's top scorer". */
  extraReason?: string
}

const points = (value: number) => value.toFixed(1)

/** Only finalized head-to-head results enter a recap. */
export function buildNativeWeeklyRecap(input: {
  leagueName: string
  season: number
  week: number
  games: NativeRecapGame[]
  leaders: Array<{ name: string; wins: number; losses: number; ties: number }>
  /** The week's storylines (lib/league-chat/nativeRecapStorylines.ts), already worded. */
  storylines?: string[]
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
      const tag = game.extraReason ? ` — extra matchup (${game.away}: ${game.extraReason})` : ''
      if (game.homeScore === game.awayScore) {
        return `  ${game.home} ${points(game.homeScore)} tied ${game.away} ${points(game.awayScore)}${tag}`
      }
      const homeWins = game.homeScore > game.awayScore
      const winner = homeWins ? game.home : game.away
      const loser = homeWins ? game.away : game.home
      const winningScore = homeWins ? game.homeScore : game.awayScore
      const losingScore = homeWins ? game.awayScore : game.homeScore
      return `  ${winner} ${points(winningScore)} def. ${loser} ${points(losingScore)}${tag}`
    }),
  ]
  if (input.leaders.length > 0) {
    lines.push('', `📈 Top of the table: ${input.leaders.slice(0, 3).map((r, index) =>
      `${index + 1}. ${r.name} (${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''})`,
    ).join(' · ')}`)
  }
  if (top) lines.push('', `🏆 Top score: ${top.name}, ${points(top.score)}`)
  if (input.storylines && input.storylines.length > 0) lines.push('', '📰 Storylines', ...input.storylines)
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
  /*
   * 🛑 THE CALENDAR YEAR IS NOT THE SEASON. The weekly sweep passes `new Date().getUTCFullYear()`, but an
   * NBA or NHL season that tips off in October is stored under the year it STARTED — so from January to
   * April every NBA/NHL league read "no current season" and got no recap all winter. The year asked for
   * still wins when it exists; otherwise the league's latest earlier season is the current one.
   */
  const season =
    (await prisma.redraftSeason.findUnique({
      where: { leagueId_season: { leagueId: input.leagueId, season: input.seasonYear } },
      select: { id: true, season: true },
    })) ??
    (await prisma.redraftSeason.findFirst({
      where: { leagueId: input.leagueId, season: { lt: input.seasonYear } },
      orderBy: [{ season: 'desc' }, { createdAt: 'desc' }],
      select: { id: true, season: true },
    }))
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
  // The table's own order (`playoffSeed`, written by updateStandings by win %), not raw wins: an
  // odd-team league plays unequal numbers of games.
  const rosters = await prisma.redraftRoster.findMany({
    where: { seasonId: season.id },
    select: { teamName: true, ownerName: true, wins: true, losses: true, ties: true, pointsFor: true },
    orderBy: [{ playoffSeed: 'asc' }, { wins: 'desc' }, { pointsFor: 'desc' }],
    take: 3,
  })
  const name = (roster: { teamName: string | null; ownerName: string } | null) =>
    roster?.teamName?.trim() || roster?.ownerName?.trim() || 'Open team'

  // An odd-team league's extra matchup that week (lib/redraft/oddTeamExtraMatchupRules.ts).
  const weekRows = await prisma.redraftMatchup.findMany({
    where: { seasonId: season.id, week: latest.week, isMedianMatchup: false },
    select: { week: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true, status: true, lineupSnapshots: true },
  })
  const extras = extraMatchupResults(weekRows)
  const extraGames: NativeRecapGame[] = []
  if (extras.length > 0) {
    const all = await prisma.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true, teamName: true, ownerName: true } })
    const byId = new Map(all.map((r) => [r.id, r]))
    for (const x of extras) {
      const record = readExtraMatchupRecord(weekRows.find((r) => !r.awayRosterId && r.homeRosterId === x.leftoverRosterId)?.lineupSnapshots)
      extraGames.push({
        home: name(byId.get(x.leftoverRosterId) ?? null),
        away: name(byId.get(x.opponentRosterId) ?? null),
        homeScore: x.leftoverScore,
        awayScore: x.opponentScore,
        extraReason: record ? describeExtraMatchupReason(record.reason) : 'extra matchup',
      })
    }
  }
  const storylines = await loadNativeRecapStorylines({
    leagueId: input.leagueId,
    seasonId: season.id,
    seasonYear: season.season,
    week: latest.week,
  }).catch(() => [] as string[])
  const text = buildNativeWeeklyRecap({
    leagueName: input.leagueName,
    season: season.season,
    week: latest.week,
    games: [
      ...rows.map((row) => ({
        home: name(row.homeRoster),
        away: name(row.awayRoster),
        homeScore: row.homeScore,
        awayScore: row.awayScore,
      })),
      ...extraGames,
    ],
    leaders: rosters.map((roster) => ({
      name: name(roster), wins: roster.wins, losses: roster.losses, ties: roster.ties,
    })),
    storylines,
  })
  return { ok: true, season: season.season, week: latest.week, text }
}

const WEEK_MS = 7 * 86_400_000

/**
 * Load the facts behind the week's storylines and word them. Every read degrades to "no storyline" rather than failing
 * the recap: a recap without storylines is still a correct recap.
 */
async function loadNativeRecapStorylines(input: { leagueId: string; seasonId: string; seasonYear: number; week: number }): Promise<string[]> {
  const [games, rosters, links, rivalryRecords, rivalryWeekRow, redraftTrades, afTrades] = await Promise.all([
    prisma.redraftMatchup.findMany({
      where: { seasonId: input.seasonId, status: 'final', isMedianMatchup: false, type: 'regular', awayRosterId: { not: null }, week: { lte: input.week } },
      select: { week: true, homeRosterId: true, awayRosterId: true, homeScore: true, awayScore: true },
    }),
    prisma.redraftRoster.findMany({ where: { seasonId: input.seasonId }, select: { id: true, teamName: true, ownerName: true } }),
    prisma.roster.findMany({ where: { leagueId: input.leagueId }, select: { id: true, redraftRosterId: true } }),
    prisma.rivalryRecord.findMany({ where: { leagueId: input.leagueId, rivalryScore: { gt: 0 } }, select: { managerAId: true, managerBId: true } }).catch(() => []),
    prisma.leagueAuditLog.findFirst({ where: { leagueId: input.leagueId, actionType: 'schedule_rivalry_week' }, orderBy: { createdAt: 'desc' }, select: { metadata: true } }).catch(() => null),
    prisma.redraftTradeProposal.findMany({
      where: { seasonId: input.seasonId, status: { in: ['accepted', 'processed'] }, processedAt: { gte: new Date(Date.now() - WEEK_MS) } },
      select: { proposerRosterId: true, receiverRosterId: true },
    }).catch(() => []),
    prisma.afLeagueTrade.findMany({
      where: { leagueId: input.leagueId, status: 'processed', processedAt: { gte: new Date(Date.now() - WEEK_MS) } },
      select: { proposerRosterId: true, receiverRosterId: true },
    }).catch(() => []),
  ])
  const seasonIds = new Set(rosters.map((r) => r.id))
  const toRedraft = new Map(links.filter((l) => l.redraftRosterId && seasonIds.has(l.redraftRosterId)).map((l) => [l.id, l.redraftRosterId!]))
  const rivalryPairs = new Set<string>()
  for (const r of rivalryRecords) {
    const a = toRedraft.get(r.managerAId)
    const b = toRedraft.get(r.managerBId)
    if (a && b) rivalryPairs.add(rivalryPairKey(a, b))
  }
  const rivalryWeekMeta = rivalryWeekRow?.metadata as { week?: unknown } | null | undefined
  const trades = [
    ...redraftTrades.map((t) => ({ aId: t.proposerRosterId, bId: t.receiverRosterId })),
    ...afTrades
      .map((t) => ({ aId: toRedraft.get(t.proposerRosterId) ?? '', bId: toRedraft.get(t.receiverRosterId) ?? '' }))
      .filter((t) => t.aId && t.bId),
  ]

  // Pickups: waiver or free-agent adds in the last two weeks who started this week and scored.
  const adds = await prisma.redraftRosterPlayer
    .findMany({
      where: { rosterId: { in: [...seasonIds] }, acquisitionType: { in: ['waiver', 'free_agent'] }, droppedAt: null, addedAt: { gte: new Date(Date.now() - 2 * WEEK_MS) } },
      select: { rosterId: true, playerId: true, playerName: true },
    })
    .catch(() => [])
  let pickups: Array<{ rosterId: string; playerName: string; points: number }> = []
  if (adds.length > 0) {
    const scored = await prisma.leaguePlayerWeeklyScore
      .findMany({
        where: { leagueId: input.leagueId, seasonYear: input.seasonYear, week: input.week, isStarter: true, playerId: { in: adds.map((a) => a.playerId) } },
        select: { playerId: true, rosterId: true, points: true },
      })
      .catch(() => [])
    const seats = nativeSeatMap([...seasonIds])
    pickups = adds.flatMap((a) => {
      const row = scored.find((s) => s.playerId === a.playerId && s.rosterId != null && seats.get(s.rosterId) === a.rosterId)
      return row ? [{ rosterId: a.rosterId, playerName: a.playerName, points: row.points }] : []
    })
  }

  const facts = buildStorylineFacts({
    week: input.week,
    seasonGames: games.map((g) => ({ week: g.week, homeId: g.homeRosterId, awayId: g.awayRosterId!, homeScore: g.homeScore, awayScore: g.awayScore })),
    rivalryPairs,
    rivalryWeek: Number(rivalryWeekMeta?.week) === input.week,
    trades,
    pickups,
  })
  const nameOf = new Map(rosters.map((r) => [r.id, r.teamName?.trim() || r.ownerName?.trim() || 'Open team']))
  return storylineLines(facts, (id) => nameOf.get(id) ?? 'Open team')
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
