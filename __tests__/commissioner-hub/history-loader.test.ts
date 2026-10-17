import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ trades: vi.fn(), sessions: vi.fn(), drafts: vi.fn(), corrections: vi.fn(), imported: vi.fn(), teams: vi.fn(), players: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: {
  redraftLeagueTrade: { findMany: mocks.trades },
  draftSession: { findMany: mocks.sessions },
  redraftDraft: { findMany: mocks.drafts },
  draftPickAuditLog: { findMany: mocks.corrections },
  // The trade list names its rows through the REAL describeImportedActivityRows, which reads these.
  leagueTeam: { findMany: mocks.teams },
  sportsPlayer: { findMany: mocks.players },
} }))
vi.mock('@/lib/league-history/leagueWarehouseReads', () => ({ readRecentImportedTrades: mocks.imported }))

import { importedTradeLabel, loadCommissionerHistory } from '@/lib/core-app/commissioner/history'

/** One completed Sleeper trade as the warehouse holds it: one row, every manager in managerKeys. */
const SLEEPER_TRADE = {
  id: 'trade-1', occurredAt: new Date('2026-09-20T00:00:00Z'), provider: 'sleeper', providerEventId: 'bb408447',
  activityType: 'trade', rosterId: null,
  payload: { source: 'sleeper_transaction', adds: { p1: 1, p2: 2 }, drops: { p1: 2, p2: 1 }, draftPicks: [{ season: '2027', round: 2 }] },
  normalized: { managerKeys: ['sleeper:manager:u1', 'sleeper:manager:u2'] },
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.trades.mockResolvedValue([])
  mocks.drafts.mockResolvedValue([])
  mocks.sessions.mockResolvedValue([])
  mocks.corrections.mockResolvedValue([])
  mocks.imported.mockResolvedValue([])
  mocks.teams.mockResolvedValue([
    { externalId: '1', teamName: 'Gridiron Gang', ownerName: 'ada', avatarUrl: null, platformUserId: 'u1', claimedByUserId: null },
    { externalId: '2', teamName: null, ownerName: 'bo', avatarUrl: null, platformUserId: 'u2', claimedByUserId: null },
  ])
  mocks.players.mockResolvedValue([
    { sleeperId: 'p1', name: 'Darren Waller', position: 'TE', team: 'CAR', imageUrl: null },
    { sleeperId: 'p2', name: 'Tyjae Spears', position: 'RB', team: 'TEN', imageUrl: null },
  ])
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
    mocks.imported.mockResolvedValue([SLEEPER_TRADE])
    const history = await loadCommissionerHistory('league-1', false)
    expect(history.trades[0]).toMatchObject({ source: 'sleeper', status: 'recorded' })
    expect(history.tradeNote).toContain('may be incomplete')
  })

  /*
   * Seen 2026-10-01 in the signed-in check: "Trade bb408447-… · recorded · sleeper". The row held
   * both managers and every player; the label printed the provider's transaction id instead.
   */
  it('names both sides and what moved, never the provider transaction id', async () => {
    mocks.imported.mockResolvedValue([SLEEPER_TRADE])
    const history = await loadCommissionerHistory('league-1', false, { platform: 'sleeper', sport: 'NFL' })
    expect(history.trades[0].label).toBe('Gridiron Gang ↔ bo: Darren Waller, Tyjae Spears, 2027 2nd')
    expect(history.trades[0].label).not.toContain('bb408447')
  })

  it('keeps a trade it cannot name, dated and sourced, rather than dropping it', async () => {
    mocks.imported.mockResolvedValue([SLEEPER_TRADE])
    mocks.teams.mockImplementation(() => { throw new Error('teams unavailable') })
    const history = await loadCommissionerHistory('league-1', false)
    expect(history.tradeAvailable).toBe(true)
    expect(history.trades).toHaveLength(1)
    expect(history.trades[0]).toMatchObject({ label: 'Trade (details unavailable)', source: 'sleeper' })
  })

  it('does not call a failed warehouse read an empty trade history', async () => {
    mocks.imported.mockRejectedValue(new Error('warehouse unavailable'))
    const history = await loadCommissionerHistory('league-1', false)
    expect(history.tradeAvailable).toBe(false)
    expect(history.tradeNote).toBe('Trade history could not be read.')
  })
})

describe('importedTradeLabel', () => {
  const base = { involvedTeams: ['A', 'B'], managerName: null, adds: [], picks: [] }
  const player = (name: string | null, label = name ?? 'player 4034') => ({ id: label, label, name, position: null, team: null, imageUrl: null })

  it('says who, when nothing that moved could be read', () => {
    expect(importedTradeLabel(base)).toBe('A ↔ B')
    expect(importedTradeLabel({ ...base, involvedTeams: [], managerName: 'ada' })).toBe('ada')
    expect(importedTradeLabel({ ...base, involvedTeams: [] })).toBe('Unattributed trade')
  })

  it('keeps an unnamed player as his id rather than dropping him', () => {
    expect(importedTradeLabel({ ...base, adds: [player(null)] })).toBe('A ↔ B: player 4034')
  })

  it('caps a long asset list and says how many it left out', () => {
    const adds = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((n) => player(n))
    expect(importedTradeLabel({ ...base, adds })).toBe('A ↔ B: a, b, c, d, e, f +2 more')
  })
})
