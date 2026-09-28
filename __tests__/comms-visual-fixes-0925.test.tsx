import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Four fixes from the owner's hands-on review (2026-09-25):
 *   1. the floating "Dark" theme pill sat over /core content — /core has a top-bar switch instead;
 *   2. the top bar read "⚠ synced never synced";
 *   3. the Discord tab was blank below "Select a league";
 *   4. the DM/Huddle privacy note sat above every message — inside a conversation it folds to a line.
 */

const nav = vi.hoisted(() => ({ pathname: '/core' }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))
vi.mock('@/components/theme/ModeToggle', () => ({
  ModeToggle: (p: { className?: string }) => <button className={p.className}>Dark</button>,
}))

import { GlobalModeToggle } from '@/components/theme/GlobalModeToggle'
import { syncChipText } from '@/components/core-app/AfCoreShell'
import CommsDrawer from '@/components/core-app/comms/CommsDrawer'
import ThreadPanel from '@/components/core-app/comms/ThreadPanel'
import { DM_PRIVACY } from '@/components/core-app/comms/privacyCopy'

let fetchMock: ReturnType<typeof vi.fn>
function json(body: unknown, status = 200) {
  return { ok: status < 400, status, json: async () => body } as Response
}

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  fetchMock = vi.fn(async (url: string) => {
    const u = String(url)
    if (u === '/api/shared/chat/threads') {
      return json({ threads: [{ id: 't1', threadType: 'dm', title: 'Jordan', lastMessageAt: new Date().toISOString(), unreadCount: 0, memberCount: 2 }] })
    }
    if (u.startsWith('/api/shared/chat/threads/t1/messages')) {
      return json({ messages: [{ id: 'd1', senderUserId: 'jordan', senderName: 'Jordan', body: 'u up', createdAt: new Date().toISOString(), messageType: 'text' }] })
    }
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('1. the floating theme pill', () => {
  it('does not float over /core — /core has its own switch in the top bar', () => {
    for (const p of ['/core', '/core/my-team', '/core/discord']) {
      nav.pathname = p
      const { container, unmount } = render(<GlobalModeToggle />)
      expect(container.querySelector('[data-af-mode-toggle]')).toBeNull()
      unmount()
    }
  })

  it('still renders where nothing else offers the switch', () => {
    nav.pathname = '/pricing'
    const { container } = render(<GlobalModeToggle />)
    expect(container.querySelector('[data-af-mode-toggle]')).not.toBeNull()
  })
})

describe('2. the sync chip', () => {
  it('says "Never synced" instead of "synced never synced"', () => {
    expect(syncChipText('never synced')).toBe('Never synced')
    expect(syncChipText('4m ago')).toBe('synced 4m ago')
    expect(syncChipText('2d ago')).toBe('synced 2d ago')
  })
})

describe('3. the Discord tab before a league is picked', () => {
  function discord(leagues: Array<{ id: string; name: string; platform: string; platformLeagueId: null }>) {
    render(
      <CommsDrawer open onClose={vi.fn()} mode="overlay" leagues={leagues as never} pageLeagueId={null} chimmyTokenCost={9} initialTab="discord" userId="me" />,
    )
  }

  it('says what a league Discord is instead of a blank panel', () => {
    discord([{ id: 'l0', name: 'Sunday Squad', platform: 'native', platformLeagueId: null }])
    expect(screen.getByText('Give your league its own Discord')).toBeTruthy()
    expect(screen.getByText(/AllFantasy doesn.t read it/)).toBeTruthy()
    expect(screen.queryByRole('link', { name: /Add a league first/ })).toBeNull()
  })

  it('with no leagues at all, points to adding one', () => {
    discord([])
    const link = screen.getByRole('link', { name: /Add a league first/ }) as HTMLAnchorElement
    expect(link.getAttribute('href')).toBe('/import')
  })
})

describe('4. the DM privacy note', () => {
  it('shows in full on the list, and folds to one line inside a conversation', async () => {
    render(<ThreadPanel kind="dm" privacy={DM_PRIVACY} />)
    expect(document.querySelector('.af-cm-privacy')?.textContent).toBe(DM_PRIVACY)

    fireEvent.click(await screen.findByText('Jordan'))
    await waitFor(() => expect(document.querySelector('.af-cm-privacy-mini')).not.toBeNull())
    expect(document.querySelector('.af-cm-privacy')).toBeNull()
    const details = document.querySelector('.af-cm-privacy-mini') as HTMLDetailsElement
    expect(details.open).toBe(false)
    expect(details.querySelector('summary')?.textContent).toContain('Private conversation')
    // The words are still there, one tap away.
    expect(details.querySelector('p')?.textContent).toBe(DM_PRIVACY)
  })
})
