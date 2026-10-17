import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * The share sheet tells us nothing, so the first recap Tuesday read "43 pushes, 0 joins" with no way
 * to tell "nobody shared" from "shared and nobody tapped". The button now says what happened to each
 * tap, and the link it shares is marked src=recap so its opens and joins count apart.
 */

const beacon = vi.hoisted(() => vi.fn())
vi.mock('@/lib/analytics/client', () => ({ sendProductAnalyticsBeacon: beacon }))

import { RecapShareButton } from '@/components/core-app/comms/RecapShareButton'
import { tagRecapInviteLink } from '@/lib/league-chat/recapShare'
import { RECAP_SHARE } from '@/lib/analytics/eventNames'

const RECAP = '📺 Week 5 recap — Death Squad (2026)'

function setNavigator(nav: Partial<Navigator>) {
  for (const [k, v] of Object.entries(nav)) {
    Object.defineProperty(navigator, k, { value: v, configurable: true, writable: true })
  }
}

beforeEach(() => {
  beacon.mockClear()
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ inviteLink: 'https://allfantasy.ai/join?code=ABC123' }))) as never
})
afterEach(() => setNavigator({ share: undefined, clipboard: undefined } as never))

const events = () => beacon.mock.calls.map((c) => [c[0], c[1]])

describe('share tap counts', () => {
  it('a share counts the tap and that it was shared, and the link carries src=recap', async () => {
    const share = vi.fn(async () => {})
    setNavigator({ share } as never)
    render(<RecapShareButton leagueId="L1" recap={RECAP} />)
    fireEvent.click(screen.getByRole('button'))
    await screen.findByText('Shared')
    expect(events()).toEqual([
      [RECAP_SHARE.TAP, { leagueId: 'L1' }],
      [RECAP_SHARE.DONE, { leagueId: 'L1', outcome: 'shared', hasLink: true }],
    ])
    expect((share.mock.calls[0] as unknown as [ShareData])[0].text).toContain('https://allfantasy.ai/join?code=ABC123&src=recap')
  })

  it('closing the sheet counts as cancelled', async () => {
    setNavigator({ share: vi.fn(async () => Promise.reject(Object.assign(new Error('x'), { name: 'AbortError' }))) } as never)
    render(<RecapShareButton leagueId="L1" recap={RECAP} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(beacon).toHaveBeenCalledTimes(2))
    expect(beacon.mock.calls[1][1]).toMatchObject({ outcome: 'cancelled' })
  })

  it('a copy counts as copied; no link says so', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 500 })) as never
    setNavigator({ share: undefined, clipboard: { writeText: vi.fn(async () => {}) } } as never)
    render(<RecapShareButton leagueId="L1" recap={RECAP} />)
    fireEvent.click(screen.getByRole('button'))
    await screen.findByText(/Copied/)
    expect(beacon.mock.calls[1][1]).toEqual({ leagueId: 'L1', outcome: 'copied', hasLink: false })
  })

  it('nowhere to share counts as failed', async () => {
    setNavigator({ share: undefined, clipboard: undefined } as never)
    render(<RecapShareButton leagueId="L1" recap={RECAP} />)
    fireEvent.click(screen.getByRole('button'))
    await screen.findByText(/Could not share/)
    expect(beacon.mock.calls[1][1]).toMatchObject({ outcome: 'failed' })
  })
})

describe('tagRecapInviteLink', () => {
  it('adds src=recap, replacing any src already there', () => {
    expect(tagRecapInviteLink('https://allfantasy.ai/join?code=ABC123')).toBe('https://allfantasy.ai/join?code=ABC123&src=recap')
    expect(tagRecapInviteLink('https://allfantasy.ai/join?code=A&src=x')).toBe('https://allfantasy.ai/join?code=A&src=recap')
  })
  it('leaves anything that is not a web link alone', () => {
    expect(tagRecapInviteLink(null)).toBeNull()
    expect(tagRecapInviteLink('ABC123')).toBe('ABC123')
  })
})
