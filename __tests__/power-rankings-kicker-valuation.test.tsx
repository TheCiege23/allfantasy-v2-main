/**
 * The power-rankings surface must SAY that its kickers are not ranked.
 *
 * The engine prices every kicker in a league identically — measured on production 2026-08-29:
 * kicker rank does not persist year to year (Spearman -0.455, negative in all six season pairs)
 * or within a season, and the startable population spans 1.55x. `lib/kicker-values/
 * leagueKickerValue.ts` carries the numbers.
 *
 * ⚠ A FLAT NUMBER WITH NO EXPLANATION IS WORSE THAN THE LADDER IT REPLACED. A manager who sees
 * their K1 and their K30 valued the same, with nothing on screen saying why, reads it as a bug
 * or as a ranking that happened to tie. These tests are on the SENTENCE as much as the number.
 */
import React from 'react'
import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { LanguageProviderClient } from '@/components/i18n/LanguageProviderClient'
import { KickerValuationBand } from '@/app/power-rankings/KickerValuationBand'

/** The page's own formatter, so the test asserts what a reader actually sees. */
const formatCurrency = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v)))

/*
 * The REAL provider, not a mocked `t`. The whole point of these tests is the sentence a manager
 * reads, so they must resolve the actual `powerRankingsPage.position.*` copy from
 * `lib/i18n/translations.ts` — a stubbed translator would assert the key and prove nothing.
 */
function renderCard(kickerValuation: unknown, kTotal = 221) {
  return render(
    <LanguageProviderClient>
      <KickerValuationBand
        valuation={kickerValuation as never}
        teamTotal={kTotal}
        formatValue={formatCurrency}
      />
    </LanguageProviderClient>,
  )
}

const LEAGUE_221 = {
  value: 221,
  replacementRank: 13,
  rankPredictability: 'none' as const,
  basis: 'Every kicker prices the same here…',
}

describe('power rankings — the kicker band', () => {
  it('states the one value every kicker in the league is worth', () => {
    renderCard(LEAGUE_221)
    /*
     * 221 is the real production number for a 12-team, one-kicker-slot dynasty league — the
     * value measured against `IDP Glory! Plus alil Offense` on 2026-08-29.
     */
    expect(screen.getByText(/Every kicker in this league is worth 221\./)).toBeTruthy()
  })

  it('says plainly that no kicker ordering predicts anything', () => {
    renderCard(LEAGUE_221)
    const note = screen.getByText(/priced as a position, not ranked/i)
    expect(note).toBeTruthy()
    // The three claims that make the flat number legible rather than suspicious.
    expect(note.textContent).toMatch(/doesn't carry from one season to the next/i)
    expect(note.textContent).toMatch(/1\.5x/)
    expect(note.textContent).toMatch(/would predict anything/i)
  })

  it("reports this league's own replacement rank, not a constant", () => {
    renderCard(LEAGUE_221)
    expect(screen.getByText(/Replacement is about K13\./)).toBeTruthy()

    /*
     * Replacement is `slots * teams + 1`, so a two-kicker or larger league must move it. A
     * hardcoded K13 would pass the test above and be wrong everywhere else.
     */
    const second = render(
      <LanguageProviderClient>
        <KickerValuationBand
          valuation={{ ...LEAGUE_221, replacementRank: 25, value: 365 }}
          teamTotal={365}
          formatValue={formatCurrency}
        />
      </LanguageProviderClient>,
    )
    expect(second.getByText(/Replacement is about K25\./)).toBeTruthy()
    expect(second.getByText(/worth 365\./)).toBeTruthy()
  })

  it('shows the team total alongside the per-kicker value, so two kickers read as two', () => {
    renderCard(LEAGUE_221, 442)
    // The band's headline is this team's kicker total; the sentence carries the league's number.
    expect(screen.getByText(/Every kicker in this league is worth 221\./)).toBeTruthy()
    expect(screen.getByText('Kickers')).toBeTruthy()
    // 442 = two kickers at 221. The headline must move with the roster, the sentence must not.
    expect(screen.getByText('442')).toBeTruthy()
  })

  it('renders nothing when the league starts no kicker', () => {
    /*
     * `resolveLeagueKickerValue` returns `value: null` there, because a kicker is not an asset in
     * that league at all — quoting a price would invent a market for a player nobody can field.
     */
    renderCard({ ...LEAGUE_221, value: null }, 0)
    expect(screen.queryByText('Kickers')).toBeNull()
    expect(screen.queryByText(/priced as a position/i)).toBeNull()
  })

  it('renders nothing when the engine sent no kicker valuation at all', () => {
    renderCard(null, 0)
    expect(screen.queryByText('Kickers')).toBeNull()
  })
})
