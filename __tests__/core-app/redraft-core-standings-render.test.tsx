/**
 * Batch B6, render half: the two markup additions carry only proven data.
 *  - the standings zone chip's `data-race` comes from the board's own proof, on the real computed fixture;
 *  - the Commissioner health panel's wrapper carries `--rdc-health` only when the engine score exists.
 * Neither changes layout or text for any league (the attribute styles nothing outside the redraft shell,
 * and the wrapper is `display: contents`).
 */
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render } from '@testing-library/react'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/lib/core-app/commissioner/reports', () => ({
  loadAuditTimeline: () => Promise.resolve({ available: true, data: [] }),
  loadActivityCharts: () => Promise.resolve({ available: false, reason: 'n/a' }),
}))
vi.mock('@/components/core-app/commissioner/HubReports', () => ({
  OperationalCharts: () => null,
  ChartsFallback: () => null,
  RecentChanges: () => null,
  RecentChangesFallback: () => null,
  AuditTimeline: () => null,
  AuditTimelineFallback: () => null,
}))
vi.mock('@/components/commish/BroadcastModal', () => ({ default: () => null }))
vi.mock('@/components/core-app/commissioner/GuidedWorkflows', () => ({ GuidedWorkflows: () => null }))
vi.mock('@/components/core-app/commissioner/AutomationRecipes', () => ({ AutomationRecipes: () => null }))
vi.mock('@/components/core-app/PublishStandingsToggle', () => ({ PublishStandingsToggle: () => null }))

import { StandingsBoardView } from '@/components/core-app/standings/StandingsBoardView'
import { CommissionerHub } from '@/components/core-app/screens/CommissionerHub'
import { DEFAULT_STANDINGS_VIEW } from '@/lib/core-app/standingsView'
import { redraftRaceTag } from '@/lib/core-app/redraftCoreRace'
import { harnessCommissioner, harnessStandings } from '@/app/e2e/redraft-core/standings/fixtures'

beforeEach(() => {
  window.history.replaceState(null, '', '/core/standings?league=L1')
  window.localStorage.clear()
  // The hub's client islands fetch on mount; nothing here should reach a network.
  vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response('{}', { status: 404 }))))
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('standings zone chip — data-race only where the board proved it', () => {
  it('tags exactly the proven teams on the real computed board, and no positional zone', () => {
    const d = harnessStandings()
    if (!d.available) throw new Error('fixture unavailable')
    const { container } = render(<StandingsBoardView board={d.board} initial={{ ...DEFAULT_STANDINGS_VIEW, layout: 'table' }} odds={null} />)
    const rows = [...container.querySelectorAll('[aria-label="League table"] tbody tr[data-zone]')]
    expect(rows).toHaveLength(d.board.teams.length)
    const seen = rows.map((r) => r.querySelector('.af-stb-zone')?.getAttribute('data-race') ?? null)
    const expected = d.board.teams.map((t) => redraftRaceTag(t))
    expect(seen).toEqual(expected)
    // Mixed on purpose: settled at both ends, the race still open in the middle.
    expect(seen).toContain('clinched-bye')
    expect(seen).toContain('eliminated')
    expect(seen.filter((s) => s == null).length).toBeGreaterThan(2)
  })

  it('mutation control: forging a clinch onto every team shows up as a tag on every row', () => {
    const d = harnessStandings()
    if (!d.available) throw new Error('fixture unavailable')
    const forged = { ...d.board, teams: d.board.teams.map((t) => ({ ...t, clinched: 'playoff' as const })) }
    const { container } = render(<StandingsBoardView board={forged} initial={{ ...DEFAULT_STANDINGS_VIEW, layout: 'table' }} odds={null} />)
    const tags = [...container.querySelectorAll('[aria-label="League table"] tbody tr[data-zone] .af-stb-zone')].map((c) => c.getAttribute('data-race'))
    expect(tags.every((t) => t === 'clinched')).toBe(true)
  })

  it('draws no odds column at all without a simulation (odds presence)', () => {
    const d = harnessStandings()
    if (!d.available) throw new Error('fixture unavailable')
    const { container } = render(<StandingsBoardView board={d.board} initial={{ ...DEFAULT_STANDINGS_VIEW, layout: 'table' }} odds={null} />)
    expect(container.querySelector('.af-stb-oddsbar')).toBeNull()
  })
})

describe('commissioner health ring — only from a real engine score', () => {
  it('carries the score as --rdc-health when the engine score is available', () => {
    const { container } = render(<CommissionerHub data={harnessCommissioner(true)} />)
    const wrap = container.querySelector('.af-rdc-health') as HTMLElement
    expect(wrap).toBeTruthy()
    expect(wrap.getAttribute('data-ring')).toBe('true')
    expect(wrap.style.getPropertyValue('--rdc-health')).toBe('84')
    expect(wrap.style.display).toBe('contents')
    expect(wrap.querySelector('.af-ch-health-score[data-available="true"]')).toBeTruthy()
  })

  it('carries nothing when the score is unavailable — the panel keeps its "—" and reason', () => {
    const { container } = render(<CommissionerHub data={harnessCommissioner(false)} />)
    const wrap = container.querySelector('.af-rdc-health') as HTMLElement
    expect(wrap.getAttribute('data-ring')).toBeNull()
    expect(wrap.style.getPropertyValue('--rdc-health')).toBe('')
    expect(wrap.style.display).toBe('contents')
    expect(wrap.querySelector('.af-ch-health-num')?.textContent).toBe('—')
  })
})
