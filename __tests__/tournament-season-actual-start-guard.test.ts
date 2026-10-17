import { describe, expect, it, vi } from 'vitest'
import { seasonContractHash } from '@/lib/tournament/seasonCalendarVerification'
import { assertSeasonObservedStartsConsistent } from '@/lib/tournament/seasonActualStartGuard'

const context = {
  tournamentId: 't1', manifestHash: 'm1', rulesHash: 'published-rules', sport: 'NBA' as const,
  periodStartsAt: '2026-10-20T00:00:00Z', periodEndsAt: '2026-10-27T00:00:00Z',
}
const game = { gameId: 'game-1', actualStartsAt: '2026-10-20T23:02:00Z', lineups: [{ lockedAt: '2026-10-20T22:50:00Z' }] }
function receipt(state: string, observedAt: string, scheduledAt = '2026-10-20T23:00:00Z', providerGameId = game.gameId) {
  const payload = { version: 1, manifestHash: context.manifestHash, rulesHash: context.rulesHash,
    providerGameId, sport: context.sport, state, observedAt, scheduledAt, rawDigest: 'a'.repeat(64) }
  return { action: 'season_game_start_observed', targetId: providerGameId, data: { ...payload, digest: seasonContractHash(payload) } }
}
function db(rows: ReturnType<typeof receipt>[], mappings: Array<{ gameId: string; providerGameId: string; verified: boolean; expiresAt: Date | null }> = []) {
  return { tournamentAuditLog: { findMany: vi.fn(async ({ where }: any) => rows.filter(row => row.targetId === where.targetId)) },
    gameProviderIdentity: { findMany: vi.fn(async () => mappings) } } as any
}

describe('saved start observations veto unsafe score claims', () => {
  it('keeps legacy setup receipts provisional when no observations exist', async () => {
    await expect(assertSeasonObservedStartsConsistent(db([]), context, [game])).resolves.toBeUndefined()
  })
  it('accepts a claimed start inside a fresh status transition, with an earlier lineup lock', async () => {
    const rows = [receipt('not_started', '2026-10-20T22:59:00Z'), receipt('in_progress', '2026-10-20T23:04:00Z')]
    await expect(assertSeasonObservedStartsConsistent(db(rows), context, [game])).resolves.toBeUndefined()
  })
  it('rejects a claimed start outside the transition and an intervening late lineup lock', async () => {
    const rows = [receipt('not_started', '2026-10-20T23:03:00Z'), receipt('in_progress', '2026-10-20T23:05:00Z')]
    await expect(assertSeasonObservedStartsConsistent(db(rows), context, [game])).rejects.toThrow('outside the observed window')
    await expect(assertSeasonObservedStartsConsistent(db(rows), context, [{ ...game, actualStartsAt: '2026-10-20T23:04:00Z', lineups: [{ lockedAt: '2026-10-20T23:04:00Z' }] }])).rejects.toThrow('start/correction review')
  })
  it('rejects later postponement and changed or forged receipt bindings', async () => {
    const rows = [receipt('not_started', '2026-10-20T22:59:00Z'), receipt('in_progress', '2026-10-20T23:04:00Z')]
    await expect(assertSeasonObservedStartsConsistent(db([...rows, receipt('postponed', '2026-10-20T23:10:00Z')]), context, [game])).rejects.toThrow('start/correction review')
    await expect(assertSeasonObservedStartsConsistent(db([...rows, receipt('final', '2026-10-20T23:10:00Z', '2026-10-21T01:00:00Z')]), context, [game])).rejects.toThrow('start/correction review')
    rows[1]!.data.state = 'canceled'
    await expect(assertSeasonObservedStartsConsistent(db(rows), context, [game])).rejects.toThrow('receipt binding differs')
  })
  it('uses the verified provider game ID when the score frame uses a canonical ID', async () => {
    const providerId = 'ri-456', canonical = { ...game, gameId: 'canonical-123' }
    const rows = [receipt('not_started', '2026-10-20T22:59:00Z', undefined, providerId), receipt('in_progress', '2026-10-20T23:04:00Z', undefined, providerId)]
    const mappings = [{ gameId: canonical.gameId, providerGameId: providerId, verified: true, expiresAt: null }]
    await expect(assertSeasonObservedStartsConsistent(db(rows, mappings), context, [canonical])).resolves.toBeUndefined()
    await expect(assertSeasonObservedStartsConsistent(db([...rows, receipt('canceled', '2026-10-20T23:06:00Z', undefined, providerId)], mappings), context, [canonical])).rejects.toThrow('start/correction review')
    await expect(assertSeasonObservedStartsConsistent(db(rows, [{ ...mappings[0]!, verified: false }]), context, [canonical])).rejects.toThrow('ambiguous or expired')
  })
})
