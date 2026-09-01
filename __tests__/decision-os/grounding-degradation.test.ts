import { describe, it, expect, vi, beforeEach } from 'vitest'

import type { ImportAssertions } from '@/lib/decision-os/import/assertions'
import type { GroundedSlice } from '@/lib/decision-os/grounding/packet'

/**
 * 5.2 — every path degrades to a NAMED GAP, never to a zero and never to silence.
 *
 * ── 🛑 WHY THIS SUITE EXISTS AS A SUITE ─────────────────────────────────────────────────────
 * `grounding-packet-gaps.test.ts` tests the pure helpers with hand-built slices. That proves
 * `collectGaps` behaves; it cannot prove the BUILDER ever produces the slices it is given. Both
 * regressions caught here were invisible to it, because both live in the assembly:
 *
 *   1. `rows ? present(rows) : absent(…)` accepts `[]`, which is truthy. A cold league produced
 *      "available" with nothing in it, and the serializer wrote `- Projections: available`.
 *   2. When `ChimmyContextEngine.loadContext` threw, eight facts became `contextFacts = null` and
 *      the gap list — built by walking `contextFacts` — carried ZERO gaps for them. Not a zero: a
 *      silence. The model was handed a complete-LOOKING picture.
 *
 * ⚠ SO THE ASSERTIONS ARE STRUCTURAL, NOT PER-SLICE. A test naming eight slices one by one goes
 * green forever the moment a ninth is added. `everySlice()` walks the packet, so a new slice is
 * covered on the day it lands or the suite says why not.
 */

const HOUR = 3_600_000
const NOW = Date.parse('2026-08-31T20:00:00.000Z')

const loadAssertions = vi.fn()
const loadRules = vi.fn()
const loadMarket = vi.fn()
const loadDevy = vi.fn()
const loadFor = vi.fn()
const loadContext = vi.fn()
const commissioner = vi.fn()
const leagueIntel = vi.fn()
const portfolio = vi.fn()

vi.mock('@/lib/decision-os/import-os', () => ({
  createImportOsLoaders: () => ({ loadAssertions }),
}))
vi.mock('@/lib/decision-os/league-os', () => ({
  createLeagueOsLoaders: () => ({ loadRules }),
}))
vi.mock('@/lib/decision-os/value-os', () => ({
  createValueOsLoaders: () => ({ loadMarket, loadDevy }),
}))
vi.mock('@/lib/decision-os/projection-os', () => ({
  createProjectionOsLoaders: () => ({ loadFor }),
}))
vi.mock('@/lib/chimmy-context/ChimmyContextEngine', () => ({
  ChimmyContextEngine: class {
    loadContext = loadContext
  },
}))
vi.mock('@/lib/intelligence/chimmy/resolveChimmyGrounding', () => ({
  resolveCommissionerGroundingOutcome: commissioner,
}))
vi.mock('@/lib/intelligence/chimmy/leagueIntelligenceGrounding', () => ({
  resolveLeagueIntelligenceGrounding: leagueIntel,
}))
vi.mock('@/lib/intelligence/chimmy/portfolioGrounding', () => ({
  resolvePortfolioGrounding: portfolio,
}))

const { buildDecisionOsGroundingPacket } = await import('@/lib/decision-os/grounding/packet')
const { serializeDecisionOsGroundingForPrompt } = await import('@/lib/decision-os/grounding/serialize')

function assertions(over: Partial<ImportAssertions> = {}): ImportAssertions {
  return {
    leagueId: 'lg1',
    provider: 'fantrax',
    externalLeagueId: 'x',
    season: 2026,
    lastAttemptedSyncAt: new Date(NOW - HOUR).toISOString(),
    lastSuccessfulSyncAt: new Date(NOW - HOUR).toISOString(),
    staleMs: HOUR,
    syncStatus: 'completed',
    consecutiveFailures: 0,
    scopes: [
      { scope: 'league_state', completedLastRun: true, incomplete: false, hasCheckpoint: true },
      { scope: 'teams_rosters', completedLastRun: true, incomplete: false, hasCheckpoint: true },
      { scope: 'traded_picks', completedLastRun: true, incomplete: false, hasCheckpoint: true },
    ],
    parity: 'matched',
    parityNote: null,
    rosterCoverage: 1,
    rostersHeld: 12,
    rostersExpected: 12,
    managerIdentityCoverage: 1,
    managersMapped: 12,
    managersTotal: 12,
    ...over,
  }
}

/** The twelve providers, all healthy, with whatever slice values the case wants. */
function bundle(over: Record<string, unknown> = {}) {
  const names = [
    'matchup',
    'roster',
    'standings',
    'rankings',
    'leagueDifficulty',
    'importHistory',
    'replayInsights',
    'devy',
  ]
  return {
    matchup: { a: 1 },
    roster: { a: 1 },
    standings: { a: 1 },
    rankings: { a: 1 },
    leagueDifficulty: { a: 1 },
    importedHistory: { a: 1 },
    replayInsights: { a: 1 },
    devy: { a: 1 },
    user: { id: 'u1' },
    activeLeague: { id: 'lg1' },
    sportsSchedule: { games: [] },
    meta: { providers: names.map((name) => ({ name, cached: false, error: null })) },
    ...over,
  }
}

/**
 * Every `GroundedSlice` on a packet, named. Walks `contextFacts` rather than listing its members,
 * so a new slice cannot quietly escape the invariants below.
 */
function everySlice(p: Awaited<ReturnType<typeof buildDecisionOsGroundingPacket>>) {
  const out: Array<[string, GroundedSlice<unknown>]> = [
    ['importAssertions', p.importAssertions as GroundedSlice<unknown>],
    ['leagueRules', p.leagueRules],
    ['marketValues', p.marketValues as GroundedSlice<unknown>],
    ['devyValues', p.devyValues as GroundedSlice<unknown>],
    ['projections', p.projections as GroundedSlice<unknown>],
    ['commissionerIntelligence', p.commissionerIntelligence as GroundedSlice<unknown>],
    ['leagueIntelligence', p.leagueIntelligence as GroundedSlice<unknown>],
    ['portfolio', p.portfolio as GroundedSlice<unknown>],
  ]
  if (p.contextFacts) {
    for (const [k, v] of Object.entries(p.contextFacts)) out.push([k, v as GroundedSlice<unknown>])
  }
  return out
}

const ARGS = {
  leagueId: 'lg1',
  userId: 'u1',
  sport: 'NFL',
  season: 2026,
  week: 3,
  valueFormat: { format: 'ppr', qbFormat: '1qb' },
  want: { values: true, devy: true, projections: true, leagueRules: true },
}

beforeEach(() => {
  vi.clearAllMocks()
  // The healthy baseline. Each test degrades exactly one thing, so a failure names its own cause.
  loadAssertions.mockResolvedValue(assertions())
  loadRules.mockResolvedValue({ scoring: {} })
  loadMarket.mockResolvedValue([{ status: 'ok', value: { playerId: 'p1' } }])
  loadDevy.mockResolvedValue([{ status: 'ok', value: { playerId: 'p2' } }])
  loadFor.mockResolvedValue([{ playerId: 'p1', computedAt: new Date(NOW).toISOString() }])
  loadContext.mockResolvedValue(bundle())
  commissioner.mockResolvedValue({ status: 'ok', text: 'commissioner brief' })
  leagueIntel.mockResolvedValue('league brief')
  portfolio.mockResolvedValue('portfolio brief')
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('5.2 — the structural invariants, checked on every slice the packet carries', () => {
  it('an absent slice ALWAYS carries a gap, and the gap always carries a remedy', async () => {
    // The cold-league case: nothing has ever been computed for this league.
    loadAssertions.mockResolvedValue(null)
    loadRules.mockResolvedValue(null)
    loadMarket.mockResolvedValue(null)
    loadDevy.mockResolvedValue(null)
    loadFor.mockResolvedValue(null)
    loadContext.mockResolvedValue(bundle({ matchup: null, roster: null, standings: null }))
    commissioner.mockResolvedValue({ status: 'unavailable' })
    leagueIntel.mockResolvedValue(null)
    portfolio.mockResolvedValue(null)

    const p = await buildDecisionOsGroundingPacket(ARGS)

    const offenders = everySlice(p)
      .filter(([, s]) => !s.present)
      .filter(([, s]) => s.gap == null || !s.gap.detail.trim() || !s.gap.remedy.trim())
      .map(([n]) => n)
    // Named, not counted: "expected 1 to be 0" would not say which slice went silent.
    expect(offenders).toEqual([])
  })

  it('🛑 a present slice is never an empty collection', async () => {
    // The regression. `[]` is truthy, so `rows ? present(rows) : absent(…)` reported "available".
    loadMarket.mockResolvedValue([])
    loadDevy.mockResolvedValue([])
    loadFor.mockResolvedValue([])
    leagueIntel.mockResolvedValue('   ')
    portfolio.mockResolvedValue('')

    const p = await buildDecisionOsGroundingPacket(ARGS)

    const emptyButPresent = everySlice(p)
      .filter(([, s]) => s.present)
      .filter(([, s]) => {
        const v = s.value
        if (Array.isArray(v)) return v.length === 0
        if (typeof v === 'string') return v.trim().length === 0
        return false
      })
      .map(([n]) => n)
    expect(emptyButPresent).toEqual([])
  })

  it('an empty producer result becomes a NAMED gap rather than disappearing', async () => {
    loadMarket.mockResolvedValue([])
    loadFor.mockResolvedValue([])

    const p = await buildDecisionOsGroundingPacket(ARGS)
    const named = p.gaps.map((g) => g.slice)
    expect(named).toContain('marketValues')
    expect(named).toContain('projections')
    for (const g of p.gaps) expect(g.remedy.trim().length).toBeGreaterThan(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('5.2 — the context engine going down must be loud', () => {
  it('🛑 eight named gaps, not silence, when loadContext throws', async () => {
    loadContext.mockRejectedValue(new Error('engine exploded'))

    const p = await buildDecisionOsGroundingPacket(ARGS)

    expect(p.contextFacts).not.toBeNull()
    const contextGaps = p.gaps.filter((g) =>
      ['matchup', 'roster', 'standings', 'rankings', 'leagueDifficulty', 'importedHistory', 'replayInsights', 'devy'].includes(
        g.slice,
      ),
    )
    expect(contextGaps).toHaveLength(8)
    for (const g of contextGaps) expect(g.remedy.trim().length).toBeGreaterThan(0)
  })

  it('and the prompt SAYS so — a reader must not be handed a complete-looking picture', async () => {
    loadContext.mockRejectedValue(new Error('engine exploded'))

    const text = serializeDecisionOsGroundingForPrompt(await buildDecisionOsGroundingPacket(ARGS), NOW)
    expect(text).toContain('WHAT IS MISSING, AND WHY:')
    expect(text).toMatch(/matchup/)
    expect(text).toMatch(/roster/)
    // The instruction that stops the model estimating over the hole.
    expect(text).toMatch(/do not answer from general knowledge/i)
  })

  it('a single failed provider names ITSELF, and says something different from "no data"', async () => {
    loadContext.mockResolvedValue(
      bundle({
        standings: null,
        meta: {
          providers: [
            { name: 'standings', cached: false, error: 'ETIMEDOUT reading standings' },
            { name: 'roster', cached: false, error: null },
          ],
        },
        roster: null,
      }),
    )

    const p = await buildDecisionOsGroundingPacket(ARGS)
    const standings = p.gaps.find((g) => g.slice === 'standings')
    const roster = p.gaps.find((g) => g.slice === 'roster')

    expect(standings?.detail).toMatch(/provider failed/i)
    expect(standings?.detail).toMatch(/ETIMEDOUT/)
    expect(roster?.detail).toMatch(/No roster data/i)
    // ⚠ The two must not collapse to one sentence: "it broke" and "there is none yet" need
    // different actions from the user, which is the whole point of carrying a remedy.
    expect(standings?.remedy).not.toEqual(roster?.remedy)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('5.2 — unsynced and un-entitled scopes stay distinguishable', () => {
  it('a stale league keeps its facts but marks them NOT SAFE TO ACT ON', async () => {
    loadAssertions.mockResolvedValue(
      assertions({ lastSuccessfulSyncAt: new Date(NOW - 40 * HOUR).toISOString(), staleMs: 40 * HOUR }),
    )

    const p = await buildDecisionOsGroundingPacket(ARGS)
    // Present AND inconclusive is a real state: we have the numbers, the league is too stale to
    // act on them. Collapsing it to absent would throw away data the user can still read.
    expect(p.projections.present).toBe(true)
    expect(p.projections.conclusive.ok).toBe(false)
    expect(p.projections.gap).not.toBeNull()

    const text = serializeDecisionOsGroundingForPrompt(p, NOW)
    expect(text).toContain('PRESENT BUT NOT SAFE TO ACT ON')
  })

  it('🛑 not_entitled never degrades into not_computed', async () => {
    // "You are not this league's commissioner" and "we could not compute it" are different
    // sentences, and only one of them has an action the user can take.
    commissioner.mockResolvedValue({ status: 'not_entitled' })

    const p = await buildDecisionOsGroundingPacket(ARGS)
    expect(p.commissionerIntelligence.gap?.reason).toBe('not_entitled')
    expect(p.gaps.find((g) => g.slice === 'commissionerIntelligence')?.reason).toBe('not_entitled')
  })

  it('a sport with no producer says so, and does not claim it is merely cold', async () => {
    loadDevy.mockResolvedValue(null)

    const p = await buildDecisionOsGroundingPacket({ ...ARGS, sport: 'NHL' })
    expect(p.devyValues.gap?.reason).toBe('no_producer')
    expect(p.devyValues.gap?.remedy).toMatch(/nothing to fix/i)

    const cold = await buildDecisionOsGroundingPacket({ ...ARGS, sport: 'NCAAF' })
    expect(cold.devyValues.gap?.reason).toBe('not_computed')
  })

  it('every producer throwing still yields a packet, never an exception', async () => {
    // One slow or failing producer must never take the packet down.
    for (const m of [loadAssertions, loadRules, loadMarket, loadDevy, loadFor, loadContext, commissioner, leagueIntel, portfolio]) {
      m.mockRejectedValue(new Error('down'))
    }

    const p = await buildDecisionOsGroundingPacket(ARGS)
    expect(p.gaps.length).toBeGreaterThan(0)
    expect(everySlice(p).every(([, s]) => s.present === false)).toBe(true)
    expect(everySlice(p).every(([, s]) => s.gap != null)).toBe(true)
  })
})
