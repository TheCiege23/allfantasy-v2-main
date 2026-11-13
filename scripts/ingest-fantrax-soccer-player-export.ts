/**
 * With the target database configured, run with scripts/_audit-preload.cjs and tsx.
 * Describe:  ... scripts/ingest-fantrax-soccer-player-export.ts <leagueId>
 * Write:     ... scripts/ingest-fantrax-soccer-player-export.ts <leagueId> <normalized.json> --apply
 *
 * Use the league's full player-pool Fantrax fantasy-point totals as of one date. Include rostered
 * players and free agents, and record club matches and player appearances over the same interval.
 */
import { readFile } from 'node:fs/promises'
import { prisma } from '@/lib/prisma'
import { rosteredIdsOf } from '@/lib/decision-os/trade/tradePlayers'
import { fantraxSoccerExportKey, fantraxSoccerRulesDigest, hasFantraxSoccerPool, validateFantraxSoccerExport } from '@/lib/league-import/fantrax/soccerPlayerExport'

async function main() {
  const [id, input, apply] = process.argv.slice(2)
  if (!id) throw new Error('Supply the AllFantasy league ID.')
  const league = await prisma.league.findUnique({
    where: { id },
    select: { platform: true, sport: true, season: true, platformLeagueId: true, settings: true },
  })
  if (!league || league.platform !== 'fantrax' || league.sport !== 'SOCCER') throw new Error('This is not a Fantrax Soccer league.')
  if (!input) {
    console.log(JSON.stringify({ season: league.season, platformLeagueId: league.platformLeagueId, rulesDigest: fantraxSoccerRulesDigest(league.settings) }))
    return
  }
  const result = validateFantraxSoccerExport(JSON.parse(await readFile(input, 'utf8')), league, new Date())
  if (!result) throw new Error('The export is incomplete, stale, invalid, or belongs to another league or scoring setup.')
  const rosters = await prisma.roster.findMany({ where: { leagueId: id }, select: { playerData: true } })
  if (!hasFantraxSoccerPool(result.board.players, rosters.flatMap((r) => rosteredIdsOf(r.playerData)))) {
    throw new Error('The export must cover every current roster and include free agents.')
  }
  if (apply === '--apply') {
    const cacheKey = fantraxSoccerExportKey(id)
    await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${cacheKey}, 0))`
      const existing = await tx.sportsDataCache.findUnique({ where: { cacheKey }, select: { data: true } })
      const current = existing && validateFantraxSoccerExport(existing.data, league, new Date())
      if (current && Date.parse(current.board.through) > Date.parse(result.board.through)) {
        throw new Error('The export is older than the currently saved board.')
      }
      await tx.sportsDataCache.upsert({
        where: { cacheKey },
        create: { cacheKey, data: result.board, expiresAt: result.expiresAt },
        update: { data: result.board, expiresAt: result.expiresAt },
      })
    })
  }
  console.log(JSON.stringify({ players: result.board.players.length, through: result.board.through, applied: apply === '--apply' }))
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.name + ': ' + (error.message.startsWith('Supply') || error.message.startsWith('This is') || error.message.startsWith('The export') ? error.message : 'Export could not be processed.') : 'Export could not be processed.')
  process.exitCode = 1
}).finally(() => prisma.$disconnect())
