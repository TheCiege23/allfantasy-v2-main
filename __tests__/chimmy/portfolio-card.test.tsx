import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ChimmyPortfolioCard } from '@/components/chimmy/ChimmyPortfolioCard'
import type { PortfolioEvidence } from '@/lib/chimmy/portfolio/types'

const evidence: PortfolioEvidence = { version: 1, status: 'partial', intent: 'compare', horizon: 'season', scopeLabel: '2 own teams',
  compared: 1, total: 2, remaining: 0, generatedAt: '2026-11-04T12:00:00Z',
  teams: [{ leagueId: 'a', leagueName: 'KBFL', sport: 'NFL', season: 2026, teamName: 'Tommy', status: 'ready', stale: false,
    lastSyncedAt: '2026-11-04T11:00:00Z', rank: 2, outOf: 12, percentile: 91, weakestPosition: 'RB', gaps: ['One player lacks a value.'],
    metrics: [{ key: 'depth', label: 'Backup coverage', value: 60, detail: '3 of 5 slots have a backup.' }],
    actions: [{ label: 'Find an upgrade', prompt: 'Find me a trade for RB in KBFL' }, { label: 'View roster', href: '/core/my-team?league=a' }] }],
  state: { version: 1, horizon: 'season', orderedLeagueIds: ['a'], focusLeagueId: 'a' },
  methodology: ['The same shared roster ranking as My Team.'], caveats: ['Only readable teams were compared.'], followUps: [] }

afterEach(() => { cleanup(); vi.unstubAllGlobals() })
describe('comparison card', () => {
  it('shows scope, freshness, league-relative strength and partial coverage', () => {
    render(<ChimmyPortfolioCard evidence={evidence} />)
    expect(screen.getByText('Compared 1 of 2 teams')).toBeTruthy()
    expect(screen.getByText('2 of 12')).toBeTruthy()
    expect(screen.getByText(/Partial coverage/)).toBeTruthy()
    expect(screen.getByRole('link', { name: 'View roster' }).getAttribute('href')).toBe('/core/my-team?league=a')
  })
  it('prepares a scoped follow-up without sending or spending', () => {
    const ask = vi.fn(), fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    render(<ChimmyPortfolioCard evidence={evidence} onAsk={ask} />)
    fireEvent.click(screen.getByRole('button', { name: 'Find an upgrade' }))
    expect(ask).toHaveBeenCalledWith('Find me a trade for RB in KBFL', expect.objectContaining({ focusLeagueId: 'a' }))
    expect(fetch).not.toHaveBeenCalled()
  })
  it('refreshes through an authenticated read and retains new scope references', async () => {
    const updated = { ...evidence, compared: 2, status: 'ready' }
    const fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ portfolio: updated }) })
    vi.stubGlobal('fetch', fetch)
    render(<ChimmyPortfolioCard evidence={evidence} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh analysis' }))
    await waitFor(() => expect(screen.getByText('Compared 2 of 2 teams')).toBeTruthy())
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('view=roster-portfolio'), { credentials: 'include', cache: 'no-store' })
  })
  it('keeps the old evidence visible when refresh fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false }))
    render(<ChimmyPortfolioCard evidence={evidence} />)
    fireEvent.click(screen.getByRole('button', { name: 'Refresh analysis' }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain('previous comparison'))
    expect(screen.getByText('Compared 1 of 2 teams')).toBeTruthy()
  })
  it('offers an explicit next pass for unchecked teams', () => {
    const ask = vi.fn()
    render(<ChimmyPortfolioCard evidence={{ ...evidence, remaining: 3 }} onAsk={ask} />)
    fireEvent.click(screen.getByRole('button', { name: /Compare next teams/ }))
    expect(ask).toHaveBeenCalledWith('Compare my remaining teams', evidence.state)
  })
})
