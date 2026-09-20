import { describe, expect, it } from 'vitest'

import {
  LATEST_TRADE_ORDER,
  gradeableSide,
  pickAssets,
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

  it('names the picks when the picks are the whole gap', () => {
    expect(withheldTradeReason(grade('PARTIAL_COVERAGE', 2, 6), 4)).toMatch(
      /includes 4 draft picks, which we do not price yet/,
    )
    expect(withheldTradeReason(grade('NO_COVERAGE', 0, 1), 1)).toMatch(/includes a draft pick/)
  })

  /*
   * ⚠ A HALF-TRUTH IS STILL WRONG. One pick and one unpriced player is not "the picks";
   * blaming them would tell the reader a sync cannot help when it can.
   */
  it('falls back to the generic reason when a player is unpriced too', () => {
    expect(withheldTradeReason(grade('PARTIAL_COVERAGE', 2, 6), 3)).not.toMatch(/draft pick/)
  })

  it('leaves an empty side its own wording', () => {
    expect(withheldTradeReason(grade('NO_ASSETS', 0, 2), 2)).toMatch(/no assets on record/)
  })

  /*
   * ⚠ "ASSETS", NOT "PLAYERS". `grade.total` counts picks now, so a coverage sentence
   * calling them players is a wrong noun bolted to a right number. It is asserted here
   * because this function owns the wording — see its docblock for why the fix does not
   * live in `describeNoSignal`.
   */
  it('counts assets rather than players in a coverage reason', () => {
    expect(withheldTradeReason(grade('PARTIAL_COVERAGE', 2, 6), 0)).toBe(
      'Not graded — only 2 of 6 assets have values on file.',
    )
    expect(withheldTradeReason(grade('NO_COVERAGE', 0, 6), 0)).not.toMatch(/player/i)
  })

  /* Never a letter, and never the word "even" — the rule `describeNoSignal` carries. */
  it('never reads as a grade', () => {
    for (const r of ['NO_ASSETS', 'PARTIAL_COVERAGE', 'NO_COVERAGE'] as const) {
      const text = withheldTradeReason(grade(r, 1, 4), 2)
      expect(text).toMatch(/^Not graded/)
      expect(text).not.toMatch(/\beven\b/i)
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
