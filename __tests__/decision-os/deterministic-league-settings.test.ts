import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('server-only', () => ({}))

// ⚠ `vi.mock` factories are hoisted above every top-level statement, so the spies have to be
// created inside `vi.hoisted` or they are read before initialisation.
const { loadRules, getFantasyCalcValuesDbFirst, leagueFindUnique } = vi.hoisted(() => ({
  loadRules: vi.fn(),
  getFantasyCalcValuesDbFirst: vi.fn(),
  leagueFindUnique: vi.fn(),
}))

// The CHART (dynasty/redraft, superflex/1QB) is read off the league row by `valueBookFor`, the rule every
// screen uses (2026-11-17); team count and PPR still come from the rules. So a league is both: a row and rules.
vi.mock('@/lib/prisma', () => ({ prisma: { league: { findUnique: leagueFindUnique } } }))
const DYNASTY_SF_ROW = { leagueType: 'dynasty', settings: { roster_positions: ['QB', 'RB', 'WR', 'SUPER_FLEX'] } }
const DYNASTY_1QB_ROW = { leagueType: 'dynasty', settings: { roster_positions: ['QB', 'RB', 'WR'] } }
const REDRAFT_1QB_ROW = { leagueType: 'redraft', settings: { roster_positions: ['QB', 'RB', 'WR'] } }

vi.mock('@/lib/decision-os/league-os', () => ({
  createLeagueOsLoaders: () => ({ loadRules, drainOutcomes: () => ({}) }),
}))
vi.mock('@/lib/fantasycalc-db', () => ({ getFantasyCalcValuesDbFirst }))

import { buildFantasyCalcValueAnswer } from '@/lib/ai/deterministic'

/**
 * ── 🛑 BUG-1: CHIMMY STATED LEAGUE SETTINGS IT HAD NEVER READ ───────────────────────────────
 *
 * Measured in production 2026-09-02 on a league the owner confirms is DYNASTY:
 *
 *   Q  "What's Jeremiyah Love worth in King Gingerbeards SF 2026!!!?"
 *   A  "...FantasyCalc REDRAFT value is 3779 ... Settings: superflex, 12-team PPR."
 *      correct dynasty value: 6644 — the answer understated a dynasty asset by 43%
 *
 * Four fabricated inputs, all presented as the user's league settings:
 *   isDynasty    from a regex on the QUESTION TEXT
 *   isSuperflex  from a regex on the QUESTION TEXT ("SF" in the league NAME matched, by luck)
 *   numTeams/ppr hardcoded in the query
 *   "12-team PPR" a hardcoded string LITERAL in the output, identical for every league
 *
 * ⚠ THE PRICE IS THE DEFECT; THE SENTENCE IS ONLY HOW IT ANNOUNCES ITSELF. Deleting the settings
 * sentence would silence the symptom and keep serving a redraft price to a dynasty league — which
 * is why the second test here asserts on the VALUE FETCHED, not on the prose.
 */
describe('BUG-1 — the deterministic value path must read the league, not the question', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    leagueFindUnique.mockResolvedValue(null)
    getFantasyCalcValuesDbFirst.mockResolvedValue([
      { player: { name: 'Jeremiyah Love' }, value: 6644, overallRank: 16, positionRank: 4, trend30Day: -375 },
    ])
  })

  it('🛑 a DYNASTY league gets a DYNASTY price, even when the question never says "dynasty"', async () => {
    loadRules.mockResolvedValue({
      general: { format: 'dynasty' },
      roster: { starters: ['QB', 'RB', 'WR', 'SUPER_FLEX'] },
      scoring: { activeRules: [] },
    })
    leagueFindUnique.mockResolvedValue(DYNASTY_SF_ROW)
    await buildFantasyCalcValueAnswer('What is Jeremiyah Love worth in my league?', 'L1')
    expect(getFantasyCalcValuesDbFirst).toHaveBeenCalledWith(
      expect.objectContaining({ isDynasty: true, numQbs: 2 }),
    )
  })

  it('🛑 does NOT emit a settings claim when no league is in scope', async () => {
    // A stated default is a claim. With no league we may still price a player on some basis, but
    // we may not tell the user it is THEIR league's basis.
    const out = await buildFantasyCalcValueAnswer('What is Jeremiyah Love worth?', null)
    expect(out).not.toMatch(/12-team/i)
    expect(out).not.toMatch(/Settings:/i)
    expect(loadRules).not.toHaveBeenCalled()
  })

  it('never hardcodes 12-team PPR when a league IS in scope', async () => {
    loadRules.mockResolvedValue({
      general: { format: 'redraft' },
      roster: { starters: ['QB'] },
      scoring: { activeRules: [] },
    })
    leagueFindUnique.mockResolvedValue(REDRAFT_1QB_ROW)
    const out = await buildFantasyCalcValueAnswer('What is Jeremiyah Love worth in my league?', 'L1')
    expect(out).not.toMatch(/12-team PPR/i)
  })

  it('falls back HONESTLY when the league is named but cannot be read', async () => {
    // ⚠ Not the same as "no league". The remedy differs, so the wording must too — and it must
    // still not assert settings it could not read.
    loadRules.mockResolvedValue(null)
    leagueFindUnique.mockResolvedValue(null)
    const out = await buildFantasyCalcValueAnswer('What is Jeremiyah Love worth in my league?', 'L1')
    expect(out).not.toMatch(/Settings:/i)
    expect(out).toBeTruthy()
  })

  it('🛑 does not CLAIM a PPR the market cannot represent', async () => {
    /*
     * FantasyCalc publishes exactly three PPR buckets: 0, 0.5, 1. A TE-premium league on 1.5 per
     * reception has NO bucket. Rounding it to 1 would print a number the league does not use —
     * the same "state a setting you did not read" defect this whole commit exists to remove,
     * reached from a different direction.
     *
     * ⚠ THE TYPECHECKER FOUND THIS, NOT THE TESTS. The suite was 68/68 green while
     * `deriveLeagueSizeAndPpr` returned a plain `number` into a `0 | 0.5 | 1` parameter.
     */
    loadRules.mockResolvedValue({
      general: { format: 'dynasty', teamCount: 10 },
      roster: { starters: ['QB', 'SUPER_FLEX'] },
      scoring: { activeRules: [{ statKey: 'rec', pointsValue: 1.5 }] },
    })
    leagueFindUnique.mockResolvedValue(DYNASTY_SF_ROW)
    const out = await buildFantasyCalcValueAnswer('What is Jeremiyah Love worth in my league?', 'L1')
    expect(out).toMatch(/10-team/)      // read, so stated
    expect(out).not.toMatch(/PPR/i)     // not representable, so NOT stated
  })

  it('still refuses questions that are not about value at all', async () => {
    expect(await buildFantasyCalcValueAnswer('Who won last night?', 'L1')).toBeNull()
  })

  it('uses an explicitly requested generic dynasty superflex market without claiming league settings', async () => {
    const out = await buildFantasyCalcValueAnswer('What is Jeremiyah Love dynasty trade value in superflex?', null)
    expect(getFantasyCalcValuesDbFirst).toHaveBeenCalledWith(expect.objectContaining({ isDynasty: true, numQbs: 2 }))
    expect(out).toContain('standard superflex dynasty market')
    expect(out).not.toContain('Settings read from your league')
    expect(loadRules).not.toHaveBeenCalled()
  })
})

/**
 * ── 🛑 A DECISION WAS ANSWERED WITH A PRICE ─────────────────────────────────────────────────
 *
 * User report, 2026-09-16, with Draft Junkies selected:
 *
 *   Q  "is it worth me trading for Rashee Rice in this league?"
 *   A  "Rashee Rice's FantasyCalc dynasty value is 3421 (mid tier) … Source: FantasyCalc current values."
 *
 * The word "worth" was enough. The shortcut must step aside for a decision so the question reaches
 * the league-aware paths; a plain price question still gets its price.
 */
describe('the price shortcut steps aside for a trade decision', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    loadRules.mockResolvedValue({ general: { format: 'dynasty' }, roster: { starters: ['QB'] }, scoring: { activeRules: [] } })
    leagueFindUnique.mockResolvedValue(DYNASTY_1QB_ROW)
    getFantasyCalcValuesDbFirst.mockResolvedValue([
      { player: { name: 'Rashee Rice' }, value: 3421, overallRank: 60, positionRank: 20, trend30Day: -436 },
    ])
  })

  it.each([
    'is it worth me trading for Rashee Rice in this league?',
    'Is Rashee Rice worth trading for?',
    'Should I trade Bijan Robinson for Rashee Rice, is it worth it?',
  ])('%s → no price answer, and no price fetched', async (message) => {
    expect(await buildFantasyCalcValueAnswer(message, 'L1')).toBeNull()
    expect(getFantasyCalcValuesDbFirst).not.toHaveBeenCalled()
  })

  it('a price question is still answered with the price', async () => {
    const out = await buildFantasyCalcValueAnswer('What is Rashee Rice worth in my league?', 'L1')
    expect(out).toMatch(/Rashee Rice's FantasyCalc dynasty value is 3421/)
  })
})
