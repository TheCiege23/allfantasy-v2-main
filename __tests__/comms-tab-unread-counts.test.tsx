import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'

/**
 * Unread counts on the drawer's tabs (owner's approved design, 2026-11-05: "League 4", "DMs 2") — so
 * you can see where something is waiting before tapping through five tabs. One source with the bubble
 * (`/api/chat/unread`), never on the tab you are already reading, and never on Discord.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'u1' } }, status: 'authenticated' }) }))

import CommsDrawer, { type CommsTab } from '@/components/core-app/comms/CommsDrawer'
import { readCommsTabCounts, tabBadgeText, useCommsTabCounts } from '@/components/core-app/comms/useCommsTabCounts'

const UNREAD = { total: 12, mentions: 1, dm: 5, league: 4, chimmy: 3, byThreadType: { dm: 2, group: 3 }, byLeague: {} }

describe('readCommsTabCounts', () => {
  it('maps the bubble endpoint onto the tabs, Discord excluded', () => {
    expect(readCommsTabCounts(UNREAD)).toEqual({ league: 4, chimmy: 3, dms: 2, huddle: 3, byLeague: {} })
  })

  it('treats a response from before the DM/huddle split as zero for those two, not as a failure', () => {
    expect(readCommsTabCounts({ total: 4, mentions: 0, dm: 0, league: 4, chimmy: 0 })).toEqual({
      league: 4,
      chimmy: 0,
      dms: 0,
      huddle: 0,
      byLeague: {},
    })
  })

  it('carries the per-league counts for the expanded league list, dropping zeros and junk', () => {
    expect(readCommsTabCounts({ league: 3, chimmy: 0, byLeague: { L1: 2, L2: 1, L3: 0, L4: 'x' } })?.byLeague).toEqual({
      L1: 2,
      L2: 1,
    })
  })

  it('is null for anything that is not that shape, so the last numbers stand', () => {
    expect(readCommsTabCounts(null)).toBeNull()
    expect(readCommsTabCounts({})).toBeNull()
    expect(readCommsTabCounts({ error: 'Unauthorized' })).toBeNull()
  })
})

describe('tabBadgeText', () => {
  it('says nothing at zero and caps at 99+', () => {
    expect(tabBadgeText(0)).toBeNull()
    expect(tabBadgeText(undefined)).toBeNull()
    expect(tabBadgeText(7)).toBe('7')
    expect(tabBadgeText(140)).toBe('99+')
  })
})

describe('CommsDrawer tab counts', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).startsWith('/api/chat/unread') ? UNREAD : {}),
    }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  const COUNTS = { league: 4, chimmy: 3, dms: 2, huddle: 3 }
  const drawer = (onTabChange = vi.fn()) => (
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={[{ id: 'l0', name: 'Sunday Squad', platform: 'sleeper' }] as never}
      pageLeagueId="l0"
      chimmyTokenCost={9}
      initialTab="chimmy"
      userId="u1"
      tabCounts={COUNTS}
      onTabChange={onTabChange}
    />
  )
  /*
   * READS only. Opening the Chimmy tab already POSTs `scope: 'chimmy'` to the same route to mark its
   * weekly checks seen — that write is the drawer's and predates the counts; a GET would be new.
   */
  const unreadReads = () =>
    fetchMock.mock.calls.filter(
      ([u, init]) => String(u).startsWith('/api/chat/unread') && (init as RequestInit | undefined)?.method !== 'POST',
    ).length

  it('badges every tab with something waiting except the one you are reading, and never Discord', () => {
    render(drawer())

    expect(screen.getByTestId('comms-tab-count-league').textContent).toBe('4')
    expect(screen.getByTestId('comms-tab-count-dms').textContent).toBe('2')
    expect(screen.getByTestId('comms-tab-count-huddle').textContent).toBe('3')
    // Chimmy is the open tab: its 3 is what you are looking at, not news.
    expect(screen.queryByTestId('comms-tab-count-chimmy')).toBeNull()
    expect(screen.queryByTestId('comms-tab-count-discord')).toBeNull()
    expect(screen.getByRole('tab', { name: 'League, 4 unread' })).toBeTruthy()
  })

  /*
   * 🛑 THE DRAWER ITSELF MUST NOT FETCH THE COUNTS. A dozen drawer suites queue their fetch replies in
   * order; one extra request on open ate their first reply and failed 28 tests. The bubble reads them.
   */
  it('makes no request of its own for the counts, and reports each tab switch', async () => {
    const onTabChange = vi.fn()
    render(drawer(onTabChange))
    expect(onTabChange).toHaveBeenLastCalledWith('chimmy')

    fireEvent.click(screen.getByRole('tab', { name: 'DMs, 2 unread' }))

    expect(onTabChange).toHaveBeenLastCalledWith('dms')
    expect(screen.queryByTestId('comms-tab-count-dms')).toBeNull()
    expect(screen.getByTestId('comms-tab-count-chimmy').textContent).toBe('3')
    expect(unreadReads()).toBe(0)
  })
})

describe('useCommsTabCounts', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  beforeEach(() => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => UNREAD }))
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  it('reads nothing while the drawer is closed, once on open, and again on each tab switch', async () => {
    const { result, rerender } = renderHook(({ open, tab }) => useCommsTabCounts(open, tab), {
      initialProps: { open: false, tab: null as CommsTab | null },
    })
    expect(fetchMock).not.toHaveBeenCalled()

    rerender({ open: true, tab: null })
    expect(fetchMock).not.toHaveBeenCalled() // waits for the drawer to name its tab

    rerender({ open: true, tab: 'chimmy' })
    await waitFor(() => expect(result.current).toEqual({ league: 4, chimmy: 3, dms: 2, huddle: 3, byLeague: {} }))
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender({ open: true, tab: 'dms' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('keeps the last numbers when a read fails, rather than claiming you are caught up', async () => {
    const { result, rerender } = renderHook(({ tab }) => useCommsTabCounts(true, tab), {
      initialProps: { tab: 'chimmy' as CommsTab },
    })
    await waitFor(() => expect(result.current.league).toBe(4))

    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({}) })
    rerender({ tab: 'dms' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    expect(result.current.league).toBe(4)
  })
})
