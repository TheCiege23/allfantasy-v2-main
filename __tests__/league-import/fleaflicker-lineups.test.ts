/**
 * @vitest-environment node
 *
 * Fleaflicker lineups — who STARTS, who is on IR, who is on the taxi squad.
 *
 * 🛑 Every Fleaflicker roster used to import with `starter_ids: []`: the only roster read,
 * FetchLeagueRosters, carries composition and no lineup (its `displayGroup` is a position group).
 * The lineup comes from `FetchRoster`, one call per team, whose shape is pinned by the committed
 * capture contracts/fleaflicker/fixtures/roster.NFL.2021.week1.team1371776.json — including the two
 * ways it differs from the vendor docs: `leaguePlayer` is camelCase, and the BENCH group names no
 * `group` at all.
 *
 * No network: `globalThis.fetch` is a URL router.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import { readFleaflickerLineup } from '@/lib/league-import/fleaflicker/fleaflickerLineup'
import { fetchFleaflickerLineups } from '@/lib/league-import/fleaflicker/FleaflickerLeagueFetchService'
import type { FleaflickerRosterResponse } from '@/lib/league-import/fleaflicker/types'

const ROSTER: FleaflickerRosterResponse = JSON.parse(
  readFileSync(
    path.join(process.cwd(), 'contracts/fleaflicker/fixtures/roster.NFL.2021.week1.team1371776.json'),
    'utf8',
  ),
)

const idsIn = (group: string | undefined) =>
  (ROSTER.groups ?? [])
    .filter((g) => g.group === group)
    .flatMap((g) => (g.slots ?? []).map((s) => s.leaguePlayer?.proPlayer?.id))
    .filter((id): id is number => typeof id === 'number')
    .map(String)

describe('readFleaflickerLineup — the committed capture', () => {
  it('reads START as starters, INJURED as reserve, TAXI as taxi', () => {
    const lineup = readFleaflickerLineup(ROSTER)
    expect(lineup).not.toBeNull()
    expect(lineup!.starters).toEqual(idsIn('START'))
    expect(lineup!.starters.length).toBeGreaterThan(0)
    expect(lineup!.reserve).toEqual(idsIn('INJURED'))
    expect(lineup!.taxi).toEqual(idsIn('TAXI'))
  })

  it('never counts the bench — the group with NO `group` key — as a starter', () => {
    const bench = idsIn(undefined)
    expect(bench.length).toBeGreaterThan(0) // the capture really has a group-less bench
    const lineup = readFleaflickerLineup(ROSTER)!
    for (const id of bench) {
      expect(lineup.starters).not.toContain(id)
      expect(lineup.reserve).not.toContain(id)
      expect(lineup.taxi).not.toContain(id)
    }
  })

  it('skips an empty slot (no `leaguePlayer`) instead of writing an empty id', () => {
    const lineup = readFleaflickerLineup({
      groups: [{ group: 'START', slots: [{ position: { label: 'QB' } }, { leaguePlayer: { proPlayer: { id: 14759 } } }] }],
    })
    expect(lineup!.starters).toEqual(['14759'])
  })

  it('an unread lineup is null — "unknown" — never an empty lineup', () => {
    expect(readFleaflickerLineup(null)).toBeNull()
    expect(readFleaflickerLineup({} as FleaflickerRosterResponse)).toBeNull()
  })
})

describe('fetchFleaflickerLineups — one FetchRoster per team, each failing soft on its own', () => {
  const original = globalThis.fetch
  let calls: string[] = []
  beforeEach(() => {
    calls = []
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      calls.push(url)
      if (url.includes('/FetchRoster?') && url.includes('team_id=1')) return new Response(JSON.stringify(ROSTER), { status: 200 })
      if (url.includes('/FetchRoster?')) return new Response('boom', { status: 500 })
      throw new Error(`unrouted ${url}`)
    }) as never
  })
  afterEach(() => {
    globalThis.fetch = original
  })

  it('asks for each team in the served season, and a failed team is null while the rest still read', async () => {
    const out = await fetchFleaflickerLineups('NFL', 206154, 2021, [1, 2, 2])
    expect(calls).toHaveLength(2) // de-duplicated
    for (const url of calls) {
      expect(url).toContain('league_id=206154')
      expect(url).toContain('season=2021')
    }
    expect(readFleaflickerLineup(out['1'])?.starters).toEqual(idsIn('START'))
    expect(out['2']).toBeNull()
  })
})

describe('FleaflickerAdapter — starters reach the normalized roster', () => {
  const team = (id: number) => ({
    id,
    name: `Team ${id}`,
    owners: [{ id: id * 10, displayName: `Owner ${id}` }],
    recordOverall: { wins: 1, losses: 1, ties: 0 },
    pointsFor: { value: 100 },
  })
  const payload = (lineups: Record<string, FleaflickerRosterResponse | null> | undefined) => ({
    sport: 'NFL' as const,
    season: 2021,
    standings: { league: { id: 206154, name: 'Test', size: 2 }, divisions: [{ name: 'E', teams: [team(1), team(2)] }] },
    rosters: {
      rosters: [
        { team: { id: 1 }, players: idsIn('START').map((id) => ({ proPlayer: { id: Number(id) } })) },
        { team: { id: 2 }, players: [{ proPlayer: { id: 99 } }] },
      ],
    },
    ...(lineups ? { lineups } : {}),
  })
  const normalize = async (raw: unknown) => {
    const { FleaflickerAdapter } = await import('@/lib/league-import/adapters/fleaflicker/FleaflickerAdapter')
    return (FleaflickerAdapter as never as {
      normalize: (r: unknown) => Promise<{
        rosters: Array<{ source_team_id: string; starter_ids: string[]; reserve_ids: string[]; taxi_ids: string[] }>
        coverage: Record<string, { state: string; count?: number; note?: string }>
      }>
    }).normalize(raw)
  }

  it('a team with a read lineup gets its starters, IR and taxi; a team without keeps [] and coverage says so', async () => {
    const out = await normalize(payload({ '1': ROSTER, '2': null }))
    const t1 = out.rosters.find((r) => r.source_team_id === '1')!
    const t2 = out.rosters.find((r) => r.source_team_id === '2')!
    expect(t1.starter_ids).toEqual(idsIn('START'))
    expect(t1.reserve_ids).toEqual(idsIn('INJURED'))
    expect(t1.taxi_ids).toEqual(idsIn('TAXI'))
    expect(t2.starter_ids).toEqual([])
    expect(out.coverage.currentRosters).toMatchObject({ state: 'partial', count: 1 })
    expect(out.coverage.currentRosters.note).toContain('1 of 2 teams')
  })

  it('every lineup read → currentRosters is full', async () => {
    const out = await normalize(payload({ '1': ROSTER, '2': ROSTER }))
    expect(out.coverage.currentRosters.state).toBe('full')
  })

  it('CONTROL: a payload with no lineups at all (the old shape) still imports, starters unknown', async () => {
    const out = await normalize(payload(undefined))
    expect(out.rosters.every((r) => r.starter_ids.length === 0)).toBe(true)
    expect(out.coverage.currentRosters.state).toBe('partial')
  })
})
