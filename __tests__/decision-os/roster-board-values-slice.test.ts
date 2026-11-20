import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Player Value OS, 2026-11-20 re-score push: in an NBA / MLB / NHL league the asker's roster reaches the packet priced
 * on the league's own value board — the trade grade's price. These sports had no value slice at all; values reached
 * Chimmy only when the model called the per-player tool.
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



const board = vi.hoisted(() => ({ load: vi.fn(), value: vi.fn() }))
vi.mock('@/lib/sport-values/leagueValueBoard', () => ({
  isBoardValueSport: (s: string | null | undefined) => ['NBA', 'MLB', 'NHL'].includes(String(s ?? '').toUpperCase()),
  loadLeagueValueBoard: board.load,
  boardPlayerValue: board.value,
}))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { serializeDecisionOsGroundingForPrompt } = await import('@/lib/decision-os/grounding/serialize')
const { renderRosterBoardValues } = await import('@/lib/decision-os/grounding/rosterBoardValues')

const ROSTER = {
  starters: [{ playerId: 'p1', name: 'Star Guard', position: 'PG' }, { playerId: 'p2', name: 'Big Wing', position: 'SF' }],
  bench: [{ playerId: 'p3', name: 'Unknown Rook', position: 'C' }],
}
const okBoard = { kind: 'ok', sport: 'NBA', ctx: {}, byId: new Map() }
const priced = (value: number, perGame: number) => ({
  available: true,
  data: { sport: 'NBA', unit: 'fantasy points', perGame, replacementPerGame: 20, replacementName: 'FA', value, gamesRemaining: 50, scheduleKnown: true, seasonLabel: '2026-27', sample: null, baselineSeasonLabel: null, dynastyValue: null, age: null },
})

beforeEach(() => {
  killedFeeds.clear()
  board.load.mockReset()
  board.value.mockReset()
  board.value.mockImplementation((_b: unknown, a: { playerId: string }) =>
    a.playerId === 'p1' ? priced(900, 38) : a.playerId === 'p2' ? priced(1200, 44) : { available: false, reason: 'not on the board' },
  )
})

describe('renderRosterBoardValues', () => {
  it('prices the roster most valuable first, with the unit, and lists who is not on the board as NOT zero', () => {
    const r = renderRosterBoardValues(okBoard as never, ROSTER)
    expect(r.kind).toBe('ok')
    const text = (r as { text: string }).text
    expect(text.indexOf('Big Wing')).toBeLessThan(text.indexOf('Star Guard'))
    expect(text).toContain('Big Wing (SF): 1,200 fantasy points over replacement rest of season (44/game vs 20 for the best free agent)')
    expect(text).toContain('Not on the board (no value, NOT zero): Unknown Rook (C)')
    expect(text).toContain('not the AllFantasy 0–10000 NFL scale')
  })

  it('a board sport whose board is unavailable says why; an empty roster says so', () => {
    expect(renderRosterBoardValues({ kind: 'unavailable', sport: 'NBA', reason: 'No games yet.' } as never, ROSTER)).toEqual({ kind: 'unavailable', reason: 'No games yet.' })
    expect(renderRosterBoardValues(okBoard as never, { starters: [], bench: [] }).kind).toBe('unavailable')
  })
})

describe('grounding packet — roster board values', () => {
  it('an NFL league never loads a board', async () => {
    await buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NFL', season: 2026, want: { values: true } })
    expect(board.load).not.toHaveBeenCalled()
  })

  it('an NBA league loads the board in the first wave and, with no roster from the context engine, says so', async () => {
    board.load.mockResolvedValue(okBoard)
    const packet = await buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NBA', season: 2026, want: { values: true } })
    expect(board.load).toHaveBeenCalledWith('lg1')
    // The context engine is stubbed to fail here, so there is no roster to price — a named gap, never a silent drop.
    expect(packet.rosterBoardValues).toMatchObject({ present: false, gap: { reason: 'not_computed' } })
  })

  it('values not asked for: nothing loads', async () => {
    await buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NBA', season: 2026, want: {} })
    expect(board.load).not.toHaveBeenCalled()
  })

  it('renders in the prompt under its own name when present', () => {
    const r = renderRosterBoardValues(okBoard as never, ROSTER) as { text: string }
    const packet = {
      leagueId: 'lg1', userId: 'u1', builtAt: '2026-11-20T00:00:00Z', contextFacts: null, contextLookups: null, gaps: [],
      meta: { durationMs: 1, engineMs: null, sources: [], killedFeeds: [] },
      rosterBoardValues: { present: true, value: r.text, asOf: null, servedFrom: 'live', confidence: null, conclusive: { ok: true }, gap: null },
    }
    const text = serializeDecisionOsGroundingForPrompt(packet as never)
    expect(text).toContain("Your roster values (this league's board)")
    expect(text).toContain('Big Wing (SF): 1,200 fantasy points')
  })
})

describe('a board read that throws', () => {
  it('becomes a named gap, never a rejected packet', async () => {
    board.load.mockRejectedValue(new Error('db down'))
    const packet = await buildDecisionOsGroundingPacket({ leagueId: 'lg1', userId: 'u1', sport: 'NHL', season: 2026, want: { values: true } })
    expect(packet.rosterBoardValues).toMatchObject({ present: false })
  })
})
