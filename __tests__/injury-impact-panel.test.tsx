import React from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'

import { InjuryImpactPanel } from '@/app/dashboard/components/warroom/InjuryImpactPanel'
import type { UserLeague } from '@/app/dashboard/types'

vi.mock('@/components/i18n/LanguageProviderClient', () => ({
  useLanguage: () => ({
    t: (key: string) => key,
    tInterpolate: (key: string, vars: Record<string, string | number> = {}) => {
      const entries = Object.entries(vars)
      return entries.length ? `${key}(${entries.map(([k, v]) => `${k}=${v}`).join(',')})` : key
    },
  }),
}))

const league = { id: 'lg1', name: 'Test League', sport: 'NFL' } as UserLeague

function stubFetch(result: unknown) {
  global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => result }) as unknown as typeof fetch
}

function player(overrides: Record<string, unknown>) {
  return {
    playerKey: 'pk',
    name: 'Player',
    position: 'WR',
    team: 'PHI',
    sport: 'NFL',
    statusRaw: 'Questionable',
    severity: 'questionable',
    source: 'injury_report',
    sourceId: 's1',
    notes: null,
    practice: null,
    gameStatus: null,
    reportDate: null,
    lastUpdated: null,
    onRoster: true,
    isStarter: true,
    headshotUrl: null,
    impactScore: 60,
    lineupDisruption: 0,
    replacementUrgency: 0,
    confidence: 80,
    dataGaps: [],
    ...overrides,
  }
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    analysisMode: 'league',
    analysisScope: 'league',
    leagueName: 'Test League',
    sportLabel: 'NFL',
    leagueSport: 'NFL',
    overallRisk: 40,
    summaryCounts: { outIr: 1, doubtful: 0, questionable: 2, limited: 0, fullPractice: 3 },
    players: [],
    aiNarrative: null,
    chimmyPayload: {},
    dataGaps: [],
    degraded: false,
    computedAt: new Date().toISOString(),
    validation: {},
    feedFreshness: {},
    summaryLine: '',
    dataQuality: 'full',
    integrationHints: {},
    ...overrides,
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe('InjuryImpactPanel (Phase 3.2)', () => {
  it('renders real severity counts, affected starters, impact, and the status as the "why"', async () => {
    stubFetch(
      result({
        players: [
          player({ name: 'A.J. Brown', position: 'WR', team: 'PHI', severity: 'questionable', statusRaw: 'Questionable', impactScore: 72, injuryNewsSummary: 'Limited in practice (hamstring).' }),
          player({ name: 'Bench Guy', position: 'RB', team: 'NYG', isStarter: false, impactScore: 90 }),
        ],
      }),
    )
    const { container } = render(<InjuryImpactPanel league={league} />)

    await waitFor(() => expect(screen.getByText('A.J. Brown', { exact: false })).toBeTruthy())
    // Real severity summary counts render (1 out/IR, 2 questionable).
    expect(container.textContent).toContain('1')
    expect(container.textContent).toContain('2')
    // Impact bar uses the real impactScore.
    expect(container.textContent).toContain('impact(n=72)')
    // The real status/news is surfaced as the "why".
    expect(screen.getByText(/Limited in practice/)).toBeTruthy()
    // A non-starter is excluded from the affected-starters list.
    expect(screen.queryByText(/Bench Guy/)).toBeNull()
  })

  it('shows an honest clean empty state when no starters are affected', async () => {
    stubFetch(result({ summaryCounts: { outIr: 0, doubtful: 0, questionable: 0, limited: 0, fullPractice: 5 }, players: [] }))
    render(<InjuryImpactPanel league={league} />)
    await waitFor(() => expect(screen.getByText('dashboard.warroom.injury.emptyClean')).toBeTruthy())
  })

  describe('X news refresh', () => {
    const twoStartersAndABench = result({
      players: [
        player({ name: 'A.J. Brown', playerKey: 'p1', severity: 'questionable', impactScore: 72 }),
        player({ name: 'Second Starter', playerKey: 'p2', severity: 'doubtful', impactScore: 40 }),
        player({ name: 'Bench Guy', playerKey: 'p3', isStarter: false, impactScore: 99 }),
      ],
    })

    /** Routes by URL so the panel read and the X refresh can answer differently. */
    function stubRoutedFetch(opts: { impact: unknown; refresh?: unknown; refreshOk?: boolean }) {
      const calls: Array<{ url: string; body: Record<string, unknown> | null }> = []
      global.fetch = vi.fn().mockImplementation(async (url: unknown, init?: RequestInit) => {
        const u = String(url)
        calls.push({ url: u, body: init?.body ? JSON.parse(String(init.body)) : null })
        if (u.includes('/api/injury-news/context')) {
          return { ok: opts.refreshOk ?? true, json: async () => opts.refresh }
        }
        return { ok: true, json: async () => opts.impact }
      }) as unknown as typeof fetch
      return calls
    }

    it('asks about exactly the starters on screen, and nobody else', async () => {
      // The money guard at the UI edge: every extra name here is a real bill,
      // so a bench player the panel does not show must never be searched.
      const calls = stubRoutedFetch({
        impact: twoStartersAndABench,
        refresh: { ok: true, refresh: { newRecords: 0, notSearched: [] } },
      })
      render(<InjuryImpactPanel league={league} />)
      await waitFor(() => expect(screen.getByText('A.J. Brown', { exact: false })).toBeTruthy())

      fireEvent.click(screen.getByRole('button'))

      await waitFor(() =>
        expect(calls.some((c) => c.url.includes('/api/injury-news/context'))).toBe(true),
      )
      const refreshCall = calls.find((c) => c.url.includes('/api/injury-news/context'))!
      expect(refreshCall.body?.players).toEqual(['A.J. Brown', 'Second Starter'])
    })

    it('reports a confirmed "no news" rather than implying it found something', async () => {
      stubRoutedFetch({
        impact: twoStartersAndABench,
        refresh: { ok: true, refresh: { newRecords: 0, notSearched: [] } },
      })
      render(<InjuryImpactPanel league={league} />)
      await waitFor(() => expect(screen.getByText('A.J. Brown', { exact: false })).toBeTruthy())

      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => expect(screen.getByText('dashboard.warroom.injury.refreshNone')).toBeTruthy())
    })

    it('keeps the rows it already had when the refresh fails', async () => {
      // Covers 401, 429 and a disabled spend switch alike — a failed lookup must
      // not blank a panel the user is already reading.
      stubRoutedFetch({ impact: twoStartersAndABench, refreshOk: false, refresh: null })
      render(<InjuryImpactPanel league={league} />)
      await waitFor(() => expect(screen.getByText('A.J. Brown', { exact: false })).toBeTruthy())

      fireEvent.click(screen.getByRole('button'))
      await waitFor(() => expect(screen.getByText('dashboard.warroom.injury.refreshFailed')).toBeTruthy())
      expect(screen.getByText('A.J. Brown', { exact: false })).toBeTruthy()
    })

    it('offers no refresh button when there is nobody to ask about', async () => {
      stubFetch(result({ summaryCounts: { outIr: 0, doubtful: 0, questionable: 0, limited: 0, fullPractice: 5 }, players: [] }))
      render(<InjuryImpactPanel league={league} />)
      await waitFor(() => expect(screen.getByText('dashboard.warroom.injury.emptyClean')).toBeTruthy())
      expect(screen.queryByRole('button')).toBeNull()
    })
  })
})
