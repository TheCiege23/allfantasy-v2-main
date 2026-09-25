import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { GradedTrade, TradeGradesPayload, TradeSideGrade } from '@/lib/trade-intel/sleeperTradeGradeService'
import type { TradeExpectation } from '@/lib/trade-intel/tradeExpectation'
const mocks = vi.hoisted(() => ({ grades: vi.fn(), feed: vi.fn(), expectation: vi.fn(), archive: vi.fn() }))
vi.mock('@/lib/trade-intel/sleeperTradeGradeService', () => ({ getTradeGrades: mocks.grades }))
vi.mock('@/lib/trade-intel/sleeperTradeSync', () => ({ currentTradeIds: mocks.feed }))
vi.mock('@/lib/import-os/collector/archiveFeedTrades', () => ({ archiveCompletedFeedTrades: mocks.archive }))
vi.mock('@/lib/trade-intel/tradeExpectationLoader', () => ({ loadTradeExpectation: mocks.expectation }))
import { getReconciledTradeGrades, getSleeperTradeHistory, toTradeRecord } from '@/lib/core-app/sleeperTradeHistory'

const player = { playerId: 'bateman', name: 'Rashod Bateman', position: 'WR', pointsBySeason: {}, creditedBySeason: {}, departed: null, gamesMissedBySeason: {} }
const pick = { season: '2027', round: 2, originalRosterId: 2, label: '2027 round 2', resolved: null, pending: true, rerouted: false }
const side = (rosterId: number): TradeSideGrade => ({ rosterId, ownerId: `owner-${rosterId}`, managerName: `Manager ${rosterId}`, teamName: null, avatar: null, playersIn: [], playersOut: [], picksIn: [], picksOut: [], madePlayoffs: null, seasonNets: [], cumulativeNet: 0, initialGrade: 'C', currentGrade: 'C', trend: 'steady' })
const trade = (): GradedTrade => ({ id: 'league:tx', season: '2026', week: 2, createdIso: '2026-09-19T00:00:00Z', multiTeam: false, tie: true, hasPendingPicks: true, sides: [
  { ...side(1), playersIn: [player], picksIn: [pick] },
  { ...side(2), playersOut: [player], picksOut: [pick] },
] })
const payload = (trades: GradedTrade[]): TradeGradesPayload => ({ version: 2, fetchedAt: '2026-09-19T00:00:00Z', staleAsOf: null, sleeperLeagueId: 'league', seasonsScanned: ['2026'], currentSeasonPartial: true, gradeScale: { description: '', thresholds: [], tieBand: 0 }, contextNotes: [], trades, missing: [] })

describe('Sleeper trades shown in the app', () => {
  beforeEach(() => { vi.resetAllMocks(); mocks.expectation.mockResolvedValue(null); mocks.archive.mockResolvedValue({ written: 0, trades: 0 }); mocks.feed.mockResolvedValue([{ id: 'tx', status: 'complete' }]) })
  /*
   * 🛑 THE ARCHIVE WAITED HOURS FOR A SYNC LANE (2026-09-25). The moment this read notices a completed
   * trade the ledger lacks is the moment the archive lacks it too, so it is written from this feed.
   */
  it('writes the archive from the same feed when it finds a completed trade the ledger lacked', async () => {
    mocks.grades.mockResolvedValueOnce(payload([])).mockResolvedValueOnce(payload([trade()]))
    await getReconciledTradeGrades('league')
    expect(mocks.archive).toHaveBeenCalledTimes(1)
    expect(mocks.archive).toHaveBeenCalledWith({ sleeperLeagueId: 'league', feed: [{ id: 'tx', status: 'complete' }] })
  })
  it('writes nothing when the ledger already has every completed trade, or only a request is new', async () => {
    mocks.grades.mockResolvedValue(payload([trade()]))
    await getReconciledTradeGrades('league')
    mocks.feed.mockResolvedValue([{ id: 'tx', status: 'complete' }, { id: 'request', status: 'pending' }])
    await getReconciledTradeGrades('league')
    expect(mocks.archive).not.toHaveBeenCalled()
  })
  it('a failed archive write never costs the read that noticed the trade', async () => {
    mocks.archive.mockRejectedValue(new Error('db down'))
    mocks.grades.mockResolvedValueOnce(payload([])).mockResolvedValueOnce(payload([trade()]))
    const result = await getReconciledTradeGrades('league')
    expect(result.refreshed).toBe(true)
    expect(result.grades?.trades).toHaveLength(1)
  })
  it('takes counts, picks and viewer direction from the same trade as the email', () => {
    const result = toTradeRecord(trade(), 'owner-2', null)
    expect(result).toMatchObject({ playersIn: 0, playersOut: 1, picks: 1, yourSide: 'in' })
    expect(result.players[0]).toMatchObject({ received: [{ name: 'Rashod Bateman' }], picks: ['2027 round 2'], isYou: false, grade: null })
    expect(result.players[1].isYou).toBe(true)
  })
  it('uses the email projection per roster and never exposes a zero-signal C', () => {
    const expectation = { sides: [{ rosterId: 1, projected: { letter: 'A', valueEdge: 0.41, productionDisagrees: true } }, { rosterId: 2, projected: { letter: 'F', valueEdge: -0.41 } }] } as TradeExpectation
    const result = toTradeRecord(trade(), null, expectation)
    expect(result.players.map((s) => s.grade)).toEqual(['A', 'F'])
    expect(result.players[0].gradeNote).toContain('production points the other way')
    expect(toTradeRecord(trade(), null, null).players.map((s) => s.grade)).toEqual([null, null])
  })
  it('keeps manager, player and team media on the trade record', () => {
    const withAvatar = trade()
    withAvatar.sides[0]!.avatar = 'avatar-hash'
    const result = toTradeRecord(withAvatar, null, null, new Map([
      ['bateman', {
        playerId: 'bateman', sport: 'nfl', teamAbbr: 'BAL', source: 'db' as const,
        media: { headshotUrl: 'https://images.example/bateman.png', teamLogoUrl: 'https://images.example/bal.png' },
      }],
    ]))
    expect(result.players[0]).toMatchObject({
      avatarUrl: 'https://sleepercdn.com/avatars/thumbs/avatar-hash',
      received: [{ team: 'BAL', headshotUrl: 'https://images.example/bateman.png', teamLogoUrl: 'https://images.example/bal.png' }],
    })
  })
  it('refreshes a cached ledger when the live feed has a newer completed trade', async () => {
    mocks.grades.mockResolvedValueOnce(payload([])).mockResolvedValueOnce(payload([trade()]))
    const result = await getSleeperTradeHistory('league', 'owner-1')
    expect(mocks.grades).toHaveBeenLastCalledWith('league', { force: true })
    expect(result?.history[0].transactionId).toBe('league:tx')
  })
  it('does not mistake a pending request for a missing completed ledger row', async () => {
    mocks.feed.mockResolvedValue([{ id: 'request', status: 'pending' }])
    mocks.grades.mockResolvedValue(payload([]))
    const result = await getReconciledTradeGrades('league')
    expect(result.refreshed).toBe(false)
    expect(mocks.grades).toHaveBeenCalledTimes(1)
  })
  it('uses the notified trade cache without requiring imported transaction facts', async () => {
    mocks.grades.mockResolvedValue(payload([trade()]))
    const result = await getSleeperTradeHistory('league', null)
    expect(result?.history).toHaveLength(1)
    expect(mocks.grades).toHaveBeenCalledTimes(1)
  })
  it('labels an unavailable live feed instead of claiming the history is current', async () => {
    mocks.grades.mockResolvedValue(payload([trade()]))
    mocks.feed.mockResolvedValue(null)
    expect((await getSleeperTradeHistory('league', null))?.notice).toContain('incomplete')
  })
})
