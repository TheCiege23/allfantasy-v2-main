import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'

/*
 * The availability designation — the most consequential line on the card.
 *
 * ── Why this section exists, and why it is NOT sourced from `SportsNews` ─────
 *
 * Measured against production 2026-09-07, per rostered player:
 *
 *              coverage   names that are real players
 *   SportsNews    26.0%                        31.4%
 *   SportsInjury  49.2%                        97.8%
 *
 * `SportsNews.playerName` is n-grams lifted out of headlines ("What Eli",
 * "Which Panthers", "Highmark Stadium"). `SportsInjury.playerName` is a real
 * player 97.8% of the time, which is what makes matching on it defensible here
 * and indefensible there.
 *
 * 🛑 THE RECENCY GATE IS THE CORRECTNESS OF THIS SECTION, NOT A REFINEMENT.
 * The table is mostly OLD — 2.2% of rows for rostered players are within 2 days,
 * 15.0% within 7, 31.6% within 14. One source is frozen outright: `api_sports`
 * contributes 1,444 rows for rostered players and ZERO fresher than 7 days,
 * still reading "Questionable for Week 1 vs. Denver" with a 2026-06-03 stamp.
 * Rendering one of those as current would be a confident lie about whether a
 * man can play.
 *
 * ⚠ THE GATE ITSELF IS PINNED NEXT DOOR, IN `player-card-injury-window.test.ts`,
 * NOT HERE. This header first claimed these tests pinned it; they do not — they
 * mount a component against a fixture and never reach the loader, so widening
 * the window to a year leaves every one of them green. That is the shape this
 * repo keeps paying for: a file asserting coverage it does not have. What THESE
 * tests pin is the rendering — that the status, the note, the source and above
 * all the AGE reach the screen.
 */

const SECTION_NO = (reason: string) => ({ available: false as const, reason })
const OK = <T,>(data: T) => ({ available: true as const, data })

function card(over: Partial<PlayerCardData> = {}): PlayerCardData {
  return {
    context: 'universal',
    player: {
      externalId: 'sleeper:9221',
      sleeperId: '9221',
      sport: 'NFL',
      name: 'Jahmyr Gibbs',
      position: 'RB',
      team: 'DET',
      number: 26,
      imageUrl: null,
    },
    bio: { age: 24, height: "5'9\"", weight: '200 lb', yearsExp: 2, college: 'Alabama' },
    market: SECTION_NO('not priced'),
    ownership: SECTION_NO('too few leagues'),
    schedule: SECTION_NO('no fixtures'),
    byeWeek: null,
    trades: SECTION_NO('no trades'),
    comps: SECTION_NO('no comps'),
    news: SECTION_NO('no news'),
    injury: SECTION_NO('No injury designation reported in the last 14 days.'),
    insight: null,
    league: null,
    ...over,
  }
}

function mount(data: PlayerCardData) {
  return render(
    <PlayerCardSheet
      subject={{ sport: 'NFL', sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB' }}
      data={data}
      status="ready"
      onClose={() => {}}
      onOpen={() => {}}
    />
  )
}

const block = (c: HTMLElement) => c.querySelector('.af-pc-injury')

describe('player card — injury designation', () => {
  it('renders the status, the note and the body part', () => {
    const { container } = mount(
      card({
        injury: OK({
          status: 'QUESTIONABLE',
          note: 'Hamstring - Questionable for Week 1 vs. Denver',
          bodyPart: 'Hamstring',
          reportedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(),
          source: 'espn',
        }),
      })
    )
    const el = block(container)
    expect(el).not.toBeNull()
    expect(el?.textContent).toContain('QUESTIONABLE')
    expect(el?.textContent).toContain('Hamstring - Questionable for Week 1 vs. Denver')
  })

  /*
   * 🛑 THE AGE IS PART OF THE FACT. A designation is a point-in-time claim, and
   * this table holds months-old rows. The card must show WHEN it was reported so
   * the reader judges currency rather than the card asserting it.
   */
  it('shows how old the report is, so currency is the reader’s judgement', () => {
    const { container } = mount(
      card({
        injury: OK({
          status: 'OUT',
          note: 'Knee',
          bodyPart: 'Knee',
          reportedAt: new Date(Date.now() - 5 * 86_400_000).toISOString(),
          source: 'espn',
        }),
      })
    )
    expect(block(container)?.textContent).toMatch(/5d/)
  })

  it('names the SOURCE, because the feeds differ in how much they can be trusted', () => {
    const { container } = mount(
      card({
        injury: OK({
          status: 'IR',
          note: 'IR. Injured Reserve',
          bodyPart: null,
          reportedAt: new Date(Date.now() - 86_400_000).toISOString(),
          source: 'rolling_insights',
        }),
      })
    )
    expect(block(container)?.textContent?.toLowerCase()).toContain('rolling_insights')
  })

  /*
   * ⚠ AN UNAVAILABLE SECTION PRINTS ITS REASON, NEVER A DASH — and here the
   * reason matters more than usual: "no designation in 14 days" and "he is
   * healthy" are different claims, and only the first is one we can support.
   */
  it('prints the reason rather than a dash when nothing was reported', () => {
    const { container } = mount(card())
    const el = block(container)
    expect(el?.textContent).toContain('No injury designation reported in the last 14 days.')
    expect(el?.textContent).not.toMatch(/^—$/)
  })

  it('renders on the league flavour too — availability is not a league-specific fact', () => {
    const { container } = mount(
      card({
        context: 'league',
        injury: OK({
          status: 'DOUBTFUL',
          note: 'Ankle',
          bodyPart: 'Ankle',
          reportedAt: new Date().toISOString(),
          source: 'espn',
        }),
        league: {
          leagueId: 'lg-1',
          leagueName: 'Ice Kings',
          platform: 'sleeper',
          slot: 'STARTER',
          isYours: true,
          owner: null,
          price: SECTION_NO('not priced'),
          yourRoster: [],
          trades: [],
          playoffSchedule: SECTION_NO('no playoff start week on file'),
          watched: false,
        },
      })
    )
    expect(block(container)?.textContent).toContain('DOUBTFUL')
  })
})
