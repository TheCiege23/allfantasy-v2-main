import { describe, expect, it } from 'vitest'

import {
  buildDevyValueBoard,
  devyTier,
  type DevyBoardInput,
} from '@/lib/devy/devyValueBoard'

/**
 * ⚠ WHAT THIS BOARD REPLACES. `DevyPlayer.devyValue` is written by
 * `calculateQuickDevyValue(position, classYear)` — a lookup with no
 * player-specific input, so every freshman QB in the country prices at 8400 —
 * and it is ZERO for 1,455 of 1,718 players in production. The live board sorts
 * those last, tiers them "Sleeper" and renders 0, which shows an absence of data
 * to a manager as a confident statement that the player is worthless.
 */

const SEASON = 2026

function player(over: Partial<DevyBoardInput> & { name: string }): DevyBoardInput {
  return {
    position: 'WR',
    school: 'Somewhere',
    draftEligibleYear: SEASON + 1,
    classYear: 3,
    draftProjectionScore: null,
    recruitingComposite: null,
    breakoutAge: null,
    projectedDraftRound: null,
    devyAdp: null,
    ...over,
  }
}

describe('the board ranks on evidence, not on position and class year', () => {
  const pool = [
    player({ name: 'Best', draftProjectionScore: 92, recruitingComposite: 0.98 }),
    player({ name: 'Middle', draftProjectionScore: 60, recruitingComposite: 0.85 }),
    player({ name: 'Worst', draftProjectionScore: 30, recruitingComposite: 0.7 }),
  ]

  it('ranks by scouting projection, best first', () => {
    const board = buildDevyValueBoard(pool, SEASON)
    expect(board.entries.map((e) => e.devyRank)).toEqual([1, 2, 3])
    expect(board.entries.map((e) => e.name)).toEqual(['Best', 'Middle', 'Worst'])
  })

  /**
   * Rank and value genuinely disagree: a freshman three years out can be the
   * better prospect and still be worth less today. A value board must list by
   * value, or the numbers appear to jump around at random.
   */
  it('lists by value, keeping rank visible for the scouting view', () => {
    const board = buildDevyValueBoard(
      [
        player({ name: 'Far Freshman', draftProjectionScore: 95, draftEligibleYear: SEASON + 3 }),
        player({ name: 'Near Junior', draftProjectionScore: 85, draftEligibleYear: SEASON }),
      ],
      SEASON,
    )
    // Freshman is the better PROSPECT...
    expect(board.entries.find((e) => e.name === 'Far Freshman')!.devyRank).toBe(1)
    // ...but the junior is worth more TODAY, so he heads the value listing.
    expect(board.entries[0].name).toBe('Near Junior')
    const values = board.entries.map((e) => e.value.value!)
    expect(values[0]).toBeGreaterThanOrEqual(values[1])
  })

  it('the listing never shows a value below one further down', () => {
    const board = buildDevyValueBoard(pool, SEASON)
    const values = board.entries.filter((e) => e.value.value != null).map((e) => e.value.value!)
    for (let i = 1; i < values.length; i++) {
      expect(values[i]).toBeLessThanOrEqual(values[i - 1])
    }
  })

  it('prices the top of the board above the bottom', () => {
    const board = buildDevyValueBoard(pool, SEASON)
    const values = board.entries.map((e) => e.value.value!)
    expect(values[0]).toBeGreaterThan(values[2])
  })

  /**
   * ⚠ A QB and a WR of identical projection must price identically here. Under
   * devyValue they would differ by 1000 purely because of the position lookup.
   */
  it('does not price a player on his position alone', () => {
    const board = buildDevyValueBoard(
      [
        player({ name: 'The QB', position: 'QB', draftProjectionScore: 80 }),
        player({ name: 'The WR', position: 'WR', draftProjectionScore: 80 }),
      ],
      SEASON,
    )
    const [a, b] = board.entries
    expect(a.value.value).toBe(b.value.value)
  })

  /**
   * ⚠ THE ARTIFACT THIS PREVENTS. Consecutive ranks for tied players priced them
   * 750 against 706 on this curve — a difference produced entirely by their
   * order in the array, which moves whenever the query order does.
   */
  it('players we cannot tell apart share a rank rather than a sort position', () => {
    const board = buildDevyValueBoard(
      [
        player({ name: 'Zeta', draftProjectionScore: 70 }),
        player({ name: 'Alpha', draftProjectionScore: 70 }),
        player({ name: 'Below', draftProjectionScore: 50 }),
      ],
      SEASON,
    )
    const ranks = new Map(board.entries.map((e) => [e.name, e.devyRank]))
    expect(ranks.get('Alpha')).toBe(1)
    expect(ranks.get('Zeta')).toBe(1)
    // Competition ranking: the next distinct score takes the position, not 2.
    expect(ranks.get('Below')).toBe(3)
  })

  it('is stable regardless of the order the pool arrives in', () => {
    const a = player({ name: 'Alpha', draftProjectionScore: 70 })
    const z = player({ name: 'Zeta', draftProjectionScore: 70 })
    const forward = buildDevyValueBoard([a, z], SEASON)
    const reversed = buildDevyValueBoard([z, a], SEASON)

    expect(forward.entries.map((e) => e.name)).toEqual(reversed.entries.map((e) => e.name))
    expect(forward.entries.map((e) => e.value.value)).toEqual(
      reversed.entries.map((e) => e.value.value),
    )
  })

  it('never reads devyValue, and says so', () => {
    const board = buildDevyValueBoard(pool, SEASON)
    expect(board.gaps.join(' ')).toMatch(/devyValue is not used here/)
  })
})

describe('an unscored player is unknown, not worthless', () => {
  const pool = [
    player({ name: 'Known', draftProjectionScore: 88 }),
    player({ name: 'Unknown A' }),
    player({ name: 'Unknown B' }),
  ]

  it('leaves him unranked rather than sorting him last with a value', () => {
    const board = buildDevyValueBoard(pool, SEASON)
    const unknown = board.entries.find((e) => e.name === 'Unknown A')!

    expect(unknown.devyRank).toBeNull()
    expect(unknown.value.value).toBeNull()
  })

  it('reports coverage so a short board is not mistaken for a complete one', () => {
    const board = buildDevyValueBoard(pool, SEASON)
    expect(board.ranked).toBe(1)
    expect(board.unranked).toBe(2)
    expect(board.coverage).toBeCloseTo(1 / 3, 5)
    expect(board.gaps.join(' ')).toMatch(/not the whole class/)
  })

  it('still places priced players ahead of unpriced ones in the listing', () => {
    const board = buildDevyValueBoard(pool, SEASON)
    expect(board.entries[0].name).toBe('Known')
    expect(board.entries.slice(1).every((e) => e.devyRank == null)).toBe(true)
  })

  it('an empty pool reports zero coverage rather than dividing by zero', () => {
    const board = buildDevyValueBoard([], SEASON)
    expect(board.coverage).toBe(0)
    expect(board.entries).toEqual([])
  })
})

/**
 * ⚠ Two college players share a name often enough that a name-only key would
 * collapse them into one rank and drop the other off the board entirely.
 */
describe('identity', () => {
  it('keeps two same-named players at different schools distinct', () => {
    const board = buildDevyValueBoard(
      [
        player({ name: 'John Smith', school: 'Alabama', draftProjectionScore: 90 }),
        player({ name: 'John Smith', school: 'Ohio State', draftProjectionScore: 50 }),
      ],
      SEASON,
    )
    expect(board.ranked).toBe(2)
    expect(board.entries.map((e) => e.devyRank)).toEqual([1, 2])
  })

  it('prefers an explicit id when the caller has one', () => {
    const board = buildDevyValueBoard(
      [
        player({ id: 'a', name: 'Same Name', school: 'Same', draftProjectionScore: 90 }),
        player({ id: 'b', name: 'Same Name', school: 'Same', draftProjectionScore: 40 }),
      ],
      SEASON,
    )
    expect(board.ranked).toBe(2)
  })
})

describe('devyTier', () => {
  it('bands by rank', () => {
    expect(devyTier(1)).toBe('Elite')
    expect(devyTier(12)).toBe('Elite')
    expect(devyTier(13)).toBe('Tier 1')
    expect(devyTier(36)).toBe('Tier 1')
    expect(devyTier(84)).toBe('Tier 2')
    expect(devyTier(300)).toBe('Depth')
  })

  /**
   * ⚠ THE LIVE BOARD'S BUG. assignTier() maps devyValue 0 to "Sleeper", turning
   * 1,455 players we know nothing about into a scouting opinion.
   */
  it('an unranked player gets no tier at all, never "Sleeper"', () => {
    expect(devyTier(null)).toBeNull()
  })
})

describe('the wait is still priced', () => {
  it('the same projection is worth less the further from eligibility he is', () => {
    const near = buildDevyValueBoard(
      [player({ name: 'Near', draftProjectionScore: 90, draftEligibleYear: SEASON })],
      SEASON,
    )
    const far = buildDevyValueBoard(
      [player({ name: 'Far', draftProjectionScore: 90, draftEligibleYear: SEASON + 3 })],
      SEASON,
    )
    expect(near.entries[0].value.value!).toBeGreaterThan(far.entries[0].value.value!)
  })

  /**
   * ⚠ Rank is taken from the STORED projection, not the horizon-discounted
   * outlook score — otherwise a freshman is punished for being a freshman twice,
   * once in his rank and again in the discount.
   */
  it('does not double-count the wait by ranking on the discounted score', () => {
    const board = buildDevyValueBoard(
      [
        player({ name: 'Freshman', draftProjectionScore: 90, draftEligibleYear: SEASON + 3 }),
        player({ name: 'Senior', draftProjectionScore: 80, draftEligibleYear: SEASON }),
      ],
      SEASON,
    )
    // The better prospect still RANKS first even though his wait is longer.
    // He does not lead the value listing — the wait is priced there, once.
    const freshman = board.entries.find((e) => e.name === 'Freshman')!
    const senior = board.entries.find((e) => e.name === 'Senior')!
    expect(freshman.devyRank).toBe(1)
    expect(senior.devyRank).toBe(2)
    expect(senior.value.value!).toBeGreaterThan(freshman.value.value!)
  })
})
