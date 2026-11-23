/**
 * The manager-record loader (2026-11-16, re-score item 11): membership before anything, the same
 * history readers as the Trade Center / Waivers / Draft HQ, the viewer left out of "the managers".
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const m = vi.hoisted(() => ({
  membership: vi.fn(),
  league: vi.fn(),
  teams: vi.fn(),
  trades: vi.fn(),
  waivers: vi.fn(),
  drafts: vi.fn(),
  rules: vi.fn(),
  native: vi.fn(),
  providerWaivers: vi.fn(),
  providerDrafts: vi.fn(),
  leagueTrades: vi.fn(async () => [] as unknown[]),
  players: vi.fn(async () => [] as unknown[]),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: { league: { findUnique: m.league }, leagueTeam: { findMany: m.teams }, leagueTrade: { findMany: m.leagueTrades }, sportsPlayer: { findMany: m.players } },
}))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: m.membership }))
vi.mock('@/lib/core-app/waivers', () => ({ resolveWaiverRules: m.rules }))
vi.mock('@/lib/competitive-edge/tradeEdgeLoader', () => ({ readSleeperTradeHistory: m.trades }))
vi.mock('@/lib/competitive-edge/waiverEdgeLoader', () => ({ readWaiverEdgeInput: m.waivers }))
vi.mock('@/lib/competitive-edge/draftEdgeLoader', () => ({ readDraftEdgeInput: m.drafts }))
vi.mock('@/lib/competitive-edge/nativeManagerHistory', () => ({ readNativeHistory: m.native }))
vi.mock('@/lib/competitive-edge/providerManagerHistory', async (orig) => ({
  ...(await orig<typeof import('@/lib/competitive-edge/providerManagerHistory')>()),
  readProviderWaivers: m.providerWaivers,
  readProviderDrafts: m.providerDrafts,
}))

import { loadLeagueManagerRecords } from '@/lib/competitive-edge/managerRecordLoader'

const TEAMS = [
  { externalId: '1', ownerName: 'You', teamName: null, platformUserId: 'viewer', claimedByUserId: 'u1' },
  { externalId: '3', ownerName: 'Mike', teamName: 'Mike Team', platformUserId: 'mike', claimedByUserId: null },
  { externalId: '5', ownerName: null, teamName: 'Sam Squad', platformUserId: 'sam', claimedByUserId: null },
]

beforeEach(() => {
  vi.clearAllMocks()
  m.membership.mockResolvedValue({ ok: true, access: { isMember: true } })
  m.league.mockResolvedValue({ id: 'L1', name: 'Dynasty', platform: 'sleeper', platformLeagueId: 'sl-1', sport: 'NFL', season: 2026 })
  m.teams.mockResolvedValue(TEAMS)
  m.rules.mockResolvedValue({ waiverType: { available: true, data: { kind: 'faab' } } })
  m.trades.mockResolvedValue({
    available: true,
    data: {
      trades: [
        {
          id: 't1', season: '2026', week: 2, createdIso: '2026-09-20T00:00:00Z',
          sides: [
            { ownerId: 'mike', playersIn: [{ position: 'WR' }], playersOut: [{ position: 'RB' }], picksIn: [], picksOut: [] },
            { ownerId: 'viewer', playersIn: [{ position: 'RB' }], playersOut: [{ position: 'WR' }], picksIn: [], picksOut: [] },
          ],
        },
      ],
      seasonsScanned: ['2026'], historyGaps: [], asOf: '2026-11-15T00:00:00Z', stale: false,
    },
  })
  m.waivers.mockResolvedValue({
    available: true,
    data: {
      season: 2026, usesFaab: true,
      claims: [{ teamExternalId: '3', position: 'RB', bid: 12, atIso: '2026-10-01T00:00:00Z' }],
      managers: [
        { teamExternalId: '1', name: 'You', faabRemaining: 50 },
        { teamExternalId: '3', name: 'Mike', faabRemaining: 88 },
        { teamExternalId: '5', name: 'Sam Squad', faabRemaining: 100 },
      ],
      viewerTeamExternalId: '1', asOf: '2026-11-15T00:00:00Z', stale: false,
    },
  })
  m.drafts.mockResolvedValue({ ok: true, picks: [], teams: TEAMS, unattributed: [] })
  m.providerDrafts.mockResolvedValue({ available: false, reason: "MFL draft picks are on file, but who owned each team in those seasons wasn't recorded." })
})

describe('loadLeagueManagerRecords', () => {
  it('🛑 refuses a league the viewer is not in, before reading anything', async () => {
    m.membership.mockResolvedValue({ ok: false, reason: 'not_member', status: 403 })
    const r = await loadLeagueManagerRecords({ leagueId: 'L1', userId: 'stranger' })
    expect(r.available).toBe(false)
    expect(m.league).not.toHaveBeenCalled()
    expect(m.trades).not.toHaveBeenCalled()
  })

  it("gives every manager but the viewer, each from the screens' own readers", async () => {
    const r = await loadLeagueManagerRecords({ leagueId: 'L1', userId: 'u1' })
    if (!r.available) throw new Error(r.reason)
    expect(r.data.viewerTeamExternalId).toBe('1')
    expect(r.data.records.map((x) => x.manager.name)).toEqual(['Mike', 'Sam Squad'])
    const mike = r.data.records[0]!
    expect(mike.trades.available && mike.trades.data.coverage.trades).toBe(1)
    expect(mike.trades.available && mike.trades.data.facts.map((f) => f.text)).toContain('1 of them was with you.')
    expect(mike.waivers.available && mike.waivers.data.faabRemaining).toBe(88)
    expect(m.waivers).toHaveBeenCalledWith(expect.objectContaining({ leagueId: 'L1', usesFaab: true }))
    expect(m.trades).toHaveBeenCalledWith('sl-1', expect.any(Date))
  })

  it('Sleeper: each trade\'s saved situation is read and becomes facts on the record; MANAGER_TRADE_SITUATION=off drops them', async () => {
    const side = (ownerId: string, rosterId: number) => ({ ownerId, rosterId, playersIn: [{ playerId: 'p1', position: 'WR' }], playersOut: [], picksIn: [], picksOut: [] })
    const three = ['a', 'b', 'c'].map((tx) => ({
      id: `sl-1:${tx}`, season: '2026', week: 9, createdIso: '2026-10-20T00:00:00Z', sides: [side('mike', 3), side('viewer', 1)],
    }))
    m.trades.mockResolvedValue({ available: true, data: { trades: three, seasonsScanned: ['2026'], historyGaps: [], asOf: '2026-11-15T00:00:00Z', stale: false } })
    m.leagueTrades.mockResolvedValue(['a', 'b', 'c'].map((tx) => ({
      transactionId: tx, history: { sleeperLeagueId: 'sl-1' },
      contextSnapshot: { starterSlots: { WR: 3 }, sides: [{ rosterId: '3', record: { wins: 6, losses: 2, ties: 0 }, rosterBefore: [{ position: 'WR' }] }] },
    })))
    const situation = async () => {
      const r = await loadLeagueManagerRecords({ leagueId: 'L1', userId: 'u1', teamExternalId: '3' })
      if (!r.available) throw new Error(r.reason)
      const t = r.data.records[0]!.trades
      return t.available ? t.data.facts.filter((f) => f.key.startsWith('trade.situation')).map((f) => f.key) : []
    }
    expect(await situation()).toEqual(expect.arrayContaining(['trade.situation.timing', 'trade.situation.record', 'trade.situation.depth.WR']))
    process.env.MANAGER_TRADE_SITUATION = 'off'
    try {
      expect(await situation()).toEqual([])
    } finally {
      delete process.env.MANAGER_TRADE_SITUATION
    }
  })

  it('one team by id — including the viewer, when asked for by id', async () => {
    const one = await loadLeagueManagerRecords({ leagueId: 'L1', userId: 'u1', teamExternalId: '5' })
    expect(one.available && one.data.records.map((x) => x.manager.name)).toEqual(['Sam Squad'])
    const self = await loadLeagueManagerRecords({ leagueId: 'L1', userId: 'u1', teamExternalId: '1' })
    expect(self.available && self.data.records.map((x) => x.manager.name)).toEqual(['You'])
    const none = await loadLeagueManagerRecords({ leagueId: 'L1', userId: 'u1', teamExternalId: '99' })
    expect(none).toEqual({ available: false, reason: 'That team is not in this league.' })
  })

  it('an ESPN league: waiver claims and drafts from its import, and trades name the gap — never "no trades"', async () => {
    m.league.mockResolvedValue({ id: 'L2', name: 'Work', platform: 'espn', platformLeagueId: 'e-1', sport: 'NFL', season: 2026 })
    m.providerDrafts.mockResolvedValue({
      available: true,
      data: {
        picks: [
          { season: 2024, round: 1, position: 'RB', ownerSleeperId: 'mike' },
          { season: 2025, round: 1, position: 'RB', ownerSleeperId: 'mike' },
          { season: 2025, round: 1, position: 'WR', ownerSleeperId: 'sam' },
        ],
        unattributedSeasons: [2023],
      },
    })
    m.providerWaivers.mockResolvedValue({
      available: true,
      data: {
        season: 2026, bidsKnown: true, asOf: '2026-11-10T00:00:00Z', stale: false,
        claims: [{ teamExternalId: '3', position: 'RB', bid: 17, atIso: '2026-10-01T00:00:00Z' }],
        faabByTeam: new Map([['3', 64]]),
      },
    })
    const r = await loadLeagueManagerRecords({ leagueId: 'L2', userId: 'u1' })
    if (!r.available) throw new Error(r.reason)
    expect(m.trades).not.toHaveBeenCalled()
    expect(m.waivers).not.toHaveBeenCalled()
    const mike = r.data.records[0]!
    expect(!mike.trades.available && mike.trades.reason).toBe("ESPN trades aren't imported in a form that can be counted per manager yet.")
    expect(m.drafts).not.toHaveBeenCalled() // the Sleeper reader
    expect(m.providerDrafts).toHaveBeenCalledWith(expect.objectContaining({ id: 'L2', platform: 'espn' }))
    expect(mike.drafts.available && [mike.drafts.data.drafts, mike.drafts.data.picks, mike.drafts.data.unattributedSeasons]).toEqual([2, 2, [2023]])
    expect(mike.waivers.available && mike.waivers.data.facts.map((f) => f.text)).toContain('Mike has won 1 waiver claim this season, spending $17 in all.')
    expect(mike.waivers.available && mike.waivers.data.faabRemaining).toBe(64)
  })

  it('🛑 an MFL league records no bids, so it draws claim counts and NO dollar figures — never "spent $0"', async () => {
    m.league.mockResolvedValue({ id: 'L3', name: 'MFL', platform: 'mfl', platformLeagueId: 'm-1', sport: 'NFL', season: 2026 })
    m.providerWaivers.mockResolvedValue({
      available: true,
      data: { season: 2026, bidsKnown: false, asOf: null, stale: false, claims: [{ teamExternalId: '3', position: 'WR', bid: null, atIso: '2026-10-01T00:00:00Z' }], faabByTeam: new Map([['3', 80]]) },
    })
    const r = await loadLeagueManagerRecords({ leagueId: 'L3', userId: 'u1' })
    if (!r.available) throw new Error(r.reason)
    const w = r.data.records[0]!.waivers
    expect(w.available && w.data.facts.map((f) => f.text)).toEqual(['Mike has won 1 waiver claim this season.'])
  })

  it('a native league reads our own tables for all three sections', async () => {
    m.league.mockResolvedValue({ id: 'L4', name: 'Native', platform: 'allfantasy', platformLeagueId: null, sport: 'NFL', season: 2026 })
    m.native.mockResolvedValue({
      trades: { available: true, data: { trades: [], seasonsScanned: ['2026'], historyGaps: [], asOf: '2026-11-15T00:00:00Z', stale: false } },
      waivers: { available: true, data: { season: 2026, claims: [], faabByTeam: new Map([['3', 55]]), asOf: null, stale: false } },
      drafts: { available: true, data: { picks: [], unattributedSeasons: [] } },
    })
    const r = await loadLeagueManagerRecords({ leagueId: 'L4', userId: 'u1' })
    if (!r.available) throw new Error(r.reason)
    expect(m.native).toHaveBeenCalled()
    expect(m.trades).not.toHaveBeenCalled()
    const mike = r.data.records[0]!
    expect(mike.trades.available && mike.trades.data.coverage.trades).toBe(0)
    expect(mike.waivers.available && mike.waivers.data.faabRemaining).toBe(55)
    expect(mike.drafts.available).toBe(true)
  })

  it('a reader that throws becomes that section’s reason; the rest of the record still reads', async () => {
    m.waivers.mockRejectedValue(new Error('db down'))
    const r = await loadLeagueManagerRecords({ leagueId: 'L1', userId: 'u1' })
    if (!r.available) throw new Error(r.reason)
    const mike = r.data.records[0]!
    expect(mike.waivers).toEqual({ available: false, reason: 'Waiver history could not be read right now.' })
    expect(mike.trades.available).toBe(true)
  })
})
