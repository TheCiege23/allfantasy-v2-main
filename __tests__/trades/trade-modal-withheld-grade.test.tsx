import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { TradeValueModal } from '@/components/ai-tools/modals/TradeValueModal'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

async function analyze(graded: boolean) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/api/trade-value/analyze')
    ? { ok: true, status: 200, json: async () => ({
      grade: graded ? { graded, letter: 'C', partnerLetter: 'C' } : { graded, reason: 'One asset has no recorded value.' },
      // The canonical memo's second opinion, on a scale of its own. The modal must not print it.
      decisionOs: { grade: 'A', confidence: 80, advantage: 'you', agreesWithConsole: false },
      fairnessScore: graded ? 49 : 100, confidenceScore: 72,
      labels: { fairnessLabel: 'Even', confidenceLabel: 'MEDIUM' },
      players: { give: [], get: [] },
      tradeIntelligence: { fairnessVerdict: 'Even · Confidence 72%.', confidenceScore: 72,
        why: 'Even · Confidence 72%.', whoWinsLongTerm: 'even', whoWinsNow: 'unknown',
        contenderRecommendation: 'Strong Win', rebuilderRecommendation: 'Even',
        rebalanceSuggestions: ['Ask for a star to balance it.'],
      },
      negotiationToolkit: { counters: [{ description: 'Ask for a star to balance it.' }] },
    }) }
    : { ok: false, status: 500, json: async () => ({}) }))
  render(<TradeValueModal open onClose={() => {}} leagues={[]} initialLeagueId="__af_global_trade__" />)
  const inputs = screen.getAllByPlaceholderText('Search player')
  fireEvent.change(inputs[0], { target: { value: 'Kaimon Rucker' } })
  fireEvent.change(inputs[1], { target: { value: 'Jordyn Brooks' } })
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Run analysis', exact: true })) })
}

describe('trade modal withheld grade', () => {
  it('legacy numeric payloads cannot imply fairness, confidence or a balancing counter', async () => {
    await analyze(false)
    expect(screen.getByText('Grade unavailable')).toBeTruthy()
    expect(screen.getByText('One asset has no recorded value.')).toBeTruthy()
    expect(screen.queryByText('100')).toBeNull()
    expect(screen.queryByText('Confidence 72%')).toBeNull()
    expect(screen.queryByText('LOPSIDED')).toBeNull()
    expect(screen.queryByText('Strong Win')).toBeNull()
    expect(screen.queryByText('Ask for a star to balance it.')).toBeNull()
    expect(screen.getByTestId('trade-value-ai-intelligence').textContent).not.toContain('Even')
  })
  it('an authoritative priced result keeps its score and confidence', async () => {
    await analyze(true)
    expect(screen.getByText('49')).toBeTruthy()
    expect(screen.getByText('Confidence 72%')).toBeTruthy()
    expect(screen.queryByText('Grade unavailable')).toBeNull()
  })
  it('shows the ONE grade as a letter, and never the canonical memo second opinion', async () => {
    await analyze(true)
    expect(screen.getByTestId('trade-value-one-grade').textContent).toContain('Your grade C')
    expect(screen.queryByText('Grade A')).toBeNull()
    expect(screen.queryByText(/disagrees with the console/)).toBeNull()
    expect(screen.queryByText('Decision OS')).toBeNull()
  })
  it('a withheld grade shows no letter at all', async () => {
    await analyze(false)
    expect(screen.queryByTestId('trade-value-one-grade')).toBeNull()
  })
})
