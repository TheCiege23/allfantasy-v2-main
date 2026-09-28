import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { TradeAssetInput } from '@/lib/trade-value-console/types'

const m = vi.hoisted(() => ({
  loadLeagueForTrade: vi.fn(),
  readLeagueTradeRows: vi.fn(),
  findPartners: vi.fn(),
  findPackages: vi.fn(),
  getMarketValues: vi.fn(),
  readFormatRules: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/trade-value-console/league-loader', () => ({ loadLeagueForTrade: m.loadLeagueForTrade }))
vi.mock('@/lib/trade-intel/marketValueService', () => ({ getMarketValues: m.getMarketValues }))
vi.mock('@/lib/trade-intel/marketContext', () => ({ marketContextFor: () => ({ scoring: { settings: {} }, variant: {}, teams: 12 }) }))
vi.mock('@/lib/trade-intel/leagueFormatRules', () => ({ readFormatRules: m.readFormatRules }))
vi.mock('@/lib/trade-discovery/redraftTradeDiscovery', () => ({ findPartners: m.findPartners, findPackages: m.findPackages }))
vi.mock('@/lib/decision-os/trade/leagueTradeGrader', () => ({ createLeagueTradeGrader: vi.fn() }))
vi.mock('@/lib/decision-os/trade/tradeAgentStore', () => ({ saveTradeAgentSuggestions: vi.fn() }))
vi.mock('@/lib/core-app/playerTradeVisual', () => ({
  readLeagueTradeRows: m.readLeagueTradeRows,
  readTradePlayerRows: async () => new Map(),
  rosterSlotsOf: () => null,
  tradeRosterPlayerIds: () => [],
  teamForTradeRoster: (teams: Array<{ platformUserId: string }>, r: { platformUserId: string }) => teams.find((t) => t.platformUserId === r.platformUserId) ?? null,
  callerTradeSeat: (rows: { teams: Array<{ claimedByUserId: string | null; platformUserId: string }>; rosters: Array<{ platformUserId: string }> }, userId: string) => {
    const yours = rows.teams.find((t) => t.claimedByUserId === userId) ?? null
    return { yours, myRoster: rows.rosters.find((r) => r.platformUserId === yours?.platformUserId) ?? null }
  },
  toDiscoveryPlayers: (r: { platformUserId: string }) => [{ playerId: `${r.platformUserId}-p`, playerName: 'x', position: 'WR', value: 1, isLocked: false }],
  toDiscoveryRoster: (team: { teamName?: string } | null, rosterId: string, players: unknown[]) => ({ rosterId, teamName: team?.teamName ?? 'Team', managerDisplayName: null, players }),
}))

import { runTradeAgentForLeague } from '@/lib/decision-os/trade/tradeAgent'

const league = (over: Record<string, unknown> = {}) => ({
  id: 'L1', platform: 'sleeper', sport: 'NFL', leagueSize: 12, isDynasty: true, leagueType: 'dynasty', settings: {}, leagueVariant: null, starters: [], ...over,
})
const rows = {
  teams: [
    { platformUserId: 'r1', externalId: '1', claimedByUserId: 'u1', teamName: 'Mine' },
    { platformUserId: 'r2', externalId: '2', claimedByUserId: null, teamName: 'Theirs' },
    { platformUserId: 'r3', externalId: '3', claimedByUserId: null, teamName: 'Third' },
  ],
  rosters: [
    { platformUserId: 'r1', playerData: { players: ['a'] } },
    { platformUserId: 'r2', playerData: { players: ['b'] } },
    { platformUserId: 'r3', playerData: { players: ['c'] } },
  ],
}
const pkg = (give: string, get: string, band = 'balanced') => ({
  giveAssets: [{ kind: 'player', playerId: give, playerName: `P${give}`, position: 'WR', value: 1 }],
  receiveAssets: [{ kind: 'player', playerId: get, playerName: `P${get}`, position: 'RB', value: 1 }],
  fairnessBand: band,
})

const view = (letter: string, fit: number | null, percentDiff = 2): TradeGradeView =>
  ({
    graded: true, letter, partnerLetter: letter === 'C' ? 'C' : 'D', percentDiff, label: 'Even', sideAdvantage: 'even', action: 'review', recommendation: '',
    giveValue: 5000, getValue: 5100, giveMarket: 5000, getMarket: 5100, basis: 'Dynasty chart', scoringApplied: true, needApplied: false, needGap: null,
    lines: [], moves: [], rosterFit: fit == null ? null : { giveValue: 1, getValue: 1, percentDiff: fit, moves: [] },
  }) as TradeGradeView

type GradeArgs = { give: TradeAssetInput[]; get: TradeAssetInput[]; viewerSide: boolean; needRoster?: { playerData: unknown } }

function graderFrom(fn: (a: GradeArgs) => TradeGradeView) {
  const grade = vi.fn(async (a: GradeArgs) => fn(a))
  return { grade, createGrader: vi.fn(async () => ({ leagueId: 'L1', chart: {}, leagueType: {}, grade })) as never }
}

const idOf = (a: TradeAssetInput) => (a.kind === 'player' ? a.providerIdentity?.id : null)
const isViewer = (a: GradeArgs) => (a.needRoster?.playerData as { players: string[] }).players[0] === 'a'

beforeEach(() => {
  vi.clearAllMocks()
  m.loadLeagueForTrade.mockResolvedValue(league())
  m.readLeagueTradeRows.mockResolvedValue(rows)
  m.getMarketValues.mockResolvedValue({})
  m.readFormatRules.mockReturnValue({ concept: 'dynasty' })
  m.findPartners.mockReturnValue([{ rosterId: 'r2' }, { rosterId: 'r3' }])
  m.findPackages.mockImplementation(({ partnerRoster }: { partnerRoster: { rosterId: string } }) =>
    partnerRoster.rosterId === 'r2' ? [pkg('1', '2'), pkg('3', '4', 'lopsided')] : [pkg('5', '6')],
  )
})

describe('runTradeAgentForLeague', () => {
  it('saves a C/C deal on which both rosters gain — graded by id, from each side, with each side’s own roster', async () => {
    const { grade, createGrader } = graderFrom((a) => (isViewer(a) ? view('C', 5) : view('C', 3)))
    const save = vi.fn(async () => 2)
    const out = await runTradeAgentForLeague('L1', '2026-09-28', { createGrader, save })

    expect(out).toMatchObject({ managers: 1, saved: 2, partial: false })
    // The lopsided package is never graded; the other two are graded from both sides.
    expect(grade).toHaveBeenCalledTimes(4)
    const first = grade.mock.calls[0]![0] as GradeArgs
    expect(first).toMatchObject({ viewerSide: true, needRoster: { playerData: { players: ['a'] } } })
    expect(idOf(first.give[0]!)).toBe('1')
    const partnerSide = grade.mock.calls[1]![0] as GradeArgs
    expect(partnerSide.needRoster).toEqual({ playerData: { players: ['b'] } })
    expect(idOf(partnerSide.give[0]!)).toBe('2')

    const saved = (save.mock.calls[0] as unknown as [{ userId: string; runDate: string; suggestions: Array<Record<string, unknown>> }])[0]
    expect(saved).toMatchObject({ leagueId: 'L1', userId: 'u1', rosterId: 'r1', runDate: '2026-09-28' })
    expect(saved.suggestions[0]).toMatchObject({ letter: 'C', partnerLetter: 'C', viewerFitPct: 5, partnerFitPct: 3, dealKey: 'g:1|r:2' })
  })

  it('a deal that is not C for the viewer is never graded from the partner’s side', async () => {
    const { grade, createGrader } = graderFrom((a) => (isViewer(a) ? view('B', 9, 12) : view('C', 3)))
    const save = vi.fn(async () => 0)
    await runTradeAgentForLeague('L1', '2026-09-28', { createGrader, save })
    expect(grade.mock.calls.every(([a]) => isViewer(a as GradeArgs))).toBe(true)
    expect((save.mock.calls[0] as unknown as [{ suggestions: unknown[] }])[0].suggestions).toEqual([])
  })

  it('a deal on which the partner’s roster does not gain is not suggested', async () => {
    const { createGrader } = graderFrom((a) => (isViewer(a) ? view('C', 5) : view('C', -1)))
    const save = vi.fn(async () => 0)
    await runTradeAgentForLeague('L1', '2026-09-28', { createGrader, save })
    expect((save.mock.calls[0] as unknown as [{ suggestions: unknown[] }])[0].suggestions).toEqual([])
  })

  it('a manager the budget interrupts keeps last night’s list — nothing is saved for them', async () => {
    const { createGrader } = graderFrom(() => view('C', 5))
    const save = vi.fn(async () => 0)
    let calls = 0
    const out = await runTradeAgentForLeague('L1', '2026-09-28', { createGrader, save, shouldStop: () => ++calls > 2 })
    expect(out.partial).toBe(true)
    expect(save).not.toHaveBeenCalled()
  })

  it.each([
    ['a non-NFL league', () => m.loadLeagueForTrade.mockResolvedValue(league({ sport: 'NBA' })), /NFL leagues only/],
    ['a devy league', () => m.loadLeagueForTrade.mockResolvedValue(league({ leagueType: 'devy' })), /devy leagues yet/],
    ['no claimed team', () => m.readLeagueTradeRows.mockResolvedValue({ ...rows, teams: rows.teams.map((t) => ({ ...t, claimedByUserId: null })) }), /no AllFantasy manager/],
    ['no market values', () => m.getMarketValues.mockResolvedValue(null), /no market values/],
  ])('skips %s with a reason and grades nothing', async (_what, arrange, reason) => {
    arrange()
    const { grade, createGrader } = graderFrom(() => view('C', 5))
    const out = await runTradeAgentForLeague('L1', '2026-09-28', { createGrader, save: vi.fn() })
    expect(out.skipped).toMatch(reason)
    expect(grade).not.toHaveBeenCalled()
  })
})
