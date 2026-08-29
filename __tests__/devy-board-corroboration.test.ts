import { describe, expect, it } from 'vitest'

import { buildDevyValueBoard, type DevyBoardInput } from '@/lib/devy/devyValueBoard'

/**
 * The second opinion on the devy board — and the reason it is REPORTED rather than blended.
 *
 * 🛑 THE FEATURE THESE TESTS PREVENT. The obvious move, once Fantrax NCAAF ADP landed, is the
 * `afValue.ts` bridge: blend the two orderings in rank space. That is honest there because
 * FantasyCalc and DynastyProcess agree on ORDER at Spearman 0.939 and differ only in scale.
 * These two agree at 0.380 (measured on production 2026-08-29 over the 327 players carrying
 * both signals; median rank gap 71 of 327). Averaging orderings that disagree that much
 * produces a number neither source supports, so the scouting rank still prices the board and
 * the disagreement is handed to the manager.
 */

const SEASON = 2026

const player = (
  name: string,
  score: number | null,
  adp: number | null,
  extra: Partial<DevyBoardInput> = {},
): DevyBoardInput => ({
  name,
  position: 'WR',
  school: 'State',
  draftEligibleYear: SEASON + 1,
  classYear: 3,
  draftProjectionScore: score,
  recruitingComposite: 0.9,
  breakoutAge: 19.5,
  projectedDraftRound: 3,
  devyAdp: adp,
  ...extra,
})

describe('devy board ADP corroboration', () => {
  it('ranks the ADP board independently of the scouting board', () => {
    const board = buildDevyValueBoard(
      [
        player('Scout Favourite', 90, 40),
        player('Draft Favourite', 60, 1),
        player('No Adp', 80, null),
      ],
      SEASON,
    )
    const byName = new Map(board.entries.map((e) => [e.name, e]))

    expect(byName.get('Draft Favourite')!.adpRank).toBe(1)
    expect(byName.get('Scout Favourite')!.adpRank).toBe(2)
    expect(byName.get('No Adp')!.adpRank).toBeNull()
    expect(board.adpCoverage).toBe(2)
  })

  /**
   * 🛑 THE PRICING MUST NOT MOVE. The board is priced off the scouting rank; adding a second
   * opinion is an information change, not a valuation change. If ADP starts moving prices,
   * it is doing so on the strength of a 0.380 correlation nobody validated.
   */
  it('does not let ADP change what a player is worth', () => {
    const withAdp = buildDevyValueBoard([player('A', 90, 1), player('B', 60, 2)], SEASON)
    const withoutAdp = buildDevyValueBoard([player('A', 90, null), player('B', 60, null)], SEASON)

    const v = (b: ReturnType<typeof buildDevyValueBoard>, n: string) =>
      b.entries.find((e) => e.name === n)!.value.value

    expect(v(withAdp, 'A')).toBe(v(withoutAdp, 'A'))
    expect(v(withAdp, 'B')).toBe(v(withoutAdp, 'B'))
  })

  /**
   * 🛑 ONE OPINION CANNOT CORROBORATE ITSELF. Reporting agreement for a player carrying only
   * a scouting score would manufacture confidence — the same rule afValue applies when it
   * refuses to call a lone source 'high'.
   */
  it('reports no corroboration when only one signal exists', () => {
    const board = buildDevyValueBoard([player('Only Scout', 80, null), player('Both', 70, 1)], SEASON)
    const byName = new Map(board.entries.map((e) => [e.name, e]))

    expect(byName.get('Only Scout')!.corroboration).toBeNull()
    expect(byName.get('Both')!.corroboration).not.toBeNull()
  })

  it('calls close agreement corroborated and wide disagreement contested', () => {
    /* 200 players so a rank gap can actually exceed the contested threshold of 176. */
    const pool: DevyBoardInput[] = []
    for (let i = 0; i < 200; i++) pool.push(player(`P${String(i).padStart(3, '0')}`, 100 - i * 0.1, i + 1))
    // Agreeing player: top of both boards.
    pool.push(player('Agrees', 200, 0.5))
    // Disagreeing player: best scouting score, worst ADP.
    pool.push(player('Disagrees', 199, 999))

    const board = buildDevyValueBoard(pool, SEASON)
    const byName = new Map(board.entries.map((e) => [e.name, e]))

    expect(byName.get('Agrees')!.corroboration!.confidence).toBe('corroborated')
    expect(byName.get('Disagrees')!.corroboration!.confidence).toBe('contested')
    expect(board.contested).toBeGreaterThan(0)
  })

  /**
   * ⚠ THE COMPARISON MUST BE OVER THE SAME POPULATION. `devyRank` is a rank over everyone with
   * a scouting score; `adpRank` is over the far smaller set carrying an ADP. Subtracting one
   * from the other directly reports a huge gap for a player both sources like, purely because
   * the boards are different sizes — the same error as comparing ranks across seasons.
   */
  it('compares the two orderings over the commonly-signalled pool, not across board sizes', () => {
    const pool: DevyBoardInput[] = []
    /* 100 scouting-only players sit ABOVE the pair we check, inflating their global ranks. */
    for (let i = 0; i < 100; i++) pool.push(player(`Filler${i}`, 500 - i, null))
    pool.push(player('TopBoth', 100, 1))
    pool.push(player('NextBoth', 99, 2))

    const board = buildDevyValueBoard(pool, SEASON)
    const top = board.entries.find((e) => e.name === 'TopBoth')!

    // Global scouting rank is ~101, ADP rank is 1 — a naive subtraction would report ~100.
    expect(top.devyRank).toBeGreaterThan(100)
    expect(top.adpRank).toBe(1)
    expect(top.corroboration!.rankGap).toBe(0)
    expect(top.corroboration!.confidence).toBe('corroborated')
  })

  it('states the partial ADP coverage as a gap rather than implying a full board', () => {
    const board = buildDevyValueBoard([player('A', 90, 1), player('B', 80, null)], SEASON)
    expect(board.gaps.join(' ')).toMatch(/0\.380|which schools are ingested/)
  })
})
