import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

/**
 * League-first phase 2: the chat bar names ONE league, so the drawer it opens must be scoped to
 * that league even after the user picked another one by hand — and a repeat of the same request
 * must still apply (`initialTab` alone only followed a CHANGE of tab).
 */

vi.mock('@/lib/tokens/client-confirm', () => ({ confirmTokenSpend: vi.fn(), previewTokenSpend: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/core',
  useSearchParams: () => new URLSearchParams(),
}))

import CommsDrawer from '@/components/core-app/comms/CommsDrawer'

const LEAGUES = [
  { id: 'l0', name: 'Sunday Squad', platform: 'sleeper' },
  { id: 'dj', name: 'Draft Junkies', platform: 'sleeper' },
]

beforeEach(() => {
  sessionStorage.clear()
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) })))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

type Req = { seq: number; tab: 'league' | 'chimmy' | null; leagueId: string | null } | null
const drawer = (openRequest: Req, initialDraft?: string) => (
  <CommsDrawer
    open
    onClose={vi.fn()}
    mode="overlay"
    leagues={LEAGUES as never}
    pageLeagueId="l0"
    chimmyTokenCost={9}
    initialTab="chimmy"
    userId="u1"
    openRequest={openRequest}
    initialDraft={initialDraft}
  />
)
const scopeValue = () => (screen.getByLabelText('League scope') as HTMLSelectElement).value

describe('CommsDrawer openRequest', () => {
  it('moves between channels with arrow keys and keeps one tab in the keyboard order', () => {
    render(drawer(null))
    const list = screen.getByRole('tablist', { name: 'Message channels' })
    const chimmy = screen.getByRole('tab', { name: 'Chimmy' })
    chimmy.focus()
    fireEvent.keyDown(list, { key: 'ArrowLeft' })
    const league = screen.getByRole('tab', { name: 'League' })
    expect(league.getAttribute('aria-selected')).toBe('true')
    expect(document.activeElement).toBe(league)
    expect(screen.getAllByRole('tab').filter((tab) => tab.tabIndex === 0)).toEqual([league])
  })
  it('seeds the requested league after saved drafts load, without seeding the previous scope', async () => {
    const question = 'Review my Draft Junkies Best Ball roster using Decision OS.'
    const { rerender } = render(drawer(null))
    rerender(drawer({ seq: 1, tab: 'chimmy', leagueId: 'dj' }, question))
    await waitFor(() => expect((screen.getByPlaceholderText('Ask Chimmy…') as HTMLTextAreaElement).value).toBe(question))
    expect(scopeValue()).toBe('dj')
    fireEvent.change(screen.getByLabelText('League scope'), { target: { value: 'l0' } })
    expect((screen.getByPlaceholderText('Ask Chimmy…') as HTMLTextAreaElement).value).toBe('')
    expect(vi.mocked(fetch).mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'POST' && String((init as RequestInit)?.body).includes(question))).toBe(false)
  })
  it('retains a saved user draft when a scoped screen question opens', async () => {
    sessionStorage.setItem('af:comms:conversations:u1', JSON.stringify({ dj: { turns: [], draft: 'My unsent question' } }))
    render(drawer({ seq: 1, tab: 'chimmy', leagueId: 'dj' }, 'Review my roster'))
    await waitFor(() => expect((screen.getByPlaceholderText('Ask Chimmy…') as HTMLTextAreaElement).value).toBe('My unsent question'))
  })
  it('rescopes to the requested league over a hand-picked one, and a repeat still applies', () => {
    const { rerender } = render(drawer(null))
    expect(scopeValue()).toBe('l0')
    rerender(drawer({ seq: 1, tab: 'chimmy', leagueId: 'dj' }))
    expect(scopeValue()).toBe('dj')
    fireEvent.change(screen.getByLabelText('League scope'), { target: { value: 'l0' } })
    expect(scopeValue()).toBe('l0')
    rerender(drawer({ seq: 2, tab: 'chimmy', leagueId: 'dj' }))
    expect(scopeValue()).toBe('dj')
  })
  it('ignores a league the user does not have', () => {
    const { rerender } = render(drawer(null))
    rerender(drawer({ seq: 1, tab: 'chimmy', leagueId: 'not-mine' }))
    expect(scopeValue()).toBe('l0')
  })
})


it('offers the selected draft question without losing or sending the saved message', async () => {
  sessionStorage.setItem('af:comms:conversations:u1', JSON.stringify({ dj: { turns: [], draft: 'My unsent question' } }))
  const incoming='Explain the verified draft analysis for archive key imported:123.'
  render(drawer({ seq: 1, tab: 'chimmy', leagueId: 'dj' }, incoming))
  await screen.findByRole('button', { name: 'Add suggested question' })
  const input=screen.getByPlaceholderText('Ask Chimmy…') as HTMLTextAreaElement
  expect(input.value).toBe('My unsent question')
  fireEvent.click(screen.getByRole('button', { name: 'Add suggested question' }))
  expect(input.value).toBe('My unsent question\n\n'+incoming)
  expect(screen.queryByRole('status', { name:'Suggested question' })).toBeNull()
  expect(vi.mocked(fetch).mock.calls.some(([,init])=>(init as RequestInit)?.method==='POST')).toBe(false)
})
it('does not show a different league suggestion and allows keeping the existing message', async () => {
  sessionStorage.setItem('af:comms:conversations:u1', JSON.stringify({ dj: { turns: [], draft: 'Keep me' } }))
  render(drawer({ seq: 1, tab: 'chimmy', leagueId: 'dj' }, 'Explain this draft'))
  await screen.findByRole('button', { name:'Add suggested question' })
  fireEvent.change(screen.getByLabelText('League scope'), { target:{ value:'l0' } })
  expect(screen.queryByRole('status', { name:'Suggested question' })).toBeNull()
  fireEvent.change(screen.getByLabelText('League scope'), { target:{ value:'dj' } })
  await screen.findByRole('button', { name:'Keep current message' })
  fireEvent.click(screen.getByRole('button', { name:'Keep current message' }))
  expect((screen.getByPlaceholderText('Ask Chimmy…') as HTMLTextAreaElement).value).toBe('Keep me')
  expect(screen.queryByRole('status', { name:'Suggested question' })).toBeNull()
})
