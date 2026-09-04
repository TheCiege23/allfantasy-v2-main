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
/*
 * Flags are mocked all-enabled by default so every case above degrades for its OWN reason, and
 * `killFeeds()` opts one case at a time into 5.3. Left unmocked, these tests would reach the real
 * `platformConfig` read — which fails open, so they would still pass, but for a reason unrelated
 * to what each of them is testing.
 */
let killedFeeds: string[] = []
vi.mock('@/lib/decision-os/flags', () => ({
  resolveDecisionOsFeedFlags: async () => ({
    enabled: (f: string) => !killedFeeds.includes(f),
    killed: killedFeeds,
  }),
}))
function killFeeds(...feeds: string[]) {
  killedFeeds = feeds
}

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
    playerIdentityCoverage: 1,
    playersResolved: 200,
    playersTotal: 200,
    ...over,
  }
}

/** The twelve providers, all healthy, with whatever slice values the case wants. */
function bundle(over: Record<string, unknown> = {}) {
  /*
   * 🛑 THESE ARE THE ENGINE'S PROVIDER NAMES, AND THIS LIST USED TO CARRY THE CALLER'S TYPOS.
   *
   * It read `'rankings'` and `'importHistory'`. The engine registers `ranking` and
   * `importedHistory`; `packet.ts` asked for the wrong two, `servedBy.get()` missed on both in
   * production — and this fixture MADE THE MISS IMPOSSIBLE TO SEE, because it was written to
   * match the caller rather than the engine. A mock that agrees with the code under test instead
   * of with reality is not a test, and it is the same mock-rot CLAUDE.md already records for
   * `@/lib/fantasycalc` during the DB-first migration.
   *
   * `grounding-provider-names.test.ts` now pins both against `ChimmyContextEngine`'s own registry,
   * so neither this list nor the caller can drift again without something going red.
   */
  const names = [
    'matchup',
    'roster',
    'standings',
    'ranking',
    'leagueDifficulty',
    'importedHistory',
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
    /*
     * ⚠ `durationMs` IS PART OF THE REAL SHAPE AND WAS MISSING HERE. `ChimmyContextEngine` sets it
     * on every provider result — including the rejected branch, which sets `durationMs: 0` — so a
     * fixture without it models an engine that does not exist, and any assertion about per-slice
     * timing reads `null` for a reason that has nothing to do with the code under test.
     */
    meta: { providers: names.map((name, i) => ({ name, cached: false, error: null, durationMs: 10 + i })) },
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
  killedFeeds = []
  // The healthy baseline. Each test degrades exactly one thing, so a failure names its own cause.
  loadAssertions.mockResolvedValue(assertions())
  loadRules.mockResolvedValue({ scoring: {} })
  loadMarket.mockResolvedValue([{ status: 'ok', value: { playerId: 'p1' } }])
  loadDevy.mockResolvedValue([{ status: 'ok', value: { playerId: 'p2' } }])
  loadFor.mockResolvedValue([{ playerId: 'p1', computedAt: new Date(NOW).toISOString() }])
  loadContext.mockResolvedValue(bundle())
  commissioner.mockResolvedValue({ status: 'ok', text: 'commissioner brief' })
  leagueIntel.mockResolvedValue('league brief')
  portfolio.mockResolvedValue({ status: 'ok', text: 'portfolio brief' })
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
    portfolio.mockResolvedValue({ status: 'empty' })

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
    portfolio.mockResolvedValue({ status: 'ok', text: '' })

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

// ─────────────────────────────────────────────────────────────────────────────────────────
describe('5.3 — a killed feed is SAID, not merely stopped', () => {
  it('🛑 leaves a named gap with reason `disabled`, not a cold-cache story', async () => {
    // The remedy for a cold cache — "it fills on the next run" — is a lie about a killed feed.
    // Nothing fills it until somebody flips the switch back.
    killFeeds('marketValues')

    const p = await buildDecisionOsGroundingPacket(ARGS)

    expect(p.marketValues.present).toBe(false)
    expect(p.marketValues.gap?.reason).toBe('disabled')
    expect(p.marketValues.gap?.remedy).toMatch(/operator/i)
    expect(p.marketValues.gap?.remedy).not.toMatch(/next run/i)
    expect(p.gaps.find((g) => g.slice === 'marketValues')?.reason).toBe('disabled')
  })

  it('does not call the producer it killed', async () => {
    // A kill switch that still pays for the work is a label, not a switch.
    killFeeds('marketValues', 'projections', 'leagueIntelligence')
    await buildDecisionOsGroundingPacket(ARGS)
    expect(loadMarket).not.toHaveBeenCalled()
    expect(loadFor).not.toHaveBeenCalled()
    expect(leagueIntel).not.toHaveBeenCalled()
    // ...and leaves the others alone.
    expect(loadDevy).toHaveBeenCalled()
  })

  it('killing the context feed names all eight, rather than dropping them', async () => {
    killFeeds('contextFacts')
    const p = await buildDecisionOsGroundingPacket(ARGS)
    expect(p.contextFacts).not.toBeNull()
    const disabled = p.gaps.filter((g) => g.reason === 'disabled')
    expect(disabled).toHaveLength(8)
    expect(loadContext).not.toHaveBeenCalled()
  })

  it('🛑 R1.2 — DERIVES valueFormat from the rules it already loaded', async () => {
    /*
     * The chat route passed no `valueFormat`, and `packet.ts` gated the whole market slice on it
     * (`want.values && args.valueFormat`) — so setting `want.values: true` alone bought nothing
     * and the entire offence/market valuation lane was silently absent from every answer.
     *
     * ⚠ DERIVED IN THE PACKET, NOT DEMANDED FROM THE CALLER. The packet already loads
     * `leagueRules`; the format is `general.format` and `roster.starters` inside them. Making
     * each caller compute it means a second read of data already in hand, and two call sites that
     * can disagree — the exact drift `OsFactSource.scopeKey` exists to prevent.
     */
    loadRules.mockResolvedValue({
      general: { format: 'dynasty' },
      roster: { starters: ['QB', 'RB', 'WR', 'SUPER_FLEX'] },
      scoring: { activeRules: [] },
    })
    await buildDecisionOsGroundingPacket({ ...ARGS, valueFormat: undefined })
    expect(loadMarket).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'DYNASTY', qbFormat: 'SUPERFLEX' }),
    )
  })

  it('R1.2 — an explicit valueFormat still WINS over the derived one', async () => {
    loadRules.mockResolvedValue({
      general: { format: 'dynasty' },
      roster: { starters: ['QB', 'SUPER_FLEX'] },
      scoring: { activeRules: [] },
    })
    await buildDecisionOsGroundingPacket({
      ...ARGS,
      valueFormat: { format: 'REDRAFT', qbFormat: 'ONE_QB' },
    })
    expect(loadMarket).toHaveBeenCalledWith(
      expect.objectContaining({ format: 'REDRAFT', qbFormat: 'ONE_QB' }),
    )
  })

  it('🛑 R1.2 — DERIVES leagueIdpRules, so projections arrive scored for THIS league', async () => {
    /*
     * Measured on production 2026-09-02: every projection rendered "canonical preset, NOT this
     * league" on a superflex dynasty league carrying Khalil Mack (LB) and Jonas Sanker (DB).
     * `projection-os` warns that the canonical value is *balanced*-IDP, not neutral — materially
     * wrong for a tackle-heavy league, and presented as if it were that league's number.
     */
    loadRules.mockResolvedValue({
      general: { format: 'dynasty' },
      roster: { starters: ['QB'] },
      scoring: { activeRules: [{ statKey: 'idp_tkl_solo', pointsValue: 2, category: 'idp', isOverridden: false }] },
    })
    await buildDecisionOsGroundingPacket({ ...ARGS, leagueIdpRules: undefined })
    expect(loadFor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ idp_tkl_solo: 2 }))
  })

  it('R1.2 — an explicit NULL leagueIdpRules is honoured, not overwritten', async () => {
    // ⚠ `null` is a real choice meaning "give me the canonical value", and `ProjectionFact.rescored`
    // reports it honestly. Only `undefined` means "you decide".
    loadRules.mockResolvedValue({
      general: { format: 'dynasty' },
      roster: { starters: ['QB'] },
      scoring: { activeRules: [{ statKey: 'idp_tkl_solo', pointsValue: 2, category: 'idp', isOverridden: false }] },
    })
    await buildDecisionOsGroundingPacket({ ...ARGS, leagueIdpRules: null })
    expect(loadFor).toHaveBeenCalledWith(expect.anything(), null)
  })

  it('🛑 dates a COLLECTION by its OLDEST member, never an arbitrary one', async () => {
    /*
     * Measured on production 2026-09-02: the packet reported projections as "13 days old" while
     * the newest `AFProjectionSnapshot` row was written the previous morning. The slice took
     * `asOf: facts[0]?.computedAt` — whichever row happened to land first — and presented one
     * arbitrary element's age as the freshness of all 1,576.
     *
     * ⚠ OLDEST, NOT NEWEST, AND THAT IS THE WHOLE POINT. A single `asOf` cannot describe a range,
     * so the only question is which way to be wrong. `ImportAssertions` already settled this for
     * this codebase: it carries `lastAttemptedSyncAt` AND `lastSuccessfulSyncAt` because "a
     * surface that shows the first one tells a user their league synced two minutes ago when it
     * has actually been failing for four days". Overstating age makes a model hedge more than it
     * needs to; understating it makes a model assert stale numbers as current. Only one of those
     * is recoverable.
     */
    const OLDEST = new Date(NOW - 300 * HOUR).toISOString()
    loadFor.mockResolvedValue([
      { playerId: 'p1', computedAt: new Date(NOW - 2 * HOUR).toISOString() },
      { playerId: 'p2', computedAt: OLDEST },
      { playerId: 'p3', computedAt: new Date(NOW - 1 * HOUR).toISOString() },
    ])
    const p = await buildDecisionOsGroundingPacket(ARGS)
    expect(p.projections.present).toBe(true)
    expect(p.projections.asOf).toBe(OLDEST)
  })

  it('⚠ records the kill on meta even when the question never wanted that feed', async () => {
    // A feed killed but not wanted produces NO gap — correctly, it would be noise on every
    // answer. But an operator asking "why is this thin" still has to be able to see the switch.
    killFeeds('devyValues')
    const p = await buildDecisionOsGroundingPacket({ ...ARGS, want: { projections: true } })
    expect(p.gaps.find((g) => g.slice === 'devyValues')).toBeUndefined()
    expect(p.meta.killedFeeds).toContain('devyValues')
  })

  it('every slice still satisfies absent-implies-named-gap with feeds killed', async () => {
    killFeeds(...['importAssertions', 'leagueRules', 'marketValues', 'devyValues', 'projections', 'contextFacts', 'commissionerIntelligence', 'leagueIntelligence', 'portfolio'])
    const p = await buildDecisionOsGroundingPacket(ARGS)
    const offenders = everySlice(p)
      .filter(([, s]) => !s.present)
      .filter(([, s]) => s.gap == null || !s.gap.detail.trim() || !s.gap.remedy.trim())
      .map(([n]) => n)
    expect(offenders).toEqual([])
    expect(p.meta.killedFeeds).toHaveLength(9)
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('a roster that resolved no player identities (P2)', () => {
  /*
   * ── 🛑 FOUND IN PRODUCTION, NOT IN A FIXTURE ────────────────────────────────────────────────
   * The 5.1 proof surface on a live 8-team dynasty league, 2026-09-01, returned 27 players shaped
   * exactly like this — `name` equal to `playerId`, `position` a flat 'UTIL', `team` null — while
   * the slice graded `present: true, conclusive: { ok: true }, gap: null`.
   *
   * `RosterContextProvider.toRosterPlayerLite` does `pickString(item, ['name', …]) ?? playerId`,
   * so a missing name silently becomes the id. That is an unsourced value rendered as a fact,
   * which is the P2 invariant this packet exists to enforce — and the packet was the thing
   * reporting it clean.
   */
  const nameless = {
    starters: [
      { playerId: '6804', name: '6804', position: 'UTIL', team: null },
      { playerId: '8138', name: '8138', position: 'UTIL', team: null },
    ],
    bench: [{ playerId: '11617', name: '11617', position: 'UTIL', team: null }],
  }

  it('🛑 raises unresolved_identity instead of reporting a usable roster', async () => {
    loadContext.mockResolvedValue(bundle({ roster: nameless }))
    const p = await buildDecisionOsGroundingPacket(ARGS)

    expect(p.contextFacts?.roster.gap?.reason).toBe('unresolved_identity')
    expect(p.contextFacts?.roster.conclusive.ok).toBe(false)
    expect(p.gaps.map((g) => g.slice)).toContain('roster')
  })

  it('⚠ stays PRESENT — the counts are real even when the names are not', async () => {
    // Dropping the slice would destroy true information (depth, starter/bench split) to punish one
    // false field. Present-but-inconclusive is what `toEvidencePacket` turns into a
    // `not_safe_to_act_on` signal, so three-brain is told "you have a roster, not who is on it".
    loadContext.mockResolvedValue(bundle({ roster: nameless }))
    const p = await buildDecisionOsGroundingPacket(ARGS)

    expect(p.contextFacts?.roster.present).toBe(true)
    expect(p.contextFacts?.roster.value).toBeTruthy()
    expect(p.contextFacts?.roster.gap?.remedy).toMatch(/re-sync/i)
  })

  it('leaves a roster alone when even ONE player resolved', async () => {
    // The check is "did identity resolution produce nothing at all", not "is every row perfect" —
    // a partially-named roster is degraded data, not fabricated data, and is still worth reading.
    loadContext.mockResolvedValue(
      bundle({
        roster: {
          starters: [{ playerId: '6804', name: 'Bijan Robinson', position: 'RB', team: 'ATL' }],
          bench: [{ playerId: '8138', name: '8138', position: 'UTIL', team: null }],
        },
      }),
    )
    const p = await buildDecisionOsGroundingPacket(ARGS)

    expect(p.contextFacts?.roster.gap).toBeNull()
    expect(p.contextFacts?.roster.conclusive.ok).toBe(true)
  })
})

describe('meta timing — a total nobody can act on is why this exists', () => {
  it('splits the engine call out, and carries the engine’s own per-provider ms', async () => {
    /*
     * The proof surface measured 5354ms against the chat route's 3000ms ceiling, so the packet is
     * built and discarded every turn. `meta.durationMs` alone said that was happening and nothing
     * about where to cut; the engine had already measured each provider and the packet threw it
     * away. `engineMs` says which HALF, `sources[].ms` says which provider.
     */
    loadContext.mockResolvedValue(bundle())
    const p = await buildDecisionOsGroundingPacket(ARGS)

    expect(typeof p.meta.engineMs).toBe('number')
    const timed = p.meta.sources.filter((s) => typeof s.ms === 'number')
    expect(timed.length).toBeGreaterThan(0)
    // `rankings` is the one slice whose packet key differs from its engine provider name
    // (`ranking`); without the alias its timing silently reads null forever.
    expect(p.meta.sources.find((s) => s.slice === 'rankings')?.ms).toBeTypeOf('number')
  })
})

// ─────────────────────────────────────────────────────────────────────────────────────────────
describe('a portfolio that timed out is not a portfolio that is empty', () => {
  /*
   * ── 🛑 MEASURED IN PRODUCTION, AND THE REMEDY WAS FALSE ─────────────────────────────────────
   * `resolvePortfolioGrounding` returned `null` for BOTH "no leagues" and "getCommandCenter did
   * not finish", so the packet graded every case `not_computed`:
   *
   *     "No cross-league snapshot is available. Fix: Import at least one league and it appears."
   *
   * The 5.1 proof surface caught it on an account with 543 imported leagues, where that sentence
   * is not merely unhelpful — it is false, and it sends someone to fix something that is not
   * broken. The slice had cost 4500ms (exactly its own timeout) to say it.
   */
  it('🛑 reports not_synced with the budget, not "import a league"', async () => {
    portfolio.mockResolvedValue({ status: 'timeout', budgetMs: 1500 })
    const p = await buildDecisionOsGroundingPacket(ARGS)

    expect(p.portfolio.gap?.reason).toBe('not_synced')
    expect(p.portfolio.gap?.detail).toContain('1500ms')
    // The specific falsehood, pinned: never tell someone with leagues to import a league.
    expect(p.portfolio.gap?.remedy).not.toMatch(/import/i)
  })

  it('still says not_computed when the snapshot genuinely is empty', async () => {
    // The distinction only matters if BOTH sides stay reachable; collapsing them again is the bug.
    portfolio.mockResolvedValue({ status: 'empty' })
    const p = await buildDecisionOsGroundingPacket(ARGS)

    expect(p.portfolio.gap?.reason).toBe('not_computed')
    expect(p.portfolio.gap?.remedy).toMatch(/import/i)
  })
})

/**
 * R2.6 — `waiverDecision` is the one slice with NO producer, and it must say so ONLY when asked.
 *
 * 🛑 IT USED TO BE INVISIBLE. The field was declared on the packet type and rendered by the
 * serializer, and assigned nowhere — `undefined` on every packet, which `sliceLine` tolerates by
 * emitting nothing. It was also absent from the array feeding `collectGaps`. So a declared fact
 * was neither reported available nor reported missing, in a packet whose whole contract is that
 * those are the only two options. The structural suite above could not see it precisely because
 * an undefined slice does not appear in `everySlice`.
 */
describe('R2.6 · waiverDecision reports an honest gap, and only when requested', () => {
  it('🛑 when REQUESTED it surfaces a no_producer gap naming the missing input', async () => {
    const p = await buildDecisionOsGroundingPacket({ ...ARGS, want: { ...ARGS.want, waiverDecision: true } })

    expect(p.waiverDecision?.present).toBe(false)
    expect(p.waiverDecision?.gap?.reason).toBe('no_producer')
    // The remedy must point somewhere that actually works, not at a TODO.
    expect(p.waiverDecision?.gap?.remedy).toMatch(/waiver assistant/i)

    const surfaced = p.gaps.filter((g) => g.slice === 'waiverDecision')
    expect(surfaced).toHaveLength(1)
  })

  it('🛑 when NOT requested it is not_requested and never reaches the gap block', async () => {
    const p = await buildDecisionOsGroundingPacket(ARGS)

    expect(p.waiverDecision?.gap?.reason).toBe('not_requested')
    // The anti-crowding guarantee: an always-surfaced "no waiver decision" would put the same
    // line on every answer and teach a reader to skim the gap block.
    expect(p.gaps.some((g) => g.slice === 'waiverDecision')).toBe(false)
  })

  it('is never silently undefined — the defect this replaced', async () => {
    const p = await buildDecisionOsGroundingPacket(ARGS)
    expect(p.waiverDecision).toBeDefined()
    expect(p.waiverDecision?.gap).toBeTruthy()
  })
})

/**
 * R1.5 — devy is requested for a devy-variant league even though the sport test fails it.
 *
 * 🛑 WIRED, NOT JUST DERIVED. `deriveWantsDevyBoard` has its own unit suite; that proves the
 * predicate and says nothing about whether the packet consults it. This asserts the path through
 * the builder — the R1.4 lesson, where 11 green helper tests sat on top of a call site reading a
 * property that did not exist.
 */
describe('R1.5 · a devy-variant league gets the board without being NCAAF', () => {
  it('🛑 want.devy false + devy_dynasty variant STILL loads the board', async () => {
    loadRules.mockResolvedValue({ general: { format: 'dynasty', variant: 'devy_dynasty' } })
    loadDevy.mockResolvedValue([{ status: 'ok', value: { playerId: 'devy1' } }])

    const p = await buildDecisionOsGroundingPacket({
      ...ARGS,
      want: { values: true, devy: false, projections: true, leagueRules: true },
    })

    expect(loadDevy).toHaveBeenCalled()
    expect(p.devyValues.present).toBe(true)
  })

  it('an ordinary dynasty league still does NOT load it', async () => {
    loadRules.mockResolvedValue({ general: { format: 'dynasty', variant: 'dynasty' } })
    loadDevy.mockResolvedValue([{ status: 'ok', value: { playerId: 'devy1' } }])

    const p = await buildDecisionOsGroundingPacket({
      ...ARGS,
      want: { values: true, devy: false, projections: true, leagueRules: true },
    })

    expect(loadDevy).not.toHaveBeenCalled()
    expect(p.devyValues.present).toBe(false)
  })

  /**
   * ⚠ THE NCAAF PATH MUST NOT REGRESS. When the caller already asked, the load kicks with the
   * rest of the wave and never waits on rules — the same escape `args.valueFormat` gives the
   * market lane. If this ever starts depending on rules, an NCAAF league pays a hop for nothing.
   */
  it('🛑 an explicit want.devy still loads even when the rules never resolve', async () => {
    loadRules.mockRejectedValue(new Error('rules down'))
    loadDevy.mockResolvedValue([{ status: 'ok', value: { playerId: 'devy1' } }])

    const p = await buildDecisionOsGroundingPacket({
      ...ARGS,
      want: { values: true, devy: true, projections: true, leagueRules: true },
    })

    expect(loadDevy).toHaveBeenCalled()
    expect(p.devyValues.present).toBe(true)
  })

  it('a failed rules load degrades to no devy, never to a throw', async () => {
    loadRules.mockRejectedValue(new Error('rules down'))
    loadDevy.mockResolvedValue([{ status: 'ok', value: { playerId: 'devy1' } }])

    const p = await buildDecisionOsGroundingPacket({
      ...ARGS,
      want: { values: true, devy: false, projections: true, leagueRules: true },
    })

    expect(loadDevy).not.toHaveBeenCalled()
    expect(p.devyValues.present).toBe(false)
  })
})
