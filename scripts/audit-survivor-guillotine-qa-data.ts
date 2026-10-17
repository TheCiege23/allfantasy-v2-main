/** Read-only inventory of the isolated QA branch before live-data rehearsal. */
import { prisma } from '../lib/prisma'
import { calculateCappedGameScores, scoreNbaGame } from '../lib/survivor-guillotine/capped-scoring'
import { identifyTarget } from './db-target-identity.cjs'

const url = process.env.DATABASE_URL ?? ''
const endpoint = new URL(url).hostname.split('.')[0].replace(/-pooler$/, '')
if (!process.env.SG_QA_ENDPOINT || endpoint !== process.env.SG_QA_ENDPOINT ||
    identifyTarget(url).kind === 'production') throw new Error('Explicit nonproduction QA branch required')

async function main() {
  const nba = await prisma.playerGameStat.groupBy({ by: ['season'], where: { sportType: 'NBA',
    gameDate: { not: null } }, _count: { _all: true }, orderBy: { season: 'desc' }, take: 4 })
  const nfl = await prisma.playerGameStat.groupBy({ by: ['season'], where: { sportType: 'NFL',
    gameDate: { not: null } }, _count: { _all: true }, orderBy: { season: 'desc' }, take: 4 })
  const nbaDates = await prisma.playerGameStat.aggregate({ where: { sportType: 'NBA', gameDate: { not: null } },
    _min: { gameDate: true }, _max: { gameDate: true } })
  const start = nbaDates._min.gameDate
  let combined: Record<string, unknown> | null = null
  if (start) {
    const midpoint = new Date(start.getTime() + 7 * 86_400_000)
    const end = new Date(start.getTime() + 14 * 86_400_000)
    const sample = await prisma.playerGameStat.findMany({ where: { sportType: 'NBA', season: nba[0]?.season,
      gameDate: { gte: start, lt: end } }, select: { playerId: true, gameId: true, gameDate: true,
        normalizedStatMap: true }, take: 5000, orderBy: { gameDate: 'asc' } })
    const rules = [{ statKey: 'points', pointsValue: 1, multiplier: 1, enabled: true },
      { statKey: 'rebounds', pointsValue: 1, multiplier: 1, enabled: true },
      { statKey: 'assists', pointsValue: 1, multiplier: 1, enabled: true }]
    const games = sample.filter(row => row.gameDate).map(row => ({ rosterId: 'sample-roster',
      playerId: row.playerId, gameId: row.gameId, gameDate: row.gameDate!,
      points: scoreNbaGame(row.normalizedStatMap, rules) }))
    const firstHalf = games.filter(row => row.gameDate < midpoint).length
    const secondHalf = games.filter(row => row.gameDate >= midpoint).length
    if (!firstHalf || !secondHalf) throw new Error('NBA QA rows do not span both halves of a combined period')
    const cap = Math.min(20, games.length)
    combined = { start, midpoint, end, firstHalf, secondHalf, cap,
      cappedPoints: cap ? calculateCappedGameScores(['sample-roster'], games, cap).get('sample-roster') : null }
  }
  console.log(JSON.stringify({ target: 'isolated QA branch', nba, nfl, nbaDates, combined }))
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
