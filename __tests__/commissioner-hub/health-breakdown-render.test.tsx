// @vitest-environment jsdom
/**
 * Commissioner Hub — the streamed health breakdown and the "League at a glance" charts, rendered.
 * The async server components are awaited directly, then their output is rendered.
 */
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { HealthBreakdown, OperationalCharts } from '@/components/core-app/commissioner/HubReports'
import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'
import type { ActivityCharts } from '@/lib/core-app/commissioner/reports'
import type { ActivityRow } from '@/lib/core-app/commissioner/charts'

afterEach(cleanup)

const TEAMS = Array.from({ length: 12 }, (_, i) => ({ name: `Team ${i + 1}`, platformUserId: `u${i + 1}`, claimedByUserId: null }))

function hub(over: Partial<CommissionerHubData> = {}): CommissionerHubData {
  return {
    grant: { teams: TEAMS } as unknown as CommissionerHubData['grant'],
    health: {
      score: { available: true, data: { score: 82, status: 'healthy', summary: 'Healthy', confidencePct: 90 } },
      flags: [
        { key: 'lineups', label: 'Missing lineups', measured: true, severity: 'good', count: 0, headline: '', detail: '', names: [], action: null },
        { key: 'dues', label: 'Unpaid dues', measured: true, severity: 'warn', count: 3, headline: '', detail: '', names: [], action: null },
      ],
    },
    members: {
      available: true,
      data: {
        rows: [
          { name: 'Team 12', status: 'inactive', detail: '', lastActionAt: null },
          { name: 'Team 1', status: 'active', detail: '', lastActionAt: '2026-10-27T09:00:00Z' },
        ],
        total: 2,
        active: 1,
        inactive: 1,
        basis: 'moves',
      },
    },
    charts: { scoring: null, balance: null, engagement: null },
    ...over,
  } as unknown as CommissionerHubData
}

const r = (activityType: string, iso: string, ...keys: string[]): ActivityRow => ({
  activityType,
  occurredAt: new Date(iso),
  managerKeys: keys.map((k) => `sleeper:${k}`),
})

function activity(rows: ActivityRow[]): Promise<ActivityCharts> {
  const managers = TEAMS.map((t) => ({ key: t.platformUserId, name: t.name }))
  return Promise.resolve({
    available: true,
    data: {
      activity: { key: 'activity', title: '', subtitle: '', bars: [], takeaway: null },
      trades: { key: 'trades', title: '', subtitle: '', bars: [], takeaway: null },
      waivers: null,
      newest: rows[0]?.occurredAt.toISOString() ?? null,
      health: {
        weeks: [
          { start: '2026-10-06T00:00:00.000Z', label: 'Oct 6', waiver: 4, trade: 0, fa: 2 },
          { start: '2026-10-13T00:00:00.000Z', label: 'Oct 13', waiver: 3, trade: 1, fa: 1 },
          { start: '2026-10-20T00:00:00.000Z', label: 'Oct 20', waiver: 2, trade: 0, fa: 2 },
          { start: '2026-10-27T00:00:00.000Z', label: 'Oct 27', waiver: 1, trade: 1, fa: 0 },
          { start: '2026-11-03T00:00:00.000Z', label: 'Nov 3', waiver: 0, trade: 0, fa: 1 },
        ],
        mix: [
          { key: 'waiver', value: 10, pct: 59 },
          { key: 'trade', value: 2, pct: 12 },
          { key: 'fa', value: 5, pct: 29 },
        ],
        seasonRows: rows,
        managers,
        waivers: { participants: 9, managers: 12 },
        trades: { participants: 4, managers: 12 },
        chat: { participants: 2, managers: 4 },
        hasMoves: rows.length > 0,
      },
    },
  })
}

describe('health breakdown, streamed', () => {
  it('a fresh league: all five bars, each with its counts', async () => {
    render(await HealthBreakdown({ data: hub(), activity: activity([r('waiver', '2026-10-27T09:00:00Z', 'u1')]) }))
    const values = [...document.querySelectorAll('.af-ch-hb-value')].map((n) => n.textContent)
    expect(values).toEqual(['100', '75', '33', '75', '50'])
    expect(screen.getByText('9 of 12 managers made a claim this season')).toBeTruthy()
    expect(screen.getByText('2 of 4 linked managers posted this week')).toBeTruthy()
  })

  it('a stale import: waiver and trade activity are not measured; chat, read from AllFantasy, still is', async () => {
    const data = hub({ activityStale: { days: 9, reason: 'stale' } } as Partial<CommissionerHubData>)
    render(await HealthBreakdown({ data, activity: activity([]) }))
    const rows = [...document.querySelectorAll('.af-ch-hb-list > li')]
    expect(rows[1].getAttribute('data-measured')).toBe('false')
    expect(rows[1].textContent).toContain('last read 9 days ago')
    expect(rows[2].getAttribute('data-measured')).toBe('false')
    expect(rows[4].getAttribute('data-measured')).toBe('true')
  })

  it('in Spanish', async () => {
    render(await HealthBreakdown({ data: hub(), activity: activity([]), language: 'es' }))
    expect(screen.getByText('Alineaciones completas')).toBeTruthy()
    expect(screen.getByText('9 de 12 equipos pagaron')).toBeTruthy()
  })
})

describe('League at a glance', () => {
  const rows = [
    r('waiver', '2026-10-27T09:00:00Z', 'u1'),
    r('trade', '2026-10-21T09:00:00Z', 'u1', 'u2'),
    r('roster_move', '2026-10-22T09:00:00Z', 'u2'),
  ]

  it('weekly line, range toggle, manager stacks with the inactive flag, table view, and both pies', async () => {
    render(await OperationalCharts({ data: hub(), activity: activity(rows) }))
    const charts = screen.getByTestId('league-health-charts')

    // Weekly: legend totals over the season, then the last four only.
    const weekly = charts.querySelector('[data-chart="weekly"]') as HTMLElement
    expect(within(weekly).getByText('Waiver claims').parentElement!.textContent).toContain('10')
    expect(weekly.querySelectorAll('.af-ch-lh-hit')).toHaveLength(5)
    fireEvent.click(within(weekly).getByRole('button', { name: 'Last 4 weeks' }))
    expect(weekly.querySelectorAll('.af-ch-lh-hit')).toHaveLength(4)
    // Hover readout names the week and all three counts.
    fireEvent.focus(weekly.querySelectorAll('.af-ch-lh-hit')[0])
    expect(within(weekly).getByRole('status').textContent).toContain('Week of Oct 13')

    // Managers: every manager listed, the inactive one flagged, and a table.
    const managers = charts.querySelector('[data-chart="managers"]') as HTMLElement
    expect(managers.querySelectorAll('.af-ch-lh-stack > li')).toHaveLength(12)
    expect(within(managers).getByText('Inactive')).toBeTruthy()
    fireEvent.click(within(managers).getByRole('button', { name: 'Table' }))
    const table = within(managers).getByRole('table')
    expect(within(table).getByRole('columnheader', { name: 'Last active' })).toBeTruthy()
    expect(within(table).getAllByRole('row')).toHaveLength(13)

    // Pies carry their numbers in the legend.
    expect(screen.getByText('Transaction mix')).toBeTruthy()
    expect(screen.getByText('59%')).toBeTruthy()
    expect(screen.getByText('Manager engagement')).toBeTruthy()
    expect(screen.getByText('17 in all')).toBeTruthy()
  })

  it('a stale import: no per-manager judgement and no engagement pie, each saying why', async () => {
    const data = hub({
      activityStale: { days: 9, reason: 'Last read 9 days ago — re-sync.' },
      members: { available: false, reason: 'Last read 9 days ago — re-sync.' },
    } as Partial<CommissionerHubData>)
    render(await OperationalCharts({ data, activity: activity(rows) }))
    const charts = screen.getByTestId('league-health-charts')
    expect(charts.querySelector('.af-ch-lh-stack')).toBeNull()
    expect(within(charts).getAllByText('Last read 9 days ago — re-sync.')).toHaveLength(2)
  })
})
