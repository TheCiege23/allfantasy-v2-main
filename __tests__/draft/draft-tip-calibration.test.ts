import { describe, expect, it, vi } from 'vitest'

/**
 * Draft OS Engine axis (owner's "build it now", 2026-11-21): every served pick tip is graded against the board it was
 * given on, and the graded record sets the confidence said beside a pick in that part of the draft. The pick never
 * changes.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

const {
  draftRoundBand,
  gradeDraftTip,
  foldDraftTips,
  draftTipCalibrationFrom,
  draftTipConfidence,
  draftTipRecordLine,
  DRAFT_TIP_MIN_SAMPLE,
  DRAFT_TIP_ALTERNATIVES,
} = await import('@/lib/decision-os/draft/tipCalibration')
const { withDraftTipRecord } = await import('@/lib/shared-services/draft/pickDecision')
const { foldLedger, weekCalendar } = await import('@/lib/chimmy-outcomes/ledgerRecord')

const board = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`Alt ${i}|WR`, 200 - i]))
const pointsOf = (map: Record<string, number>) => (k: string) => (k in map ? map[k]! : null)

describe('grading one tip', () => {
  it('held up when the served pick out-scored the median of the best-projected alternatives; missed when not', () => {
    const projections = { 'Pick Me|RB': 210, ...board(20) }
    const altPoints = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Alt ${i}|WR`, 100 + i]))
    expect(gradeDraftTip({ servedKey: 'Pick Me|RB', projections, points: pointsOf({ 'Pick Me|RB': 150, ...altPoints }) })).toBe('held')
    expect(gradeDraftTip({ servedKey: 'Pick Me|RB', projections, points: pointsOf({ 'Pick Me|RB': 90, ...altPoints }) })).toBe('missed')
  })

  it('only the top alternatives by projection count — a deep sleeper who boomed is not the bar', () => {
    // Twenty deep sleepers who all boomed: counted, they would set the bar at 999.
    const sleepers = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`Deep Sleeper${i}|WR`, 1]))
    const projections = { 'Pick Me|RB': 210, ...board(DRAFT_TIP_ALTERNATIVES), ...sleepers }
    const pts = {
      'Pick Me|RB': 120,
      ...Object.fromEntries(Object.keys(board(DRAFT_TIP_ALTERNATIVES)).map((k) => [k, 100])),
      ...Object.fromEntries(Object.keys(sleepers).map((k) => [k, 999])),
    }
    expect(gradeDraftTip({ servedKey: 'Pick Me|RB', projections, points: pointsOf(pts) })).toBe('held')
  })

  it('not gradable: no served pick, served pick unplaced, or too few placed alternatives', () => {
    const projections = { 'Pick Me|RB': 210, ...board(4) }
    expect(gradeDraftTip({ servedKey: null, projections, points: () => 1 })).toBeNull()
    expect(gradeDraftTip({ servedKey: 'Pick Me|RB', projections: board(20), points: (k) => (k === 'Pick Me|RB' ? null : 1) })).toBeNull()
    // Four placed alternatives at 50 and a served pick at 60 would be "held" — but four is not a market.
    expect(gradeDraftTip({ servedKey: 'Pick Me|RB', projections, points: (k) => (k === 'Pick Me|RB' ? 60 : 50) })).toBeNull()
  })
})

describe('the record', () => {
  const calls = (n: number, round: number, grade: 'held' | 'missed') => Array.from({ length: n }, () => ({ round, grade }))

  it('bands by round; silent below the sample; shrunk toward a coin flip', () => {
    expect([draftRoundBand(1), draftRoundBand(3), draftRoundBand(4), draftRoundBand(8), draftRoundBand(9), draftRoundBand(0)]).toEqual(['early', 'early', 'middle', 'middle', 'late', null])
    expect(draftTipCalibrationFrom(foldDraftTips(calls(DRAFT_TIP_MIN_SAMPLE - 1, 2, 'held')))).toBeNull()
    const cal = draftTipCalibrationFrom(foldDraftTips([...calls(30, 2, 'held'), ...calls(10, 2, 'missed'), { round: 5, grade: null }]))
    expect(cal?.early).toEqual({ heldRate: (30 + 10) / (40 + 20), decided: 40 })
    expect(cal?.middle).toBeUndefined()
  })

  it('rides the six-hourly snapshot', () => {
    const draftTips = foldDraftTips(calls(25, 2, 'held'))
    const snap = foldLedger({ season: 2026, cal: weekCalendar([]), now: new Date(), bench: [], adds: [], trades: { byLetter: {}, pending: 0, unscored: 0, read: 0, gradable: 0 }, draftTips })
    expect(snap.draftTips).toEqual({ early: { held: 25, missed: 0 } })
  })
})

describe('the decision says it beside its own confidence, and nothing else changes', () => {
  const decision = {
    recommended_actions: [{ rank: 1, playerName: 'Pick Me', position: 'RB' }],
    four_answers: { what_happened: 'a', why_it_matters: 'b', how_confident: 'High confidence.', what_to_do: 'Draft Pick Me.' },
    rule_verdicts: [],
  } as never
  const calibration = { early: { heldRate: 0.5, decided: 44 } }

  it('NFL: the record line follows the engine\'s confidence; a low one says the pick is closer than it looks', () => {
    const out = withDraftTipRecord(decision, { sport: 'NFL', round: 2, calibration }) as { four_answers: Record<string, string>; recommended_actions: unknown }
    expect(out.four_answers.how_confident).toBe(
      'High confidence. How Draft OS\'s picks in rounds 1–3 have held up: about 50% out-scored the typical player still on the board (44 graded picks), so treat this pick as closer than it looks.',
    )
    expect(out.four_answers.what_to_do).toBe('Draft Pick Me.')
    expect(out.recommended_actions).toBe((decision as { recommended_actions: unknown }).recommended_actions)
  })

  it('another sport, another band, or no record: the decision is returned as it was', () => {
    expect(withDraftTipRecord(decision, { sport: 'NBA', round: 2, calibration })).toBe(decision)
    expect(withDraftTipRecord(decision, { sport: 'NFL', round: 6, calibration })).toBe(decision)
    expect(withDraftTipRecord(decision, { sport: 'NFL', round: 2, calibration: null })).toBe(decision)
  })

  it('a high band reads without the warning', () => {
    const c = draftTipConfidence(10, { late: { heldRate: 0.74, decided: 30 } })!
    expect(draftTipRecordLine(c)).toBe("How Draft OS's picks in rounds 9+ have held up: about 74% out-scored the typical player still on the board (30 graded picks).")
  })
})

describe('the six-hourly rebuild grades the recorded tips', () => {
  it('a season of served picks that beat their board reaches the snapshot as held up, by round band', async () => {
    const { recomputeLedgerRecord } = await import('@/lib/chimmy-outcomes/ledgerGrading')
    const week = (w: number) => new Date(Date.UTC(2026, 8, 10 + 7 * (w - 1), 17))
    const projections = { 'Pick Me|RB': 210, ...Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`Alt Guy${i}|WR`, 200 - i])) }
    const players = [
      { id: 'sp-pick', externalId: null, sleeperId: 's-pick', source: 'x', name: 'Pick Me', position: 'RB' },
      ...Array.from({ length: 12 }, (_, i) => ({ id: `sp-${i}`, externalId: null, sleeperId: `s-${i}`, source: 'x', name: `Alt Guy${i}`, position: 'WR' })),
    ]
    const stats = [2, 3, 4, 5, 6, 7, 8, 9, 10].flatMap((wk) => [
      { playerId: 's-pick', weekOrRound: wk, fantasyPoints: 20, normalizedStatMap: {} },
      ...Array.from({ length: 12 }, (_, i) => ({ playerId: `s-${i}`, weekOrRound: wk, fantasyPoints: 10, normalizedStatMap: {} })),
    ])
    const record = { createdAt: new Date(Date.UTC(2026, 8, 12)), round: 2, servedMode: 'observe', observeName: 'Pick Me', observePosition: 'RB', activeName: 'Pick Me', activePosition: 'RB', detail: { projections } }
    const db = {
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join('?')
        if (sql.includes('FROM "SportsGame"')) return Array.from({ length: 10 }, (_, i) => ({ week: i + 1, first: week(i + 1), last: week(i + 1) }))
        return []
      }),
      sportsPlayer: { findMany: vi.fn(async () => players) },
      playerGameStat: { findMany: vi.fn(async () => stats) },
      draftRecommendationRecord: { findMany: vi.fn(async () => Array.from({ length: 22 }, () => record)) },
    }
    const snap = await recomputeLedgerRecord({ now: new Date('2026-11-21T12:00:00Z'), db: db as never })
    expect(snap?.draftTips).toEqual({ early: { held: 22, missed: 0 } })
    expect(db.draftRecommendationRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ sport: 'NFL' }) }))
  })
})
