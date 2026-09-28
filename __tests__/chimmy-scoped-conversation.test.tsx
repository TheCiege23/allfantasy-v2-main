import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScopedConversation } from '@/components/core-app/comms/useScopedConversation'

beforeEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})
afterEach(() => vi.restoreAllMocks())

/** A reply shaped the way `GET /api/chat/chimmy` returns one. */
function stubFetch(turns: Array<Record<string, unknown>>, ok = true) {
  const fn = vi.fn(async () => ({ ok, json: async () => ({ turns }) }))
  vi.stubGlobal('fetch', fn)
  return fn
}

it('keeps a delayed answer in its originating league', () => {
  const { result, rerender } = renderHook(({ scope }) => useScopedConversation('user-a', scope), { initialProps: { scope: 'league-a' } })
  const answerA = result.current.setTurns
  act(() => result.current.setDraft('My league A question'))
  rerender({ scope: 'league-b' })
  act(() => answerA([{ id: '1', role: 'chimmy', text: 'Answer for A' }]))
  expect(result.current.turns).toEqual([])
  expect(result.current.draft).toBe('')
  rerender({ scope: 'league-a' })
  expect(result.current.turns[0].text).toBe('Answer for A')
  expect(result.current.draft).toBe('My league A question')
})

it('does not overwrite another account storage on account switching', () => {
  const key = 'af:comms:conversations:user-b'
  sessionStorage.setItem(key, JSON.stringify({ league: { turns: [], draft: 'B private draft' } }))
  const { result, rerender } = renderHook(({ owner }) => useScopedConversation(owner, 'league'), { initialProps: { owner: 'user-a' } })
  act(() => result.current.setDraft('A private draft'))
  rerender({ owner: 'user-b' })
  expect(result.current.draft).toBe('B private draft')
  expect(sessionStorage.getItem(key)).not.toContain('A private draft')
})

/*
 * ── 🛑 THE TRANSCRIPT SURVIVES THE TAB ──────────────────────────────────────────────────────
 *
 * Reported as "why isn't my previous conversation showing?". The turns were never lost — the
 * server has written every one to `chat_history` since PROMPT 234 and already feeds them back
 * into the prompt. Only the drawer forgot, because it kept the transcript in `sessionStorage`.
 */
describe('server-side history hydration', () => {
  it('retries a cancelled history load after a quick scope change', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>(resolve => { release = resolve })
    const fetchMock = vi.fn(async () => {
      await gate
      return { ok: true, json: async () => ({ turns: [{ id: 'saved', role: 'chimmy', text: 'Saved answer' }] }) }
    })
    vi.stubGlobal('fetch', fetchMock)
    const { result, rerender } = renderHook(({ scope }) => useScopedConversation('user-a', scope), { initialProps: { scope: 'league-a' } })
    rerender({ scope: 'league-b' })
    rerender({ scope: 'league-a' })
    await act(async () => { release() })
    await waitFor(() => expect(result.current.turns[0]?.text).toBe('Saved answer'))
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
  it('🛑 fills an empty scope from the server, scoped to that league', async () => {
    const fetchMock = stubFetch([
      { id: 'hist-0', role: 'you', text: 'how is my team doing?' },
      { id: 'hist-1', role: 'chimmy', text: 'Here is the read.', grounding: { status: 'ok' } },
    ])

    const { result } = renderHook(() => useScopedConversation('user-a', 'cream-bowl'))

    await waitFor(() => expect(result.current.turns).toHaveLength(2))
    expect(result.current.turns.map((t) => t.text)).toEqual([
      'how is my team doing?',
      'Here is the read.',
    ])
    // The league it asked for is the scope, not a hardcoded default.
    expect(String(fetchMock.mock.calls[0][0])).toContain('leagueId=cream-bowl')
  })

  /*
   * ⚠ THE RACE THIS GUARDS IS THE WHOLE REASON THE CHECK LIVES INSIDE THE SETTER. The fetch is
   * async; a user can ask and be answered before it lands. Deciding "is this scope empty" before
   * awaiting would replace that live exchange with an older snapshot — losing the answer they are
   * currently reading.
   */
  it('🛑 never replaces a live conversation with an older snapshot', async () => {
    let release: (v: unknown) => void = () => {}
    const gate = new Promise((r) => { release = r })
    vi.stubGlobal('fetch', vi.fn(async () => {
      await gate
      return { ok: true, json: async () => ({ turns: [{ id: 'hist-0', role: 'you', text: 'stale' }] }) }
    }))

    const { result } = renderHook(() => useScopedConversation('user-a', 'league-x'))
    // The user asks and is answered while the history request is still in flight.
    await act(async () => { result.current.setTurns([{ id: 'live-0', role: 'you', text: 'live question' }]) })
    await act(async () => { release(null) })

    expect(result.current.turns.map((t) => t.text)).toEqual(['live question'])
  })

  it('leaves the drawer usable when the history read fails', async () => {
    stubFetch([], false)
    const { result } = renderHook(() => useScopedConversation('user-a', 'league-x'))
    await waitFor(() => expect(result.current.turns).toEqual([]))
    await act(async () => { result.current.setTurns([{ id: 'a', role: 'you', text: 'still works' }]) })
    expect(result.current.turns[0].text).toBe('still works')
  })

  it('survives fetch throwing outright', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    const { result } = renderHook(() => useScopedConversation('user-a', 'league-x'))
    await waitFor(() => expect(result.current.turns).toEqual([]))
  })

  it('drops malformed rows rather than rendering them', async () => {
    stubFetch([
      { id: 'hist-0', role: 'you', text: 'kept' },
      { id: 'hist-1', role: 'system', text: 'wrong role' },
      { id: 'hist-2', text: 'no role' },
      { role: 'you', text: 'no id' },
      { id: 'hist-4', role: 'chimmy' },
    ])
    const { result } = renderHook(() => useScopedConversation('user-a', 'league-x'))
    await waitFor(() => expect(result.current.turns).toHaveLength(1))
    expect(result.current.turns[0].text).toBe('kept')
  })

  it('asks once per scope, not once per render', async () => {
    const fetchMock = stubFetch([])
    const { rerender } = renderHook(({ scope }) => useScopedConversation('user-a', scope), {
      initialProps: { scope: 'league-x' },
    })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    rerender({ scope: 'league-x' })
    rerender({ scope: 'league-y' })
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    rerender({ scope: 'league-x' })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not reach for history with no signed-in owner', async () => {
    const fetchMock = stubFetch([])
    renderHook(() => useScopedConversation(undefined, 'league-x'))
    await act(async () => {})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
