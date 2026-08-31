// @vitest-environment node
/**
 * Guards the redraft assignment.
 *
 * 🛑 THE EXISTING `executeAdvancement` IS WRONG FOR THIS TOURNAMENT IN THREE
 * WAYS, and only one of them is the randomness:
 *
 *   1. it shuffles, so a preview and the commit disagree and a commissioner
 *      rebuilding it by hand on the host platform cannot reproduce either;
 *   2. it buckets every advancer across all leagues before handing buckets to
 *      conferences, mixing Black and Gold into the same league when the two
 *      brackets run separately all the way to the final; and
 *   3. it caps leagues at eight slots, so 64 advancers become eight leagues of
 *      eight rather than four of sixteen.
 *
 * The assignment here is deterministic, conference-respecting and sized from the
 * tournament's own settings.
 */
import { describe, it, expect, vi } from 'vitest'

/*
 * 🛑 THE MODULE UNDER TEST IS `server-only` AND IMPORTS PRISMA AT MODULE SCOPE,
 * SO IMPORTING IT BUILDS A CLIENT BEFORE A SINGLE ASSERTION RUNS. That needs a
 * DATABASE_URL, and CI has none — the file dies at COLLECTION on "DATABASE_URL
 * is not set" while passing locally, because importing `@prisma/client` in a dev
 * checkout loads `.env` as a side effect and a runner without one gets nothing.
 * A green local run is not evidence about CI here.
 *
 * Two other test files in this repo were fixed for exactly this an hour before
 * this one was written; the same trap, found by diffing against main rather than
 * by anything failing locally.
 *
 * Only the PURE helpers are exercised below — none of them touches the database
 * — so the client is stubbed rather than built. Anything that did reach prisma
 * fails loudly on the empty stub, which is deliberate: this must not become a
 * way to test a query without a database.
 */
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { leagueNameFor, snakeAssign } from '@/lib/tournament/redraftPlan'
import { buildAdvancerList, buildRedraftExport } from '@/lib/tournament/standingsExport'

describe('spreading seeds across the new leagues', () => {
  const seeds = Array.from({ length: 8 }, (_, i) => i + 1)

  /**
   * 🛑 A SNAKE, NOT A ROUND ROBIN. Straight round-robin gives the league holding
   * seed 1 also seed 5 and seed 9 — every league keeps its band. The snake turns
   * each row around so the top seed's league takes the WEAKEST of the next band.
   */
  it('turns each row around so no league collects a tier', () => {
    expect(snakeAssign(seeds, 4)).toEqual([
      [1, 8],
      [2, 7],
      [3, 6],
      [4, 5],
    ])
  })

  it('is stable — the same input always gives the same assignment', () => {
    expect(snakeAssign(seeds, 4)).toEqual(snakeAssign(seeds, 4))
  })

  it('keeps every manager exactly once', () => {
    const out = snakeAssign(Array.from({ length: 64 }, (_, i) => i + 1), 4).flat()
    expect(out).toHaveLength(64)
    expect(new Set(out).size).toBe(64)
  })

  it('fills 64 into four leagues of sixteen', () => {
    const buckets = snakeAssign(Array.from({ length: 64 }, (_, i) => i + 1), 4)
    expect(buckets.map((b) => b.length)).toEqual([16, 16, 16, 16])
  })

  /** ⚠ An uneven field must still place everybody, not drop the remainder. */
  it('handles a field that does not divide evenly', () => {
    const buckets = snakeAssign([1, 2, 3, 4, 5], 2)
    expect(buckets.flat().sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    expect(buckets.map((b) => b.length)).toEqual([3, 2])
  })

  it('survives an empty field and a single league', () => {
    expect(snakeAssign([] as number[], 4)).toEqual([[], [], [], []])
    expect(snakeAssign(seeds, 1)).toEqual([seeds])
  })
})

describe('what the new leagues are called', () => {
  /**
   * ⚠ THE COMMISSIONER'S OWN NAMES, not something invented. `namingEngine`
   * generates themed names; a commissioner who has run NORTH/SOUTH/EAST/WEST for
   * years should not find their bracket renamed by a tool meant to save time.
   */
  it('uses the compass, prefixed by the conference', () => {
    expect([0, 1, 2, 3].map((i) => leagueNameFor(i, 'BLACK'))).toEqual([
      'BLACK NORTH',
      'BLACK SOUTH',
      'BLACK EAST',
      'BLACK WEST',
    ])
  })

  it('keeps going past four without colliding', () => {
    expect(leagueNameFor(4, 'GOLD')).toBe('GOLD NORTH 2')
    expect(leagueNameFor(8, 'GOLD')).toBe('GOLD NORTH 3')
    const names = Array.from({ length: 12 }, (_, i) => leagueNameFor(i, 'GOLD'))
    expect(new Set(names).size).toBe(12)
  })
})

describe('the sheet the commissioner works from', () => {
  const leagues = [
    {
      name: 'BLACK NORTH',
      managers: [
        { seed: 1, displayName: 'TyT1', fromLeague: 'BEAST', wins: 8, losses: 1, pointsFor: 1300.5 },
        { seed: 8, displayName: 'emmae', fromLeague: 'GOAT', wins: 5, losses: 4, pointsFor: 1100 },
      ],
    },
    {
      name: 'BLACK SOUTH',
      managers: [
        { seed: 2, displayName: 'RICO3', fromLeague: 'GRIZZ', wins: 7, losses: 2, pointsFor: 1250 },
      ],
    },
  ]

  /**
   * ⚠ ONE BLOCK PER NEW LEAGUE, because that is the unit of work — a commissioner
   * builds one league and invites its sixteen people, then the next.
   */
  it('emits a block per league with its own header', () => {
    const out = buildRedraftExport('BLACK', leagues)
    expect(out).toContain('BLACK — REDRAFT')
    expect(out).toContain('BLACK NORTH  (2 teams)')
    expect(out).toContain('BLACK SOUTH  (1 teams)')
    expect(out).toContain('1\tTyT1\tBEAST\t8-1\t1300.50')
  })

  /**
   * ⚠ THE FLAT LIST IS A DIFFERENT JOB. Announcing who advanced is one list
   * ordered by seed; pasting eight per-league tables into a chat makes 128
   * people hunt for their own name.
   */
  it('also produces one flat list, ordered by seed, naming where each goes', () => {
    const out = buildAdvancerList(leagues)
    const rows = out.split('\n')
    expect(rows[0]).toBe('SEED\tManager\tGoes to\tW/L\tTotal Pts')
    expect(rows[1]).toContain('TyT1')
    expect(rows[2]).toContain('RICO3')
    expect(rows[3]).toContain('emmae')
    expect(rows[1]).toContain('BLACK NORTH')
  })
})
