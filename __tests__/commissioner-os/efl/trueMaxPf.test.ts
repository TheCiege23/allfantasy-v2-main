import { describe, expect, it } from 'vitest'

import { computeOptimalLineup, type LineupSlotSpec } from '@/lib/lineup-optimizer/optimalLineup'
import { runGreedyOptimizer } from '@/lib/bestball/optimizerCore'
import {
  computeSeasonMaxPf,
  computeWeeklyMaxPf,
  MAX_PF_COMPUTATION_VERSION,
  type WeeklyRosterPlayer,
} from '@/lib/commissioner-os/efl/maxPfEngine'
import { computeRegularSeasonMaxPf } from '@/lib/commissioner-os/efl/maxPfFreeze'

/**
 * TRUE Max PF.
 *
 * 🛑 THE RULE UNDER TEST: **BENCHING A GOOD PLAYER MUST NOT LOWER MAX PF.** That is the whole
 * purpose — the EFL constitution uses Reverse Max PF to reduce tanking, and a metric a manager can
 * lower by sitting his best players rewards exactly the behaviour it exists to punish.
 */

const STANDARD: LineupSlotSpec[] = [
  { slot: 'QB', eligible: ['QB'], count: 1, slotOrder: 0 },
  { slot: 'RB', eligible: ['RB'], count: 2, slotOrder: 1 },
  { slot: 'WR', eligible: ['WR'], count: 2, slotOrder: 2 },
  { slot: 'TE', eligible: ['TE'], count: 1, slotOrder: 3 },
  { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1, slotOrder: 4 },
]

const p = (
  playerId: string,
  positions: string[],
  points: number,
  wasStarter = false,
): WeeklyRosterPlayer => ({ playerId, positions, points, wasStarter, playerName: playerId })

const total = (players: WeeklyRosterPlayer[], slots = STANDARD) =>
  computeOptimalLineup({ players, slots }).total

describe('1-3 · the anti-tanking property', () => {
  const roster = [
    p('QB1', ['QB'], 25),
    p('RB1', ['RB'], 20),
    p('RB2', ['RB'], 15),
    p('WR1', ['WR'], 18),
    p('WR2', ['WR'], 12),
    p('TE1', ['TE'], 10),
    p('RB3', ['RB'], 9),
    /* The star. Benched in every variant below. */
    p('WRSTAR', ['WR'], 40),
  ]

  it('1 · a benched star still counts toward Max PF', () => {
    const benched = roster.map((x) => ({ ...x, wasStarter: x.playerId !== 'WRSTAR' && x.playerId !== 'RB3' }))
    const week = computeWeeklyMaxPf({ week: 1, slots: STANDARD, teams: [{ teamId: 'a', players: benched }] })
    const row = week.rows[0]!
    /* QB1 25 + RB1 20 + RB2 15 + WRSTAR 40 + WR1 18 + TE1 10 + FLEX WR2 12 = 140 */
    expect(row.maxPf).toBe(140)
    expect(row.optimal.assignments.some((a) => a.playerId === 'WRSTAR')).toBe(true)
  })

  it('2 · starting a worse player does NOT lower Max PF', () => {
    /*
     * 🛑 THE CENTRAL TANKING TEST. Identical rosters, identical scores, different submitted lineups.
     * Max PF must be byte-identical; only `actualStarterPoints` may differ.
     */
    const optimalStart = roster.map((x) => ({ ...x, wasStarter: x.playerId !== 'RB3' && x.playerId !== 'WR2' }))
    const tanked = roster.map((x) => ({ ...x, wasStarter: x.playerId === 'RB3' || x.playerId === 'WR2' }))

    const a = computeWeeklyMaxPf({ week: 1, slots: STANDARD, teams: [{ teamId: 'a', players: optimalStart }] }).rows[0]!
    const b = computeWeeklyMaxPf({ week: 1, slots: STANDARD, teams: [{ teamId: 'a', players: tanked }] }).rows[0]!

    expect(b.maxPf).toBe(a.maxPf)
    expect(b.actualStarterPoints).toBeLessThan(a.actualStarterPoints)
  })

  it('3 · an EMPTY submitted lineup does not make Max PF zero', () => {
    const noneStarted = roster.map((x) => ({ ...x, wasStarter: false }))
    const row = computeWeeklyMaxPf({ week: 1, slots: STANDARD, teams: [{ teamId: 'a', players: noneStarted }] }).rows[0]!
    expect(row.actualStarterPoints).toBe(0)
    expect(row.maxPf).toBe(140)
  })
})

describe('4-9 · legal slot assignment', () => {
  it('4 · a player cannot fill two slots', () => {
    /* One RB, two RB seats: he takes one, the other is unfilled. */
    const result = computeOptimalLineup({
      players: [p('RB1', ['RB'], 30)],
      slots: [{ slot: 'RB', eligible: ['RB'], count: 2 }],
    })
    expect(result.assignments).toHaveLength(1)
    expect(result.total).toBe(30)
    expect(result.unfilledSlots).toEqual([{ slot: 'RB', seat: 2 }])
  })

  it('5 · FLEX eligibility admits RB/WR/TE and nothing else', () => {
    const flex: LineupSlotSpec[] = [{ slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 }]
    expect(total([p('QB1', ['QB'], 50)], flex)).toBe(0)
    expect(total([p('QB1', ['QB'], 50), p('WR1', ['WR'], 10)], flex)).toBe(10)
  })

  it('6 · SUPERFLEX admits a quarterback', () => {
    const sf: LineupSlotSpec[] = [
      { slot: 'QB', eligible: ['QB'], count: 1, slotOrder: 0 },
      { slot: 'SUPER_FLEX', eligible: ['QB', 'RB', 'WR', 'TE'], count: 1, slotOrder: 1 },
    ]
    expect(total([p('QB1', ['QB'], 30), p('QB2', ['QB'], 25)], sf)).toBe(55)
  })

  it('7 · the TE slot takes a tight end and not a receiver', () => {
    const te: LineupSlotSpec[] = [{ slot: 'TE', eligible: ['TE'], count: 1 }]
    expect(total([p('WR1', ['WR'], 40)], te)).toBe(0)
    expect(total([p('WR1', ['WR'], 40), p('TE1', ['TE'], 6)], te)).toBe(6)
  })

  it('8 · multiple FLEX seats optimise GLOBALLY, not one at a time', () => {
    /*
     * 🛑 THE COUNTEREXAMPLE THE WHOLE ALGORITHM EXISTS FOR. A per-slot greedy fills the restrictive
     * RB seat with the best RB, then has nothing left for the flexes. The optimal answer seats the
     * WEAKER RB in the RB seat so the stronger one can take a flex alongside the receiver.
     */
    const slots: LineupSlotSpec[] = [
      { slot: 'RB', eligible: ['RB'], count: 1, slotOrder: 0 },
      { slot: 'FLEX', eligible: ['RB', 'WR'], count: 2, slotOrder: 1 },
    ]
    const players = [p('RB1', ['RB'], 30), p('RB2', ['RB'], 20), p('WR1', ['WR'], 25)]
    expect(total(players, slots)).toBe(75)
  })

  it('9 · multi-position eligibility never duplicates a player', () => {
    const slots: LineupSlotSpec[] = [
      { slot: 'RB', eligible: ['RB'], count: 1, slotOrder: 0 },
      { slot: 'WR', eligible: ['WR'], count: 1, slotOrder: 1 },
    ]
    const result = computeOptimalLineup({ players: [p('DUAL', ['RB', 'WR'], 30)], slots })
    expect(result.assignments).toHaveLength(1)
    expect(result.total).toBe(30)
    expect(result.unfilledSlots).toHaveLength(1)
  })

  it('9b · a dual-eligible player is seated where he unblocks the most points', () => {
    const slots: LineupSlotSpec[] = [
      { slot: 'RB', eligible: ['RB'], count: 1, slotOrder: 0 },
      { slot: 'FLEX', eligible: ['RB', 'WR'], count: 1, slotOrder: 1 },
    ]
    /* DUAL must take RB so WR1 can take FLEX; the reverse would leave RB empty. */
    const result = computeOptimalLineup({
      players: [p('DUAL', ['RB', 'WR'], 20), p('WR1', ['WR'], 18)],
      slots,
    })
    expect(result.total).toBe(38)
    expect(result.assignments.find((a) => a.slot === 'RB')!.playerId).toBe('DUAL')
  })
})

describe('10 · ties are deterministic', () => {
  it('the same inputs always seat the same players', () => {
    const players = [p('B', ['WR'], 10), p('A', ['WR'], 10), p('C', ['WR'], 10)]
    const slots: LineupSlotSpec[] = [{ slot: 'WR', eligible: ['WR'], count: 1 }]
    const first = computeOptimalLineup({ players, slots })
    const second = computeOptimalLineup({ players: [...players].reverse(), slots })
    expect(first.assignments[0]!.playerId).toBe('A')
    expect(JSON.stringify(first.assignments)).toBe(JSON.stringify(second.assignments))
    expect(first.provenance.tiedAlternativeExists).toBe(true)
  })

  it('slot array order does not change the total', () => {
    const players = [p('QB1', ['QB'], 30), p('RB1', ['RB'], 25), p('QB2', ['QB'], 5)]
    const forward: LineupSlotSpec[] = [
      { slot: 'QB', eligible: ['QB'], count: 1, slotOrder: 0 },
      { slot: 'SUPER_FLEX', eligible: ['QB', 'RB', 'WR', 'TE'], count: 1, slotOrder: 1 },
    ]
    const backward = [...forward].reverse()
    expect(total(players, forward)).toBe(total(players, backward))
  })
})

describe('11-15 · the season aggregate', () => {
  const week = (w: number, pts: number) => ({
    week: w,
    teams: [{ teamId: 'a', players: [p('QB1', ['QB'], pts)] }],
  })
  const QB_ONLY: LineupSlotSpec[] = [{ slot: 'QB', eligible: ['QB'], count: 1 }]

  it('11 · playoff weeks are excluded from the aggregate', () => {
    const season = computeSeasonMaxPf({
      regularSeasonFinalWeek: 14,
      weeks: [...Array.from({ length: 17 }, (_, i) => week(i + 1, 10))],
      slotsForWeek: () => QB_ONLY,
    })
    expect(season.weeklyValues).toHaveLength(14)
    expect(season.weeklyValues.every((v) => v.week <= 14)).toBe(true)
  })

  it('12 · adding playoff scoring cannot alter the frozen number', () => {
    const regular = Array.from({ length: 14 }, (_, i) => week(i + 1, 10))
    const withPlayoffs = [...regular, week(15, 999), week(16, 999), week(17, 999)]

    const freezeOf = (weeks: ReturnType<typeof week>[]) => {
      const season = computeSeasonMaxPf({ regularSeasonFinalWeek: 14, weeks, slotsForWeek: () => QB_ONLY })
      return computeRegularSeasonMaxPf({
        leagueId: 'efl-1',
        season: 2026,
        regularSeasonFinalWeek: 14,
        metric: 'optimal_lineup_max_pf',
        computationVersion: season.computationVersion,
        weeklyRows: season.weeklyValues,
        teamIds: ['a'],
      }).snapshot
    }
    expect(freezeOf(withPlayoffs)).toEqual(freezeOf(regular))
    expect(freezeOf(regular).rows[0]!.value).toBe(140)
  })

  it('13 · a player rostered only from week 10 contributes nothing to week 9', () => {
    /*
     * ⚠ ROSTER MEMBERSHIP IS PER WEEK AND COMES FROM THE DATA, NOT FROM A SEASON ROSTER.
     * `LeaguePlayerWeeklyScore` stores one row per (league, season, week, player) with the roster
     * that held him, so a mid-season acquisition simply is not in the earlier weeks' input.
     */
    const season = computeSeasonMaxPf({
      regularSeasonFinalWeek: 10,
      weeks: [
        { week: 9, teams: [{ teamId: 'a', players: [p('QB1', ['QB'], 10)] }] },
        { week: 10, teams: [{ teamId: 'a', players: [p('QB1', ['QB'], 10), p('LATE', ['QB'], 99)] }] },
      ],
      slotsForWeek: () => QB_ONLY,
    })
    expect(season.weeklyValues.find((v) => v.week === 9)!.value).toBe(10)
    expect(season.weeklyValues.find((v) => v.week === 10)!.value).toBe(99)
  })

  it('14 · a player dropped before a week contributes nothing to it', () => {
    const season = computeSeasonMaxPf({
      regularSeasonFinalWeek: 10,
      weeks: [
        { week: 9, teams: [{ teamId: 'a', players: [p('GONE', ['QB'], 50)] }] },
        { week: 10, teams: [{ teamId: 'a', players: [p('QB1', ['QB'], 10)] }] },
      ],
      slotsForWeek: () => QB_ONLY,
    })
    expect(season.weeklyValues.find((v) => v.week === 10)!.value).toBe(10)
  })

  it('15 · week-specific lineup configuration is respected', () => {
    /*
     * 🛑 THE SEAM SURVIVOR ALL-STARS NEEDS. That format opens a WRT flex in week 7 and a SUPERFLEX in
     * week 9, so a static configuration would make its Max PF meaningless. EFL does not change
     * mid-season and its reader returns the same seats every week — but the ENGINE does not assume
     * that, and this proves it.
     */
    const roster = [{ teamId: 'a', players: [p('QB1', ['QB'], 30), p('QB2', ['QB'], 25)] }]
    const season = computeSeasonMaxPf({
      regularSeasonFinalWeek: 2,
      weeks: [{ week: 1, teams: roster }, { week: 2, teams: roster }],
      slotsForWeek: (w) =>
        w >= 2
          ? [
              { slot: 'QB', eligible: ['QB'], count: 1, slotOrder: 0 },
              { slot: 'SUPER_FLEX', eligible: ['QB', 'RB', 'WR', 'TE'], count: 1, slotOrder: 1 },
            ]
          : [{ slot: 'QB', eligible: ['QB'], count: 1, slotOrder: 0 }],
    })
    expect(season.weeklyValues.find((v) => v.week === 1)!.value).toBe(30)
    expect(season.weeklyValues.find((v) => v.week === 2)!.value).toBe(55)
  })

  it('reports weeks with no data rather than treating them as zero', () => {
    const season = computeSeasonMaxPf({
      regularSeasonFinalWeek: 5,
      weeks: [week(1, 10), week(3, 10)],
      slotsForWeek: () => QB_ONLY,
    })
    expect(season.weeksWithNoData).toEqual([2, 4, 5])
  })
})

describe('16 · IDP is supported, not silently treated as offense-only', () => {
  it('defensive seats are filled by defensive players', () => {
    const idp: LineupSlotSpec[] = [
      { slot: 'QB', eligible: ['QB'], count: 1, slotOrder: 0 },
      { slot: 'DL', eligible: ['DL', 'DE', 'DT'], count: 1, slotOrder: 1 },
      { slot: 'LB', eligible: ['LB'], count: 1, slotOrder: 2 },
      { slot: 'IDP_FLEX', eligible: ['DL', 'DE', 'DT', 'LB', 'DB'], count: 1, slotOrder: 3 },
    ]
    const result = computeOptimalLineup({
      players: [
        p('QB1', ['QB'], 20),
        p('DL1', ['DL'], 12),
        p('LB1', ['LB'], 14),
        p('DB1', ['DB'], 11),
        p('WRX', ['WR'], 99),
      ],
      slots: idp,
    })
    expect(result.total).toBe(57)
    /* The 99-point receiver has no seat in this lineup and must not appear. */
    expect(result.assignments.some((a) => a.playerId === 'WRX')).toBe(false)
    expect(result.unusedPlayerIds).toContain('WRX')
  })

  it('a defensive player is not admitted to an offensive flex', () => {
    const flex: LineupSlotSpec[] = [{ slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 }]
    expect(total([p('LB1', ['LB'], 30)], flex)).toBe(0)
  })
})

describe('17 · the primitive is reusable, and Best Ball is measured rather than assumed', () => {
  it('🛑 the Best Ball greedy optimizer is NOT safe for Max PF — measured, both answers pinned', () => {
    /*
     * This is the justification for building a new optimizer, kept as a measurement so nobody has to
     * take the claim on trust. `SUPER_FLEX` is not named `FLEX`, so `runGreedyOptimizer` fills it in
     * the first pass in ARRAY ORDER and burns the best quarterback there.
     */
    const slots = [
      { slot: 'SUPER_FLEX', eligible: ['QB', 'RB', 'WR', 'TE'], count: 1 },
      { slot: 'QB', eligible: ['QB'], count: 1 },
    ]
    const greedy = runGreedyOptimizer(
      [
        { playerId: 'QB_A', playerName: 'QB_A', position: 'QB', points: 30 },
        { playerId: 'RB_B', playerName: 'RB_B', position: 'RB', points: 25 },
        { playerId: 'QB_C', playerName: 'QB_C', position: 'QB', points: 5 },
      ],
      slots,
      'NFL',
    )
    const exact = computeOptimalLineup({
      players: [p('QB_A', ['QB'], 30), p('RB_B', ['RB'], 25), p('QB_C', ['QB'], 5)],
      slots: slots.map((s, i) => ({ ...s, slotOrder: i })),
    })

    expect(greedy.totalPoints).toBe(35)
    expect(exact.total).toBe(55)
    expect(exact.total).toBeGreaterThan(greedy.totalPoints)
  })

  it('Best Ball behaviour is UNCHANGED — the greedy optimizer still returns what it always did', () => {
    /*
     * ⚠ A GUARD, NOT A COMPLIMENT. Repointing Best Ball at the exact primitive is a separate,
     * user-visible decision. This fails if somebody quietly rewires it.
     */
    const result = runGreedyOptimizer(
      [
        { playerId: 'WR1', playerName: 'WR1', position: 'WR', points: 20 },
        { playerId: 'RB1', playerName: 'RB1', position: 'RB', points: 18 },
      ],
      [
        { slot: 'WR', eligible: ['WR'], count: 1 },
        { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1 },
      ],
      'NFL',
    )
    expect(result.totalPoints).toBe(38)
    expect(result.optimizerLog).toMatchObject({ algorithm: 'bestball-greedy-v1' })
  })

  it('the exact primitive handles a Best Ball shaped lineup', () => {
    const bestBallSlots: LineupSlotSpec[] = [
      { slot: 'QB', eligible: ['QB'], count: 1, slotOrder: 0 },
      { slot: 'RB', eligible: ['RB'], count: 2, slotOrder: 1 },
      { slot: 'WR', eligible: ['WR'], count: 3, slotOrder: 2 },
      { slot: 'TE', eligible: ['TE'], count: 1, slotOrder: 3 },
      { slot: 'FLEX', eligible: ['RB', 'WR', 'TE'], count: 1, slotOrder: 4 },
    ]
    const result = computeOptimalLineup({
      players: [
        p('QB1', ['QB'], 20), p('RB1', ['RB'], 15), p('RB2', ['RB'], 12), p('RB3', ['RB'], 11),
        p('WR1', ['WR'], 18), p('WR2', ['WR'], 14), p('WR3', ['WR'], 9), p('TE1', ['TE'], 8),
      ],
      slots: bestBallSlots,
    })
    /* 20 + 15 + 12 + 18 + 14 + 9 + 8 + FLEX RB3 11 = 107 */
    expect(result.total).toBe(107)
  })
})

describe('18 · Max PF and actual Points For genuinely differ', () => {
  it('the manager started the wrong player and the two numbers disagree', () => {
    const roster = [
      p('QB1', ['QB'], 30, true),
      p('RB1', ['RB'], 5, true),
      p('RB2', ['RB'], 4, true),
      p('WR1', ['WR'], 3, true),
      p('WR2', ['WR'], 2, true),
      p('TE1', ['TE'], 1, true),
      p('FLEXY', ['WR'], 1, true),
      /* On the bench, and the best player on the roster. */
      p('BENCHED', ['RB'], 40, false),
    ]
    const row = computeWeeklyMaxPf({ week: 1, slots: STANDARD, teams: [{ teamId: 'a', players: roster }] }).rows[0]!
    /* Submitted: 30+5+4+3+2+1+1 = 46. */
    expect(row.actualStarterPoints).toBe(46)
    /* Optimal: QB1 30 + RB BENCHED 40 + RB RB1 5 + WR1 3 + WR2 2 + TE1 1 + FLEX RB2 4 = 85. */
    expect(row.maxPf).toBe(85)
    expect(row.pointsLeftOnBench).toBe(39)
  })
})

describe('provenance is stamped so two engines can never be silently compared', () => {
  it('the computation version names the optimizer it used', () => {
    expect(MAX_PF_COMPUTATION_VERSION).toContain('exact-transversal-matroid-v1')
    const season = computeSeasonMaxPf({
      regularSeasonFinalWeek: 1,
      weeks: [{ week: 1, teams: [{ teamId: 'a', players: [p('QB1', ['QB'], 10)] }] }],
      slotsForWeek: () => [{ slot: 'QB', eligible: ['QB'], count: 1 }],
    })
    expect(season.computationVersion).toBe(MAX_PF_COMPUTATION_VERSION)
  })
})
