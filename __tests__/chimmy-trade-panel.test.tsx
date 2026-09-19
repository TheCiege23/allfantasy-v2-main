import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChimmyTrades } from '@/components/core-app/comms/ChimmyTrades'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('loads every proposal page in the selected league and offers a grounded question', async () => {
  const onAsk = vi.fn()
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('view=proposals') ? {
    proposals: [{ id: url.includes('cursor=') ? 'two' : 'one', title: url.includes('cursor=') ? 'Second offer' : 'My offer', status: 'proposed', involvesYou: true, assets: ['Player A'], grade: 'B', explanation: 'Balanced under this league scoring.' }],
    nextCursor: url.includes('cursor=') ? null : 'one',
  } : { supported: false } }))
  vi.stubGlobal('fetch', fetcher)
  render(<ChimmyTrades leagueId="selected-league" onAsk={onAsk} />)
  expect(fetcher).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText('Second offer')
  expect(fetcher.mock.calls.every(([url]) => url.includes('leagueId=selected-league'))).toBe(true)
  fireEvent.click(screen.getAllByRole('button', { name: 'Ask Chimmy' })[0])
  expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("this league's rules"))
})
it('aborts the old league request when its panel unmounts', async () => {
  let signal: AbortSignal | undefined
  vi.stubGlobal('fetch', vi.fn((_url, options) => { signal = options.signal; return new Promise(() => {}) }))
  const { unmount } = render(<ChimmyTrades leagueId="old-league" onAsk={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await waitFor(() => expect(signal).toBeDefined())
  unmount()
  expect(signal!.aborted).toBe(true)
})
