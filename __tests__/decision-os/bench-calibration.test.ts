import { describe, expect, it, vi } from 'vitest'

/**
 * Lineup OS, 2026-11-21 (owner's call): My Team's bench check learns from its own graded calls. A swap's confidence
 * comes from how swaps with an edge that size turned out; the call itself never changes.
 */

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/core-app/myTeam', () => ({ getMyTeamData: vi.fn() }))

const {
  benchEdgeBand,
  foldBenchEdgeBands,
  benchCalibrationFrom,
  benchCallRecord,
  BENCH_CALIBRATION_MIN_SAMPLE,
  BENCH_EDGE_FLOOR,
} = await import('@/lib/decision-os/lineup/benchCalibration')
const { foldLedger, weekCalendar } = await import('@/lib/chimmy-outcomes/ledgerRecord')
const { BENCH_SWAP_POINTS } = await import('@/lib/core-app/rosterSlots')
const { myTeamScreenMessages } = await import('@/lib/core-app/messages/myTeamScreen')
const { optimizeLineup } = await import('@/lib/decision-os/lineup/bestLineup')
const { buildMyTeamLineupContext } = await import('@/lib/chimmy/myTeamLineupGrounding')

const calls = (n: number, edge: number, call: 'right' | 'wrong' | 'same', ageDays = 0) => Array.from({ length: n }, () => ({ edge, call, ageDays }))

describe('the edge bands', () => {
  it('2–4, 4–8 and 8+ points; under the swap threshold is not a swap at all', () => {
    expect(BENCH_EDGE_FLOOR).toBe(BENCH_SWAP_POINTS)
    expect(benchEdgeBand(1.9)).toBeNull()
    expect(benchEdgeBand(2)).toBe('narrow')
    expect(benchEdgeBand(3.99)).toBe('narrow')
    expect(benchEdgeBand(4)).toBe('clear')
    expect(benchEdgeBand(7.9)).toBe('clear')
    expect(benchEdgeBand(8)).toBe('wide')
    expect(benchEdgeBand(Number.NaN)).toBeNull()
  })
})

describe('the record', () => {
  it('🛑 says nothing until a band has enough DECIDED calls — a tie decides nothing', () => {
    const under = foldBenchEdgeBands([...calls(BENCH_CALIBRATION_MIN_SAMPLE - 1, 5, 'right'), ...calls(30, 5, 'same')])
    expect(under.clear).toMatchObject({ n: BENCH_CALIBRATION_MIN_SAMPLE - 1 + 30, same: 30 })
    expect(benchCalibrationFrom(under)).toBeNull()
    const enough = foldBenchEdgeBands(calls(BENCH_CALIBRATION_MIN_SAMPLE, 5, 'right'))
    expect(benchCalibrationFrom(enough)?.clear?.decided).toBe(BENCH_CALIBRATION_MIN_SAMPLE)
  })

  it('shrinks toward a coin flip: 20 of 20 right reads 75%, not 100%', () => {
    const cal = benchCalibrationFrom(foldBenchEdgeBands(calls(20, 5, 'right')))
    expect(cal?.clear?.rightRate).toBeCloseTo((20 + 0.5 * 20) / (20 + 20), 6)
  })

  it('old calls weigh less than this week’s', () => {
    const fresh = benchCalibrationFrom(foldBenchEdgeBands([...calls(20, 5, 'right'), ...calls(20, 5, 'wrong', 120)]))
    const stale = benchCalibrationFrom(foldBenchEdgeBands([...calls(20, 5, 'right', 120), ...calls(20, 5, 'wrong')]))
    expect(fresh!.clear!.rightRate).toBeGreaterThan(0.5)
    expect(stale!.clear!.rightRate).toBeLessThan(0.5)
  })

  it('each band is its own record, and a call is read against its own band', () => {
    const cal = benchCalibrationFrom(foldBenchEdgeBands([...calls(60, 3, 'wrong'), ...calls(30, 3, 'right'), ...calls(80, 10, 'right'), ...calls(10, 10, 'wrong')]))
    const narrow = benchCallRecord(2.5, cal)!
    const wide = benchCallRecord(12, cal)!
    expect(narrow).toMatchObject({ band: 'narrow', decided: 90, level: 'low' })
    expect(wide).toMatchObject({ band: 'wide', decided: 90, level: 'high' })
    expect(benchCallRecord(5, cal)).toBeNull()
    expect(benchCallRecord(1, cal)).toBeNull()
  })
})

describe('the ledger folds NFL calls by their edge', () => {
  const DAY = 86_400_000
  const cal = weekCalendar(
    Array.from({ length: 18 }, (_, i) => ({
      week: i + 1,
      firstKickoff: new Date(Date.UTC(2026, 8, 11, 0, 20) + i * 7 * DAY),
      lastKickoff: new Date(Date.UTC(2026, 8, 15, 1, 15) + i * 7 * DAY),
    })),
  )
  const NOW = new Date(Date.UTC(2026, 10, 17, 12))
  const noTrades = { byLetter: {}, pending: 0, unscored: 0, read: 0, gradable: 0 }
  const row = (over: Record<string, unknown>) => ({ userId: 'u', week: 9, withdrawn: false, recPts: 18, altPts: 6, sport: 'NFL', recProjected: 14, altProjected: 9, givenAt: new Date(Date.UTC(2026, 10, 2)), ...over })

  it('🛑 NFL, graded, with both projections — and the tally is exactly what it was', () => {
    const out = foldLedger({
      season: 2026, cal, now: NOW, adds: [], trades: noTrades,
      bench: [
        row({}),
        row({ recPts: 4, altPts: 9 }),
        row({ sport: 'NBA' }), // another sport: not this record's at all (2026-11-23) — neither tallied nor banded
        row({ recProjected: null }), // an old row with no projections
        row({ week: 11 }), // not over yet
        row({ withdrawn: true }),
      ] as never,
    })
    expect(out.bench).toMatchObject({ right: 2, wrong: 1, pending: 1, withdrawn: 1 })
    expect(out.benchEdges?.clear).toMatchObject({ n: 2, right: 1, wrong: 1 })
    expect(Object.keys(out.benchEdges ?? {})).toEqual(['clear'])
  })

  it('🛑 an NBA call stored under a week number that matches the NFL\'s counts nowhere — not graded, pending or withdrawn', () => {
    const out = foldLedger({
      season: 2026, cal, now: NOW, adds: [], trades: noTrades,
      bench: [row({ sport: 'NBA' }), row({ sport: 'nba', week: 11 }), row({ sport: 'NHL', withdrawn: true }), row({ sport: 'MLB', recPts: 1 })] as never,
    })
    expect(out.bench).toEqual({ right: 0, wrong: 0, same: 0, gain: 0, pending: 0, unscored: 0, withdrawn: 0 })
    expect(out.users).toEqual({})
    // A row with no sport is an old read and grades as it always did.
    const old = foldLedger({ season: 2026, cal, now: NOW, adds: [], trades: noTrades, bench: [row({ sport: undefined })] as never })
    expect(old.bench.right).toBe(1)
  })

  it('no banded call, no `benchEdges` key — a snapshot reads as before', () => {
    const out = foldLedger({ season: 2026, cal, now: NOW, adds: [], trades: noTrades, bench: [row({ sport: 'NBA' })] as never })
    expect(out).not.toHaveProperty('benchEdges')
  })
})

describe('said, never decided', () => {
  it('the screen’s sentence, in English and Spanish (and no Spanish «waiver»)', () => {
    const en = myTeamScreenMessages.en.benchCheckRecord
    const es = myTeamScreenMessages.es.benchCheckRecord
    expect(en(71, 140, 'clear', false)).toBe('Swaps with a 4–8 point edge have been right 71% of the time (140 graded calls).')
    expect(en(48, 90, 'narrow', true)).toContain('right only 48% of the time (90 graded calls) — closer than the projections suggest.')
    expect(es(71, 140, 'clear', false)).toBe('Los cambios con una ventaja de 4 a 8 puntos han acertado el 71% de las veces (140 decisiones evaluadas).')
    expect(es(48, 90, 'narrow', true)).toContain('solo han acertado el 48%')
    expect(es(48, 90, 'wide', true).toLowerCase()).not.toContain('waiver')
  })

  const NOW = new Date('2026-11-15T15:00:00.000Z')
  const later = new Date('2026-11-15T18:00:00.000Z')
  const player = (id: string, name: string, position: string, af: number) =>
    ({ sleeperId: id, name, position, team: 'XX', sport: 'NFL', kickoff: later, injuryStatus: null, ruledOut: false, afProjectedPoints: af, onBye: false }) as never
  const slot = (slotLabel: string, p: unknown) => ({ slotLabel, benchCheck: null, player: p, empty: !p, unresolvedId: null }) as never
  const qb = player('1', 'Quinn Arm', 'QB', 21)
  const wr1 = player('2', 'Wade Hands', 'WR', 9)
  const wr2 = player('3', 'Benchy Burner', 'WR', 15)
  const rb = player('4', 'Rex Legs', 'RB', 12)
  const rbBench = player('5', 'Ronnie Backup', 'RB', 11)
  const data = (starters: unknown[], bench: unknown[]) =>
    ({
      league: { id: 'L', name: 'Sunday League', platform: 'sleeper', sport: 'NFL', format: 'redraft', sourceLink: null },
      starters: { available: true, data: starters },
      bench: { available: true, data: bench },
      projections: { available: true, data: { season: '2026', week: 11 } },
      lineupOptimizer: optimizeLineup({ starters: starters as never, bench: bench as never, sport: 'NFL', now: NOW }),
    }) as never

  const record = benchCalibrationFrom(foldBenchEdgeBands([...calls(70, 6, 'right'), ...calls(30, 6, 'wrong')]))

  it('Chimmy’s one-swap verdict carries the record for a swap that size; the verdict is unchanged', async () => {
    const d = data([slot('QB', qb), slot('WR', wr1), slot('RB', rb)], [wr2, rbBench])
    const plain = (await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: NOW }, { load: async () => d, calibration: async () => null })) as string
    const withRecord = (await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: NOW }, { load: async () => d, calibration: async () => record })) as string
    expect(withRecord).toContain("How My Team's bench calls like this have held up: swaps with an edge of 4–8 points were right")
    expect(withRecord).toContain('never call the swap certain')
    // Everything else is byte for byte the same answer.
    expect(withRecord.split('\n').filter((l) => !l.startsWith('How My Team')).join('\n')).toBe(plain)
  })

  it('🛑 an NBA swap is read against the NBA record by its share of the starter — and the answer is otherwise unchanged', async () => {
    const { foldBenchShareBands } = await import('@/lib/decision-os/lineup/benchCalibration')
    const nba = (starters: unknown[], bench: unknown[]) => ({ ...(data(starters, bench) as object), league: { id: 'L', name: 'Hoops', platform: 'sleeper', sport: 'NBA', format: 'redraft', sourceLink: null } }) as never
    // Sam Bench 15 over Pat Guard 9: a 6-point edge, 67% of the starter — `wide` by share (it would be `clear` in points).
    const share = benchCalibrationFrom(foldBenchShareBands([...Array.from({ length: 40 }, () => ({ edge: 30, starterProjected: 100, call: 'right' as const, ageDays: 0 })), ...Array.from({ length: 10 }, () => ({ edge: 30, starterProjected: 100, call: 'wrong' as const, ageDays: 0 }))]))
    const hoop = (id: string, name: string, position: string, af: number) =>
      ({ sleeperId: id, name, position, team: 'XX', sport: 'NBA', kickoff: later, injuryStatus: null, ruledOut: false, afProjectedPoints: af, onBye: false }) as never
    const pg = hoop('11', 'Pat Guard', 'PG', 9)
    const c = hoop('12', 'Cal Center', 'C', 20)
    const sgBench = hoop('13', 'Sam Bench', 'PG', 15)
    const d = nba([slot('PG', pg), slot('C', c)], [sgBench])
    const plain = (await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: NOW }, { load: async () => d, calibration: async () => null })) as string
    const out = (await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: NOW }, { load: async () => d, calibration: async () => share })) as string
    expect(out).toContain("swaps with an edge of 25%+ of the starter's projection were right 71% of 50 graded calls")
    expect(out.split('\n').filter((l) => !l.startsWith('How My Team')).join('\n')).toBe(plain)
    // The NFL points record is never read for it: a points-only record says nothing here.
    const pointsOnly = (await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: NOW }, { load: async () => d, calibration: async () => record })) as string
    expect(pointsOnly).not.toContain('held up')
  })

  it('a close call gets no record line — only a swap is a call', async () => {
    const d = data([slot('QB', qb), slot('RB', rbBench)], [rb])
    const out = (await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: NOW }, { load: async () => d, calibration: async () => record })) as string
    expect(out).toContain('CLOSE CALL')
    expect(out).not.toContain('held up')
  })

  it('a calibration read that throws costs the line, never the answer', async () => {
    const d = data([slot('QB', qb), slot('WR', wr1), slot('RB', rb)], [wr2, rbBench])
    const out = (await buildMyTeamLineupContext({ leagueId: 'L', userId: 'u', now: NOW }, { load: async () => d, calibration: async () => { throw new Error('db') } })) as string
    expect(out).toContain('Verdict: CHANGE THE LINEUP')
    expect(out).not.toContain('held up')
  })

  it('My Team attaches the record to a swap only, from the edge it already computed', async () => {
    const { readFileSync } = await import('node:fs')
    const src = readFileSync(`${process.cwd()}/lib/core-app/myTeam.ts`, 'utf8')
    expect(src).toMatch(/const record = swap \? benchCallRecord\(c\.gap, benchCalibration, \{ scale: benchEdgeScaleFor\(sport\), starterProjected: c\.starterProj \}\) : null/)
    expect(src).toMatch(/verdict: swap \? 'swap' : 'close',/)
  })
})

describe('🛑 the bench read survives a database without the projection columns', () => {
  it('reads the projections when they exist, and falls back to the original read when they do not', async () => {
    const { loadBenchRows } = await import('@/lib/chimmy-outcomes/ledgerGrading')
    const base = { user_id: 'u', week: 9, withdrawn: false, rec_pts: 18, alt_pts: 6 }
    const wide = { $queryRaw: vi.fn(async () => [{ ...base, sport: 'NFL', rec_projected: 14, alt_projected: 9, given_at: new Date('2026-11-02') }]) }
    expect(await loadBenchRows(2026, wide as never)).toEqual([
      expect.objectContaining({ recPts: 18, altPts: 6, sport: 'NFL', recProjected: 14, altProjected: 9 }),
    ])
    // A database where `20261115000000_chimmy_advice_ledger_inputs` has not run: the wider SELECT fails once.
    const old = { $queryRaw: vi.fn().mockRejectedValueOnce(new Error('column a.rec_projected does not exist')).mockResolvedValueOnce([{ ...base, sport: 'NFL' }]) }
    const rows = await loadBenchRows(2026, old as never)
    expect(old.$queryRaw).toHaveBeenCalledTimes(2)
    expect(rows).toEqual([expect.objectContaining({ recPts: 18, altPts: 6, sport: 'NFL', recProjected: null, altProjected: null })])
  })

  it('🛑 both reads ask for NFL rows only, and the fallback still carries the sport', async () => {
    const { loadBenchRows } = await import('@/lib/chimmy-outcomes/ledgerGrading')
    const db = { $queryRaw: vi.fn().mockRejectedValueOnce(new Error('column a.rec_projected does not exist')).mockResolvedValueOnce([]) }
    await loadBenchRows(2026, db as never)
    const sqlOf = (call: unknown[]) => {
      const q = call[0] as { strings?: readonly string[] } | readonly string[]
      return (Array.isArray(q) ? q : (q as { strings: readonly string[] }).strings ?? []).join('?') + JSON.stringify(call.slice(1))
    }
    for (const call of db.$queryRaw.mock.calls) {
      const text = sqlOf(call as unknown[])
      expect(text).toMatch(/upper\(a\.sport\) = 'NFL'/)
      expect(text).toMatch(/a\.sport/)
    }
    expect(sqlOf(db.$queryRaw.mock.calls[1] as unknown[])).toMatch(/s\.points AS alt_pts, a\.sport/)
  })
})

describe('🛑 native NFL leagues are graded on our own engine\'s weekly scores (2026-11-23)', () => {
  // The read is `SELECT … ${from}`: the outer template's strings, then the nested `from` fragment's.
  type Frag = { strings: readonly string[]; values: readonly unknown[] }
  const fromOf = (call: unknown[]) => call.find((v): v is Frag => Boolean(v && typeof v === 'object' && 'strings' in v)) as Frag
  const sqlOf = (call: unknown[]) => fromOf(call).strings.join('?')
  const valuesOf = (call: unknown[]) => fromOf(call).values

  it('both players\' scores join on League.id + source allfantasy for a native league, and on the platform id otherwise', async () => {
    const { loadBenchRows } = await import('@/lib/chimmy-outcomes/ledgerGrading')
    const db = { $queryRaw: vi.fn(async () => []) }
    await loadBenchRows(2026, db as never)
    const call = db.$queryRaw.mock.calls[0] as unknown[]
    const text = sqlOf(call).replace(/\s+/g, ' ')
    for (const alias of ['r', 's']) {
      expect(text).toContain(`THEN ${alias}."leagueId" = l.id AND ${alias}.source = ?`)
      expect(text).toContain(`ELSE ${alias}."leagueId" = l."platformLeagueId" AND ${alias}.source <> ? END`)
    }
    expect(text).toContain(`r."playerId" = a.rec_player_key`)
    expect(text).toContain(`s."playerId" = a.alt_player_key`)
    // ESPN NFL (2026-11-24): its own rows only, under the `espn:` key the writer uses — never the bare platform id.
    for (const alias of ['r', 's']) {
      expect(text).toContain(`WHEN lower(coalesce(l.platform, '')) = ? THEN ${alias}."leagueId" = ? || l."platformLeagueId" AND ${alias}.source = ?`)
    }
    const values = valuesOf(call)
    expect(values).toContain('espn')
    expect(values).toContain('espn:')
    expect(values).toContain('allfantasy')
    // The native spellings come from the one predicate the app uses, never a local copy — and never ''.
    for (const p of ['allfantasy', 'af', 'manual', 'native']) expect(values).toContain(p)
    expect(values).not.toContain('')
  })

  it('My Team reads the bench record in a native or ESPN NFL league, not in Yahoo, nor in a native NBA league with no NBA record', async () => {
    const snapshot = { ledger: { benchEdges: { clear: { n: 30, right: 25, wrong: 5, same: 0, wDecided: 30, wRight: 25 } } } }
    vi.doMock('@/lib/chimmy-outcomes/learningStore', () => ({ readAdviceLearningSnapshot: vi.fn(async () => snapshot) }))
    vi.resetModules()
    const { loadBenchCalibration } = await import('@/lib/decision-os/lineup/benchCalibrationStore')
    expect(await loadBenchCalibration({ sport: 'NFL', platform: 'allfantasy' })).toMatchObject({ clear: { decided: 30 } })
    expect(await loadBenchCalibration({ sport: 'NFL', platform: 'sleeper' })).toMatchObject({ clear: { decided: 30 } })
    expect(await loadBenchCalibration({ sport: 'NFL', platform: 'espn' })).toMatchObject({ clear: { decided: 30 } })
    expect(await loadBenchCalibration({ sport: 'NFL', platform: 'yahoo' })).toBeNull()
    expect(await loadBenchCalibration({ sport: 'NFL', platform: '' })).toBeNull()
    expect(await loadBenchCalibration({ sport: 'NBA', platform: 'allfantasy' })).toBeNull()
    vi.doUnmock('@/lib/chimmy-outcomes/learningStore')
  })
})

describe('🛑 NBA / NHL / MLB: banded by share of the starter, each sport its own record (2026-11-23)', () => {
  it('the share bands: under 10%, 10–25%, 25%+ — and still nothing under the swap threshold', async () => {
    const { benchShareBand } = await import('@/lib/decision-os/lineup/benchCalibration')
    expect(benchShareBand(5, 100)).toBe('narrow')
    expect(benchShareBand(10, 100)).toBe('clear')
    expect(benchShareBand(24.9, 100)).toBe('clear')
    expect(benchShareBand(25, 100)).toBe('wide')
    expect(benchShareBand(3, 0)).toBe('wide')
    expect(benchShareBand(BENCH_EDGE_FLOOR - 0.1, 10)).toBeNull()
    expect(benchShareBand(5, null)).toBeNull()
  })

  it('the same 6-point edge is a different call in a 100-point week and a 10-point one', async () => {
    const { benchCallRecord: rec, foldBenchShareBands } = await import('@/lib/decision-os/lineup/benchCalibration')
    const cal = benchCalibrationFrom(
      foldBenchShareBands([
        ...Array.from({ length: 30 }, () => ({ edge: 6, starterProjected: 100, call: 'wrong' as const, ageDays: 0 })),
        ...Array.from({ length: 30 }, () => ({ edge: 6, starterProjected: 10, call: 'right' as const, ageDays: 0 })),
      ]),
    )
    expect(rec(6, cal, { scale: 'share', starterProjected: 100 })).toMatchObject({ band: 'narrow', level: 'low', scale: 'share' })
    expect(rec(6, cal, { scale: 'share', starterProjected: 10 })).toMatchObject({ band: 'wide', level: 'high', scale: 'share' })
    // Read in points it would be the one `clear` band for both — a band this share record does not hold, so: nothing.
    expect(rec(6, cal)).toBeNull()
  })

  it('🛑 silent below the minimum sample; shrunk toward a coin flip', async () => {
    const { foldBenchShareBands } = await import('@/lib/decision-os/lineup/benchCalibration')
    const few = Array.from({ length: BENCH_CALIBRATION_MIN_SAMPLE - 1 }, () => ({ edge: 30, starterProjected: 100, call: 'right' as const, ageDays: 0 }))
    expect(benchCalibrationFrom(foldBenchShareBands(few))).toBeNull()
    const enough = Array.from({ length: 20 }, () => ({ edge: 30, starterProjected: 100, call: 'right' as const, ageDays: 0 }))
    expect(benchCalibrationFrom(foldBenchShareBands(enough))?.wide?.rightRate).toBeCloseTo(0.75, 5)
  })

  it('the snapshot line bands each graded call by the starter it would bench; a call missing a projection is tallied only', async () => {
    const { sportBenchLineFrom } = await import('@/lib/chimmy-outcomes/sportBenchRecord')
    const tally = { right: 3, wrong: 0, same: 0, gain: 9, pending: 0, unscored: 0, withdrawn: 0 }
    const line = sportBenchLineFrom({
      tally,
      graded: [
        { call: 'right', recProjected: 115, altProjected: 100, ageDays: 0 },
        { call: 'right', recProjected: 104, altProjected: 100, ageDays: 0 },
        { call: 'right', recProjected: null, altProjected: 100, ageDays: 0 },
      ],
    })
    expect(line.tally).toBe(tally)
    expect(line.edges).toMatchObject({ clear: { n: 1, right: 1 }, narrow: { n: 1, right: 1 } })
    expect(sportBenchLineFrom({ tally, graded: [] })).toEqual({ tally })
  })

  it('My Team reads each sport\'s own line — never the NFL bands, never another sport\'s', async () => {
    const edges = { wide: { n: 30, right: 27, wrong: 3, same: 0, wDecided: 30, wRight: 27 } }
    const snapshot = { ledger: { benchEdges: { clear: { n: 99, right: 90, wrong: 9, same: 0, wDecided: 99, wRight: 90 } }, sportBench: { NBA: { tally: {}, edges } } } }
    vi.doMock('@/lib/chimmy-outcomes/learningStore', () => ({ readAdviceLearningSnapshot: vi.fn(async () => snapshot) }))
    vi.resetModules()
    const { loadBenchCalibration } = await import('@/lib/decision-os/lineup/benchCalibrationStore')
    expect(await loadBenchCalibration({ sport: 'NBA', platform: 'sleeper' })).toEqual({ wide: expect.objectContaining({ decided: 30 }) })
    expect(await loadBenchCalibration({ sport: 'nba', platform: 'allfantasy' })).toEqual({ wide: expect.objectContaining({ decided: 30 }) })
    expect(await loadBenchCalibration({ sport: 'NHL', platform: 'sleeper' })).toBeNull()
    expect(await loadBenchCalibration({ sport: 'NFL', platform: 'sleeper' })).toEqual({ clear: expect.objectContaining({ decided: 99 }) })
    expect(await loadBenchCalibration({ sport: 'NBA', platform: 'espn' })).toBeNull()
    expect(await loadBenchCalibration({ sport: 'SOCCER', platform: 'sleeper' })).toBeNull()
    vi.doUnmock('@/lib/chimmy-outcomes/learningStore')
  })

  it('the screen says the share, in English and Spanish', () => {
    const en = myTeamScreenMessages.en.benchCheckRecord
    const es = myTeamScreenMessages.es.benchCheckRecord
    expect(en(71, 140, 'clear', false, 'share')).toBe("Swaps with an edge of 10–25% of the starter's projection have been right 71% of the time (140 graded calls).")
    expect(en(48, 90, 'narrow', true, 'share')).toBe("Swaps with an edge of under 10% of the starter's projection have been right only 48% of the time (90 graded calls) — closer than the projections suggest.")
    expect(es(71, 140, 'wide', false, 'share')).toBe('Los cambios con una ventaja de más del 25% de la proyección del titular han acertado el 71% de las veces (140 decisiones evaluadas).')
    // Points, as before, when no scale is given.
    expect(en(71, 140, 'clear', false)).toBe('Swaps with a 4–8 point edge have been right 71% of the time (140 graded calls).')
  })
})
