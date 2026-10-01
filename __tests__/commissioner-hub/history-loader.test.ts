import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ trades: vi.fn(), sessions: vi.fn(), drafts: vi.fn(), corrections: vi.fn(), imported: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  redraftLeagueTrade: { findMany: mocks.trades },
  draftSession: { findMany: mocks.sessions },
  redraftDraft: { findMany: mocks.drafts },
  draftPickAuditLog: { findMany: mocks.corrections },
} }))
vi.mock('@/lib/league-history/leagueWarehouseReads', () => ({ readRecentImportedTrades: mocks.imported }))

import { loadCommissionerHistory } from '@/lib/core-app/commissioner/history'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.trades.mockResolvedValue([])
  mocks.drafts.mockResolvedValue([])
  mocks.sessions.mockResolvedValue([])
  mocks.corrections.mockResolvedValue([])
  mocks.imported.mockResolvedValue([])
})

describe('commissioner history', () => {
  it('shows draft owner, player and the actual correction trail', async () => {
    mocks.sessions.mockResolvedValue([{ id: 'draft-1', status: 'completed', startedAt: new Date('2025-08-01T00:00:00Z'), completedAt: null,
      picks: [{ overall: 1, round: 1, displayName: 'Ada', playerName: 'Player B', rosterId: 'roster-1' }],
    }])
    mocks.corrections.mockResolvedValue([{ draftSessionId: 'draft-1', overallPickNumber: 1, action: 'replace_player', oldPlayerName: 'Player A', newPlayerName: 'Player B', reason: 'Commissioner correction' }])
    const history = await loadCommissionerHistory('league-1', false)
    expect(history.drafts[0]).toMatchObject({ season: 2025, seasonBasis: 'date_inferred', picks: [
      { overall: 1, round: 1, owner: 'Ada', player: 'Player B', corrections: ['replace_player · Player A → Player B · Commissioner correction'] },
    ] })
    expect(history.draftNote).toContain('missing provider seasons')
  })

  it('labels imported trades as warehouse records with incomplete provider history', async () => {
    mocks.imported.mockResolvedValue([{ id: 'trade-1', occurredAt: new Date('2026-09-20T00:00:00Z'), provider: 'sleeper', providerEventId: 'tx-9' }])
    const history = await loadCommissionerHistory('league-1', false)
    expect(history.trades[0]).toMatchObject({ label: 'Trade tx-9', source: 'sleeper' })
    expect(history.tradeNote).toContain('may be incomplete')
  })

  it('does not call a failed warehouse read an empty trade history', async () => {
    mocks.imported.mockRejectedValue(new Error('warehouse unavailable'))
    const history = await loadCommissionerHistory('league-1', false)
    expect(history.tradeAvailable).toBe(false)
    expect(history.tradeNote).toBe('Trade history could not be read.')
  })
})
