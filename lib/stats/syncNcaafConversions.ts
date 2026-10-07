import { prisma } from '@/lib/prisma'
import { applyConversionEvidence, conversionCandidateGames, enrichCfbdConversions, type ConversionEvidence } from './cfbdConversions'
import { normalizeStatPayload } from '@/lib/schedule-stats/StatNormalizationService'
import type { CfbdGameLogRow } from './cfbdGameLogs'

const stableJson = (v: unknown): string => JSON.stringify(v, (_, value) => value && typeof value === 'object' && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))) : value)

/** Independent retry ledger: replay cached evidence after a box-score refresh and refresh corrections. */
export async function syncRecentNcaafConversions(season: number, now = new Date()) {
  const stored = await prisma.playerGameStat.findMany({ where: { sportType: 'NCAAF', season, gameDate: { gte: new Date(now.getTime() - 21 * 86400000) }, gameId: { startsWith: 'cfbd:' }, OR: [{ source: 'cfbd-weekly' }, { source: null }] }, select: { id: true, playerId: true, gameId: true, statPayload: true, updatedAt: true } })
  const rows = stored.filter(r => r.statPayload && typeof r.statPayload === 'object' && !Array.isArray(r.statPayload)).map(r => ({ playerId: r.playerId, gameId: r.gameId, statPayload: r.statPayload as CfbdGameLogRow['statPayload'] }))
  let deferred = 0
  const due: string[] = [], cachedEvidence: ConversionEvidence[] = [], cachedVerified: string[] = []
  for (const gameId of conversionCandidateGames(rows)) {
    const cached = await prisma.sportsDataCache.findUnique({ where: { cacheKey: `ncaaf-conversions:${season}:${gameId}` }, select: { expiresAt: true, data: true } })
    if (!cached || cached.expiresAt <= now) { if (due.length < 16) due.push(gameId); else deferred++; continue }
    const data = cached.data as any
    if (data?.provider === 'espn-summary' && data.gameId === gameId && Array.isArray(data.evidence)) {
      cachedEvidence.push(...data.evidence.filter((e: ConversionEvidence) => e.gameId === gameId && e.source === 'espn-summary'))
      if (data.verified === true) cachedVerified.push(gameId)
    }
  }
  const enriched = await enrichCfbdConversions(rows.filter(r => due.includes(r.gameId)))
  const evidence = [...cachedEvidence, ...enriched.evidence], verifiedGames = [...cachedVerified, ...enriched.verifiedGames]
  const patched = applyConversionEvidence(rows, evidence, verifiedGames)
  let written = 0; const conflicts = new Set<string>()
  for (const row of patched) {
    const original = stored.find(r => r.gameId === row.gameId && r.playerId === row.playerId)
    if (!original || stableJson(original.statPayload) === stableJson(row.statPayload)) continue
    // Conversion provenance is in the payload; never invent CFBD provenance for a legacy row.
    const result = await prisma.playerGameStat.updateMany({ where: { id: original.id, updatedAt: original.updatedAt }, data: { statPayload: row.statPayload as any, normalizedStatMap: normalizeStatPayload('NCAAF', row.statPayload as any) as any } })
    written += result.count
    if (!result.count) conflicts.add(row.gameId)
  }
  for (const gameId of due) {
    if (conflicts.has(gameId)) continue // A concurrent refresh must be retried, not cached as successful.
    const gaps = enriched.gaps.filter(g => g.startsWith(gameId))
    const expiresAt = new Date(now.getTime() + (gaps.length ? 3600000 : 6 * 3600000))
    const data = { provider: 'espn-summary', gameId, capturedAt: now.toISOString(), evidence: enriched.evidence.filter(e => e.gameId === gameId), verified: enriched.verifiedGames.includes(gameId), gaps }
    await prisma.sportsDataCache.upsert({ where: { cacheKey: `ncaaf-conversions:${season}:${gameId}` }, create: { cacheKey: `ncaaf-conversions:${season}:${gameId}`, expiresAt, data }, update: { expiresAt, data } })
  }
  return { gamesProbed: due.length, evidence: evidence.length, rowsWritten: written, gaps: [...enriched.gaps, ...(deferred ? [`${deferred} conversion candidate games deferred`] : []), ...[...conflicts].map(id => `${id}: concurrent box-score refresh; retry required`)] }
}
