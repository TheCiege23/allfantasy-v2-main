import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'

/*
 * Every number on the card must stay attached to the thing it describes.
 *
 * ⚠ WHY THIS SUITE EXISTS, AND IT IS BORROWED. The core-boards session ran a
 * side-flattening mutation against its own TradesBoard suite and got 45 passed /
 * 45 passed — completely blind — because every name and every value still
 * *appeared*. Its extension of that finding is the one that applies here: a
 * value rendered against the WRONG name is the same class of error, and a
 * whole-card text scan cannot see it either. "1,809" and "25" both still appear
 * on the card however they are shuffled.
 *
 * `PlayerCardSheet` had no test at all, and it pairs a number with a label in
 * three places: YOUR ROSTER (name → price), SIMILAR PRICE (name → price) and the
 * schedule (week → projection). So these assert the TRIPLE, never the presence.
 *
 * ⚠ THE ROWS ARE READ AS PAIRS RATHER THAN SCOPED BY SECTION, deliberately.
 * Schedule rows and roster rows share `.af-pc-row`, and pairing them
 * ({key, value}) makes section scoping unnecessary — a week and a player name
 * cannot collide, and a shuffled value breaks its pair wherever it lives.
 */

const SECTION_OK = <T,>(data: T) => ({ available: true as const, data })
const SECTION_NO = (reason: string) => ({ available: false as const, reason })

function card(over: Partial<PlayerCardData> = {}): PlayerCardData {
  return {
    context: 'league',
    player: {
      externalId: 'sleeper:11579',
      sleeperId: '11579',
      sport: 'NFL',
      name: 'Audric Estime',
      position: 'RB',
      team: 'NO',
      number: 30,
      imageUrl: null,
    },
    bio: { age: 23, height: "5'11\"", weight: '227 lb', yearsExp: 1, college: 'Notre Dame' },
    market: SECTION_OK({
      value: 126,
      overallRank: 357,
      positionRank: 97,
      delta: { change: 27, days: 7 },
      format: 'DYNASTY',
      qbFormat: 'SUPERFLEX',
      source: 'FANTASYCALC',
      capturedAt: '2026-09-06T04:00:00.000Z',
    }),
    ownership: SECTION_NO('too few leagues'),
    schedule: SECTION_OK({
      season: 2026,
      projectedWeek: 1,
      weeks: [
        { week: 1, opponent: 'DET', home: false, bye: false, projection: 1.5 },
        { week: 2, opponent: 'JAX', home: true, bye: false, projection: null },
        { week: 3, opponent: null, home: false, bye: true, projection: null },
      ],
    }),
    byeWeek: 3,
    trades: SECTION_NO('no trades'),
    comps: SECTION_OK([
      { sleeperId: '1', name: 'Comp Alpha', position: 'RB', value: 8888 },
      { sleeperId: '2', name: 'Comp Beta', position: 'RB', value: 4444 },
    ]),
    news: SECTION_NO('no news'),
    insight: null,
    league: {
      leagueId: 'l1',
      leagueName: 'BB Dynasty League 26!',
      platform: 'sleeper',
      slot: 'BENCH',
      isYours: true,
      owner: null,
      price: SECTION_OK({ value: 126, mode: 'dynasty', numQbs: 1, teams: 14 }),
      /* Required since the ☆ shipped; the star's own behaviour is pinned by
         `__tests__/player-card-watchlist.test.tsx`. */
      watched: false,
      playoffSchedule: SECTION_OK({
        startWeek: 15,
        weeks: [
          { week: 15, opponent: 'TEN', home: true, bye: false, projection: null },
          { week: 16, opponent: 'HOU', home: false, bye: false, projection: null },
          { week: 17, opponent: null, home: false, bye: true, projection: null },
        ],
      }),
      yourRoster: [
        { name: 'Zach Charbonnet', value: 1809 },
        { name: 'Aaron Jones', value: 1114 },
        { name: 'Jaydon Blue', value: 361 },
        { name: 'Joe Mixon', value: null },
      ],
      trades: [],
    },
    ...over,
  }
}

function mount(data: PlayerCardData) {
  return render(
    <PlayerCardSheet
      subject={{ sport: 'NFL', sleeperId: '11579', name: 'Audric Estime', position: 'RB' }}
      data={data}
      status="ready"
      onClose={() => {}}
      onOpen={() => {}}
    />
  )
}

/** Every hairline row as the pair it renders: {key, value}. */
function pairs(container: HTMLElement): Array<{ k: string; v: string }> {
  return [...container.querySelectorAll('.af-pc-row')].map((row) => ({
    k: row.querySelector('.af-pc-row-k')?.textContent?.trim() ?? '',
    v: row.querySelector('.af-pc-row-v')?.textContent?.trim() ?? '',
  }))
}

describe('player card — every number stays with the thing it describes', () => {
  it('keeps each roster price on its own player row', () => {
    const { container } = mount(card())
    const p = pairs(container)
    expect(p).toContainEqual({ k: 'Zach Charbonnet', v: '1,809' })
    expect(p).toContainEqual({ k: 'Aaron Jones', v: '1,114' })
    expect(p).toContainEqual({ k: 'Jaydon Blue', v: '361' })
  })

  /* An unpriced player is a dash, never a zero and never the next man's price. */
  it('renders an unpriced roster player as a dash on HIS row', () => {
    const { container } = mount(card())
    expect(pairs(container)).toContainEqual({ k: 'Joe Mixon', v: '—' })
  })

  it('keeps each projection on its own week', () => {
    const { container } = mount(card())
    const p = pairs(container)
    expect(p).toContainEqual({ k: 'WK1 · @ DET', v: '1.5' })
    // Only week 1 is published; later weeks are fixtures, never a borrowed number.
    expect(p).toContainEqual({ k: 'WK2 · vs JAX', v: '—' })
    expect(p).toContainEqual({ k: 'WK3 · BYE', v: '—' })
  })

  /*
   * ⚠ ON THE UNIVERSAL FLAVOUR, and the first draft of this test got it wrong.
   * SIMILAR PRICE is gated on `!league` — the league card swaps that column for
   * this league's own trade history — so asserting it on a league payload found
   * zero chips. Correct behaviour, wrong fixture; kept as a case so the gating
   * itself is now pinned.
   */
  it('keeps each comp price inside its own chip (universal flavour)', () => {
    const { container } = mount(card({ context: 'universal', league: null }))
    const chips = [...container.querySelectorAll('.af-pc-chip')].map((c) =>
      (c.textContent ?? '').replace(/\s+/g, ' ').trim()
    )
    expect(chips).toContain('Comp Alpha 8,888')
    expect(chips).toContain('Comp Beta 4,444')
  })

  it('does NOT show comps on the league flavour — that column is league trades', () => {
    const { container } = mount(card())
    expect(container.querySelectorAll('.af-pc-chip')).toHaveLength(0)
    expect(container.textContent).toContain('TRADES IN THIS LEAGUE')
  })

  /*
   * The league price carries its basis. A number whose format is dropped is a
   * claim nobody can support — 126 in one-QB is not 126 in superflex.
   */
  it('renders the league price with the basis it was derived under', () => {
    const { container } = mount(card())
    const tiles = [...container.querySelectorAll('.af-pc-tile')].map((t) => ({
      label: t.querySelector('.af-pc-label')?.textContent?.trim(),
      value: t.querySelector('.af-pc-tile-v')?.textContent?.trim(),
      sub: t.querySelector('.af-pc-tile-sub')?.textContent?.replace(/\s+/g, ' ').trim(),
    }))
    const price = tiles.find((t) => t.label === 'LEAGUE PRICE')
    expect(price?.value).toBe('126')
    expect(price?.sub).toContain('1QB')
    expect(price?.sub).toContain('14-team')
  })
})

describe('player card — the playoff window comes from the league, not a literal', () => {
  it('labels the window with the league’s OWN weeks', () => {
    const { container } = mount(card())
    const labels = [...container.querySelectorAll('.af-pc-label')].map((l) => l.textContent)
    expect(labels).toContain('PLAYOFF SCHEDULE · WK 15-17')
  })

  /*
   * ⚠ THE CASE THE DESIGN'S HARDCODED "15-17" GETS WRONG. Measured on
   * production: 197 of 257 claimed leagues start playoffs at 15, but 4 start at
   * 16, 3 at 14 and 1 at 11 — plus 33 carrying the `0` sentinel. A league that
   * starts at 14 must say 14-16.
   */
  it('follows a league that does NOT start at week 15', () => {
    const base = card()
    const { container } = mount(
      card({
        league: {
          ...base.league!,
          playoffSchedule: {
            available: true,
            data: {
              startWeek: 14,
              weeks: [
                { week: 14, opponent: 'KC', home: true, bye: false, projection: null },
                { week: 15, opponent: 'DEN', home: false, bye: false, projection: null },
                { week: 16, opponent: 'LV', home: true, bye: false, projection: null },
              ],
            },
          },
        },
      })
    )
    const labels = [...container.querySelectorAll('.af-pc-label')].map((l) => l.textContent)
    expect(labels).toContain('PLAYOFF SCHEDULE · WK 14-16')
    expect(labels).not.toContain('PLAYOFF SCHEDULE · WK 15-17')
  })

  /* Each playoff week keeps its own opponent — the pairing rule, again. */
  it('keeps each playoff opponent on its own week, and marks a bye', () => {
    const { container } = mount(card())
    const p = pairs(container)
    expect(p).toContainEqual({ k: 'WK15 · vs TEN', v: '—' })
    expect(p).toContainEqual({ k: 'WK16 · @ HOU', v: '—' })
    expect(p).toContainEqual({ k: 'WK17 · BYE', v: '—' })
  })

  it('states a reason when the league published no playoff start', () => {
    const base = card()
    const { container } = mount(
      card({
        league: {
          ...base.league!,
          playoffSchedule: { available: false, reason: 'no playoff start week on file' },
        },
      })
    )
    expect(container.textContent).toContain('no playoff start week on file')
  })
})
