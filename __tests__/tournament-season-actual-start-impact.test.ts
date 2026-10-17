import { describe, expect, it } from 'vitest'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'
import { readSeasonGameStartImpact } from '@/lib/tournament/seasonActualStartImpact'

const manifest = { manifestHash: 'm'.repeat(64), rulesHash: 'r'.repeat(64), config: { sport: 'NBA' }, leagues: [{ key: 'pool-1' }] }
const leagueId = seasonResourceId('freeze', 'pool-1'), targetId = `${leagueId}:1`
const receipt = (action: string, extra: Record<string, unknown>) => {
  const payload = { version: 1, mode: 'locked_setup', manifestHash: manifest.manifestHash, rulesHash: manifest.rulesHash, ...extra }
  return { tournamentId: 't1', action, targetId, data: { ...payload, digest: seasonContractHash(payload) } }
}
function db(lineup: unknown, scores: unknown[], finals: unknown[], mappings: unknown[] = []) {
  return { gameProviderIdentity: { findMany: async () => mappings }, tournamentAuditLog: {
    findUnique: async () => lineup,
    findMany: async ({ where }: { where: { action: string } }) => where.action === 'season_scores_ingested' ? scores : finals,
  } } as never
}
describe('game-start correction receipt impact', () => {
  it('counts saved lineup, score revisions, and finalization without changing them', async () => {
    const lineup = receipt('season_lineup_locked', { period: 1, game: { gameId: 'g1' }, lineups: [{ lockedAt: '2026-10-20T23:58:00Z' }] })
    const score = receipt('season_scores_ingested', { evidence: { games: [{ gameId: 'g1' }], scores: [{ gameId: 'g1' }] } })
    const final = receipt('season_week_finalized_setup', { period: 1 })
    const result = await readSeasonGameStartImpact(db(lineup, [score, score], [final]), manifest as never, 't1', 'freeze', 'g1', 1)
    expect(result).toEqual({ lockedLeagues: 1, scoreRevisions: 2, finalizedWeeks: 1, latestLineupLockAt: '2026-10-20T23:58:00.000Z', receiptReviewRequired: true })
  })
  it('blocks tampered or mismatched saved receipts', async () => {
    const lineup = receipt('season_lineup_locked', { period: 1, game: { gameId: 'g1' }, lineups: [{ lockedAt: '2026-10-20T23:58:00Z' }] })
    ;(lineup.data as Record<string, unknown>).period = 2
    await expect(readSeasonGameStartImpact(db(lineup, [], []), manifest as never, 't1', 'freeze', 'g1', 1)).rejects.toThrow('checksum differs')
  })
  it('counts canonical score receipts from a verified provider game ID', async () => {
    const lineup = receipt('season_lineup_locked', { period: 1, game: { gameId: 'canonical-g1' }, lineups: [{ lockedAt: '2026-10-20T23:58:00Z' }] })
    const score = receipt('season_scores_ingested', { evidence: { games: [{ gameId: 'canonical-g1' }], scores: [] } })
    const mapping = [{ gameId: 'canonical-g1', providerGameId: 'ri-g1', verified: true, expiresAt: null }]
    const result = await readSeasonGameStartImpact(db(lineup, [score], [], mapping), manifest as never, 't1', 'freeze', 'ri-g1', 1)
    expect(result).toMatchObject({ lockedLeagues: 1, scoreRevisions: 1, receiptReviewRequired: true })
  })
})
