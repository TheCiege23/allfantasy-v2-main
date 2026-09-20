import { describe, expect, it } from 'vitest'

import {
  LATEST_TRADE_ORDER,
  gradeableSide,
  parsePickRowName,
  pickAssets,
  pickPricerFrom,
  withheldTradeReason,
} from '@/lib/core-app/tradePicks'
import { gradeTrade } from '@/lib/projections/tradeGrading'

/*
 * The KBFL trade these rules were written from, read off Sleeper on 2026-09-20:
 *
 *   TitanUp406 sends  A.J. Brown, David Montgomery, a 2027 3rd
 *   TitanUp406 gets   a 2027 1st, a 2027 1st, a 2027 2nd
 *
 * The board showed it as "A.J. Brown, David Montgomery" against "Picks or FAAB only
 * — no players on this side", graded "ungraded: one side has no assets on record".
 * Three false statements about one real trade, all from the same cause: nothing on
 * this path read `picksGiven`/`picksReceived`.
 */
const TITANUP_GAVE = [{ season: '2027', round: 3 }]
const TITANUP_GOT = [
  { season: '2027', round: 1 },
  { season: '2027', round: 2 },
  { season: '2027', round: 1 },
]

describe('pickAssets', () => {
  it('names every pick on a side, in season then round order', () => {
    expect(pickAssets(TITANUP_GOT).map((p) => p.name)).toEqual([
      '2027 1st',
      '2027 1st',
      '2027 2nd',
    ])
  })

  /*
   * 🛑 THE KEY COLLISION IS THE REASON THE INDEX IS IN THE ID. This side holds TWO
   * 2027 1sts; keyed on season and round alone they are the same string, and React
   * renders one row where two assets moved — a 3-for-2 shown as a 2-for-2.
   */
  it('gives two identical picks distinct ids', () => {
    const ids = pickAssets(TITANUP_GOT).map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  /*
   * ⚠ `kind` IS WHAT MAKES A PICK SAFE TO RENDER BESIDE A PLAYER. A synthetic pick
   * key is a non-empty string, so a renderer that looks at `id` alone opens a player
   * card for a player who is not in the trade.
   */
  it('marks picks as picks and never prices them', () => {
    for (const p of pickAssets(TITANUP_GOT)) {
      expect(p.kind).toBe('pick')
      expect(p.value).toBeNull()
      expect(p.id.startsWith('pick:')).toBe(true)
    }
  })

  it('handles the ordinals that the naive rule gets wrong', () => {
    expect(pickAssets([{ season: '2027', round: 11 }])[0]!.name).toBe('2027 11th')
    expect(pickAssets([{ season: '2027', round: 21 }])[0]!.name).toBe('2027 21st')
    expect(pickAssets([{ season: '2027', round: 4 }])[0]!.name).toBe('2027 4th')
  })

  /* The column is untyped JSON written by two importers. A row we cannot name is dropped. */
  it('drops anything it cannot name rather than guessing', () => {
    expect(pickAssets(null)).toEqual([])
    expect(pickAssets('2027 1st')).toEqual([])
    expect(
      pickAssets([null, {}, { season: '', round: 1 }, { season: '2027', round: 0 }, 'x']),
    ).toEqual([])
  })
})

describe('gradeableSide', () => {
  const priced = (id: string) => (id === 'brown' ? 12 : id === 'monty' ? 60 : null)

  /*
   * 🛑 THE REGRESSION THIS WHOLE CHANGE EXISTS TO STOP. Both players are priced, so
   * before picks were passed in, this graded — on the players alone, which values the
   * 2027 1st at ZERO and hands the letter to whichever side gave it away.
   */
  it('refuses a letter when the unpriced half of a trade is draft picks', () => {
    const g = gradeTrade(
      { label: 'received', assets: gradeableSide(['brown'], priced, pickAssets([])) },
      { label: 'gave', assets: gradeableSide(['monty'], priced, pickAssets(TITANUP_GOT)) },
    )
    expect(g.graded).toBe(false)
  })

  /* The control: the same shape with no picks still grades, so the test above can fail. */
  it('still grades a players-only trade', () => {
    const g = gradeTrade(
      { label: 'received', assets: gradeableSide(['brown'], priced, []) },
      { label: 'gave', assets: gradeableSide(['monty'], priced, []) },
    )
    expect(g.graded).toBe(true)
  })

  /*
   * ⚠ AND A PICKS-ONLY SIDE IS NOT AN EMPTY SIDE. `NO_ASSETS` was the reason the live
   * card gave — "one side has no assets on record" — about a side holding three picks.
   */
  it('does not report a picks-only side as having no assets', () => {
    const g = gradeTrade(
      { label: 'received', assets: gradeableSide([], priced, pickAssets(TITANUP_GOT)) },
      { label: 'gave', assets: gradeableSide(['brown', 'monty'], priced, pickAssets(TITANUP_GAVE)) },
    )
    expect(g.graded).toBe(false)
    if (!g.graded) expect(g.reason).not.toBe('NO_ASSETS')
  })
})

describe('withheldTradeReason', () => {
  const grade = (reason: 'NO_ASSETS' | 'PARTIAL_COVERAGE' | 'NO_COVERAGE', covered: number, total: number) =>
    ({ graded: false as const, reason, covered, total, detail: '' })
  const player = (name?: string) => ({ kind: 'player' as const, name })
  const pick = (name: string) => ({ kind: 'pick' as const, name })

  /*
   * 🛑 THE REGRESSION THIS FUNCTION EXISTS TO STOP, AND IT SHIPPED ONCE.
   * The old signature took a COUNT and fired the pick wording when `unpriced === pickCount`.
   * One unpriced player beside one perfectly priced pick satisfies that exactly, which is
   * the real production trade that exposed it: "Last League Left", a dynasty superflex
   * league whose 2027 4th sits in the book at rank 221, whose unpriced asset is a linebacker
   * FantasyCalc does not publish, and whose card blamed the pick.
   */
  it('does not blame the pick when the unpriced asset is a player', () => {
    const text = withheldTradeReason(grade('PARTIAL_COVERAGE', 1, 2), [player('DeMarvion Overshown')])
    expect(text).toMatch(/DeMarvion Overshown/)
    expect(text).not.toMatch(/draft pick/)
  })

  it('names the picks when the picks really are the gap', () => {
    expect(withheldTradeReason(grade('NO_COVERAGE', 0, 1), [pick('2027 4th')])).toMatch(/2027 4th/)
    expect(
      withheldTradeReason(grade('PARTIAL_COVERAGE', 2, 6), [
        pick('2027 1st'), pick('2027 2nd'), pick('2027 3rd'), pick('2028 1st'),
      ]),
    ).toMatch(/4 draft picks/)
  })

  /* Mixed gaps say so, rather than picking whichever kind reads better. */
  it('reports both kinds when both are unpriced', () => {
    const text = withheldTradeReason(grade('PARTIAL_COVERAGE', 2, 6), [
      player(), player(), pick('2027 1st'),
    ])
    expect(text).toMatch(/2 players and 1 draft pick/)
  })

  /*
   * ⚠ A KIND WITHOUT A NAME IS STILL THE TRUTH. The per-league screen never loads player
   * names on its grading path, so it passes kinds alone — which must still be enough to
   * avoid attributing the gap to the wrong asset.
   */
  it('works from kinds alone when the caller has no names', () => {
    const text = withheldTradeReason(grade('PARTIAL_COVERAGE', 1, 2), [player()])
    expect(text).toMatch(/1 player/)
    expect(text).not.toMatch(/draft pick/)
  })

  it('leaves an empty side its own wording', () => {
    expect(withheldTradeReason(grade('NO_ASSETS', 0, 2), [player('x')])).toMatch(/no assets on record/)
  })

  /*
   * ⚠ "ASSETS", NOT "PLAYERS". `grade.total` counts picks now, so a coverage sentence
   * calling them players is a wrong noun bolted to a right number. Reached when the caller
   * identifies nothing — the honest fallback rather than a guess.
   */
  it('counts assets rather than players when nothing was identified', () => {
    expect(withheldTradeReason(grade('PARTIAL_COVERAGE', 2, 6), [])).toBe(
      'Not graded — only 2 of 6 assets have values on file.',
    )
    expect(withheldTradeReason(grade('NO_COVERAGE', 0, 6), [])).not.toMatch(/player/i)
  })

  /* Never a letter, and never the word "even" — the rule `describeNoSignal` carries. */
  it('never reads as a grade', () => {
    for (const r of ['NO_ASSETS', 'PARTIAL_COVERAGE', 'NO_COVERAGE'] as const) {
      for (const u of [[], [player('A')], [pick('2027 1st'), player()]]) {
        const text = withheldTradeReason(grade(r, 1, 4), u)
        expect(text).toMatch(/^Not graded/)
        expect(text).not.toMatch(/\beven\b/i)
      }
    }
  })
})

describe('LATEST_TRADE_ORDER', () => {
  /*
   * 🛑 THE BUG IN ONE ASSERTION. Ordering by `(season, week)` is ordering by the LEG
   * Sleeper served a trade under — every offseason trade in a league shares one — so a
   * July trade held the "latest" slot while a September one sat below it.
   */
  it('leads on the trade timestamp, not the week', () => {
    expect(Object.keys(LATEST_TRADE_ORDER[0])).toEqual(['tradeDate'])
  })

  /* Postgres sorts NULLs FIRST under DESC, so a dateless row would win outright. */
  it('puts a missing timestamp last rather than first', () => {
    expect(LATEST_TRADE_ORDER[0].tradeDate).toEqual({ sort: 'desc', nulls: 'last' })
  })

  /* The mirrored copies tie on the timestamp; this is what stops the card flipping. */
  it('ends on historyId so the surviving mirror is deterministic', () => {
    expect(Object.keys(LATEST_TRADE_ORDER[LATEST_TRADE_ORDER.length - 1]!)).toEqual(['historyId'])
  })
})

/*
 * Stored pick rows, in the two shapes FantasyCalc really sends — per SLOT for near picks
 * ("2026 Pick 1.01") and per BUCKET for far ones ("2027 1st (Early)"). Both forms appear in
 * one response; the measured examples are recorded in `availablePlayersTool.ts`.
 *
 * 🛑 THE NUMBERS ARE SHAPED, NOT SAMPLED. They are ordered and spaced like a real dynasty
 * superflex board so the arithmetic below is meaningful, but no assertion here should ever be
 * read as a claim about what a 2027 1st is really worth. What is being tested is the MATH —
 * that buckets average, that an unknown round stays unpriced, that a missing rank is not a
 * missing price — none of which depends on the magnitudes being right.
 */
const PICK_ROWS = [
  { name: '2027 1st (Early)', value: 7000, overallRank: 10 },
  { name: '2027 1st (Mid)', value: 5800, overallRank: 20 },
  { name: '2027 1st (Late)', value: 4600, overallRank: 30 },
  { name: '2027 2nd (Early)', value: 3800, overallRank: 48 },
  { name: '2027 2nd (Mid)', value: 3200, overallRank: 62 },
  { name: '2027 3rd (Mid)', value: 2000, overallRank: 110 },
  { name: '2026 Pick 1.01', value: 9000, overallRank: 4 },
  { name: '2026 Pick 1.02', value: 8600, overallRank: 6 },
]

describe('parsePickRowName', () => {
  it('reads both of the shapes FantasyCalc sends', () => {
    expect(parsePickRowName('2027 1st (Early)')).toEqual({ season: '2027', round: 1 })
    expect(parsePickRowName('2027 3rd')).toEqual({ season: '2027', round: 3 })
    expect(parsePickRowName('2026 Pick 1.01')).toEqual({ season: '2026', round: 1 })
    expect(parsePickRowName('2026 Pick 12.11')).toEqual({ season: '2026', round: 12 })
  })

  /*
   * ⚠ A PARSER THAT KNOWS ONE FORM PRICES HALF THE BOARD AT NOTHING, and silently — an
   * unmatched row is indistinguishable from a round the market does not cover.
   */
  it('refuses anything that is not a pick name', () => {
    for (const n of ['A.J. Brown', '', '2027', 'Pick 1.01', '27 1st']) {
      expect(parsePickRowName(n)).toBeNull()
    }
  })
})

describe('pickPricerFrom', () => {
  const price = pickPricerFrom(PICK_ROWS)

  /* The user's decision, 2026-09-20: an unknown slot is unknown, so average the buckets. */
  it('averages the buckets, because we never store which slot a pick is', () => {
    expect(price('2027', 1)?.rank).toBe(20) // mean of 10, 20, 30
    expect(price('2027', 1)?.value).toBe(5800) // mean of 7000, 5800, 4600
    expect(price('2026', 1)?.rank).toBe(5) // mean of 4, 6 — slot form averages too
  })

  it('prices a round the book does not cover as unpriced, never as zero', () => {
    expect(price('2027', 9)).toBeNull()
    expect(price('2031', 1)).toBeNull()
    expect(price('', 1)).toBeNull()
  })

  /*
   * ⚠ A MISSING RANK IS NOT A MISSING PRICE, and they are different questions. The row still
   * carries a value worth displaying; it just cannot be graded on.
   */
  it('keeps a rankless row out of the rank mean without dropping its value', () => {
    const p = pickPricerFrom([
      { name: '2027 1st (Early)', value: 7000, overallRank: 10 },
      { name: '2027 1st (Mid)', value: 5000, overallRank: null },
    ])
    expect(p('2027', 1)?.rank).toBe(10)
    expect(p('2027', 1)?.value).toBe(6000)
  })

  it('returns nothing at all when the book holds no picks', () => {
    expect(pickPricerFrom([])('2027', 1)).toBeNull()
  })
})

describe('pricing the KBFL trade', () => {
  const priced = (id: string) => (id === 'brown' ? 12 : id === 'monty' ? 60 : null)
  const price = pickPricerFrom(PICK_ROWS)

  const kbfl = (p?: ReturnType<typeof pickPricerFrom>) =>
    gradeTrade(
      { label: 'received', assets: gradeableSide([], priced, pickAssets(TITANUP_GOT, p), p) },
      {
        label: 'gave',
        assets: gradeableSide(['brown', 'monty'], priced, pickAssets(TITANUP_GAVE, p), p),
      },
    )

  /*
   * 🛑 THE HEADLINE. This is the real trade the board showed as "ungraded: one side has no
   * assets on record" — three 2027 picks against two players and a 2027 3rd.
   */
  it('grades a trade whose whole side is draft picks', () => {
    const g = kbfl(price)
    expect(g.graded).toBe(true)
    if (g.graded) expect(['A', 'B', 'C', 'D', 'F']).toContain(g.letter)
  })

  /*
   * THE POSITIVE CONTROL, and it is the same trade. Take the pricer away and the letter goes
   * away with it — so the test above is reporting the pricing and not merely the fact that
   * `gradeTrade` returns something.
   */
  it('withholds the same trade when the book prices no picks', () => {
    expect(kbfl(undefined).graded).toBe(false)
    expect(kbfl(pickPricerFrom([])).graded).toBe(false)
  })

  /*
   * ⚠ AND A PICK THE BOOK DOES NOT COVER STILL WITHHOLDS. A partial fallback would be worse
   * than no grade: it would price the covered picks and treat the uncovered one as worthless.
   */
  it('withholds when only some of the picks are covered', () => {
    const g = gradeTrade(
      { label: 'received', assets: gradeableSide([], priced, pickAssets([{ season: '2029', round: 1 }], price), price) },
      { label: 'gave', assets: gradeableSide(['brown'], priced, [], price) },
    )
    expect(g.graded).toBe(false)
  })

  it('puts a market value on the pick it prices, for the card to show', () => {
    const [first] = pickAssets([{ season: '2027', round: 1 }], price)
    expect(first.value).toBe(5800)
    expect(first.pickSeason).toBe('2027')
    expect(first.pickRound).toBe(1)
    /* Unpriced stays null — never 0, which would read as "worthless" on the card. */
    expect(pickAssets([{ season: '2027', round: 9 }], price)[0]!.value).toBeNull()
  })
})
