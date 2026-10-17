import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/league/L1',
}))

import { LeagueChatInPanel } from '@/app/dashboard/components/LeagueChatInPanel'

/*
 * The league page's chat (inside LeftChatPanel) speaks the drawer's visual language: your ordinary
 * message is the solid accent bubble, a run of one sender's messages reads as one voice with the time
 * once under its last message, and a message's own line breaks survive.
 */

const now = Date.now()
const at = (minAgo: number) => new Date(now - minAgo * 60_000).toISOString()

function renderWith(messages: Array<Record<string, unknown>>) {
  globalThis.fetch = vi.fn(async (url: string) => {
    if (String(url).includes('/api/league/chat')) {
      return new Response(JSON.stringify({ messages }), { status: 200 })
    }
    return new Response('{}', { status: 200 })
  }) as never
  Element.prototype.scrollIntoView = vi.fn()
  return render(
    <LeagueChatInPanel
      selectedLeague={{ id: 'L1', name: 'Degenerates', leagueVariant: null } as never}
      userId="me"
      onAskChimmy={() => {}}
    />,
  )
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('league page chat restyle', () => {
  it('draws your ordinary message as the solid accent bubble', async () => {
    renderWith([{ id: 'm1', authorId: 'me', authorName: 'Me', text: 'final offer', createdAt: at(3) }])
    await screen.findByText('final offer')
    const bubble = screen.getByTestId('league-chat-own-bubble')
    expect(bubble.className).toContain('bg-[#22d3ee]')
    expect(bubble.getAttribute('data-plain')).toBe('true')
  })

  it('keeps the private tint on a message only you can see', async () => {
    renderWith([
      {
        id: 'm1',
        authorId: 'me',
        authorName: 'Me',
        text: 'note to self',
        createdAt: at(3),
        metadata: { isPrivate: true, visibleToUserId: 'me' },
      },
    ])
    await screen.findByText('note to self')
    const bubble = screen.getByTestId('league-chat-own-bubble')
    expect(bubble.className).not.toContain('bg-[#22d3ee]')
    expect(bubble.getAttribute('data-plain')).toBeNull()
  })

  it('shows the time once, under the last message of a run', async () => {
    renderWith([
      { id: 'a', authorId: 'me', authorName: 'Me', text: 'one', createdAt: at(10) },
      { id: 'b', authorId: 'me', authorName: 'Me', text: 'two', createdAt: at(9) },
      { id: 'c', authorId: 'me', authorName: 'Me', text: 'three', createdAt: at(8) },
    ])
    await screen.findByText('three')
    expect(screen.queryByText('10m ago')).toBeNull()
    expect(screen.queryByText('9m ago')).toBeNull()
    expect(screen.getByText('8m ago')).toBeTruthy()
    const [first, middle, last] = screen.getAllByTestId('league-chat-own-bubble')
    // The corner facing you squares off inside the run.
    expect(first!.className).toContain('rounded-br-md')
    expect(first!.className).not.toContain('rounded-tr-md')
    expect(middle!.className).toContain('rounded-tr-md')
    expect(middle!.className).toContain('rounded-br-md')
    expect(last!.className).toContain('rounded-tr-md')
    expect(last!.className).not.toContain('rounded-br-md')
  })

  it('keeps a message’s own line breaks', async () => {
    renderWith([{ id: 'x', authorId: 'sam', authorName: 'Sam', text: 'line one\nline two', createdAt: at(1) }])
    const p = await screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === 'line one\nline two')
    expect(p.className).toContain('whitespace-pre-wrap')
  })
})
