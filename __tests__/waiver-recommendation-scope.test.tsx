import React from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import Panel from '@/components/waivers/AIWaiverRecommendationsPanel'
afterEach(() => { cleanup(); vi.unstubAllGlobals() })
const response = (recommendations: unknown) => ({ ok: true, json: async () => ({ ok: true, recommendations }) })
const rec = { addPlayerId: 'p1', addPlayerName: 'League A player', priority: 1, confidence: 'high', risk: 'low', reasoning: 'League A need', tags: [] }
describe('league-scoped waiver suggestions', () => {
  it.each([null, { ...rec, tags: {} }, { ...rec, priority: -1 }, { ...rec, suggestedFaabBid: -1 }, { ...rec, deeperAnalysisPath: '//foreign.test' }])('preserves verified advice when a row is malformed', async malformed => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([rec])).mockResolvedValueOnce(response([malformed])))
    render(<Panel leagueId="A" surface="core" />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    await act(async () => {})
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    await act(async () => {})
    expect(screen.getByText('League A player')).toBeInTheDocument()
    expect(screen.getByTestId('ai-waiver-recommendations-error')).toBeInTheDocument()
  })
  it('clears completed suggestions when changing leagues', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response([rec])))
    const view = render(<Panel leagueId="A" surface="core" />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    await act(async () => {})
    expect(screen.getByText('League A player')).toBeInTheDocument()
    view.rerender(<Panel leagueId="B" surface="core" />)
    expect(screen.queryByText('League A player')).toBeNull()
  })
  it('ignores a late result from the old league and leaves the new league loadable', async () => {
    let resolve!: (value: unknown) => void
    const fetcher = vi.fn().mockImplementationOnce(() => new Promise(yes => { resolve = yes })).mockResolvedValue(response([]))
    vi.stubGlobal('fetch', fetcher)
    const view = render(<Panel leagueId="A" surface="core" />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    view.rerender(<Panel leagueId="B" surface="core" />)
    expect(screen.getByTestId('ai-waiver-recommendations-load')).not.toBeDisabled()
    await act(async () => { resolve(response([rec])) })
    expect(screen.queryByText('League A player')).toBeNull()
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    await act(async () => {})
    expect(JSON.parse(fetcher.mock.calls[1][1].body).leagueId).toBe('B')
  })
  it('keeps verified suggestions when a refresh payload is malformed', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([rec])).mockResolvedValueOnce(response(undefined)))
    render(<Panel leagueId="A" surface="core" />)
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    await act(async () => {})
    fireEvent.click(screen.getByTestId('ai-waiver-recommendations-load'))
    await act(async () => {})
    expect(screen.getByText('League A player')).toBeInTheDocument()
    expect(screen.getByTestId('ai-waiver-recommendations-error')).toBeInTheDocument()
  })
})
