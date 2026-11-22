import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Hub operability, 2026-11-20: each slice the +10% push added has its own kill switch (`lib/decision-os/flags.ts`).
 * Killed, the slice is a `disabled` gap and its builder never runs; the other four are untouched.
 */

const loadWaiver = vi.fn()

vi.mock('@/lib/decision-os/grounding/decisionBridge', () => ({
  loadWaiverDecisionSlice: loadWaiver,
  loadCommissionerHealthDecisionSlice: vi.fn(async () => null),
}))
vi.mock('@/lib/decision-os/import-os', () => ({ createImportOsLoaders: () => ({ loadAssertions: vi.fn(async () => null) }) }))
vi.mock('@/lib/decision-os/league-os', () => ({ createLeagueOsLoaders: () => ({ loadRules: vi.fn(async () => null) }) }))
vi.mock('@/lib/decision-os/value-os', () => ({
  createValueOsLoaders: () => ({ loadMarket: vi.fn(async () => null), loadDevy: vi.fn(async () => null) }),
}))
vi.mock('@/lib/decision-os/projection-os', () => ({ createProjectionOsLoaders: () => ({ loadFor: vi.fn(async () => null) }) }))
vi.mock('@/lib/chimmy-context/ChimmyContextEngine', () => ({
  ChimmyContextEngine: class {
    loadContext = vi.fn(async () => {
      throw new Error('not under test')
    })
  },
}))
vi.mock('@/lib/intelligence/chimmy/resolveChimmyGrounding', () => ({ resolveCommissionerGroundingOutcome: vi.fn(async () => null) }))
vi.mock('@/lib/intelligence/chimmy/leagueIntelligenceGrounding', () => ({ resolveLeagueIntelligenceGrounding: vi.fn(async () => null) }))
vi.mock('@/lib/intelligence/chimmy/portfolioGrounding', () => ({ resolvePortfolioGrounding: vi.fn(async () => null) }))
const killedFeeds = new Set<string>()
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({ enabled: (f: string) => !killedFeeds.has(f), killed: [...killedFeeds] }),
}))


const lineup = vi.fn(async () => 'LINEUP')
const pending = vi.fn(async () => 'INBOX')
const board = vi.fn(async () => 'BOARD')
const records = vi.fn(async () => ({ text: 'RECORDS', locked: false }))
const valueBoard = vi.fn(async () => ({ kind: 'unavailable', sport: 'NBA', reason: 'x' }))
vi.mock('@/lib/chimmy/myTeamLineupGrounding', () => ({ buildMyTeamLineupContext: lineup }))
vi.mock('@/lib/chimmy-trade/pendingTradeDecisionGrounding', () => ({ buildPendingTradeDecisionContext: pending }))
vi.mock('@/lib/chimmy/draftGrounding', () => ({ buildDraftContext: board }))
vi.mock('@/lib/chimmy/managerRecordGrounding', () => ({ buildManagerRecordContext: records }))
vi.mock('@/lib/sport-values/leagueValueBoard', async (orig) => ({ ...(await orig<object>()), loadLeagueValueBoard: valueBoard }))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { DECISION_OS_FEEDS } = await vi.importActual<typeof import('@/lib/decision-os/flags')>('@/lib/decision-os/flags')

const ALL = { myTeamLineup: true, pendingTrades: true, draftBoard: true, managerRecords: true, values: true }
const build = (sport = 'NFL') => buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport, season: 2026, want: ALL })

const CASES = [
  { feed: 'myTeamLineup', builder: lineup, sport: 'NFL' },
  { feed: 'pendingTrades', builder: pending, sport: 'NFL' },
  { feed: 'draftBoard', builder: board, sport: 'NFL' },
  { feed: 'managerRecords', builder: records, sport: 'NFL' },
  { feed: 'rosterBoardValues', builder: valueBoard, sport: 'NBA' },
] as const

describe('the five new slices each have their own kill switch', () => {
  beforeEach(() => {
    killedFeeds.clear()
    for (const c of CASES) c.builder.mockClear()
  })

  it('are all listed as feeds an operator can switch', () => {
    for (const c of CASES) expect(DECISION_OS_FEEDS).toContain(c.feed)
  })

  for (const c of CASES) {
    it(`${c.feed}: killed, it is a disabled gap, its builder never runs, and the others still run`, async () => {
      killedFeeds.add(c.feed)
      const packet = (await build(c.sport)) as unknown as Record<string, { present: boolean; gap?: { reason: string } }>
      expect(packet[c.feed]).toMatchObject({ present: false, gap: { reason: 'disabled' } })
      expect(c.builder).not.toHaveBeenCalled()
      const others = CASES.filter((o) => o.feed !== c.feed && o.sport === c.sport)
      for (const o of others) expect(o.builder).toHaveBeenCalled()
    })
  }
})
