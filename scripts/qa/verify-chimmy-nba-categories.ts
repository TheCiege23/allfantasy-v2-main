import { prisma } from '@/lib/prisma'
import { buildOtherSportStartSit } from '@/lib/chimmy/otherSportStartSit'
import { dailySportWeekForInstant, resolveDailySportWeekWindow } from '@/lib/season-week/dailySportSeasonStarts'

const leagueId = 'chimmy-3164-qa-categories'
const userId = 'bracket-qa-admin'
const source = 'chimmy_nba_category_qa'
const sport = 'NBA'

async function main() {
  if (process.env.CHIMMY_STAGING_PROJECT_ID !== 'b3cd0239-9cb1-4c22-9d76-533d91d26f36') throw new Error('Isolated staging required')
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { userId: true, tenantId: true, season: true } })
  if (league?.userId !== userId || league.tenantId !== 'chimmy-release-3164-rules-fixture-tenant') throw new Error('Seed the isolated decision league first')
  const now = new Date()
  const week = dailySportWeekForInstant(sport, league.season, now)
  if (week == null) throw new Error('Run during a current NBA scoring week')
  const window = resolveDailySportWeekWindow(sport, league.season, week)
  if (!window || now.getTime() + 3_600_000 >= window.end.getTime()) throw new Error('Run during a current NBA scoring week')
  const start = new Date(now.getTime() + 3_600_000)
  const games = [
    { gameId: source + '-bos', homeTeam: 'BOS', awayTeam: 'NYK' },
    { gameId: source + '-chi', homeTeam: 'CHI', awayTeam: 'LAL' },
  ].map((g) => ({ ...g, startTime: start.toISOString(), status: 'scheduled', seasonType: 'regular' }))
  const expiresAt = new Date(now.getTime() + 86_400_000)
  await prisma.$transaction([
    prisma.sportsGame.createMany({ data: games.map((g) => ({ sport, source: 'espn', season: league.season, seasonType: 'regular', externalId: g.gameId, homeTeam: g.homeTeam,
      awayTeam: g.awayTeam, status: 'scheduled', startTime: start, expiresAt })) }),
    prisma.playerGameStat.createMany({ data: [
      { index: 0, team: 'BOS', stats: { points: 30, assists: 6, field_goals_made: 10, field_goals_attempted: 20 } },
      { index: 2, team: 'CHI', stats: { points: 20, assists: 9, field_goals_made: 6, field_goals_attempted: 10 } },
    ].flatMap(({ index, team, stats }) => [1, 2, 3].map((i) => ({
      source, sportType: sport, season: league.season, playerId: leagueId + '-player-' + index,
      gameId: source + '-' + index + '-' + i, weekOrRound: week,
      gameDate: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)),
      statPayload: {}, normalizedStatMap: { stats, seasonType: 'regular' }, team,
    }))) }),
  ])
  try {
    const answer = await buildOtherSportStartSit({ leagueId, userId, players: ['Avery Lockhart', 'Jordan Ashford'] })
    const expected = ['PTS: Avery Lockhart (30.00 vs 20.00)', 'AST: Jordan Ashford (6.00 vs 9.00)',
      'FG%: Jordan Ashford (0.50 vs 0.60)', 'No overall category winner']
    if (!answer.ready || !expected.every((part) => answer.text.includes(part))) throw new Error(answer.text)
    console.log(JSON.stringify({ week, ready: true, points: 'Avery Lockhart', assists: 'Jordan Ashford', fieldGoalPercentage: 'Jordan Ashford' }))
  } finally {
    await prisma.$transaction([
      prisma.sportsGame.deleteMany({ where: { sport, source: 'espn', externalId: { in: games.map((g) => g.gameId) } } }),
      prisma.playerGameStat.deleteMany({ where: { sportType: sport, source, playerId: { in: [leagueId + '-player-0', leagueId + '-player-2'] } } }),
    ])
  }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : 'Category verification failed'); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
