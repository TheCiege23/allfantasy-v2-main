import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'

/*
 * The ☆ as a cross-league FOLLOW (user decisions, 2026-09-14). When the payload carries
 * `follow`, the star follows him in every league and renders on every card; when it does
 * not (signed out, or follows unavailable before the migration), the star is the league
 * watchlist exactly as before — pinned in player-card-watchlist.test.tsx.
 */

const SECTION_NO = (reason: string) => ({ available: false as const, reason })

const LEAGUE: NonNullable<PlayerCardData['league']> = {
  leagueId: 'lg-42',
  leagueName: 'Ice Kings',
  platform: 'sleeper',
  slot: 'STARTER',
  isYours: false,
  owner: null,
  price: SECTION_NO('not priced'),
  yourRoster: [],
  trades: [],
  playoffSchedule: SECTION_NO('no playoff start week on file'),
  watched: false,
}

function card(over: Partial<PlayerCardData> = {}): PlayerCardData {
  return {
    context: 'universal',
    player: {
      externalId: 'ri:771',
      sleeperId: '9221',
      sport: 'NFL',
      name: 'Jahmyr Gibbs',
      position: 'RB',
      team: 'DET',
      number: 26,
      imageUrl: null,
    },
    bio: { age: 24, height: null, weight: null, yearsExp: 2, college: null },
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
  } as PlayerCardData
}

const mount = (data: PlayerCardData) =>
  render(
    <PlayerCardSheet
      subject={{ sport: 'NFL', sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB' }}
      data={data}
      status="ready"
      onClose={() => {}}
      onOpen={() => {}}
    />,
  )

const star = (c: HTMLElement) => c.querySelector('button.af-pc-star') as HTMLButtonElement | null

let fetchMock: ReturnType<typeof vi.fn>
beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('player card — ☆ as a cross-league follow', () => {
  it('🛑 renders on the UNIVERSAL card when follows are available', () => {
    const { container } = mount(card({ follow: { following: false } }))
    const s = star(container)
    expect(s).not.toBeNull()
    expect(s?.getAttribute('aria-label')).toBe('Follow Jahmyr Gibbs')
    expect(s?.getAttribute('aria-pressed')).toBe('false')
  })

  it('🛑 POSTs ids only — no leagueId, even on a league card', async () => {
    const { container } = mount(card({ context: 'league', league: LEAGUE, follow: { following: false } }))
    fireEvent.click(star(container)!)
    expect(star(container)?.getAttribute('aria-pressed')).toBe('true')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/core/player-card/watch')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ sport: 'NFL', sleeperId: '9221', externalId: 'ri:771' })
  })

  it('pressed when already following, and DELETEs on the way off', async () => {
    const { container } = mount(card({ follow: { following: true } }))
    const s = star(container)!
    expect(s.getAttribute('aria-label')).toBe('Unfollow Jahmyr Gibbs')
    fireEvent.click(s)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
  })

  it('🛑 a refused follow (503 before the migration) reverts the star', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) })
    const { container } = mount(card({ follow: { following: false } }))
    const s = star(container)!
    fireEvent.click(s)
    await waitFor(() => expect(s.getAttribute('aria-pressed')).toBe('false'))
  })

  it('🛑 without `follow`, the universal card still has NO star', () => {
    const { container } = mount(card())
    expect(star(container)).toBeNull()
  })

  it('without `follow`, a league card falls back to the league watchlist body', async () => {
    const { container } = mount(card({ context: 'league', league: LEAGUE }))
    expect(star(container)?.getAttribute('aria-label')).toBe('Watch Jahmyr Gibbs')
    fireEvent.click(star(container)!)
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ leagueId: 'lg-42', sleeperId: '9221' })
  })
})
