import React from 'react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/*
 * Three things the hands-on test of the chat drawer found (2026-09-25, live-shots phone-18, phone-19,
 * desktop-21):
 *   1. open a huddle, tap DMs, and the huddle stayed open under the DM privacy note;
 *   2. with the phone keyboard up, the drawer's chrome filled the screen and the footer sat on the box;
 *   3. a failed Chimmy answer was one bare red line, the question printed twice, and no way to retry.
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('next-auth/react', () => ({ useSession: () => ({ data: { user: { id: 'me' } }, status: 'authenticated' }) }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), info: vi.fn(), success: vi.fn() } }))

import CommsDrawer, { describeChimmyFailure } from '@/components/core-app/comms/CommsDrawer'
import { DM_PRIVACY, HUDDLE_PRIVACY } from '@/components/core-app/comms/privacyCopy'

function json(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response
}

let chimmyPost: ReturnType<typeof vi.fn>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  chimmyPost = vi.fn(async () => json({ response: 'Sunday Squad. Your flex is on bye.', meta: {} }))
  fetchMock = vi.fn(async (url: unknown, init?: { method?: string }) => {
    const u = String(url)
    const method = (init?.method ?? 'GET').toUpperCase()
    if (u === '/api/shared/chat/threads') {
      const now = new Date().toISOString()
      return json({
        threads: [
          { id: 'g1', threadType: 'group', title: 'Sunday Crew', lastMessageAt: now, unreadCount: 0, memberCount: 3 },
          { id: 't1', threadType: 'dm', title: 'Jordan', lastMessageAt: now, unreadCount: 0, memberCount: 2 },
        ],
      })
    }
    if (u.startsWith('/api/shared/chat/threads/g1/messages')) {
      return json({ messages: [{ id: 'h1', senderUserId: 'ben', senderName: 'Ben', body: 'Huddle is live', createdAt: new Date().toISOString(), messageType: 'text' }] })
    }
    if (u.startsWith('/api/shared/chat/threads/t1/messages')) {
      return json({ messages: [{ id: 'd1', senderUserId: 'jordan', senderName: 'Jordan', body: 'u up', createdAt: new Date().toISOString(), messageType: 'text' }] })
    }
    if (u === '/api/chat/chimmy' && method === 'POST') return chimmyPost(url, init)
    if (u.startsWith('/api/chat/chimmy?')) return json({ turns: [] })
    return json({})
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function openDrawer(initialTab: 'huddle' | 'chimmy') {
  return render(
    <CommsDrawer open onClose={vi.fn()} mode="overlay" leagues={[]} pageLeagueId={null} chimmyTokenCost={9} initialTab={initialTab} userId="me" />,
  )
}

describe('1. a huddle never opens under the DMs tab', () => {
  it('switching Huddle → DMs shows the DM list with the DM note, not the huddle you had open', async () => {
    openDrawer('huddle')
    fireEvent.click(await screen.findByText('Sunday Crew'))
    await screen.findByText('Huddle is live')
    expect(document.querySelector('.af-cm-privacy-mini p')?.textContent).toBe(HUDDLE_PRIVACY)

    fireEvent.click(screen.getByRole('tab', { name: /DMs/ }))

    expect(await screen.findByText('Jordan')).toBeTruthy()
    expect(screen.queryByText('Huddle is live')).toBeNull()
    expect(screen.queryByText('Sunday Crew')).toBeNull()
    // The list view, with the DM note in full — not a conversation labelled "One person".
    expect(document.querySelector('.af-cm-privacy-mini')).toBeNull()
    expect(document.querySelector('.af-cm-privacy')?.textContent).toBe(DM_PRIVACY)
  })

  it('and back to Huddle starts at the list too', async () => {
    openDrawer('huddle')
    fireEvent.click(await screen.findByText('Sunday Crew'))
    await screen.findByText('Huddle is live')
    fireEvent.click(screen.getByRole('tab', { name: /DMs/ }))
    await screen.findByText('Jordan')
    fireEvent.click(screen.getByRole('tab', { name: /Huddle/ }))
    expect(await screen.findByText('Sunday Crew')).toBeTruthy()
    expect(screen.queryByText('Huddle is live')).toBeNull()
    expect(document.querySelector('.af-cm-privacy')?.textContent).toBe(HUDDLE_PRIVACY)
  })
})

describe('3. when Chimmy cannot answer', () => {
  const Q = 'Is Bijan a sell this week?'
  function ask() {
    const input = screen.getByLabelText('Message')
    fireEvent.change(input, { target: { value: Q } })
    fireEvent.submit(input.closest('form')!)
  }
  const youBubbles = () =>
    Array.from(document.querySelectorAll('.af-cm-turn[data-role="you"]')).filter((el) => el.textContent?.includes(Q))

  it('says it hit a snag, puts the question back in the box once, and Try again answers it', async () => {
    chimmyPost.mockResolvedValueOnce(json({ error: 'Internal error' }, 500))
    openDrawer('chimmy')
    ask()

    expect(await screen.findByText('Chimmy hit a snag on our side.')).toBeTruthy()
    expect(screen.getByText('Your question is back in the box.')).toBeTruthy()
    // In the box — and NOT also printed in the transcript as a question nobody answered.
    expect((screen.getByLabelText('Message') as HTMLTextAreaElement).value).toBe(Q)
    expect(youBubbles()).toHaveLength(0)

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }))

    expect(await screen.findByText(/Your flex is on bye/)).toBeTruthy()
    expect(youBubbles()).toHaveLength(1)
    expect(screen.queryByText('Chimmy hit a snag on our side.')).toBeNull()
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull()
    // The retry sent the same question, and the failed one never went to the model as a turn.
    const posts = fetchMock.mock.calls.filter(([u, i]) => String(u) === '/api/chat/chimmy' && i?.method === 'POST')
    expect(posts).toHaveLength(2)
    const retried = posts[1]![1].body as FormData
    expect(retried.get('message')).toBe(Q)
    expect(JSON.parse(String(retried.get('conversation')))).toEqual([])
  })

  it('a dropped connection says so, and offers Try again', async () => {
    chimmyPost.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    openDrawer('chimmy')
    ask()
    expect(await screen.findByText('Could not reach Chimmy. Check your connection.')).toBeTruthy()
    expect(screen.getByRole('button', { name: /Try again/ })).toBeTruthy()
  })

  it('a gate keeps its own sentence and offers no retry — asking again cannot pass it', async () => {
    chimmyPost.mockResolvedValueOnce(json({ code: 'VERIFICATION_REQUIRED', error: 'VERIFICATION_REQUIRED' }, 403))
    openDrawer('chimmy')
    ask()
    expect(await screen.findByText(/Verify your email to use Chimmy/)).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Try again/ })).toBeNull()
    expect(screen.queryByText('Your question is back in the box.')).toBeNull()
  })
})

describe('describeChimmyFailure', () => {
  it('names the failure and says whether a retry could fix it', () => {
    expect(describeChimmyFailure(null, null)).toEqual({ message: 'Could not reach Chimmy. Check your connection.', retryable: true })
    expect(describeChimmyFailure(504, undefined)).toEqual({ message: 'Chimmy took too long on that one.', retryable: true })
    expect(describeChimmyFailure(429, 'rate_limited')).toEqual({ message: 'Too many questions at once. Give it a few seconds.', retryable: true })
    expect(describeChimmyFailure(500, 'Internal error')).toEqual({ message: 'Chimmy hit a snag on our side.', retryable: true })
    // Gates win over the status: out of tokens is a 402, not a snag.
    expect(describeChimmyFailure(402, 'insufficient_token_balance').retryable).toBe(false)
    // An unmapped 4xx is not retried, and an internal constant is never shown raw.
    expect(describeChimmyFailure(400, 'SOME_NEW_CODE')).toEqual({ message: 'Chimmy could not answer that.', retryable: false })
  })

  it('never claims nothing was charged — a 500 can come after the spend', () => {
    for (const s of [null, 408, 429, 500, 502, 504]) {
      expect(describeChimmyFailure(s, undefined).message).not.toMatch(/charg|free|spent/i)
    }
  })
})

describe('2. a short screen gives the conversation the room', () => {
  const css = readFileSync(join(process.cwd(), 'components/core-app/af-comms.css'), 'utf8')
  const tail = css.slice(css.lastIndexOf('── A short screen'))
  const shortQuery = tail.slice(tail.indexOf('@media (max-height: 560px)'))

  it('with the keyboard up: privacy notes and tab icons step aside (the footer already did)', () => {
    expect(tail).toMatch(/^\.af-cm\[data-keyboard='open'\] \.af-cm-privacy,$/m)
    expect(tail).toMatch(/^\.af-cm\[data-keyboard='open'\] \.af-cm-privacy-mini,$/m)
    expect(tail).toMatch(/^\.af-cm\[data-keyboard='open'\] \.af-cm-tab > svg \{$/m)
    expect(css).toMatch(/^\.af-cm\[data-keyboard='open'\] \.af-cm-foot \{ display: none; \}$/m)
  })

  it('a short viewport does the same, footer included, for keyboards that resize the page instead', () => {
    expect(shortQuery).toMatch(/^\s+\.af-cm \.af-cm-foot,$/m)
    expect(shortQuery).toMatch(/^\s+\.af-cm \.af-cm-privacy,$/m)
    expect(shortQuery).toMatch(/^\s+\.af-cm \.af-cm-tab > svg \{$/m)
  })

  it('keeps "Who sees this" and 44px tabs — the audience line is about the words being typed', () => {
    expect(tail).not.toMatch(/\.af-cm-audience[^{]*\{\s*display: none/)
    expect(tail).toMatch(/^\.af-cm\[data-keyboard='open'\] \.af-cm-tab \{ min-height: 44px;/m)
    expect(shortQuery).toMatch(/^\s+\.af-cm \.af-cm-tab \{ min-height: 44px;/m)
  })
})
