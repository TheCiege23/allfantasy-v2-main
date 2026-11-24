// @vitest-environment node
/**
 * ESPN NFL per-player week points → `league_player_weekly_scores` (contracts/espn/GAPS.md PS-01), against the
 * committed capture `contracts/espn/fixtures/fantasy-matchup.NFL.2026.week11.json` (week 11, Monday night, all
 * five matchups in progress; redacted, league 123456). Nothing reaches ESPN or a database.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fixture from '../../contracts/espn/fixtures/fantasy-matchup.NFL.2026.week11.json'

const db = vi.hoisted(() => ({
  playerIdentityMap: { findMany: vi.fn(async (_args?: unknown) => [] as unknown[]) },
  leaguePlayerWeeklyScore: {
    findMany: vi.fn(async (_args?: unknown) => [] as unknown[]),
    upsert: vi.fn((args: unknown) => args),
  },
  $transaction: vi.fn(async (ops: unknown[]) => ops),
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/league-sync-core', () => ({ getDecryptedAuth: vi.fn(async () => null) }))

import {
  espnPlayerScoreLeagueKey,
  parseEspnCurrentWeekPlayerScores,
  toSleeperKeyedScores,
} from '@/lib/league-import/espn/espnPlayerWeekScores'
import { writeEspnPlayerWeekScores } from '@/lib/league-import/espn/espnPlayerWeekScoresWriter'

const raw = fixture as any
const STAFFORD_ESPN = 12483
const BECH_SLEEPER = '12483'
/** A stand-in for Stafford's Sleeper id: what matters is that it is the crosswalk's answer, not 12483. */
const STAFFORD_SLEEPER = 'sleeper-stafford'

const weekSides = () =>
  raw.schedule
    .filter((m: any) => m.matchupPeriodId === raw.status.currentMatchupPeriod)
    .flatMap((m: any) => [m.home, m.away])

/** The fixture with Stafford's game started: he is on team 10's BENCH (slot 20) and unlocked in the capture. */
function withStaffordPlayed(points: number) {
  const copy = JSON.parse(JSON.stringify(raw))
  for (const m of copy.schedule) {
    for (const side of [m.home, m.away]) {
      for (const e of side?.rosterForCurrentScoringPeriod?.entries ?? []) {
        if (e.playerId === STAFFORD_ESPN) {
          e.playerPoolEntry.lineupLocked = true
          e.playerPoolEntry.appliedStatTotal = points
        }
      }
    }
  }
  return copy
}

beforeEach(() => {
  db.playerIdentityMap.findMany.mockReset().mockResolvedValue([])
  db.leaguePlayerWeeklyScore.findMany.mockReset().mockResolvedValue([])
  db.leaguePlayerWeeklyScore.upsert.mockClear()
  db.$transaction.mockClear()
})
afterEach(() => vi.restoreAllMocks())

describe('parseEspnCurrentWeekPlayerScores — the week-11 capture', () => {
  const parsed = parseEspnCurrentWeekPlayerScores(raw)

  it('reads all 10 sides of the current week, season 2026 week 11', () => {
    expect(parsed).toMatchObject({ season: 2026, week: 11, sides: 10, reason: null, malformed: 0 })
  })

  it('skips every player whose game had not started — 0 there is not a score', () => {
    const unlocked = weekSides().flatMap((s: any) =>
      s.rosterForCurrentScoringPeriod.entries.filter((e: any) => e.playerPoolEntry.lineupLocked !== true).map((e: any) => String(e.playerId)),
    )
    expect(unlocked.length).toBe(37)
    expect(parsed.unlocked).toBe(37)
    const ids = new Set(parsed.rows.map((r) => r.espnPlayerId))
    for (const id of unlocked) expect(ids.has(id)).toBe(false)
    expect(parsed.rows).toHaveLength(164 - 37)
  })

  it('keeps bench and IR players, with their own points, filed as not starting', () => {
    const bench = parsed.rows.filter((r) => r.lineupSlotId === 20)
    expect(bench.length).toBeGreaterThan(0)
    expect(bench.every((r) => r.isStarter === false)).toBe(true)
    expect(bench.some((r) => r.points > 0)).toBe(true)
    expect(parsed.rows.filter((r) => r.lineupSlotId === 21).every((r) => !r.isStarter)).toBe(true)
  })

  it('each side\'s locked starters sum to the side\'s own total for the week', () => {
    for (const side of weekSides()) {
      const starters = parsed.rows.filter((r) => r.teamId === side.teamId && r.isStarter)
      const sum = starters.reduce((t, r) => t + r.points, 0)
      expect(sum).toBeCloseTo(side.rosterForCurrentScoringPeriod.appliedStatTotal, 6)
    }
  })

  it('reads D/ST under its negative ESPN id, and only once his game started', () => {
    expect(parsed.rows.find((r) => r.espnPlayerId === '-16034')).toMatchObject({ isStarter: true, points: 15 }) // Texans
    expect(parsed.rows.find((r) => r.espnPlayerId === '-16014')).toBeUndefined() // Rams, not played yet
  })

  it('🛑 never reads slots from rosterForMatchupPeriod (every slot there is 0)', () => {
    const stripped = JSON.parse(JSON.stringify(raw))
    for (const m of stripped.schedule) for (const s of [m.home, m.away]) if (s) delete s.rosterForCurrentScoringPeriod
    expect(parseEspnCurrentWeekPlayerScores(stripped)).toMatchObject({ rows: [], reason: 'no-roster-block' })
  })

  it('produces nothing when the matchup period spans another NFL week than the scoring period', () => {
    expect(parseEspnCurrentWeekPlayerScores({ ...raw, scoringPeriodId: 12 })).toMatchObject({ rows: [], reason: 'period-mismatch' })
  })
})

describe('toSleeperKeyedScores — ESPN ids never reach the table', () => {
  const row = (espnPlayerId: string, points = 10) => ({ espnPlayerId, teamId: 1, lineupSlotId: 20, isStarter: false, points })

  it('🛑 ESPN 12483 is Matthew Stafford, not Sleeper 12483 (Jack Bech)', () => {
    const out = toSleeperKeyedScores([row('12483')], new Map([['12483', STAFFORD_SLEEPER]]))
    expect(out.rows.map((r) => r.sleeperId)).toEqual([STAFFORD_SLEEPER])
    expect(out.rows.map((r) => r.sleeperId)).not.toContain(BECH_SLEEPER)
  })

  it('skips an unmapped player and both players of an ambiguous pair, counting them', () => {
    const out = toSleeperKeyedScores([row('1'), row('2'), row('3'), row('4')], new Map([['1', 'A'], ['2', 'B'], ['3', 'B']]))
    expect(out).toMatchObject({ unmapped: 1, ambiguous: 2 })
    expect(out.rows.map((r) => r.sleeperId)).toEqual(['A'])
  })
})

describe('writeEspnPlayerWeekScores — crosswalk, key, upsert', () => {
  it('stores Stafford under his Sleeper id and the Texans D/ST as HOU, keyed espn:<league>, source espn', async () => {
    db.playerIdentityMap.findMany.mockResolvedValue([{ espnId: String(STAFFORD_ESPN), fleaflickerId: null, mflId: null, sleeperId: STAFFORD_SLEEPER }])
    const result = await writeEspnPlayerWeekScores({ platformLeagueId: '123456', season: 2026, raw: withStaffordPlayed(21.46) })
    const upserts = db.leaguePlayerWeeklyScore.upsert.mock.calls.map((c) => c[0] as any)
    const byId = new Map(upserts.map((u) => [u.create.playerId, u.create]))

    expect(byId.get(STAFFORD_SLEEPER)).toEqual({
      leagueId: 'espn:123456', seasonYear: 2026, week: 11, playerId: STAFFORD_SLEEPER,
      rosterId: 10, isStarter: false, points: 21.46, source: 'espn',
    })
    expect(byId.has(BECH_SLEEPER)).toBe(false)
    expect(byId.has(String(STAFFORD_ESPN))).toBe(false)
    expect(byId.get('HOU')).toMatchObject({ isStarter: true, points: 15 })
    expect(byId.has('LAR')).toBe(false) // Rams D/ST: game not started
    // Nothing is stored under an ESPN id: every athlete the mock registry does not bridge is counted, not written.
    for (const id of byId.keys()) expect(Number(id)).toBeNaN()
    expect(result.unmapped).toBeGreaterThan(0)
    expect(result.written).toBe(upserts.length)
    expect(espnPlayerScoreLeagueKey('123456')).toBe('espn:123456')
  })

  it('never overwrites a row another source owns, and skips an unchanged one', async () => {
    db.playerIdentityMap.findMany.mockResolvedValue([])
    db.leaguePlayerWeeklyScore.findMany.mockResolvedValue([
      { playerId: 'HOU', points: 15, isStarter: true, rosterId: 5, source: 'sleeper' },
      { playerId: 'KC', points: 8, isStarter: true, rosterId: 6, source: 'espn' }, // Chiefs D/ST, team 6, 8 points
    ])
    const result = await writeEspnPlayerWeekScores({ platformLeagueId: '123456', season: 2026, raw })
    const written = db.leaguePlayerWeeklyScore.upsert.mock.calls.map((c) => (c[0] as any).create.playerId)
    expect(written).not.toContain('HOU')
    expect(result.foreign).toBe(1)
    expect(written).not.toContain('KC')
    expect(result.unchanged).toBe(1)
    expect(written).toContain('BUF') // Bills D/ST: new, so written
  })

  it('writes nothing for another season than the one read', async () => {
    const result = await writeEspnPlayerWeekScores({ platformLeagueId: '123456', season: 2025, raw })
    expect(result.skipped).toBe('season-mismatch')
    expect(db.$transaction).not.toHaveBeenCalled()
  })
})

describe('the scheduled sync writes from the response it already fetched', () => {
  it('asks for mMatchupScore on the same request and hands that response to the writer', async () => {
    const writer = vi.fn()
    vi.doMock('@/lib/league-import/espn/espnPlayerWeekScoresWriter', () => ({ recordEspnPlayerWeekScores: writer }))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const urls: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      urls.push(url)
      if (url.includes('/communication/')) return new Response('{}', { status: 401, headers: { 'content-type': 'application/json' } })
      if (/\/seasons\/2026\//.test(url)) return new Response(JSON.stringify(raw), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response('{}', { status: 404, headers: { 'content-type': 'application/json' } })
    }))
    try {
      const { fetchEspnLeagueForImport } = await import('@/lib/league-import/espn/EspnLeagueFetchService')
      await fetchEspnLeagueForImport('u1', '2026:123456', { includePreviousSeasons: false })
      await new Promise((r) => setTimeout(r, 20))
      expect(writer).not.toHaveBeenCalled() // opt-in only

      await fetchEspnLeagueForImport('u1', '2026:123456', { includePreviousSeasons: false, recordPlayerWeekScores: true })
      await vi.waitFor(() => expect(writer).toHaveBeenCalledTimes(1))
      expect(writer.mock.calls[0][0]).toMatchObject({ platformLeagueId: '123456', season: 2026 })
      expect(writer.mock.calls[0][0].raw.schedule).toBeDefined()
      const leagueRead = urls.find((u) => u.includes('view=mRoster'))
      expect(leagueRead).toContain('view=mMatchupScore')
    } finally {
      vi.unstubAllGlobals()
      vi.doUnmock('@/lib/league-import/espn/espnPlayerWeekScoresWriter')
    }
  })
})
