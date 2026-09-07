import React from 'react'
import { describe, expect, it } from 'vitest'
import { render } from '@testing-library/react'

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'

/*
 * "Propose Trade" — the card's one outbound action, and where it goes.
 *
 * The flow it belongs to has three steps and only the middle one existed:
 *
 *   1. the card sends you to AF's per-league trade builder      <- added
 *   2. you build and price the deal there                        <- already existed
 *   3. the builder hands off to Sleeper/ESPN/Yahoo to SEND it    <- added
 *
 * ⚠ STEP 3 IS NOT OPTIONAL POLISH. AllFantasy is read-only on every connected
 * platform — Sleeper's API has no write endpoint at all — so a trade built here
 * does not exist until it is re-entered on the source platform. Without the
 * hand-off the builder dead-ends on a verdict, which reads like the trade was
 * sent. My Team and Matchup have carried a `sourceLink` since they shipped; the
 * trade screen, the one whose entire output is an action taken elsewhere, did not.
 *
 * The resolver itself is pinned by `__tests__/league-links/source-deep-links.test.ts`
 * (Sleeper's `/trades` URL, unverified providers, the ESPN partnerTeamId case).
 * These assert the WIRING that reaches it.
 */

const SECTION_NO = (reason: string) => ({ available: false as const, reason })

function card(over: Partial<PlayerCardData> = {}): PlayerCardData {
  return {
    context: 'league',
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
    insight: null,
    league: {
      leagueId: 'lg-42',
      leagueName: 'Ice Kings',
      platform: 'sleeper',
      slot: 'STARTER',
      isYours: false,
      owner: { teamName: 'Gridiron Vultures', ownerName: 'Jordan' },
      price: SECTION_NO('not priced'),
      yourRoster: [],
      trades: [],
      /* Required on the type since the playoff window shipped; unavailable here
         because this suite is about the button, not the schedule. */
      playoffSchedule: SECTION_NO('no playoff start week on file'),
      /* Required since the ☆ shipped; this suite is about the button, not the star. */
      watched: false,
    },
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

const cta = (c: HTMLElement) => c.querySelector('a.af-pc-cta') as HTMLAnchorElement | null

describe('player card — Propose Trade', () => {
  it('offers it for a player another manager holds, pointing at THIS league’s builder', () => {
    const { container } = mount(card())
    const a = cta(container)
    expect(a?.textContent?.trim()).toBe('Propose Trade')
    // The league must be in the href — a builder opened league-less prices nothing.
    expect(a?.getAttribute('href')).toBe('/core/trades?league=lg-42')
  })

  /* You cannot trade for a man you already have. */
  it('does NOT offer it for a player on your own roster', () => {
    const { container } = mount(
      card({ league: { ...card().league!, isYours: true, owner: null } })
    )
    expect(cta(container)).toBeNull()
  })

  /* Nor for a free agent — that is a waiver claim, a different action entirely. */
  it('does NOT offer it for a player nobody rosters', () => {
    const { container } = mount(
      card({ league: { ...card().league!, slot: 'NOT ROSTERED', owner: null } })
    )
    expect(cta(container)).toBeNull()
  })

  /*
   * ⚠ AND NOT ON THE UNIVERSAL FLAVOUR. With no league there is no builder to
   * open and no scoring to price the deal under, so the button would lead
   * somewhere that cannot answer the question it implies.
   */
  it('does NOT offer it when there is no league in context', () => {
    const { container } = mount(card({ context: 'universal', league: null }))
    expect(cta(container)).toBeNull()
  })

  it('escapes the league id rather than interpolating it raw', () => {
    const { container } = mount(
      card({ league: { ...card().league!, leagueId: 'a b&c' } })
    )
    expect(cta(container)?.getAttribute('href')).toBe('/core/trades?league=a%20b%26c')
  })
})
