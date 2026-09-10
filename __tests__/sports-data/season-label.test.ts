/** @vitest-environment node */
/**
 * `lib/sports-data/seasonLabel.ts` — one rule for what a stored season means.
 *
 * Providers disagree about a season spanning two calendar years, and production stored both
 * spellings in the same column. Measured 2026-09-08 in `player_season_stats`: NBA under
 * "2024-2025" / "2022-2023" / "2019-2020", NHL under "2020-2021" / "1993-1994", every Rolling
 * Insights NFL row under a plain "2025".
 *
 * 🛑 THE COLUMN TYPE DECIDED IT, NOT A DECISION. `SportsGame.season` is an `Int`, so the games
 * path in `theSportsDbIngest` was forced to reduce the label. `player_season_stats.season` is a
 * `String`, so the raw span passed through untouched — same file, same feed, two answers.
 *
 * ⚠ AND THE MISMATCH CANNOT THROW: an integer year compared against "2024-2025" matches nothing
 * and returns zero rows silently. That is why this rule is named and pinned rather than inlined.
 *
 * The authority is the vendor contract, not taste — `contracts/rolling-insights/ENDPOINTS.yaml`:
 *   season: { format: "YYYY", note: "Year season started." }
 */
import { describe, expect, it } from 'vitest'

import { canonicalSeasonLabel, seasonStartYear } from '@/lib/sports-data/seasonLabel'

describe('seasonStartYear', () => {
  it('takes the START year of a span, never the end', () => {
    // Choosing the end year would silently disagree with every season id we send the provider.
    expect(seasonStartYear('2024-2025')).toBe(2024)
    expect(seasonStartYear('2020-2021')).toBe(2020)
    expect(seasonStartYear('1993-1994')).toBe(1993)
  })

  it('passes a single-year label through unchanged', () => {
    // MLB, NFL and every Rolling Insights row already use this form; it must not move.
    expect(seasonStartYear('2025')).toBe(2025)
    expect(seasonStartYear(2025)).toBe(2025)
  })

  it('reads the span spellings a provider might send', () => {
    expect(seasonStartYear('2024-25')).toBe(2024)
    expect(seasonStartYear('2024/2025')).toBe(2024)
    expect(seasonStartYear('  2024 - 2025  ')).toBe(2024)
  })

  it('declines rather than guessing, so an unreadable label cannot become a row', () => {
    // A guessed year writes something that joins to nothing while looking correct — strictly
    // worse than declining and being counted.
    const offenders: string[] = []
    const cases: Array<[string, unknown]> = [
      ['null', null],
      ['undefined', undefined],
      ['empty', ''],
      ['whitespace', '   '],
      ['prose', 'not a season'],
      ['too short', '20'],
      ['out of range low', '0999'],
      ['out of range high', '9999'],
      ['not leading', 'Week 2024'],
      ['object', {}],
    ]
    for (const [label, input] of cases) {
      let got: number | null
      try {
        got = seasonStartYear(input)
      } catch (e) {
        offenders.push(`${label}: THREW ${(e as Error).message}`)
        continue
      }
      if (got !== null) offenders.push(`${label}: expected null, got ${got}`)
    }
    expect(offenders).toEqual([])
    expect(cases.length).toBeGreaterThan(0) // floor: an empty case list must not read as a pass
  })
})

describe('canonicalSeasonLabel', () => {
  it('renders the same rule as a string for the text column', () => {
    // Not a second decision — `player_season_stats.season` is a String and needs the same
    // answer the Int columns get, or the two halves of one file disagree again.
    expect(canonicalSeasonLabel('2024-2025')).toBe('2024')
    expect(canonicalSeasonLabel('2025')).toBe('2025')
    expect(canonicalSeasonLabel(2025)).toBe('2025')
  })

  it('agrees with seasonStartYear on every input, including the refusals', () => {
    // The two must never diverge; that divergence is the bug being fixed.
    for (const input of ['2024-2025', '2025', '2024/2025', '', 'nope', null, undefined, 2019]) {
      const n = seasonStartYear(input)
      expect(canonicalSeasonLabel(input)).toBe(n == null ? null : String(n))
    }
  })
})
