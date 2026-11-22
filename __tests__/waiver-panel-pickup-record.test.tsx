/**
 * The waiver panel shows how its #1 pickup has done (the learning loop, re-score build item 7): the advice
 * ledger's platform-wide rate, beside the list it grades — only for an NFL list, and only once a rate is earned.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'

import AIWaiverRecommendationsPanel from '@/components/waivers/AIWaiverRecommendationsPanel'
import { __resetAdviceRecordForTests } from '@/components/core-app/useAdviceRecord'

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

const REC = {
  addPlayerId: 'p-add', addPlayerName: 'Harbor Runner', dropPlayerId: null, dropPlayerName: null, priority: 1,
  suggestedFaabBid: null, confidence: 'high', risk: 'low', reasoning: 'Room in the flex.', tags: [], deeperAnalysisPath: '/chimmy',
}
const RECORD = (ratePct: number | null, graded: number) => ({
  season: 2026, bench: null, trades: null,
  pickups: { you: null, everyone: { graded, startable: 18, ratePct, vsDrop: 0, beatDrop: 0 } },
})

let urls: string[] = []
function stub(sport: string, record: unknown) {
  urls = []
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input)
    urls.push(url)
    if (url.includes('/api/ai/waivers/recommend')) {
      return json({ ok: true, generatedAt: '2026-11-19T12:00:00.000Z', recommendations: [REC], leagueContext: { leagueId: 'L1', sport } })
    }
    if (url === '/api/advice-record') return json({ record })
    return json({})
  }))
}

beforeEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  __resetAdviceRecordForTests()
})

describe('AIWaiverRecommendationsPanel — the #1 pickup record', () => {
  it('an NFL list says how the #1 pickup has done across everyone', async () => {
    stub('NFL', RECORD(45, 40))
    render(<AIWaiverRecommendationsPanel leagueId="L1" surface="core" />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    const line = await screen.findByTestId('ai-waiver-recommendations-record')
    expect(line.textContent).toBe(
      'How this panel’s #1 pickup has done this season: 45% averaged 10+ PPR a week over the next three weeks (40 graded).',
    )
  })

  it('no line before a rate is earned', async () => {
    stub('NFL', RECORD(null, 12))
    render(<AIWaiverRecommendationsPanel leagueId="L1" />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    await screen.findByTestId('ai-waiver-recommendation-1')
    await waitFor(() => expect(urls).toContain('/api/advice-record'))
    expect(screen.queryByTestId('ai-waiver-recommendations-record')).toBeNull()
  })

  it('another sport never asks — the ledger grades NFL pickups only', async () => {
    stub('NBA', RECORD(45, 40))
    render(<AIWaiverRecommendationsPanel leagueId="L1" />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    await screen.findByTestId('ai-waiver-recommendation-1')
    expect(urls).not.toContain('/api/advice-record')
    expect(screen.queryByTestId('ai-waiver-recommendations-record')).toBeNull()
  })
})
