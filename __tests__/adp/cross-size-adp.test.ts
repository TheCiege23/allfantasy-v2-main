/**
 * Cross-size ADP projection — the maths that makes every league size work.
 *
 * Measured on production 2026-08-30: 170 boards, and every league that was not 12-team read
 * em-dashes (8-, 14-, 22-, 27-team all empty), while 25,261 of 27,742 rows sat on imported boards
 * no league could resolve to. Exact-match-or-nothing fragments a modest corpus into empty buckets.
 *
 * The transform is rounds: `overall / teamCount`. Pick 13 is round 1.08 in a 12-team draft and
 * round 0.93 in a 14-team one — the same player, two league geometries. Projecting through rounds
 * is exact arithmetic, not a heuristic, and these tests pin it, because getting it wrong gives
 * every non-12-team league a confidently wrong board instead of an honest empty one.
 */

import { describe, expect, it } from 'vitest'

import {
  buildCrossSizeBoard,
  toOverall,
  toRounds,
  weightedMedian,
  type CrossSizeRow,
} from '@/lib/adp/crossSizeAdp'

function row(over: Partial<CrossSizeRow> = {}): CrossSizeRow {
  return {
    playerKey: 'jamarr chase|wr',
    playerName: "Ja'Marr Chase",
    teamCount: 12,
    draftType: 'snake',
    averageOverallPick: 12,
    sampleSize: 100,
    ...over,
  }
}

describe('rounds are the size-independent unit', () => {
  it('converts an overall pick to rounds and back', () => {
    expect(toRounds(12, 12)).toBe(1)
    expect(toRounds(13, 12)).toBeCloseTo(1.0833, 4)
    expect(toOverall(1, 14)).toBe(14)
    expect(toOverall(toRounds(13, 12), 12)).toBeCloseTo(13, 10)
  })

  it('projects the same market position into a different league size', () => {
    // Overall 13 of 12 teams is 1.083 rounds; the same position in a 14-team draft is ~15.2.
    const rounds = toRounds(13, 12)
    expect(toOverall(rounds, 14)).toBeCloseTo(15.17, 2)
    expect(toOverall(rounds, 8)).toBeCloseTo(8.67, 2)
  })

  it('refuses a non-positive team count rather than dividing by zero', () => {
    expect(Number.isNaN(toRounds(10, 0))).toBe(true)
    expect(Number.isNaN(toRounds(10, -12))).toBe(true)
    expect(Number.isNaN(toOverall(1, 0))).toBe(true)
  })
})

describe('weightedMedian', () => {
  it('returns the single value when there is one', () => {
    expect(weightedMedian([{ value: 5, weight: 3 }])).toBe(5)
  })

  it('is dragged far less than a mean by a heavy outlier', () => {
    const pairs = [
      { value: 1, weight: 10 },
      { value: 2, weight: 10 },
      { value: 200, weight: 9 },
    ]
    const mean = pairs.reduce((s, p) => s + p.value * p.weight, 0) / pairs.reduce((s, p) => s + p.weight, 0)
    const median = weightedMedian(pairs)
    // This is the auction-contamination case: a mean would report ~63, the median holds at 2.
    expect(mean).toBeGreaterThan(50)
    expect(median).toBe(2)
  })

  it('respects weight, not just count', () => {
    // One heavily-sampled board outvotes two thin ones.
    expect(weightedMedian([
      { value: 1, weight: 1 },
      { value: 2, weight: 1 },
      { value: 50, weight: 1000 },
    ])).toBe(50)
  })

  it('ignores non-finite and zero-weight entries', () => {
    expect(weightedMedian([
      { value: Number.NaN, weight: 100 },
      { value: 7, weight: 0 },
      { value: 9, weight: 5 },
    ])).toBe(9)
  })

  it('returns NaN when nothing is usable rather than a fabricated zero', () => {
    expect(Number.isNaN(weightedMedian([]))).toBe(true)
    expect(Number.isNaN(weightedMedian([{ value: 5, weight: 0 }]))).toBe(true)
  })
})

describe('buildCrossSizeBoard', () => {
  it('projects a 12-team board into a 14-team league', () => {
    const board = buildCrossSizeBoard([row({ averageOverallPick: 12, teamCount: 12 })], {
      targetTeamCount: 14,
      targetDraftType: 'snake',
    })
    // 12/12 = 1 round; 1 round in a 14-team league is overall 14.
    expect(board.get('jamarr chase|wr')?.adp).toBe(14)
  })

  it('projects into a smaller league too', () => {
    const board = buildCrossSizeBoard([row({ averageOverallPick: 24, teamCount: 12 })], {
      targetTeamCount: 8,
      targetDraftType: 'snake',
    })
    // 24/12 = 2 rounds; 2 rounds at 8 teams is overall 16.
    expect(board.get('jamarr chase|wr')?.adp).toBe(16)
  })

  it('is identity when the sizes already match', () => {
    const board = buildCrossSizeBoard([row({ averageOverallPick: 37, teamCount: 12 })], {
      targetTeamCount: 12,
      targetDraftType: 'snake',
    })
    expect(board.get('jamarr chase|wr')?.adp).toBe(37)
  })

  it('pools several sizes and reports what contributed', () => {
    const board = buildCrossSizeBoard(
      [
        row({ teamCount: 10, averageOverallPick: 10, sampleSize: 50 }),
        row({ teamCount: 12, averageOverallPick: 12, sampleSize: 50 }),
        row({ teamCount: 14, averageOverallPick: 14, sampleSize: 50 }),
      ],
      { targetTeamCount: 12, targetDraftType: 'snake' },
    )
    const entry = board.get('jamarr chase|wr')!
    // Every board says "1 round", so the projection is overall 12 at 12 teams.
    expect(entry.adp).toBe(12)
    expect(entry.contributingTeamCounts).toEqual([10, 12, 14])
    expect(entry.boardCount).toBe(3)
    expect(entry.sampleSize).toBe(150)
  })
})

describe('auction boards are kept apart from the rest', () => {
  const mixed = [
    row({ draftType: 'snake', averageOverallPick: 12, teamCount: 12, sampleSize: 100 }),
    row({ draftType: 'imported', averageOverallPick: 12, teamCount: 12, sampleSize: 100 }),
    row({ draftType: 'auction', averageOverallPick: 180, teamCount: 12, sampleSize: 100 }),
  ]

  it('excludes auction boards from a snake reader', () => {
    const board = buildCrossSizeBoard(mixed, { targetTeamCount: 12, targetDraftType: 'snake' })
    const entry = board.get('jamarr chase|wr')!
    expect(entry.boardCount).toBe(2) // snake + imported, not auction
    expect(entry.adp).toBe(12)
  })

  it('gives an auction reader ONLY auction boards', () => {
    const board = buildCrossSizeBoard(mixed, { targetTeamCount: 12, targetDraftType: 'auction' })
    const entry = board.get('jamarr chase|wr')!
    expect(entry.boardCount).toBe(1)
    expect(entry.adp).toBe(180)
  })

  it('includes imported boards, which is the whole point of the tier', () => {
    // 25,261 production rows were quarantined on draftType 'imported' and reachable by nobody.
    const board = buildCrossSizeBoard([row({ draftType: 'imported' })], {
      targetTeamCount: 14,
      targetDraftType: 'snake',
    })
    expect(board.size).toBe(1)
  })
})

describe('rows that cannot be trusted are dropped, not guessed at', () => {
  it('drops a row whose own team count is unusable', () => {
    const board = buildCrossSizeBoard([row({ teamCount: 0 })], {
      targetTeamCount: 12,
      targetDraftType: 'snake',
    })
    expect(board.size).toBe(0)
  })

  it('drops a row with a non-positive ADP', () => {
    const board = buildCrossSizeBoard([row({ averageOverallPick: 0 })], {
      targetTeamCount: 12,
      targetDraftType: 'snake',
    })
    expect(board.size).toBe(0)
  })

  it('returns an empty board for a non-positive target size', () => {
    expect(buildCrossSizeBoard([row()], { targetTeamCount: 0, targetDraftType: 'snake' }).size).toBe(0)
  })
})
