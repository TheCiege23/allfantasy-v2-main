import 'server-only'
import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/team-abbrev'
import { validateObservedMarketAdpBoard } from '@/lib/adp/observedMarketAdpBoard'

export async function importObservedMarketAdpBoard(input: unknown, expected: Parameters<typeof validateObservedMarketAdpBoard>[1], dryRun = true) {
  const board = validateObservedMarketAdpBoard(input, expected)
  const identities = await prisma.sportsPlayer.findMany({ where: { sport: board.sport, id: { in: board.players.map(player => player.canonicalPlayerId) } }, select: { id: true, name: true, position: true } })
  const byId = new Map(identities.map(player => [player.id, player]))
  for (const player of board.players) {
    const identity = byId.get(player.canonicalPlayerId)
    if (!identity || normalizePlayerName(identity.name) !== normalizePlayerName(player.playerName) || !identity.position?.split(/[,/]/).map(p => p.trim().toUpperCase()).includes(player.position.toUpperCase())) throw new Error('ADP_PLAYER_IDENTITY_MISMATCH')
  }
  if (dryRun) return { dryRun: true, accepted: board.players.length, sport: board.sport, source: board.source, asOf: board.asOf }
  const asOf = new Date(board.asOf)
  const start = Date.UTC(asOf.getUTCFullYear(), 0, 1)
  const week = Math.max(1, Math.ceil(((asOf.getTime() - start) / 86400000 + new Date(start).getUTCDay() + 1) / 7))
  return prisma.$transaction(async tx => {
    // Replace one source's complete period atomically, removing players omitted in a revised export.
    const scope = { sport: board.sport, format: board.format, scoring: board.scoring, season: board.season, week, source: board.source }
    const newest = await tx.adpDataRecord.findFirst({ where: { sport:board.sport,format:board.format,scoring:board.scoring,season:board.season,source:board.source }, orderBy:{createdAt:'desc'},select:{createdAt:true} })
    if (newest && newest.createdAt > asOf) throw new Error('ADP_EXPORT_OLDER_THAN_STORED_BOARD')
    await tx.adpDataRecord.deleteMany({ where: scope })
    const inserted = await tx.adpDataRecord.createMany({ data: board.players.map(player => ({ ...scope, playerId: player.canonicalPlayerId, playerName: player.playerName, position: player.position, team: player.team ?? 'FA', adp: player.adp, providerCount: 1, providerBreakdown: { [board.source]: player.adp }, createdAt: asOf })) })
    // Preserve observation provenance without changing the numeric provider breakdown contract.
    await tx.adpRefreshRun.create({ data: { status:'completed',trigger:'licensed_market_export',finishedAt:new Date(),sportsProcessed:[board.sport],rawRowsRead:board.players.length,rawRowsInserted:inserted.count,qualitySummary:{ evidenceType:board.evidenceType,licensedForUse:true,source:board.source,season:board.season,format:board.format,scoring:board.scoring,asOf:board.asOf,players:board.players.map(player => ({ canonicalPlayerId:player.canonicalPlayerId,providerPlayerId:player.providerPlayerId,draftSampleSize:player.draftSampleSize })) } } })
    return { dryRun:false, accepted:inserted.count,sport:board.sport,source:board.source,asOf:board.asOf }
  }, { timeout:60000 })
}
