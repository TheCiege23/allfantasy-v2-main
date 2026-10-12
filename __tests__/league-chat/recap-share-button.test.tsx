import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RecapShareButton } from '@/components/core-app/comms/RecapShareButton'

const RECAP = '📺 Week 5 recap — Death Squad (2026)\n\nEvery number here comes from your real matchups. The full records book is in the Legacy tab.'
const LINK = 'https://allfantasy.ai/join?code=ABC123'

function stubFetch(ok = true) {
  const fn = vi.fn(async () =>
    ok ? new Response(JSON.stringify({ inviteLink: LINK }), { status: 200 }) : new Response('{}', { status: 500 }),
  )
  globalThis.fetch = fn as never
  return fn
}

function setNavigator(nav: Partial<Navigator>) {
  for (const [k, v] of Object.entries(nav)) {
    Object.defineProperty(navigator, k, { value: v, configurable: true, writable: true })
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  setNavigator({ share: undefined, clipboard: undefined } as never)
})

describe('RecapShareButton', () => {
  it('opens the share sheet with the recap and the league invite link', async () => {
    const fetchFn = stubFetch()
    const share = vi.fn(async () => {})
    setNavigator({ share } as never)
    render(<RecapShareButton leagueId="L1" leagueName="Death Squad" recap={RECAP} />)
    fireEvent.click(screen.getByRole('button', { name: /share with your league/i }))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    expect(fetchFn).toHaveBeenCalledWith('/api/leagues/join?leagueId=L1', expect.anything())
    const arg = (share.mock.calls[0] as unknown as [ShareData])[0]
    expect(arg.title).toBe('Death Squad recap')
    expect(arg.text).toContain('📺 Week 5 recap — Death Squad (2026)')
    expect(arg.text).toContain(LINK)
    expect(arg.text).not.toContain('Legacy tab')
    await screen.findByText('Shared')
  })

  it('closing the share sheet is not an error', async () => {
    stubFetch()
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' })
    setNavigator({ share: vi.fn(async () => Promise.reject(abort)) } as never)
    render(<RecapShareButton leagueId="L1" recap={RECAP} />)
    fireEvent.click(screen.getByRole('button'))
    await screen.findByText('Share with your league')
    expect(screen.queryByText(/could not share/i)).toBeNull()
  })

  it('copies the text where there is no share sheet, and says where to paste it', async () => {
    stubFetch()
    const writeText = vi.fn(async () => {})
    setNavigator({ share: undefined, clipboard: { writeText } } as never)
    render(<RecapShareButton leagueId="L1" recap={RECAP} />)
    fireEvent.click(screen.getByRole('button'))
    await screen.findByText('Copied — paste it in your league’s group chat')
    expect((writeText.mock.calls[0] as unknown as [string])[0]).toContain(LINK)
  })

  it('still shares the recap when the invite link cannot be had', async () => {
    stubFetch(false)
    const share = vi.fn(async () => {})
    setNavigator({ share } as never)
    render(<RecapShareButton leagueId="L1" recap={RECAP} />)
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1))
    const arg = (share.mock.calls[0] as unknown as [ShareData])[0]
    expect(arg.text).not.toMatch(/Join our league chat/)
  })

  it('fetches the invite link once, however many times it is shared', async () => {
    const fetchFn = stubFetch()
    setNavigator({ share: vi.fn(async () => {}) } as never)
    render(<RecapShareButton leagueId="L1" recap={RECAP} />)
    fireEvent.click(screen.getByRole('button'))
    await screen.findByText('Shared')
    fireEvent.click(screen.getByRole('button'))
    await waitFor(() => expect((navigator.share as unknown as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2))
    expect(fetchFn).toHaveBeenCalledTimes(1)
  })
})
