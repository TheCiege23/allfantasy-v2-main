/** Commissioner "League health" panel on the native league home, after the draft (2026-10-13). */
import React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildLeagueHealth, overdueClaims, unpaidTeams } from '@/lib/league/league-health'
import { LeagueHealthPanel, loadLeagueHealth } from '@/components/league/native/LeagueHealthPanel'

afterEach(() => vi.unstubAllGlobals())
const NOW = '2026-11-10T12:00:00.000Z'
const daysAgo = (d: number) => new Date(new Date(NOW).getTime() - d * 86400000).toISOString()
const ids = (items: { id: string }[]) => items.map((i) => i.id)

describe('the rules', () => {
  it('a healthy league has nothing to show', () => {
    expect(buildLeagueHealth({ claimedSeats: 12, teamCount: 12, now: NOW })).toEqual([])
  })

  it('only the settings that still matter after the draft, never optional ones', () => {
    const items = buildLeagueHealth({
      steps: [
        { id: 'rules', label: 'Roster rules', done: false, panel: 'roster' },
        { id: 'scoring', label: 'Scoring', done: false, panel: 'scoring' },
        { id: 'order', label: 'Draft order', done: false, panel: 'draft' },
        { id: 'date', label: 'Draft date', done: false, optional: true, panel: 'draft' },
      ],
      claimedSeats: 12,
      teamCount: 12,
      now: NOW,
    })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ id: 'settings', detail: 'Roster rules, Scoring', action: { kind: 'settings', panel: 'roster' } })
  })

  it('open seats point at the invite', () => {
    expect(buildLeagueHealth({ claimedSeats: 10, teamCount: 12, now: NOW })[0]).toMatchObject({ id: 'seats', title: '2 seats still open', action: { panel: 'invite' } })
  })

  it('dues: nothing when the tracker is off; per-season for multi-season leagues', () => {
    const teams = [{ id: 'a', teamName: 'A' }, { id: 'b', teamName: 'B' }, { id: 'c', teamName: 'C' }]
    expect(unpaidTeams({ config: { enabled: false, entries: [] }, teams })).toEqual([])
    expect(unpaidTeams({ config: { enabled: true, entries: [{ teamId: 'a', paid: true }, { teamId: 'b', paid: false }] }, teams }).map((t) => t.id)).toEqual(['b', 'c'])
    const dynasty = { config: { enabled: true, entries: [{ teamId: 'a', paid: true, paidSeasons: [2025] }, { teamId: 'b', paid: true, paidSeasons: [2025, 2026] }, { teamId: 'c', paid: true, paidSeasons: [2026] }] }, teams, currentSeason: 2026, isMultiSeason: true }
    expect(unpaidTeams(dynasty).map((t) => t.id)).toEqual(['a'])
  })

  it('trades: review is urgent, a league vote is a heads-up, everything else is ignored', () => {
    const items = buildLeagueHealth({ claimedSeats: 12, teamCount: 12, now: NOW, trades: [{ status: 'awaiting_commissioner' }, { status: 'awaiting_commissioner' }, { status: 'awaiting_votes' }, { status: 'pending' }, { status: 'processed' }] })
    expect(items.map((i) => [i.id, i.title, i.tone])).toEqual([
      ['trades_review', '2 trades need your review', 'danger'],
      ['trades_vote', '1 trade is in a league vote', 'warn'],
    ])
    expect(items[0].action).toEqual({ kind: 'tab', tab: 'trades' })
  })

  it('waivers: only claims pending past the shared overdue line', () => {
    expect(overdueClaims([{ createdAt: daysAgo(8) }, { createdAt: daysAgo(6) }, { createdAt: null }], NOW)).toBe(1)
    expect(buildLeagueHealth({ claimedSeats: 12, teamCount: 12, now: NOW, waiverClaims: [{ createdAt: daysAgo(2) }] })).toEqual([])
    expect(ids(buildLeagueHealth({ claimedSeats: 12, teamCount: 12, now: NOW, waiverClaims: [{ createdAt: daysAgo(9) }] }))).toEqual(['waivers_overdue'])
  })
})

describe('the panel', () => {
  function stub(responses: Record<string, unknown>) {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      calls.push(url)
      const key = Object.keys(responses).find((k) => url.includes(k))
      return key && responses[key] != null ? ({ ok: true, json: async () => responses[key] } as Response) : ({ ok: false, status: 403, json: async () => ({}) } as Response)
    }))
    return calls
  }

  it('reads only the four read-only endpoints — never the ones whose GET writes', async () => {
    const calls = stub({ 'setup/checklist': { steps: [] }, '/dues': null, '/trades': { trades: [] }, '/waivers': { claims: [] } })
    const result = await loadLeagueHealth({ leagueId: 'L 1', claimedSeats: 12, teamCount: 12, now: () => NOW })
    expect(calls.sort()).toEqual([
      '/api/commissioner/leagues/L%201/dues',
      '/api/commissioner/leagues/L%201/waivers?type=pending',
      '/api/leagues/L%201/setup/checklist',
      '/api/leagues/L%201/trades',
    ])
    expect(calls.some((u) => /finance\/summary|integrity|commissioner-queue|ai-commissioner/.test(u))).toBe(false)
    expect(result).toEqual({ items: [], loadedAny: true })
  })

  it('lists what needs you, and each button goes where it is fixed', async () => {
    stub({ 'setup/checklist': { steps: [] }, '/dues': { config: { enabled: true, entries: [] }, teams: [{ id: 'a', teamName: 'Unpaid FC' }] }, '/trades': { trades: [{ status: 'awaiting_commissioner' }] }, '/waivers': { claims: [] } })
    const onOpenSettings = vi.fn()
    const onSelectTab = vi.fn()
    render(<LeagueHealthPanel leagueId="L1" claimedSeats={11} teamCount={12} onOpenSettings={onOpenSettings} onSelectTab={onSelectTab} />)
    expect((await screen.findByTestId('league-health-count')).textContent).toBe('3 things need you')
    fireEvent.click(screen.getByTestId('league-health-seats'))
    fireEvent.click(screen.getByTestId('league-health-dues'))
    fireEvent.click(screen.getByTestId('league-health-trades_review'))
    expect(onOpenSettings.mock.calls.map((c) => c[0])).toEqual(['invite', 'league-dues'])
    expect(onSelectTab).toHaveBeenCalledWith('trades')
    expect(screen.getByTestId('league-health-full').getAttribute('href')).toBe('/core/commissioner?league=L1')
  })

  it('all clear says so', async () => {
    stub({ 'setup/checklist': { steps: [] }, '/dues': null, '/trades': { trades: [] }, '/waivers': { claims: [] } })
    render(<LeagueHealthPanel leagueId="L1" claimedSeats={12} teamCount={12} onOpenSettings={vi.fn()} onSelectTab={vi.fn()} />)
    expect((await screen.findByTestId('league-health-clear')).textContent).toContain('Nothing needs you right now.')
  })

  it('nothing loaded (not the commissioner, offline) shows nothing — never a false all-clear', async () => {
    const calls = stub({})
    render(<LeagueHealthPanel leagueId="L1" claimedSeats={12} teamCount={12} onOpenSettings={vi.fn()} onSelectTab={vi.fn()} />)
    await vi.waitFor(() => expect(calls.length).toBe(4))
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.queryByTestId('league-health')).toBeNull()
  })
})
