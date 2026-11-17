import { describe, it, expect, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { buildProviderCompletedHistory } from '@/lib/provider-trades/providerCompletedHistory'
import type { GradedLeagueTradeRows, LeagueTradeRow } from '@/lib/core-app/leagueTradeRowGrades'
import type { ArchivedTradeGrade } from '@/lib/core-app/archivedTradeGrade'

/**
 * The Trade Center's completed trades on an imported (ESPN / Yahoo / MFL / Fleaflicker) league.
 *
 * These rows read through the SAME loader as /core Trades (`loadGradedLeagueTradeRows`), so what is pinned
 * here is the mapping: only the viewer's trades, the frozen letter as THE grade, no invented direction, and
 * no provider id ever shown or fed to Sleeper's headshot CDN.
 */

const VIEWER = 'espn-user-7'

function row(over: Partial<LeagueTradeRow> = {}): LeagueTradeRow {
  return {
    transactionId: 'tx1',
    season: 2026,
    week: 9,
    playersGiven: ['4001'],
    playersReceived: ['4002', '4003'],
    picksGiven: [],
    picksReceived: [{ season: '2027', round: 1 }],
    partnerName: 'Gridiron Gang',
    partnerRosterId: 4,
    tradeDate: new Date('2026-11-02T18:30:00.000Z'),
    history: { sleeperUsername: VIEWER },
    ...over,
  }
}

const GRADED: ArchivedTradeGrade = {
  grade: {
    graded: true,
    letter: 'B',
    giveValue: 40,
    getValue: 55,
    current: { letter: 'C', giveValue: 50, getValue: 48 },
  } as never,
  picksIn: [{ id: 'pick:2027:1:0', kind: 'pick', name: '2027 1st', position: null, team: null, imageUrl: null, value: null, pickSeason: '2027', pickRound: 1, drafted: null }],
  picksOut: [],
  give: { players: [], picks: [] } as never,
  get: { players: [], picks: [] } as never,
}

function loaded(rows: LeagueTradeRow[], over: Partial<Extract<GradedLeagueTradeRows, { available: true }>> = {}): GradedLeagueTradeRows {
  const names: Record<string, string> = { '4001': 'Puka Nacua', '4002': 'Bijan Robinson' }
  return {
    available: true,
    rows,
    graded: new Map([['tx1', GRADED]]),
    nameOf: (id) => names[id] ?? null,
    positionOf: (id) => (id === '4001' ? 'WR' : id === '4002' ? 'RB' : null),
    providerIds: true,
    ...over,
  }
}

const ARGS = { leagueId: 'af-league', userId: 'u1', platform: 'ESPN', platformLeagueId: '123456', sport: 'NFL', viewerPlatformUserId: VIEWER }

describe('buildProviderCompletedHistory', () => {
  it('lists the viewer’s completed trade with the frozen letter as THE grade and today’s beside it', async () => {
    const load = vi.fn(async () => loaded([row()]))
    const out = await buildProviderCompletedHistory(ARGS, { load, receiptFor: async () => 'rcpt-1' })

    expect(load).toHaveBeenCalledWith({ leagueId: 'af-league', platformLeagueId: '123456', viewerPlatformUserId: VIEWER, sport: 'NFL', platform: 'espn' })
    expect(out).toHaveLength(1)
    const t = out[0]!
    expect(t).toMatchObject({
      id: 'espn:tx1',
      receiptId: 'rcpt-1',
      direction: 'complete',
      status: 'completed_on_espn',
      partnerName: 'Gridiron Gang',
      timestamp: '2026-11-02T18:30:00.000Z',
      leagueGradeSide: 'viewer',
      currentGrade: 'C',
      proposalGrade: null,
      decisionRecommendation: null,
    })
    expect(t.leagueGrade).toMatchObject({ graded: true, letter: 'B' })
    expect(t.sent.map((a) => a.label)).toEqual(['Puka Nacua'])
    expect(t.received.map((a) => a.label)).toEqual(['Bijan Robinson', 'Unidentified player', '2027 1st'])
    expect(t.received[2]!.pick).toEqual({ season: 2027, round: 1, originalRosterId: null, fromRosterId: null })
  })

  it('🛑 never shows a provider id, or feeds one to Sleeper’s headshot CDN', async () => {
    const out = await buildProviderCompletedHistory(ARGS, { load: async () => loaded([row()]), receiptFor: async () => null })
    const assets = [...out[0]!.sent, ...out[0]!.received]
    for (const a of assets) {
      expect(a.headshotUrl).toBeNull()
      expect(a.label).not.toMatch(/^\d+$/)
    }
    expect(assets.filter((a) => !a.pick).every((a) => a.playerId === null)).toBe(true)
  })

  it('a Sleeper-id league keeps its headshots (positive control for the test above)', async () => {
    const out = await buildProviderCompletedHistory(ARGS, { load: async () => loaded([row()], { providerIds: false }), receiptFor: async () => null })
    expect(out[0]!.sent[0]!.headshotUrl).toMatch(/4001/)
  })

  it('🛑 lists only the viewer’s own trades — another manager’s copy is from their side', async () => {
    const theirs = row({ transactionId: 'tx2', history: { sleeperUsername: 'someone-else' } })
    const out = await buildProviderCompletedHistory(ARGS, { load: async () => loaded([row(), theirs]), receiptFor: async () => null })
    expect(out.map((t) => t.id)).toEqual(['espn:tx1'])
  })

  it('with no linked provider account there is no “you”, so it reads nothing', async () => {
    const load = vi.fn(async () => loaded([row()]))
    expect(await buildProviderCompletedHistory({ ...ARGS, viewerPlatformUserId: null }, { load })).toEqual([])
    expect(await buildProviderCompletedHistory({ ...ARGS, platformLeagueId: null }, { load })).toEqual([])
    expect(load).not.toHaveBeenCalled()
  })

  it('a league with no synced trades answers an empty list, not an error', async () => {
    const out = await buildProviderCompletedHistory(ARGS, { load: async () => ({ available: false, reason: 'no trades on file for this league' }) })
    expect(out).toEqual([])
  })

  it('an ungraded trade withholds its letter, and a failed receipt is null rather than a thrown panel', async () => {
    const out = await buildProviderCompletedHistory(ARGS, {
      load: async () => loaded([row({ picksGiven: [{ season: '2028', round: 2 }] })], { graded: new Map() }),
      receiptFor: async () => { throw new Error('receipts table missing') },
    })
    const t = out[0]!
    expect(t.leagueGrade).toMatchObject({ graded: false })
    expect(t.currentGrade).toBeNull()
    expect(t.receiptId).toBeNull()
    // Picks still listed from the row itself when the grade did not run.
    expect(t.sent.map((a) => a.label)).toEqual(['Puka Nacua', '2028 2nd'])
  })
})
