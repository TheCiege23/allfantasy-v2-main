import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, waitFor } from '@testing-library/react'

import PlayerCardSheet from '@/components/core-app/player-card/PlayerCardSheet'
import type { PlayerCardData } from '@/lib/core-app/playerCard'

/*
 * The player card's trade-block control (2026-09-17).
 *
 * Sleeper does not share its own trade block, so a manager marks their OWN players here and Chimmy
 * reads those listings. The card offers the toggle only on your own rostered player in a league
 * AllFantasy can hold listings for; someone else's listed player shows a tag instead. The server
 * proves ownership — pinned in `__tests__/trade-block/imported-trade-block.test.ts` — so this file
 * only pins what the card offers and what it sends.
 */

const SECTION_NO = (reason: string) => ({ available: false as const, reason })

const SLEEPER_NOTE =
  "Sleeper doesn't share its trade block with outside apps, so this only includes players managers put on the block in AllFantasy."

type League = NonNullable<PlayerCardData['league']>
type Block = League['tradeBlock']

const BLOCK: Block = { supported: true, note: SLEEPER_NOTE, listed: false, byYou: false, teamName: null, since: null }

function league(over: Partial<League> = {}): League {
  return {
    leagueId: 'lg-42',
    leagueName: 'Ice Kings',
    platform: 'sleeper',
    slot: 'BENCH',
    isYours: true,
    owner: { teamName: 'Ice Kings', ownerName: 'TheCiege26' },
    price: SECTION_NO('not priced'),
    yourRoster: [],
    trades: [],
    playoffSchedule: SECTION_NO('no playoff start week on file'),
    watched: false,
    tradeBlock: BLOCK,
    ...over,
  }
}

function card(l: League | null): PlayerCardData {
  return {
    context: l ? 'league' : 'universal',
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
    league: l,
  } as PlayerCardData
}

function mount(data: PlayerCardData) {
  return render(
    <PlayerCardSheet
      subject={{ sport: 'NFL', sleeperId: '9221', name: 'Jahmyr Gibbs', position: 'RB' }}
      data={data}
      status="ready"
      onClose={() => {}}
      onOpen={() => {}}
    />,
  )
}

const button = (c: HTMLElement) => c.querySelector('button.af-pc-block-btn') as HTMLButtonElement | null
const tag = (c: HTMLElement) => c.querySelector('.af-pc-block-tag')
const section = (c: HTMLElement) => c.querySelector('.af-pc-block')

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('player card — trade block', () => {
  it('offers "Put on trade block" on your own player, with the Sleeper caveat', () => {
    const { container } = mount(card(league()))
    const b = button(container)
    expect(b?.textContent).toBe('Put on trade block')
    expect(b?.getAttribute('aria-pressed')).toBe('false')
    expect(section(container)?.textContent).toContain(SLEEPER_NOTE)
  })

  it('POSTs this league, the Sleeper id and list=trade-block, and flips at once', async () => {
    const { container } = mount(card(league()))
    const b = button(container)!
    fireEvent.click(b)
    expect(b.getAttribute('aria-pressed')).toBe('true')
    expect(b.textContent).toBe('On your trade block ✓ · Take off')

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('/api/core/player-card/watch')
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body)).toEqual({ leagueId: 'lg-42', sleeperId: '9221', sport: 'NFL', list: 'trade-block' })
  })

  it('shows your own listing pressed, and DELETEs to take him off', async () => {
    const listed = league({ tradeBlock: { ...BLOCK, listed: true, byYou: true, teamName: 'Ice Kings', since: new Date().toISOString() } })
    const { container } = mount(card(listed))
    const b = button(container)!
    expect(b.getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(b)
    expect(b.getAttribute('aria-pressed')).toBe('false')
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).list).toBe('trade-block')
  })

  /* A refused write must not leave the card claiming he is listed, and must say why. */
  it('reverts and shows the server’s reason when the write is refused', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: 'Only players on your own roster can go on your trade block.', code: 'not_your_player' }),
    })
    const { container } = mount(card(league()))
    const b = button(container)!
    fireEvent.click(b)
    await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('false'))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Only players on your own roster can go on your trade block.',
    )
  })

  it('reverts with a generic message when the request throws', async () => {
    fetchMock.mockRejectedValue(new Error('offline'))
    const { container } = mount(card(league()))
    const b = button(container)!
    fireEvent.click(b)
    await waitFor(() => expect(b.getAttribute('aria-pressed')).toBe('false'))
    expect(container.querySelector('[role="alert"]')?.textContent).toBe('That did not save. Try again.')
  })

  it('someone else’s listed player shows a tag with the listing team, and no button', () => {
    const since = new Date(Date.now() - 3 * 3_600_000).toISOString()
    const theirs = league({
      isYours: false,
      owner: { teamName: 'Gridiron Vultures', ownerName: 'Jordan' },
      tradeBlock: { ...BLOCK, listed: true, teamName: 'Gridiron Vultures', since },
    })
    const { container } = mount(card(theirs))
    expect(button(container)).toBeNull()
    expect(tag(container)?.textContent).toBe('ON THE TRADE BLOCK · Gridiron Vultures · listed 3h ago')
    expect(section(container)?.textContent).toContain(SLEEPER_NOTE)
  })

  it('someone else’s unlisted player shows nothing — "not listed" is not a claim worth a row', () => {
    const { container } = mount(card(league({ isYours: false })))
    expect(section(container)).toBeNull()
  })

  it('offers nothing on a platform AllFantasy cannot hold listings for', () => {
    const espn = league({
      platform: 'espn',
      tradeBlock: { ...BLOCK, supported: false, note: "ESPN doesn't share its trade block with AllFantasy." },
    })
    const { container } = mount(card(espn))
    expect(section(container)).toBeNull()
  })

  it('offers nothing for a free agent, or with no league in context', () => {
    expect(section(mount(card(league({ slot: 'NOT ROSTERED', isYours: false }))).container)).toBeNull()
    expect(section(mount(card(null)).container)).toBeNull()
  })

  /* A payload cached before this field existed must still render. */
  it('a payload without tradeBlock renders without the control', () => {
    const old = league()
    delete (old as Partial<League>).tradeBlock
    const { container } = mount(card(old))
    expect(section(container)).toBeNull()
    expect(container.querySelector('button.af-pc-star')).not.toBeNull()
  })
})
