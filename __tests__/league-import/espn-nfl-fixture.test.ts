// @vitest-environment node
/**
 * The ESPN NFL import against a REAL league (contracts/espn/fixtures/fantasy-league.NFL.2026.json:
 * 10 teams, week 9 of 14, redacted). Until this capture the NFL import had only ever been tested
 * against hand-written payloads, and two defects only real data shows were found by it:
 *
 *   - every team imported with rank 0 (ESPN's final rank is 0 until the season ends);
 *   - every unplayed week imported as a 0–0 TIE.
 *
 * `fetch` is stubbed with the fixture; nothing reaches ESPN.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import fixture from '../../contracts/espn/fixtures/fantasy-league.NFL.2026.json'

vi.mock('@/lib/league-sync-core', () => ({ getDecryptedAuth: vi.fn(async () => null) }))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { fetchEspnLeagueForImport } from '@/lib/league-import/espn/EspnLeagueFetchService'
import { EspnAdapter } from '@/lib/league-import/adapters/espn/EspnAdapter'

const raw = fixture as any

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function serve(league: unknown) {
  const urls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      // Measured: the activity feed is 401 AUTH_COMMUNICATION_NOT_VISIBLE without cookies, even public.
      if (url.includes('/communication/')) return json({ messages: ['not authorized'] }, 401)
      if (/\/seasons\/2026\//.test(url)) return json(league)
      return json({ messages: ['not found'] }, 404)
    }),
  )
  return urls
}

async function importFixture(league: unknown = raw) {
  serve(league)
  const payload = await fetchEspnLeagueForImport('u1', '2026:123456', { includePreviousSeasons: false })
  const normalized = await EspnAdapter.normalize(payload)
  return { payload, normalized }
}

beforeEach(() => vi.spyOn(console, 'warn').mockImplementation(() => {}))
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('the fixture is safe to be public', () => {
  it('carries no ESPN member id (SWID) and only synthetic managers and teams', () => {
    const text = readFileSync(path.resolve(__dirname, '../../contracts/espn/fixtures/fantasy-league.NFL.2026.json'), 'utf8')
    expect(text.match(/\{[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}\}/g)).toBeNull()
    expect(raw.members.every((m: any) => /^fixture-manager-\d+$/.test(m.id))).toBe(true)
    expect(raw.teams.every((t: any) => /^Fixture Team \d+$/.test(t.name))).toBe(true)
    expect(raw.settings.name).toBe('Fixture League')
  })
})

describe('ESPN NFL import against a real league', () => {
  it('reads the league, its 10 teams and its settings', async () => {
    const { payload } = await importFixture()
    expect(payload.league).toMatchObject({ size: 10, currentWeek: 9, isFinished: false, playoffTeamCount: 6, regularSeasonLength: 14 })
    expect(payload.teams).toHaveLength(10)
    expect(payload.settings?.lineupSlotCounts.map((s) => `${s.slot}:${s.count}`)).toEqual([
      'QB:1', 'RB:2', 'WR:2', 'TE:1', 'D/ST:1', 'K:1', 'BE:7', 'IR:1', 'FLEX:1',
    ])
  })

  it("ranks teams by ESPN's current seed, never 0 and never the projection", async () => {
    const { payload } = await importFixture()
    const rank = Object.fromEntries(payload.teams.map((t) => [t.teamId, t.rank]))
    // ESPN's playoffSeed per team at week 9. Team 1 is seeded 8th but PROJECTED 9th.
    expect(rank).toEqual({ '1': 8, '2': 10, '3': 4, '4': 9, '5': 7, '6': 2, '7': 6, '8': 1, '9': 5, '10': 3 })
  })

  it('labels every rostered and drafted player with a known position', async () => {
    const { payload } = await importFixture()
    const positions = new Set(payload.teams.flatMap((t) => Object.values(t.playerMap).map((p) => p.position)))
    expect([...positions].sort()).toEqual(['D/ST', 'K', 'QB', 'RB', 'TE', 'WR'])
    expect(payload.draftPicks).toHaveLength(160)
    /*
     * ⚠ KNOWN GAP (GAPS.md D-01): a draft pick carries only a player id, and names/positions come
     * from current rosters. The 17 players drafted and since dropped have neither. Pinned so a fix
     * (or a regression) shows up as a changed number rather than nothing at all.
     */
    const labelled = payload.draftPicks.filter((p) => p.position && p.position !== 'N/A')
    expect(labelled).toHaveLength(143)
    expect(console.warn).not.toHaveBeenCalledWith(expect.stringContaining('unmapped defaultPositionId'))
  })

  it('puts only IR players in reserve, and starters in the lineup', async () => {
    const { payload } = await importFixture()
    expect(payload.teams.map((t) => t.reservePlayerIds.length).reduce((a, b) => a + b, 0)).toBe(3)
    expect(payload.teams.every((t) => t.starterPlayerIds.length === 9)).toBe(true)
  })

  it('records played weeks with their scores, and unplayed weeks with NO score (not a 0-0 tie)', async () => {
    const { normalized } = await importFixture()
    expect(normalized.schedule).toHaveLength(14)
    const week1 = normalized.schedule.find((w) => w.week === 1)!
    expect(week1.matchups).toContainEqual({ roster_id_1: '7', roster_id_2: '6', points_1: 98.7, points_2: 105.26 })
    for (const week of normalized.schedule.filter((w) => w.week >= 9)) {
      for (const m of week.matchups) {
        expect(m.points_1).toBeUndefined()
        expect(m.points_2).toBeUndefined()
      }
    }
    const scored = normalized.schedule.flatMap((w) => w.matchups).filter((m) => m.points_1 != null)
    expect(scored).toHaveLength(40) // weeks 1-8, 5 matchups each
  })

  it("standings records and points against match ESPN's own record", async () => {
    const { normalized } = await importFixture()
    for (const r of normalized.rosters) {
      const team = raw.teams.find((t: any) => String(t.id) === r.source_team_id)
      expect(r.wins).toBe(team.record.overall.wins)
      expect(r.losses).toBe(team.record.overall.losses)
      expect(r.points_against).toBeCloseTo(team.record.overall.pointsAgainst, 2)
    }
  })

  it('says trade history is unavailable rather than empty: the activity feed needs a signed-in account', async () => {
    const { payload, normalized } = await importFixture()
    expect(payload.transactionsFetched).toBe(false)
    expect((normalized as any).coverage.tradeHistory.state).toBe('missing')
  })
})

describe('IDP positions ESPN has not shown us yet', () => {
  it('imports an unknown position as N/A and logs its id once, with a count and no names', async () => {
    const league = JSON.parse(JSON.stringify(raw))
    league.teams[0].roster.entries[0].playerPoolEntry.player.defaultPositionId = 99
    league.teams[1].roster.entries[0].playerPoolEntry.player.defaultPositionId = 99
    const { payload } = await importFixture(league)
    expect(Object.values(payload.teams[0].playerMap).some((p) => p.position === 'N/A')).toBe(true)
    const calls = (console.warn as any).mock.calls.map((c: unknown[]) => String(c[0])).filter((m: string) => m.includes('unmapped defaultPositionId'))
    expect(calls).toEqual([expect.stringContaining('99x2')])
    expect(calls[0]).not.toContain(league.teams[0].roster.entries[0].playerPoolEntry.player.fullName)
  })
})
