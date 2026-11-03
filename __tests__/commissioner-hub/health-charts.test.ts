/**
 * Commissioner Hub — the health breakdown bars and the activity charts' builders
 * (lib/core-app/commissioner/healthCharts.ts). The screen half is in
 * core-commissioner-league-hub.test.tsx and health-breakdown-render.test.tsx.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  engagementMix,
  healthComponents,
  managerActivityRows,
  moveKindOf,
  participation,
  pie3dGeometry,
  transactionMix,
  weeklyActivitySeries,
} from '@/lib/core-app/commissioner/healthCharts'
import type { ActivityRow } from '@/lib/core-app/commissioner/charts'
import type { HealthFlag } from '@/lib/core-app/commissioner/health'
import type { MemberActivityRow } from '@/lib/core-app/commissioner/activity'
import { commissionerHealthChartsMessages } from '@/lib/core-app/messages/commissionerHealthCharts'

const NOW = new Date('2026-10-28T15:00:00Z') // a Wednesday
const SEASON = new Date('2026-08-01T00:00:00Z')
const row = (activityType: string, iso: string, ...keys: string[]): ActivityRow => ({
  activityType,
  occurredAt: new Date(iso),
  managerKeys: keys.map((k) => `sleeper:${k}`),
})
const MANAGERS = [
  { key: 'u1', name: 'Brown Pig Bandits' },
  { key: 'u2', name: 'Gridiron Goons' },
  { key: 'u3', name: 'Kickin’ Knees' },
]
const measured = (key: HealthFlag['key'], count: number): HealthFlag => ({
  key, label: key, measured: true, severity: count ? 'warn' : 'good', count, headline: '', detail: '', names: [], action: null,
})
const unmeasured = (key: HealthFlag['key'], reason: string): HealthFlag => ({ key, label: key, measured: false, reason, action: null })

describe('health components', () => {
  it('lineups and dues are shares of the teams, with the counts behind them', () => {
    const out = healthComponents(
      {
        teamCount: 12,
        flags: [measured('lineups', 2), measured('dues', 3)],
        waivers: { participants: 9, managers: 12 },
        trades: { participants: 4, managers: 12 },
        chat: { participants: 5, managers: 10 },
      },
      'no teams',
    )
    expect(out.map((c) => c.key)).toEqual(['lineups', 'waivers', 'trades', 'dues', 'chat'])
    expect(out.map((c) => c.value)).toEqual([83, 75, 33, 75, 50])
    expect(out[0]).toMatchObject({ part: 10, whole: 12, reason: null })
    expect(out[3]).toMatchObject({ part: 9, whole: 12 })
  })

  it('"not measured" is null with its reason — never zero', () => {
    const out = healthComponents(
      {
        teamCount: 12,
        flags: [unmeasured('lineups', 'MFL stores no lineup'), unmeasured('dues', 'Dues aren’t tracked')],
        waivers: { unmeasured: 'No moves imported' },
        trades: { unmeasured: 'No moves imported' },
        chat: { unmeasured: 'Nobody linked' },
      },
      'no teams',
    )
    for (const c of out) {
      expect(c.value, c.key).toBeNull()
      expect(c.part, c.key).toBeNull()
      expect(c.reason, c.key).toBeTruthy()
    }
    expect(out[0].reason).toBe('MFL stores no lineup')
    expect(out[4].reason).toBe('Nobody linked')
  })

  it('an empty league (no teams) measures nothing, even with flags that say "measured"', () => {
    const out = healthComponents(
      { teamCount: 0, flags: [measured('lineups', 0), measured('dues', 0)], waivers: { participants: 0, managers: 0 }, trades: { participants: 0, managers: 0 }, chat: { unmeasured: 'n/a' } },
      'no teams',
    )
    expect(out.every((c) => c.value === null)).toBe(true)
    expect(out[0].reason).toBe('no teams')
  })

  it('a missing flag is not measured, not a perfect score', () => {
    const [lineups] = healthComponents(
      { teamCount: 12, flags: [], waivers: { participants: 1, managers: 1 }, trades: { participants: 1, managers: 1 }, chat: { participants: 1, managers: 1 } },
      'no teams',
    )
    expect(lineups.value).toBeNull()
  })
})

describe('participation — imported leagues are read from moves, never from WaiverClaim', () => {
  it('counts managers with at least one move of the kind, ignoring unknown keys', () => {
    const rows = [
      row('waiver', '2026-09-10T12:00:00Z', 'u1'),
      row('waiver', '2026-09-11T12:00:00Z', 'u1'),
      row('waiver', '2026-09-12T12:00:00Z', 'someone-who-left'),
      row('trade', '2026-09-13T12:00:00Z', 'u1', 'u2'),
      row('roster_move', '2026-09-14T12:00:00Z', 'u3'),
    ]
    expect(participation(rows, MANAGERS, 'waiver')).toEqual({ participants: 1, managers: 3 })
    expect(participation(rows, MANAGERS, 'trade')).toEqual({ participants: 2, managers: 3 })
    expect(participation(rows, MANAGERS, 'fa')).toEqual({ participants: 1, managers: 3 })
  })

  it('free-agent adds are the imported roster_move rows; draft picks are not a move kind', () => {
    expect(moveKindOf('roster_move')).toBe('fa')
    expect(moveKindOf('draft_pick')).toBeNull()
  })
})

describe('weekly activity series', () => {
  it('one point per fantasy week since the season began, each kind counted apart', () => {
    const rows = [
      row('waiver', '2026-10-27T09:00:00Z', 'u1'), // Tue → this week
      row('roster_move', '2026-10-28T09:00:00Z', 'u2'), // this week
      row('trade', '2026-10-26T20:00:00Z', 'u1', 'u2'), // Monday night → last week
      row('draft_pick', '2026-08-20T00:00:00Z', 'u1'), // not plotted
    ]
    const weeks = weeklyActivitySeries(rows, NOW, SEASON)
    expect(weeks.length).toBe(14) // Jul 28 week … Oct 27 week
    const last = weeks.at(-1)!
    expect(last).toMatchObject({ waiver: 1, fa: 1, trade: 0 })
    expect(weeks.at(-2)).toMatchObject({ trade: 1, waiver: 0, fa: 0 })
    expect(weeks.reduce((n, w) => n + w.waiver + w.trade + w.fa, 0)).toBe(3)
    expect(new Date(last.start).getUTCDay()).toBe(2) // weeks turn over on Tuesday
  })

  it('at least four weeks before a season starts, at most eighteen late in one', () => {
    expect(weeklyActivitySeries([], new Date('2026-08-02T00:00:00Z'), SEASON).length).toBe(4)
    expect(weeklyActivitySeries([], new Date('2027-01-30T00:00:00Z'), SEASON).length).toBe(18)
  })
})

describe('manager activity rows', () => {
  const members: MemberActivityRow[] = [
    { name: 'Kickin’ Knees', status: 'inactive', detail: '', lastActionAt: null },
    { name: 'Brown Pig Bandits', status: 'active', detail: '', lastActionAt: '2026-10-27T09:00:00Z' },
  ]

  it('every manager is listed — the ones with no moves are the point — most moves first', () => {
    const rows = [
      row('waiver', '2026-10-01T00:00:00Z', 'u1'),
      row('trade', '2026-10-02T00:00:00Z', 'u1', 'u2'),
      row('roster_move', '2026-10-03T00:00:00Z', 'u2'),
      row('roster_move', '2026-10-04T00:00:00Z', 'u2'),
    ]
    const out = managerActivityRows(rows, MANAGERS, members)
    expect(out.map((r) => r.name)).toEqual(['Gridiron Goons', 'Brown Pig Bandits', 'Kickin’ Knees'])
    expect(out[0]).toMatchObject({ waiver: 0, trade: 1, fa: 2, total: 3, status: null })
    // A trade counts once for each manager in it.
    expect(out[1]).toMatchObject({ waiver: 1, trade: 1, fa: 0, status: 'active', lastActionAt: '2026-10-27T09:00:00Z' })
    expect(out[2]).toMatchObject({ total: 0, status: 'inactive' })
  })

  it('a stale or unread league passes no members, so nobody is flagged inactive on stale data', () => {
    const out = managerActivityRows([], MANAGERS, null)
    expect(out.every((r) => r.status === null)).toBe(true)
  })
})

describe('pies', () => {
  it('transaction mix: counts by kind, percentages that add to exactly 100', () => {
    const rows = [
      ...Array.from({ length: 150 }, (_, i) => row('waiver', `2026-09-0${(i % 9) + 1}T00:00:00Z`, 'u1')),
      ...Array.from({ length: 15 }, () => row('trade', '2026-09-10T00:00:00Z', 'u1', 'u2')),
      ...Array.from({ length: 86 }, () => row('roster_move', '2026-09-11T00:00:00Z', 'u3')),
    ]
    const mix = transactionMix(rows)
    expect(mix.map((s) => [s.key, s.value])).toEqual([['waiver', 150], ['trade', 15], ['fa', 86]])
    expect(mix.reduce((n, s) => n + s.pct, 0)).toBe(100)
  })

  it('no moves → no slices, so the pie says so instead of drawing an empty circle', () => {
    expect(transactionMix([])).toEqual([])
  })

  it('engagement: active, slowing, inactive — and unknown only when there are some', () => {
    const m = (status: MemberActivityRow['status']): MemberActivityRow => ({ name: status, status, detail: '', lastActionAt: null })
    expect(engagementMix([m('active'), m('active'), m('at_risk'), m('inactive')]).map((s) => s.key)).toEqual(['active', 'at_risk', 'inactive'])
    expect(engagementMix([m('active'), m('unknown')]).map((s) => s.key)).toEqual(['active', 'at_risk', 'inactive', 'unknown'])
    expect(engagementMix([m('active'), m('active'), m('inactive')]).reduce((n, s) => n + s.pct, 0)).toBe(100)
  })

  it('3D geometry: a top per slice, a wall only for slices that face the reader', () => {
    const geo = pie3dGeometry([1, 1, 1, 1])
    expect(geo.every((g) => g.top.startsWith('M '))).toBe(true)
    // Slices start at 12 o'clock and run clockwise: the first (12→3) faces away, the second and third face the reader.
    expect(geo[0].side).toBe('')
    expect(geo[1].side).not.toBe('')
    expect(geo[2].side).not.toBe('')
  })

  it('3D geometry: one slice is a full ellipse, a zero slice draws nothing', () => {
    const [only, zero] = pie3dGeometry([5, 0])
    expect(only.top).toContain(' A ')
    expect(only.side).not.toBe('')
    expect(zero).toEqual({ top: '', side: '' })
  })
})

describe('copy and colour', () => {
  it('every English string has Spanish', () => {
    const en = Object.keys(commissionerHealthChartsMessages.en)
    const es = Object.keys(commissionerHealthChartsMessages.es ?? {})
    expect(en.filter((k) => !es.includes(k))).toEqual([])
  })

  it('the chart series tokens exist for the dark base and for light (AF inherits the dark ones)', () => {
    const css = readFileSync(resolve(process.cwd(), 'components/core-app/af-core.css'), 'utf8')
    for (const slot of ['1', '2', '3', '4']) {
      expect(css.match(new RegExp(`--chart-${slot}:`, 'g'))?.length, slot).toBe(2)
    }
    const hub = readFileSync(resolve(process.cwd(), 'components/core-app/af-commish-hub.css'), 'utf8')
    expect(hub).toContain('.af-ch-lh')
  })
})
