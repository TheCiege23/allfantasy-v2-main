import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TradeEvaluator from '@/app/trade-evaluator/page'

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('mode=league') }))
vi.mock('next-auth/react', () => ({ useSession: () => ({ status: 'authenticated', data: { user: { id: 'viewer' } } }) }))
vi.mock('@/components/ai/sim/TradeSimulationStrip', () => ({ TradeSimulationStrip: () => null }))
vi.mock('@/hooks/usePostPurchaseSync', () => ({ usePostPurchaseSync: () => ({ state: { phase: 'idle' } }) }))
vi.mock('@/components/monetization/TradeReviewPurchase', () => ({
  TradeReviewPurchase: () => <button type="button">Run full review</button>,
}))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('grading a trade', () => {
  it('shows the basic verdict using the free engine before revealing the full review', async () => {
    const fetch = vi.fn(async (url: string, _options?: RequestInit) => Response.json(url.startsWith('/api/league/list')
      ? { leagues: [] }
      : { grade: { graded: true, letter: 'B', partnerLetter: 'C', percentDiff: 8 } }))
    vi.stubGlobal('fetch', fetch)

    render(<TradeEvaluator />)
    const [sender, receiver] = screen.getAllByPlaceholderText('Player name')
    fireEvent.change(sender!, { target: { value: 'Player A' } })
    fireEvent.change(receiver!, { target: { value: 'Player B' } })
    expect(screen.queryByRole('button', { name: 'Run full review' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Get free trade verdict' }))
    expect(await screen.findByTestId('trade-free-verdict')).toHaveTextContent('Sender B · Receiver C · 8% value gap')
    expect(screen.getByRole('button', { name: 'Run full review' })).toBeInTheDocument()
    expect(fetch.mock.calls.some(([path]) => path === '/api/trade-evaluator')).toBe(false)
    const request = fetch.mock.calls.find(([path]) => path === '/api/trade-value/analyze')
    expect(JSON.parse(String(request?.[1]?.body))).toMatchObject({
      skipAi: true,
      sideGive: [{ kind: 'player', name: 'Player A' }],
      sideGet: [{ kind: 'player', name: 'Player B' }],
    })
  })
})
