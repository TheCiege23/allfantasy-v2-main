import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook } from '@testing-library/react'
import { useMentionAutocomplete } from '@/lib/chat-core/useMentionAutocomplete'

const LEAGUES = [
  { id: 'l1', name: 'Dynasty Warriors' },
  { id: 'l2', name: 'Sunday Money' },
]

function setup(text: string, over: Record<string, unknown> = {}) {
  return renderHook(() =>
    useMentionAutocomplete({
      text,
      cursorPos: text.length,
      leagueId: 'l1',
      chatType: 'league',
      leagues: LEAGUES,
      ...over,
    }),
  )
}

/*
 * `waitFor` polls on real timers, which these tests fake — it never advances and
 * simply times out. Draining the debounce inside `act` flushes both the timer
 * and the React state update it causes.
 */
async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(500)
  })
}

function searchCalls() {
  return (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.filter((c) =>
    String(c[0]).includes('players/search'),
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { name: 'Travis Kelce', position: 'TE', team: 'KC', imageUrl: 'https://x/k.png' },
      ],
    }),
  )
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('# autocomplete', () => {
  it('offers nothing when no sigil is open', async () => {
    const { result } = setup('just talking')
    await settle()
    expect(result.current.suggestions).toEqual([])
    expect(result.current.trigger).toBeNull()
  })

  it('matches the writer\u2019s own leagues without a request', async () => {
    const { result } = setup('look at #dyn')
    await settle()

    expect(result.current.trigger).toBe('#')
    expect(result.current.suggestions.some((s) => s.label === 'Dynasty Warriors')).toBe(true)
  })

  it('searches the player catalog and inserts a plain name', async () => {
    const { result } = setup('trading #kelce')
    await settle()

    const player = result.current.suggestions.find((s) => s.type === '#player')
    expect(player?.label).toBe('Travis Kelce')
    /* `#` is a way to find the name, not something the reader should see. */
    expect(player?.value).toBe('Travis Kelce ')
    expect(player?.description).toContain('TE')
  })

  /*
   * The catalog search allows 30 requests a minute per IP and wants at least
   * two characters — a single letter must not spend that budget.
   */
  it('does not search the catalog on one letter', async () => {
    setup('#k')
    await settle()
    expect(searchCalls()).toHaveLength(0)
  })

  it('accepts a player name with a space in it', async () => {
    const { result } = setup('give me #travis kel')
    await settle()
    expect(result.current.trigger).toBe('#')
  })

  /* Without a cap, one `#` would keep the list open for the rest of the message. */
  it('gives up after a few words', async () => {
    const { result } = setup('#one two three four five')
    await settle()
    expect(result.current.trigger).not.toBe('#')
  })

  it('keeps the league matches when the catalog search fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('rate limited')))
    const { result } = setup('#sunday')
    await settle()

    expect(result.current.suggestions.some((s) => s.label === 'Sunday Money')).toBe(true)
  })

  /*
   * `@mahomes` would look like a user mention, and the notifier would go looking
   * for a member by that name and quietly find nobody.
   */
  it('still treats @ as people, not players', async () => {
    const { result } = setup('hey @cas')
    await settle()

    expect(result.current.trigger).toBe('@')
    expect(result.current.suggestions.every((s) => s.type !== '#player')).toBe(true)
    expect(searchCalls()).toHaveLength(0)
  })
})
