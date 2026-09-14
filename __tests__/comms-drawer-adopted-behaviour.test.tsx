import React from 'react'
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react'

/*
 * The chat-bubble work adopted on 2026-09-14 from an unowned WIP. Each case here
 * is a rule the adoption had to keep, not a layout check.
 *
 * ⚠ THE PUBLIC/PRIVATE SEPARATION IS THE LOAD-BEARING ONE. Chimmy conversations
 * are now kept per scope in sessionStorage. Keyed on the league alone, a PRIVATE
 * thread about a league would reappear inside that league's PUBLIC @chimmy mode,
 * rendered as though everyone in the league could read it.
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

describe('useScopedConversation', () => {
  beforeEach(() => sessionStorage.clear())

  it('keeps a public league thread and a private one about the same league apart', () => {
    const { result, rerender } = renderHook(({ scope }) => useScopedConversation<Turn>('u1', scope), {
      initialProps: { scope: 'l1' },
    })
    act(() => result.current.setTurns([{ id: 'p', role: 'you', text: 'private question' }]))

    rerender({ scope: 'public:l1' })
    expect(result.current.turns).toEqual([])

    rerender({ scope: 'l1' })
    expect(result.current.turns.map((t) => t.text)).toEqual(['private question'])
  })

  it('never loads one account’s saved chat for another', () => {
    const first = renderHook(() => useScopedConversation<Turn>('u1', 'global'))
    act(() => first.result.current.setTurns([{ id: 'a', role: 'you', text: 'mine' }]))
    first.unmount()

    const other = renderHook(() => useScopedConversation<Turn>('u2', 'global'))
    expect(other.result.current.turns).toEqual([])
  })
})

describe('CommsDrawer — adopted behaviour', () => {
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    sessionStorage.clear()
    Element.prototype.scrollIntoView = vi.fn()
    fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) })
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  function openChimmy(leagueCount: number) {
    const leagues = Array.from({ length: leagueCount }, (_, i) => ({ id: `l${i}`, name: `League ${i}`, platform: 'sleeper' }))
    render(
      <CommsDrawer
        open
        onClose={vi.fn()}
        mode="overlay"
        leagues={leagues as never}
        pageLeagueId={null}
        chimmyTokenCost={9}
        initialTab="chimmy"
        userId="u1"
      />,
    )
  }

  /* The chips capped at six; on a 60-league account most leagues could not be picked. */
  it('offers every league in the scope picker, not the first six', () => {
    openChimmy(12)
    const select = screen.getByLabelText('League scope') as HTMLSelectElement
    // 12 leagues + the "All leagues" option.
    expect(select.options).toHaveLength(13)
  })

  /* A suggestion used to SEND, spending tokens on a question the user had not chosen. */
  it('fills the box from a suggestion instead of sending it', () => {
    openChimmy(1)
    fireEvent.click(screen.getByRole('button', { name: /Which league needs me most\?/ }))
    expect((screen.getByLabelText('Message') as HTMLInputElement).value).toBe('Which league needs me most?')
    expect(fetchMock.mock.calls.filter(([url]) => String(url) === '/api/chat/chimmy')).toHaveLength(0)
  })

  it('keeps the public @chimmy mode in league chat', () => {
    openChimmy(1)
    fireEvent.click(screen.getByRole('tab', { name: /League/ }))
    fireEvent.change(screen.getByLabelText('League scope'), { target: { value: 'l0' } })
    expect(screen.getByRole('button', { name: /ask the league.*publicly/i })).toBeTruthy()
  })
})
