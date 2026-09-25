import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

/*
 * Three small truths from the hands-on chat test (2026-09-25):
 *
 *   V9  — Chimmy's starter and follow-up chips carried an ↗ ("opens / sends") icon, but a tap only
 *         FILLS the box. The icon now says "fill in"; the behaviour (fill, never send) is unchanged.
 *   V10 — the drawer footer said "Read-only · AllFantasy never writes to your platform" inside a
 *         chat you type into. What it means is that AllFantasy never changes your league on the
 *         platform, so that is what it says.
 *   V11 — the DM / huddle send button was announced as "Send league message".
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'
import { ChatComposer } from '@/app/dashboard/components/chat/ChatComposer'

const chimmyPosts = (fetchMock: ReturnType<typeof vi.fn>) =>
  fetchMock.mock.calls.filter(([url]) => String(url) === '/api/chat/chimmy')

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  fetchMock = vi.fn(async (url: unknown) => {
    const u = String(url)
    if (u === '/api/chat/chimmy') {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          response: 'Start Jayden Reed over Tank Bigsby.',
          meta: { followUps: ['What are my playoff odds?'] },
        }),
      }
    }
    if (u === '/api/shared/chat/threads') {
      return { ok: true, status: 200, json: async () => ({ threads: [{ id: 't1', threadType: 'dm', title: 'Jordan', unreadCount: 0, memberCount: 2 }] }) }
    }
    if (u.startsWith('/api/shared/chat/threads/t1/messages')) {
      return { ok: true, status: 200, json: async () => ({ messages: [] }) }
    }
    return { ok: true, status: 200, json: async () => ({}) }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function openDrawer(tab: 'chimmy' | 'dms' = 'chimmy') {
  render(
    <CommsDrawer
      open
      onClose={vi.fn()}
      mode="overlay"
      leagues={[{ id: 'l0', name: 'KBFL', platform: 'sleeper' }] as never}
      pageLeagueId={null}
      chimmyTokenCost={10}
      initialTab={tab}
      userId="u1"
    />,
  )
}

function iconsIn(el: Element) {
  return Array.from(el.querySelectorAll('svg')).map((svg) => svg.getAttribute('class') ?? '')
}

describe('V9 — a chip that fills the box looks like it fills the box', () => {
  it('starter chips carry a "fill in" icon, not ↗, and a tap fills without sending', () => {
    openDrawer()
    const chip = screen.getByRole('button', { name: /Which league needs me most\?/ })
    const icons = iconsIn(chip)
    expect(icons.some((c) => c.includes('lucide-arrow-up-right'))).toBe(false)
    expect(icons.some((c) => c.includes('lucide-pencil'))).toBe(true)

    fireEvent.click(chip)
    expect((screen.getByLabelText('Message') as HTMLInputElement).value).toBe('Which league needs me most?')
    expect(chimmyPosts(fetchMock)).toHaveLength(0)
  })

  it('follow-up chips share the same icon and still only fill', async () => {
    openDrawer()
    const box = screen.getByLabelText('Message') as HTMLInputElement
    fireEvent.change(box, { target: { value: 'Set my best lineup' } })
    fireEvent.submit(box.closest('form') as HTMLFormElement)
    const group = await screen.findByRole('group', { name: 'Ask next' })
    const chip = within(group).getByRole('button', { name: /What are my playoff odds\?/ })
    expect(iconsIn(chip).some((c) => c.includes('lucide-arrow-up-right'))).toBe(false)
    expect(iconsIn(chip).some((c) => c.includes('lucide-pencil'))).toBe(true)

    fireEvent.click(chip)
    expect(box.value).toBe('What are my playoff odds?')
    expect(chimmyPosts(fetchMock)).toHaveLength(1)
  })
})

describe('V10 — the footer says what is actually true', () => {
  it('says AllFantasy never changes your league on the platform, and no longer calls a chat read-only', () => {
    openDrawer()
    const foot = document.querySelector('.af-cm-foot')!
    expect(foot.textContent).toContain('AllFantasy never changes your league on Sleeper, ESPN or Yahoo.')
    expect(foot.textContent).not.toMatch(/Read-only/i)
    expect(foot.textContent).not.toMatch(/never writes/i)
  })
})

describe('V11 — the send button is named for the surface it sends on', () => {
  it('a DM says "Send message"', async () => {
    openDrawer('dms')
    fireEvent.click(await screen.findByRole('button', { name: /Jordan/ }))
    expect(await screen.findByRole('button', { name: 'Send message' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Send league message' })).toBeNull()
  })

  it.each([
    ['dm', 'Send message'],
    ['huddle', 'Send message'],
    ['draft', 'Send message'],
    ['league', 'Send league message'],
  ] as const)('chatType=%s is announced as "%s"', (chatType, label) => {
    render(<ChatComposer leagueId="league-1" chatType={chatType} onSend={async () => {}} />)
    expect(screen.getByTestId('league-chat-send').getAttribute('aria-label')).toBe(label)
  })
})
