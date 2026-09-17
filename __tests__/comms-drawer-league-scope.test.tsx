import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'

/**
 * Chimmy keeps the league the user is asking about (user report, 2026-09-16).
 *
 * "A user in Draft Junkies put Rashee Rice on the trade block. I asked Chimmy if he was worth trading
 * for in that league — Chimmy could not find the league, and I could not find the league. Even after
 * opening the league, Chimmy was lost."
 *
 * What went wrong in the drawer, each pinned below:
 *   - a hand-picked league was thrown away every time the bubble reopened;
 *   - moving to a league started an empty conversation, so "he" meant nothing;
 *   - the leagues a "which league?" refusal offered were discarded;
 *   - an answer about one league, asked from "All leagues", left the scope on "All leagues".
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'
import { useScopedConversation } from '@/components/core-app/comms/useScopedConversation'

type Turn = { id: string; role: string; text: string }

const LEAGUES = [
  { id: 'l0', name: 'Sunday Squad', platform: 'sleeper' },
  { id: 'dj', name: 'Draft Junkies', platform: 'sleeper' },
]

type Reply = { status: number; body: Record<string, unknown> }

let replies: Reply[]
let fetchMock: ReturnType<typeof vi.fn>

const chimmyCalls = () => fetchMock.mock.calls.filter(([url]) => String(url) === '/api/chat/chimmy')
const sent = (i: number) => {
  const body = chimmyCalls()[i]?.[1]?.body as FormData | undefined
  return {
    message: body?.get('message'),
    leagueId: body?.get('leagueId'),
    conversation: JSON.parse(String(body?.get('conversation') ?? '[]')) as Array<{ content: string }>,
  }
}

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  replies = []
  fetchMock = vi.fn(async (url: string) => {
    if (String(url) !== '/api/chat/chimmy') return { ok: true, status: 200, json: async () => ({}) }
    const next = replies.shift() ?? { status: 200, body: { response: 'ok' } }
    return { ok: next.status < 400, status: next.status, json: async () => next.body }
  })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function drawer(props: { open?: boolean; pageLeagueId?: string | null } = {}) {
  return (
    <CommsDrawer
      open={props.open ?? true}
      onClose={vi.fn()}
      mode="overlay"
      leagues={LEAGUES as never}
      pageLeagueId={props.pageLeagueId ?? null}
      chimmyTokenCost={9}
      initialTab="chimmy"
      userId="u1"
    />
  )
}

const scopeValue = () => (screen.getByLabelText('League scope') as HTMLSelectElement).value
const pickScope = (value: string) => fireEvent.change(screen.getByLabelText('League scope'), { target: { value } })

async function ask(question: string) {
  fireEvent.change(screen.getByLabelText('Message'), { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: 'Send to Chimmy' }))
  await waitFor(() => expect(screen.queryByText('Chimmy is thinking…')).toBeNull())
}

describe('useScopedConversation.carryInto', () => {
  it('seeds an empty thread, never overwrites one, and appends only when asked', () => {
    const { result, rerender } = renderHook(({ scope }) => useScopedConversation<Turn>('u1', scope), {
      initialProps: { scope: 'global' },
    })
    const carried = [
      { id: 'a', role: 'you', text: 'one' },
      { id: 'b', role: 'chimmy', text: 'two' },
      { id: 'c', role: 'you', text: 'three' },
    ]

    act(() => result.current.carryInto('dj', carried))
    rerender({ scope: 'dj' })
    expect(result.current.turns.map((t) => t.text)).toEqual(['one', 'two', 'three'])

    act(() => result.current.setTurns((t) => [...t, { id: 'd', role: 'chimmy', text: 'four' }]))
    rerender({ scope: 'global' })
    // A thread that already holds a conversation is left alone…
    act(() => result.current.carryInto('dj', [{ id: 'x', role: 'you', text: 'intruder' }]))
    // …unless the caller asks for the last turns to be appended — and those are not duplicated.
    act(() => result.current.carryInto('dj', [...carried, { id: 'e', role: 'you', text: 'five' }], 2))
    rerender({ scope: 'dj' })
    expect(result.current.turns.map((t) => t.text)).toEqual(['one', 'two', 'three', 'four', 'five'])
  })

  it('is a no-op into its own scope and with nothing to carry', () => {
    const { result } = renderHook(() => useScopedConversation<Turn>('u1', 'global'))
    act(() => result.current.carryInto('global', [{ id: 'a', role: 'you', text: 'self' }]))
    act(() => result.current.carryInto('dj', []))
    expect(result.current.turns).toEqual([])
  })
})

describe('CommsDrawer keeps the league the user is asking about', () => {
  it('🛑 a hand-picked league survives closing and reopening the bubble', () => {
    const { rerender } = render(drawer({ pageLeagueId: null }))
    pickScope('dj')
    rerender(drawer({ open: false, pageLeagueId: null }))
    rerender(drawer({ open: true, pageLeagueId: null }))
    expect(scopeValue()).toBe('dj')
  })

  it('still follows the page when the page moves to another league', () => {
    const { rerender } = render(drawer({ pageLeagueId: 'l0' }))
    expect(scopeValue()).toBe('l0')
    pickScope('')
    rerender(drawer({ open: false, pageLeagueId: 'dj' }))
    rerender(drawer({ open: true, pageLeagueId: 'dj' }))
    expect(scopeValue()).toBe('dj')
  })

  it('🛑 moving to a league carries the conversation, so "he" still means someone', async () => {
    render(drawer())
    replies.push({ status: 200, body: { response: 'Rashee Rice is on the block in Draft Junkies.' } })
    await ask('who is on the trade block?')

    pickScope('dj')
    expect(screen.getAllByText(/· earlier/).length).toBeGreaterThan(0)
    await ask('is he worth trading for?')

    const second = sent(1)
    expect(second.leagueId).toBe('dj')
    expect(second.conversation.map((t) => t.content)).toEqual([
      'who is on the trade block?',
      'Rashee Rice is on the block in Draft Junkies.',
    ])
  })

  it('carries only the words — no hand-off from the scope it was answered in', async () => {
    render(drawer({ pageLeagueId: 'l0' }))
    replies.push({
      status: 200,
      body: { response: 'Start him.', meta: { leagueGrounding: { grounded: true, leagueId: 'l0', leagueName: 'Sunday Squad' } } },
    })
    await ask('should I start Rice?')
    expect(screen.queryAllByRole('link').some((a) => /sleeper/i.test(a.textContent ?? ''))).toBe(true)
    pickScope('dj')
    expect(screen.getByText('Start him.')).toBeTruthy()
    expect(screen.queryAllByRole('link').some((a) => /sleeper/i.test(a.textContent ?? ''))).toBe(false)
  })

  it('🛑 a "which league?" refusal offers the leagues as buttons that re-ask the question there', async () => {
    render(drawer())
    replies.push({
      status: 412,
      body: {
        error: 'league_grounding_required',
        details: {
          message: 'Which league do you want me to use?',
          choices: [
            { leagueId: 'dj', leagueName: 'Draft Junkies' },
            // Not a league this drawer can scope to: never a dead button.
            { leagueId: 'somewhere-else', leagueName: 'Old Tournament' },
          ],
        },
      },
    })
    await ask('is Rashee Rice worth trading for?')

    expect(screen.getByRole('button', { name: /Ask in Draft Junkies/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Old Tournament/ })).toBeNull()

    replies.push({ status: 200, body: { response: 'In Draft Junkies, yes.' } })
    fireEvent.click(screen.getByRole('button', { name: /Ask in Draft Junkies/ }))
    await waitFor(() => expect(chimmyCalls()).toHaveLength(2))
    await waitFor(() => expect(screen.getByText('In Draft Junkies, yes.')).toBeTruthy())
    expect(scopeValue()).toBe('dj')
    expect(sent(1)).toMatchObject({ message: 'is Rashee Rice worth trading for?', leagueId: 'dj' })
  })

  it('🛑 an answer about one league, asked from "All leagues", moves the conversation there', async () => {
    render(drawer())
    replies.push({
      status: 200,
      body: {
        response: 'In Draft Junkies he is worth a 2nd.',
        meta: { leagueGrounding: { grounded: true, leagueId: 'dj', leagueName: 'Draft Junkies' } },
      },
    })
    await ask('is Rashee Rice worth trading for in Draft Junkies?')

    await waitFor(() => expect(scopeValue()).toBe('dj'))
    expect(screen.getByText('In Draft Junkies he is worth a 2nd.')).toBeTruthy()

    await ask('what would it cost?')
    expect(sent(1).leagueId).toBe('dj')
    expect(sent(1).conversation.map((t) => t.content)).toContain('In Draft Junkies he is worth a 2nd.')
  })

  it('does not move to a league the drawer cannot scope to, nor away from a picked one', async () => {
    render(drawer())
    replies.push({
      status: 200,
      body: { response: 'Elsewhere.', meta: { leagueGrounding: { grounded: true, leagueId: 'not-listed' } } },
    })
    await ask('anything?')
    expect(scopeValue()).toBe('')

    pickScope('l0')
    replies.push({
      status: 200,
      body: { response: 'About DJ.', meta: { leagueGrounding: { grounded: true, leagueId: 'dj' } } },
    })
    await ask('and there?')
    expect(scopeValue()).toBe('l0')
  })
})
