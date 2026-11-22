/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
const h = vi.hoisted(() => ({ league: vi.fn(), rosters: vi.fn(), identities: vi.fn(), games: vi.fn(), finals: vi.fn(), evaluate: vi.fn(), names: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: h.league }, roster: { findMany: h.rosters },
  playerIdentityMap: { findMany: h.identities }, playerGameStat: { findMany: h.games }, sportsGame: { findMany: h.finals } } }))
vi.mock('@/lib/league-access', () => ({ resolveLeagueMembership: vi.fn() }))
vi.mock('@/lib/decision-os/trade/evaluateTrade', () => ({ evaluateTrade: h.evaluate }))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({ createLeagueTradeGrader: vi.fn(), gradeDeal: vi.fn(), loadNativePlayerNames: h.names }))
vi.mock('@/lib/trade-intel/viewerLeagueRoster', () => ({ resolveViewerLeagueRoster: vi.fn() }))
import { loadNhlHistoricalLineups, scoreNhlHistoricalBox } from '@/lib/league-trade-engine/nhlHistoricalLineup'
import { evaluateServerTradeDecision } from '@/lib/league-trade-engine/serverTradeDecision'
import { buildTradeDecisionSnapshot } from '@/lib/league-trade-engine/tradeDecisionSnapshot'
import { publicTradeDecisionReceipt } from '@/lib/league-trade-engine/tradeDecisionReceipt'
import { gradeTrade } from '@/lib/decision-os/trade/tradeGrade'

const league = { id: 'league', sport: 'NHL', platform: 'fantrax', platformLeagueId: 'source',
  season: 2026, leagueSize: 160, scoring: 'points', starters: ['FLEX_CW'], leagueType: 'redraft',
  isDynasty: false, settings: { scoringSettings: { rules: { goals: 1 } } },
  waiverBudget: null, irSlots: null, taxiSlots: null }
const sourceSettings = { scoringSystem: { scoringCategorySettings: [{ group: { code: 'HOCKEY_SKATING' },
  configs: [{ points: 1, position: { shortName: 'Default' }, scoringCategory: { code: 'INDIVIDUAL_GOALS' } }] }] } }
const rosters = [1, 2, 3].map((i) => ({ id: `r${i}`, platformUserId: `u${i}`, playerData: { players: [`f${i}`] } }))
const input = { leagueId: 'league', participantRosterIds: ['r1', 'r2', 'r3'], capturedAt: '2026-11-01T12:00:00Z',
  assets: [1, 2, 3].map((i) => ({ itemType: 'player' as const, itemReference: `f${i}`,
    fromRosterId: `r${i}`, toRosterId: `r${i % 3 + 1}` })) }
const games = () => [1, 2, 3].flatMap((i) => Array.from({ length: 5 }, (_, n) => ({ playerId: `p${i}`,
  gameId: `g${i}-${n}:skaters`, providerGameId: `g${i}-${n}`, season: 2026,
  normalizedStatMap: { seasonType: 'regular', stats: { goals: i } } })))

const grade = (giveValue: number, getValue: number) => gradeTrade({ giveValue, getValue,
  giveMarket: giveValue, getMarket: getValue, unpriced: 0, giveCount: 1, getCount: 1,
  basis: 'NHL league points over replacement', scoringApplied: true, needApplied: false,
  needGap: null, lines: [], moves: [] })

beforeEach(() => {
  vi.resetAllMocks()
  h.names.mockResolvedValue(() => null)
  h.league.mockResolvedValue({ ...league, settings: { ...league.settings, fantrax_settings: sourceSettings } })
  h.rosters.mockResolvedValue(rosters)
  h.identities.mockResolvedValue([1, 2, 3].map((i) => ({ id: `p${i}`, fantraxId: `f${i}`,
    position: 'C', espnId: null, sleeperId: null })))
  h.games.mockResolvedValue(games())
  h.finals.mockResolvedValue(games().map((row) => ({ externalId: row.providerGameId, status: 'final' })))
})

describe('current-main NHL historical integration', () => {
  it.each([true, false])('preserves the supported two-team NHL grade with canonical evidence %s', async (canonical) => {
    h.rosters.mockResolvedValue(rosters.slice(0, 2))
    h.evaluate.mockResolvedValue({ grade: grade(5000, 6000), partnerGrade: grade(6000, 5000),
      canonical: canonical ? { participants: ['r1', 'r2'].map((rosterId) => ({ rosterId,
        action: 'review', recommendation: '', coverageStatus: 'complete', coveragePct: 100,
        fairnessScore: 80, confidenceScore: 90,
        rosterImpact: { startingPointsBefore: 100, startingPointsAfter: 104, startingPointsDelta: 4 } })) } : null })
    const result = await evaluateServerTradeDecision({ ...input, participantRosterIds: ['r1', 'r2'],
      assets: [{ ...input.assets[0]! }, { ...input.assets[1]!, toRosterId: 'r1' }],
      proposerRosterId: 'r1', receiverRosterId: 'r2', season: 2026 })
    expect(h.evaluate).toHaveBeenCalledOnce()
    expect(result.participants[0]).toMatchObject({ grade: 'B', valueGiven: 5000, valueReceived: 6000,
      lineupPointsDelta: 1 })
    expect(result.participants[1]).toMatchObject({ grade: 'D', lineupPointsDelta: -1 })
    expect(result.lineupBasis).toBe('historical_points_per_game')
  })
  it('blocks malformed roster entries instead of silently dropping them', async () => {
    h.rosters.mockResolvedValue([{ ...rosters[0], playerData: { players: ['f1', null] } }, ...rosters.slice(1)])
    const rows = await loadNhlHistoricalLineups(input)
    expect(rows?.every((row) => row.status === 'blocked')).toBe(true)
    expect(rows?.[0]?.reason).toContain('malformed')
    expect(h.games).not.toHaveBeenCalled()
  })
  it('withholds the proposal grade for malformed NHL roster data', async () => {
    h.rosters.mockResolvedValue([{ ...rosters[0], playerData: { players: ['f1', null] } }, rosters[1]])
    const gradeProposal = vi.fn()
    const result = await evaluateServerTradeDecision({ ...input, participantRosterIds: ['r1', 'r2'],
      assets: [{ ...input.assets[0]! }, { ...input.assets[1]!, toRosterId: 'r1' }],
      proposerRosterId: 'r1', receiverRosterId: 'r2',
      season: 2026, gradeProposal })
    expect(result.lineupBasis).toBe('historical_points_per_game')
    expect(result.lineupCoverage?.every((row) => row.status === 'blocked')).toBe(true)
    expect(result.participants.every((row) => row.grade === null && row.lineupPointsDelta === null)).toBe(true)
    expect(gradeProposal).not.toHaveBeenCalled()
    expect(h.evaluate).not.toHaveBeenCalled()
  })
  it('preserves the market grade when NHL lineup history is unavailable', async () => {
    h.games.mockRejectedValue(new Error('storage unavailable'))
    h.rosters.mockResolvedValue(rosters.slice(0, 2))
    h.evaluate.mockResolvedValue({ grade: grade(5000, 6000), partnerGrade: grade(6000, 5000), canonical: null })
    const result = await evaluateServerTradeDecision({ ...input, participantRosterIds: ['r1', 'r2'],
      assets: [{ ...input.assets[0]! }, { ...input.assets[1]!, toRosterId: 'r1' }],
      proposerRosterId: 'r1', receiverRosterId: 'r2', season: 2026 })
    expect(h.evaluate).toHaveBeenCalledOnce()
    expect(result.lineupCoverage?.map((row) => row.status)).toEqual(['blocked', 'blocked'])
    expect(result.participants).toMatchObject([
      { grade: 'B', valueGiven: 5000, valueReceived: 6000, lineupPointsDelta: null },
      { grade: 'D', valueGiven: 6000, valueReceived: 5000, lineupPointsDelta: null },
    ])
  })
  it('requires every weighted stat, including a verified zero, and keeps goalie weights distinct', () => {
    expect(scoreNhlHistoricalBox({ stats: { goals: 0 } }, { goals: 4, assists: 3 }, false)).toBeNull()
    expect(scoreNhlHistoricalBox({ stats: { goals: 0, assists: 0 } }, { goals: 4, assists: 3 }, false)).toBe(0)
    expect(scoreNhlHistoricalBox({ stats: { goalie_penalty_minutes: 2 } },
      { penalty_minutes: 0.2, goalie_penalty_minutes: 0.5 }, true)).toBe(1)
  })
  it('computes every real participant without assuming a small league or crossing provider namespaces', async () => {
    const rows = await loadNhlHistoricalLineups(input)
    expect(rows?.map((row) => row.status)).toEqual(['verified', 'verified', 'verified'])
    expect(rows?.map((row) => row.delta)).toEqual([2, -1, -1])
    expect(JSON.stringify(h.identities.mock.calls)).not.toContain('rollingInsightsId')
    expect(h.games.mock.calls[0]![0].where).toMatchObject({ gameDate: { lte: new Date(input.capturedAt) },
      fetchedAt: { lte: new Date(input.capturedAt) } })
  })
  it('withholds an incomplete sample and duplicate or ambiguous transfers', async () => {
    h.games.mockResolvedValue(games().slice(1))
    expect((await loadNhlHistoricalLineups(input))?.[0]).toMatchObject({ status: 'blocked', missingScoredHistory: 1 })
    expect((await loadNhlHistoricalLineups({ ...input, assets: [...input.assets, input.assets[0]!] }))
      ?.every((row) => row.status === 'blocked')).toBe(true)
  })
  it('freezes historical evidence without a market grade, projection or outcome claim', async () => {
    const gradeProposal = vi.fn()
    const result = await evaluateServerTradeDecision({ ...input, proposerRosterId: 'r1', receiverRosterId: 'r2',
      season: 2026, gradeProposal })
    expect(gradeProposal).not.toHaveBeenCalled()
    expect(result.participants.every((row) => row.grade === null)).toBe(true)
    const snapshot = buildTradeDecisionSnapshot({ league, rosters, assets: input.assets,
      proposedByUserId: 'u1', managerStrategy: null, tradeSettings: {}, serverDecisionResult: result })
    const receipt = publicTradeDecisionReceipt({ ...snapshot, capturedAt: new Date(input.capturedAt) })
    expect(receipt).toMatchObject({ lineupBasis: 'historical_points_per_game', projectionsVerified: false,
      assetValuesVerified: false, outcomeVerified: false, contextualGradeAllowed: false })
    expect(receipt.participantDecisions[0]!.reason).toContain('Historical')
    expect(receipt.lineupCoverage).toHaveLength(3)
  })
})
