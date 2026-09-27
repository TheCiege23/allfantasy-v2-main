/**
 * `evaluateTrade()` — the one trade engine's entry point (2026-09-26). One receipt per evaluation:
 * the ONE grade and its exact mirror, the canonical lineup/confidence per roster when rosters are
 * known, an asset line per priced asset, and an append-only saved row — where saving can fail
 * without losing the grade.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  evaluateTrade,
  NO_LEAGUE_REASON,
  tradeInputHash,
  type EvaluateTradeDeps,
  type EvaluateTradeInput,
} from '@/lib/decision-os/trade/evaluateTrade'
import type { LeagueTradeGrader } from '@/lib/decision-os/trade/leagueTradeGrader'
import { gradeTrade, type TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'

/* 5,000 out, 6,000 in on league value: +17%, a B — and a D for the other side. */
const B_GRADE: TradeGradeView = gradeTrade({
  giveValue: 5000,
  getValue: 6000,
  giveMarket: 4800,
  getMarket: 6000,
  unpriced: 0,
  giveCount: 1,
  getCount: 2,
  basis: 'Dynasty · 1QB · 12 teams · PPR',
  scoringApplied: true,
  needApplied: false,
  needGap: null,
  lines: [
    { side: 'give', name: 'Alpha', marketValue: 4800, leagueValue: 5000, source: 'fantasycalc' },
    { side: 'get', name: 'Bravo', marketValue: 3500, leagueValue: 3500, source: 'fantasycalc' },
    { side: 'get', name: '2027 Round 1', marketValue: 2500, leagueValue: 2500, source: 'pick_chart' },
  ],
  moves: [{ side: 'give', name: 'Alpha', base: 4800, leagueValue: 5000, reasons: ['TE premium'] }],
})

const base = (over: Partial<EvaluateTradeInput> = {}): EvaluateTradeInput => ({
  surface: 'test',
  leagueId: 'l1',
  userId: 'u1',
  give: { assets: [{ kind: 'player', name: 'Alpha' }], unpriceable: [] },
  get: { assets: [{ kind: 'player', name: 'Bravo' }, { kind: 'pick', year: 2027, round: 1 }], unpriceable: [] },
  viewerSide: true,
  evaluatedAt: '2026-09-26T12:00:00.000Z',
  ...over,
})

const deps = (over: Partial<EvaluateTradeDeps> = {}): Partial<EvaluateTradeDeps> => ({
  grade: vi.fn(async () => B_GRADE),
  saveReceipt: vi.fn(async () => ({ id: 'rcpt_1' })),
  evaluateCanonical: vi.fn(async () => {
    throw new Error('not expected')
  }),
  ...over,
})

describe('evaluateTrade — the receipt', () => {
  it('carries the one grade, its exact mirror, and one line per asset with value, source and adjustments', async () => {
    const r = await evaluateTrade(base(), deps())
    expect(r.grade).toMatchObject({ graded: true, letter: 'B', percentDiff: 17 })
    expect(r.partnerGrade).toMatchObject({ graded: true, letter: 'D', percentDiff: -17 })
    expect(r.assets).toEqual([
      { side: 'give', name: 'Alpha', kind: 'player', marketValue: 4800, leagueValue: 5000, source: 'fantasycalc', adjustments: ['TE premium'] },
      { side: 'get', name: 'Bravo', kind: 'player', marketValue: 3500, leagueValue: 3500, source: 'fantasycalc', adjustments: [] },
      { side: 'get', name: '2027 Round 1', kind: 'pick', marketValue: 2500, leagueValue: 2500, source: 'pick_chart', adjustments: [] },
    ])
    expect(r).toMatchObject({ modelVersion: 'trade-eval-v1', surface: 'test', leagueId: 'l1', userId: 'u1', canonical: null, canonicalError: null })
  })

  it('saves the receipt and returns the row id', async () => {
    const saveReceipt = vi.fn(async () => ({ id: 'rcpt_9' }))
    const r = await evaluateTrade(base(), deps({ saveReceipt }))
    expect(r).toMatchObject({ persisted: true, receiptId: 'rcpt_9', persistError: null })
    expect(saveReceipt).toHaveBeenCalledTimes(1)
    // The receipt that is saved is the one returned, before its id was known.
    expect(saveReceipt).toHaveBeenCalledWith(
      expect.objectContaining({ surface: 'test', leagueId: 'l1', inputHash: r.inputHash, receiptId: null, persisted: false }),
    )
  })

  it('a save that fails keeps the grade and says so — without echoing the database error', async () => {
    const saveReceipt = vi.fn(async () => {
      throw new Error("Can't reach database server at `ep-secret-host.neon.tech:5432`")
    })
    const r = await evaluateTrade(base(), deps({ saveReceipt }))
    expect(r.persisted).toBe(false)
    expect(r.receiptId).toBeNull()
    expect(r.grade).toMatchObject({ graded: true, letter: 'B' })
    expect(r.persistError).toBe('The evaluation receipt could not be saved.')
    expect(JSON.stringify(r)).not.toContain('ep-secret-host')
  })

  it('the real store, absent from the client, is a failed save and not a thrown error', async () => {
    const { saveReceipt: _drop, ...rest } = deps()
    const r = await evaluateTrade(base(), rest)
    expect(r.persisted).toBe(false)
    expect(r.grade.graded).toBe(true)
  })

  it('persist: false saves nothing', async () => {
    const saveReceipt = vi.fn(async () => ({ id: 'x' }))
    const r = await evaluateTrade(base({ persist: false }), deps({ saveReceipt }))
    expect(saveReceipt).not.toHaveBeenCalled()
    expect(r).toMatchObject({ persisted: false, persistError: null })
  })
})

describe('evaluateTrade — refusals, never a default value', () => {
  it('no league: the letter is withheld and says why', async () => {
    const r = await evaluateTrade(base({ leagueId: null }), { saveReceipt: async () => ({ id: 'r' }) })
    expect(r.grade).toEqual({ graded: false, reason: NO_LEAGUE_REASON, basis: null })
    expect(r.partnerGrade).toEqual(r.grade)
  })

  it('an asset the surface could not turn into an input withholds the grade by name, and the grader is never asked', async () => {
    const grader: LeagueTradeGrader = {
      leagueId: 'l1',
      chart: {} as LeagueTradeGrader['chart'],
      leagueType: {} as LeagueTradeGrader['leagueType'],
      grade: vi.fn(async () => B_GRADE),
    }
    const r = await evaluateTrade(
      base({ grader, get: { assets: [{ kind: 'player', name: 'Bravo' }], unpriceable: ['a 2027 pick with no round'] } }),
      { saveReceipt: async () => ({ id: 'r' }) },
    )
    expect(grader.grade).not.toHaveBeenCalled()
    expect(r.grade.graded).toBe(false)
    expect(r.grade.graded === false && r.grade.reason).toContain('a 2027 pick with no round')
    expect(r.unpriceable).toEqual(['a 2027 pick with no round'])
  })

  it('a withheld grade lists every asset with NO value — nothing is priced at a placeholder', async () => {
    const withheld: TradeGradeView = {
      graded: false,
      reason: 'Nobody Special could not be found in the NFL player database, so this deal is not graded.',
      basis: null,
    }
    const r = await evaluateTrade(
      base({ give: { assets: [{ kind: 'player', name: 'Nobody Special' }], unpriceable: [] } }),
      deps({ grade: async () => withheld }),
    )
    expect(r.grade).toEqual(withheld)
    for (const a of r.assets) {
      expect(a.marketValue).toBeNull()
      expect(a.leagueValue).toBeNull()
    }
    expect(JSON.stringify(r.assets)).not.toMatch(/\b200\b/)
  })

  it('a grader that throws is a withheld grade, never a thrown evaluation', async () => {
    const r = await evaluateTrade(base(), deps({ grade: async () => { throw new Error('boom') } }))
    expect(r.grade).toMatchObject({ graded: false, reason: 'This deal could not be priced just now.' })
  })

  it('a grader that throws SYNCHRONOUSLY is a withheld grade as well', async () => {
    const grade = (() => {
      throw new TypeError('boom')
    }) as unknown as EvaluateTradeDeps['grade']
    const r = await evaluateTrade(base(), deps({ grade }))
    expect(r.grade).toMatchObject({ graded: false, reason: 'This deal could not be priced just now.' })
  })

  it('a league that cannot be read withholds instead of grading', async () => {
    const r = await evaluateTrade(base({ grader: null }), { saveReceipt: async () => ({ id: 'r' }) })
    expect(r.grade).toMatchObject({ graded: false, reason: expect.stringContaining('could not be loaded') })
  })
})

describe('evaluateTrade — the canonical half', () => {
  const canonical = {
    proposerRosterId: 'r1',
    receiverRosterId: 'r2',
    participantRosterIds: ['r1', 'r2'],
    assets: [],
    currentSeason: 2026,
    includeRosterImpact: true,
  }

  it('runs once per participant roster and keeps its lineup effect and confidence — but never its letter', async () => {
    const evaluateCanonical = vi.fn(async (a: { viewerRosterId?: string | null }) => ({
      action: 'accept' as const,
      recommendation: 'x',
      fairnessScore: 80,
      confidenceScore: a.viewerRosterId === 'r1' ? 90 : 70,
      coverageStatus: 'complete' as const,
      coveragePct: 100,
      grade: 'A+',
      memo: { snapshot: { version: 'memo-v' } },
      rosterImpact: { startingPointsDelta: a.viewerRosterId === 'r1' ? 4 : -3 },
    }))
    const r = await evaluateTrade(base({ canonical }), deps({ evaluateCanonical: evaluateCanonical as never }))
    expect(evaluateCanonical).toHaveBeenCalledTimes(2)
    expect(evaluateCanonical).toHaveBeenCalledWith(expect.objectContaining({ viewerRosterId: 'r2', includeRosterImpact: true }))
    expect(r.canonical?.participants.map((p) => [p.rosterId, p.confidenceScore, p.rosterImpact?.startingPointsDelta, p.memoVersion])).toEqual([
      ['r1', 90, 4, 'memo-v'],
      ['r2', 70, -3, 'memo-v'],
    ])
    // Positive control: the canonical letter was A+, and the receipt's letter is the one grade.
    expect(JSON.stringify(r)).not.toContain('A+')
    expect(r.grade).toMatchObject({ letter: 'B' })
  })

  it('a canonical failure is a named gap beside an intact grade', async () => {
    const r = await evaluateTrade(
      base({ canonical }),
      deps({ evaluateCanonical: (async () => { throw new Error('Canonical trade world unavailable') }) as never }),
    )
    expect(r.canonical).toBeNull()
    expect(r.canonicalError).toBe('Canonical trade world unavailable')
    expect(r.grade).toMatchObject({ graded: true, letter: 'B' })
  })

  it('a 3-team trade is refused by the canonical half without being attempted', async () => {
    const evaluateCanonical = vi.fn()
    const r = await evaluateTrade(
      base({ canonical: { ...canonical, participantRosterIds: ['r1', 'r2', 'r3'] } }),
      deps({ evaluateCanonical: evaluateCanonical as never }),
    )
    expect(evaluateCanonical).not.toHaveBeenCalled()
    expect(r.canonicalError).toContain('3-team')
  })
})

describe('tradeInputHash', () => {
  const g = (names: string[]) => ({ assets: names.map((name) => ({ kind: 'player' as const, name })), unpriceable: [] })

  it('ignores asset order, case and whitespace', () => {
    const a = tradeInputHash({ leagueId: 'l1', give: g(['Alpha', 'Bravo']), get: g(['Charlie']), viewerSide: true })
    const b = tradeInputHash({ leagueId: 'l1', give: g([' bravo ', 'ALPHA']), get: g(['charlie']), viewerSide: true })
    expect(a).toBe(b)
    expect(a).toMatch(/^[0-9a-f]{64}$/)
  })

  it('a swapped deal is a different deal', () => {
    const a = tradeInputHash({ leagueId: 'l1', give: g(['Alpha']), get: g(['Bravo']), viewerSide: true })
    const b = tradeInputHash({ leagueId: 'l1', give: g(['Bravo']), get: g(['Alpha']), viewerSide: true })
    expect(a).not.toBe(b)
  })
})

describe('evaluateTrade — the team-benefit shadow on the receipt', () => {
  const benefit = (designLetter: 'A' | 'B' | 'C' | null) => ({
    ok: true as const,
    benefit: {
      model: 'team-benefit-v1-uncalibrated',
      horizon: { currentWeek: 13, finalWeek: 16, playoffStartWeek: 15, weeks: [13, 14, 15, 16], playoffWeeks: [15, 16], approximation: 'x' },
      sides: [
        { teamId: 'me', receives: [], packageReceived: 10, forcedDrops: [], lineupDeltaPerWeek: 1, lineupBeforePerWeek: 100, grade: designLetter },
        { teamId: 'them', receives: [], packageReceived: 8, forcedDrops: [], lineupDeltaPerWeek: -1, lineupBeforePerWeek: 100, grade: null },
      ] as never,
      gapPct: 20,
      fairnessLabel: 'leans' as const,
      notes: [],
    },
  })

  it('records the one grade beside the design letter, for the same side — and whether they agree', async () => {
    const same = await evaluateTrade({ ...base(), teamBenefit: benefit('B') }, deps())
    expect(same.designShadow).toEqual({ currentLetter: 'B', designLetter: 'B', agree: true })
    expect(same.teamBenefit?.gapPct).toBe(20)
    const differ = await evaluateTrade({ ...base(), teamBenefit: benefit('A') }, deps())
    expect(differ.designShadow).toEqual({ currentLetter: 'B', designLetter: 'A', agree: false })
  })

  it('the shadow NEVER changes the letter shown', async () => {
    const r = await evaluateTrade({ ...base(), teamBenefit: benefit('A') }, deps())
    expect(r.grade).toMatchObject({ letter: 'B' })
  })

  it('a missing letter on either side is no comparison — agree is null, not true', async () => {
    const r = await evaluateTrade({ ...base(), teamBenefit: benefit(null) }, deps())
    expect(r.designShadow).toEqual({ currentLetter: 'B', designLetter: null, agree: null })
  })

  it('a refused model is recorded as a refusal, with no shadow', async () => {
    const r = await evaluateTrade({ ...base(), teamBenefit: { ok: false, reason: 'no projection', missingAssets: ['X'] } }, deps())
    expect(r).toMatchObject({ teamBenefit: null, designShadow: null, teamBenefitRefusal: { reason: 'no projection', missingAssets: ['X'] } })
  })
})
