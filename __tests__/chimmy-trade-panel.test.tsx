import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ChimmyTrades } from '@/components/core-app/comms/ChimmyTrades'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
it('loads every proposal page in the selected league and offers a grounded question', async () => {
  const onAsk = vi.fn()
  const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('view=proposals') ? {
    proposals: [{ id: url.includes('cursor=') ? 'two' : 'one', title: url.includes('cursor=') ? 'Second offer' : 'My offer', status: 'proposed', involvesYou: true, assets: ['Player A'], grade: 'B', explanation: 'Balanced under this league scoring.' }],
    nextCursor: url.includes('cursor=') ? null : 'one',
  } : url.includes('view=draft-proposals') ? { proposals: [], nextCursor: null } : { supported: false } }))
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
it('renders draft-pick verdicts and sends their league context to Chimmy', async () => {
  const onAsk = vi.fn()
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('view=draft-proposals') ? {
    proposals: [{ id: 'draft-one', title: 'Alpha → Beta', status: 'pending', involvesYou: true, assets: ['Alpha offers pick 2.01', 'Beta offers pick 4.01'], grade: 'ACCEPT', explanation: 'Receiver-side draft-capital verdict: You receive an earlier pick.' }], nextCursor: null,
  } : url.includes('view=proposals') ? { proposals: [], nextCursor: null } : url.includes('trades-panel') ? { activeTrades: [], historyTrades: [] } : { supported: false } })))
  render(<ChimmyTrades leagueId="league" onAsk={onAsk} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText(/Draft-capital verdict ACCEPT/)
  const draftArticle = screen.getByText('Alpha → Beta').closest('article')!
  fireEvent.click(draftArticle.querySelector('button')!)
  expect(onAsk).toHaveBeenCalledWith(expect.stringContaining("this league's exact draft rules"))
})
it('includes general league offers and processed trade grades with explanations', async () => {
  const offer = { id: 'native', partnerName: 'Rivals', status: 'pending', sent: [{ label: 'Player A' }], received: [{ label: 'Player B' }], viewerIsReceiver: true, decisionCoveragePct: 95, proposalGrade: 'A', decisionRecommendation: 'Improves your starting lineup.' }
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('trades-panel') ? { activeTrades: [offer], historyTrades: [{ ...offer, id: 'done', status: 'processed', currentPricingComplete: true, currentGrade: 'B' }] } : url.includes('view=proposals') ? { proposals: [], nextCursor: null } : { supported: false } })))
  render(<ChimmyTrades leagueId="league" onAsk={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText(/Current proposal grade A/)
  expect(screen.getByText('Improves your starting lineup.')).toBeTruthy()
  expect(screen.getByText(/Current market grade B/)).toBeTruthy()
})
it('withholds letters when trade coverage is incomplete and reports a failed provider scan', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('trades-panel') ? { activeTrades: [{ id: 'thin', partnerName: 'Rivals', sent: [], received: [], proposalGrade: 'A', decisionCoveragePct: 20 }], pending: { scanned: false, reason: 'Provider unavailable' } } : url.includes('view=proposals') ? { proposals: [], nextCursor: null } : { supported: false } })))
  render(<ChimmyTrades leagueId="league" onAsk={() => {}} />)
  fireEvent.click(screen.getByRole('button', { name: /Trade intelligence/ }))
  await screen.findByText('Provider unavailable')
  expect(screen.queryByText(/Current proposal grade A/)).toBeNull()
  expect(screen.getByText(/Verified valuation coverage is incomplete/)).toBeTruthy()
})
