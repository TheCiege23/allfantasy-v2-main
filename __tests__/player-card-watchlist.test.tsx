import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'

/*
 * The ☆ — the card's one WRITE, and the only control on it that changes state.
 *
 * ⚠ IT IS LEAGUE-SCOPED, AND THAT IS A SCHEMA FACT, NOT A DESIGN CHOICE.
 * `WaiverWatchlist` keys on [leagueId, userId, playerId] with a NOT NULL
 * leagueId, so there is nowhere to put a star that belongs to no league. The
 * universal flavour therefore does not render one — the same gating Propose
 * Trade already has, for the same reason: a control that cannot answer the
 * question it implies is worse than no control.
 *
 * ⚠ AND THE ID WRITTEN IS THE SLEEPER ID. Measured 2026-09-07 against
 * production: `SportsPlayer.sleeperId` ("5129"), `SportsPlayer.id` (a uuid) and
 * `SportsPlayerRecord.id` ("NFL:1000" — what the waiver pool joins on) are
 * three disjoint spaces, 0/200 overlap in both directions. The waiver page
 * matches its stars on the third; the card knows the first. Resolving between
 * them needs a name join across the 178 NFL duplicate groups the repo forbids
 * merging, so the card writes its OWN vocabulary and the two surfaces do not
 * yet reflect each other. `waiver_watchlists` is empty in production (0 rows),
 * so nothing regresses — but do not read a green test here as cross-surface
 * agreement, because it is not.
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
      playoffSchedule: SECTION_NO('no playoff start week on file'),
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

const star = (c: HTMLElement) => c.querySelector('button.af-pc-star') as HTMLButtonElement | null

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('player card — the ☆ watchlist toggle', () => {
  it('renders on the league flavour, unpressed when he is not watched', () => {
    const { container } = mount(card())
    const s = star(container)
    expect(s).not.toBeNull()
    expect(s?.getAttribute('aria-pressed')).toBe('false')
  })

  it('renders PRESSED when the payload says he is already watched', () => {
    const { container } = mount(card({ league: { ...card().league!, watched: true } }))
    expect(star(container)?.getAttribute('aria-pressed')).toBe('true')
  })

  /*
   * ⚠ NOT ON THE UNIVERSAL FLAVOUR. There is no league to scope the row to, so
   * a star here would have nowhere to write. See the header.
   */
  it('does NOT render when there is no league in context', () => {
    const { container } = mount(card({ context: 'universal', league: null }))
    expect(star(container)).toBeNull()
  })

  it('POSTs the SLEEPER id and this league on the way on, and flips optimistically', async () => {
    const { container } = mount(card())
    const s = star(container)!
    fireEvent.click(s)

    // The pressed state must not wait for the network — the card is a pop-up and
    // a star that lags a round-trip reads as a dropped click.
    expect(s.getAttribute('aria-pressed')).toBe('true')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/core/player-card/watch')
    expect(init.method).toBe('POST')
    const body = JSON.parse(init.body)
    expect(body).toMatchObject({ leagueId: 'lg-42', sleeperId: '9221', sport: 'NFL' })
  })

  it('DELETEs on the way back off', async () => {
    const { container } = mount(card({ league: { ...card().league!, watched: true } }))
    const s = star(container)!
    fireEvent.click(s)
    expect(s.getAttribute('aria-pressed')).toBe('false')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  /*
   * A write that failed must not leave the card claiming he is watched — that is
   * the one outcome worse than the click not registering, because the reader
   * walks away believing something was saved.
   */
  it('reverts the star when the write fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'nope' }) })
    const { container } = mount(card())
    const s = star(container)!
    fireEvent.click(s)
    expect(s.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(s.getAttribute('aria-pressed')).toBe('false'))
  })

  it('reverts when the request throws outright', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const { container } = mount(card())
    const s = star(container)!
    fireEvent.click(s)
    await waitFor(() => expect(s.getAttribute('aria-pressed')).toBe('false'))
  })
})
