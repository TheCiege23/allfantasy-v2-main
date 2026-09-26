import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useMentionAutocomplete } from '@/lib/chat-core/useMentionAutocomplete'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('ignores an old member search after the writer switches league', async () => {
  vi.useFakeTimers()
  let resolveOld!: (response: unknown) => void
  const old = new Promise(resolve => { resolveOld = resolve })
  const fetchMock = vi.fn().mockReturnValueOnce(old).mockResolvedValue({ ok: true, json: async () => [{ username: 'newmember', displayName: 'New member' }] })
  vi.stubGlobal('fetch', fetchMock)
  const { result, rerender } = renderHook(({ leagueId }) => useMentionAutocomplete({ text: '@m', cursorPos: 2, leagueId, chatType: 'league' }), { initialProps: { leagueId: 'old-league' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  rerender({ leagueId: 'new-league' })
  await act(async () => { await vi.advanceTimersByTimeAsync(200) })
  expect(result.current.suggestions.map(s => s.label)).toContain('@newmember')
  await act(async () => { resolveOld({ ok: true, json: async () => [{ username: 'oldmember', displayName: 'Old member' }] }) })
  expect(result.current.suggestions.map(s => s.label)).not.toContain('@oldmember')
  expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true)
})

it('does not reopen player suggestions after the writer removes the # query', async () => {
  vi.useFakeTimers()
  let release!: (response: unknown) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise(resolve => { release = resolve })))
  const { result, rerender } = renderHook(({ text }) => useMentionAutocomplete({ text, cursorPos: text.length, chatType: 'league' }), { initialProps: { text: '#bi' } })
  await act(async () => { await vi.advanceTimersByTimeAsync(300) })
  rerender({ text: '' })
  await act(async () => { release({ ok: true, json: async () => [{ name: 'Bijan Robinson' }] }) })
  expect(result.current.suggestions).toEqual([])
  expect(result.current.trigger).toBeNull()
})
