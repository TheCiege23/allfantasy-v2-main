/**
 * @vitest-environment node
 *
 * 🛑 ROLLING INSIGHTS SEASON ROWS WERE READ BY NAME, AND A NAME IS SEVERAL PLAYERS.
 *
 * Production, 2026-10-11: 38 NFL names map to 79 RI ids. "Byron Young" is 7859 (LB, LAR) and 7785
 * (DT, PHI), and both careers came back interleaved by season. "Lamar Jackson" is 3416 (QB, BAL)
 * and 5888 — the Falcons CB, whose SEASON rows are nonetheless stamped "QB, BAL" — so the QB's
 * 2020 and 2022 appeared twice. The rows below are those production rows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type SeasonRow = {
  playerName: string
  playerId: string
  season: string
  seasonType: string
  position: string
  team: string
  gamesPlayed: number
  fantasyPoints: number | null
  fantasyPointsPerGame: number | null
  stats: Record<string, number>
}

const db = vi.hoisted(() => ({
  seasonRows: [] as Array<Record<string, unknown>>,
  identities: [] as Array<{ externalId: string; position: string | null; team: string | null }>,
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerSeasonStats: {
      findMany: vi.fn(async (args: { where: { playerName: { equals: string } } }) => {
        const want = args.where.playerName.equals.toLowerCase()
        return db.seasonRows
          .filter((r) => String(r.playerName).toLowerCase() === want)
          // Stable for equal seasons, so a fixture's within-season order (post before regular) holds.
          .sort((a, b) => String(b.season).localeCompare(String(a.season)))
      }),
    },
    sportsPlayer: {
      findMany: vi.fn(async (args: { where: { externalId: { in: string[] } } }) =>
        db.identities.filter((i) => args.where.externalId.in.includes(i.externalId)),
      ),
    },
  },
}))

import { loadRiSeasonRowsForName } from '@/lib/player-comparison-lab/riSeasonRowsByName'
import { GET } from '@/app/api/players/season-stats/route'

const row = (
  playerName: string,
  playerId: string,
  season: string,
  position: string,
  team: string,
  gamesPlayed: number,
  extra: Partial<SeasonRow> = {},
): SeasonRow => ({
  playerName, playerId, season, seasonType: 'regular', position, team, gamesPlayed,
  fantasyPoints: null, fantasyPointsPerGame: null, stats: {}, ...extra,
})

const BYRON = [
  row('Byron Young', '7859', '2026', 'LB', 'LAR', 4),
  row('Byron Young', '7785', '2026', 'DT', 'PHI', 2),
  row('Byron Young', '7785', '2025', 'DT', 'PHI', 14),
  row('Byron Young', '7859', '2025', 'LB', 'LAR', 17),
  row('Byron Young', '7859', '2024', 'LB', 'LAR', 17),
  row('Byron Young', '7785', '2024', 'DT', 'PHI', 17),
  row('Byron Young', '7785', '2023', 'DT', 'PHI', 20),
]
const LAMAR = [
  row('Lamar Jackson', '3416', '2023', 'QB', 'BAL', 16, { fantasyPoints: 356.22 }),
  row('Lamar Jackson', '3416', '2022', 'QB', 'BAL', 12, { fantasyPoints: 254.08 }),
  // RI 5888 is the CB. His season rows carry the QB's labels; his stats are tackles.
  row('Lamar Jackson', '5888', '2022', 'QB', 'BAL', 1, { stats: { tackles: 3 } }),
  row('Lamar Jackson', '3416', '2021', 'QB', 'BAL', 12, { fantasyPoints: 267.98 }),
  row('Lamar Jackson', '5888', '2020', 'QB', 'BAL', 8, { stats: { tackles: 28 } }),
  row('Lamar Jackson', '3416', '2020', 'QB', 'BAL', 14, { fantasyPoints: 636.56 }),
]
const IDENTITIES = [
  { externalId: '3416', position: 'QB', team: 'Baltimore Ravens' },
  { externalId: '5888', position: 'CB', team: 'Atlanta Falcons' },
  { externalId: '7785', position: 'DT', team: 'Philadelphia Eagles' },
  { externalId: '7859', position: 'LB', team: 'Los Angeles Rams' },
]

beforeEach(() => {
  db.seasonRows = [...BYRON, ...LAMAR]
  db.identities = IDENTITIES
})

const load = (name: string, hint: { position?: string; team?: string } = {}) =>
  loadRiSeasonRowsForName({ name, sport: 'NFL', limit: 5, ...hint })

describe('🛑 loadRiSeasonRowsForName binds a shared name to ONE RI id', () => {
  it('refuses a shared name with no verifying hint — no interleaved career', async () => {
    const r = await load('Byron Young')
    expect(r.resolution).toBe('ambiguous')
    expect(r.rows).toEqual([])
    expect(r.rollingInsightsPlayerId).toBeNull()
    expect(r.candidateIds).toBe(2)
  })

  it('position picks the linebacker; every season is his', async () => {
    const r = await load('Byron Young', { position: 'LB' })
    expect(r.rollingInsightsPlayerId).toBe('7859')
    expect(r.rows.map((x) => `${x.playerId}:${x.season}`)).toEqual(['7859:2026', '7859:2025', '7859:2024'])
  })

  it('team picks the tackle, matching an abbreviation against SportsPlayer’s full team name', async () => {
    const r = await load('Byron Young', { team: 'PHI' })
    expect(r.rollingInsightsPlayerId).toBe('7785')
    expect(r.team).toBe('PHI')
    expect(new Set(r.rows.map((x) => x.playerId))).toEqual(new Set(['7785']))
  })

  it('Lamar Jackson: the QB’s seasons appear ONCE each — the CB stamped "QB, BAL" is not him', async () => {
    const r = await load('Lamar Jackson', { position: 'QB', team: 'BAL' })
    expect(r.rollingInsightsPlayerId).toBe('3416')
    expect(r.rows.map((x) => x.season)).toEqual(['2023', '2022', '2021', '2020'])
    expect(r.rows.every((x) => x.playerId === '3416')).toBe(true)
  })

  it('[control] without SportsPlayer identities both ids look like "QB, BAL", so it refuses', async () => {
    db.identities = []
    const r = await load('Lamar Jackson', { position: 'QB', team: 'BAL' })
    expect(r.resolution).toBe('ambiguous')
    expect(r.rows).toEqual([])
  })

  it('one row per season for one id — the regular season wins over a postseason row', async () => {
    db.seasonRows = [
      row('Solo Guy', '1', '2024', 'WR', 'KC', 3, { seasonType: 'post' }),
      row('Solo Guy', '1', '2024', 'WR', 'KC', 17),
      row('Solo Guy', '1', '2023', 'WR', 'KC', 16),
    ]
    const r = await load('Solo Guy')
    expect(r.resolution).toBe('unique_id')
    expect(r.rows.map((x) => `${x.season}:${x.gamesPlayed}`)).toEqual(['2024:17', '2023:16'])
  })
})

describe('🛑 GET /api/players/season-stats', () => {
  const get = (qs: string) => GET(new Request(`http://localhost/api/players/season-stats?${qs}`))

  it('returns no seasons and ambiguous:true for a shared name with no hint', async () => {
    const body = await (await get('name=Byron%20Young&sport=NFL')).json()
    expect(body.ambiguous).toBe(true)
    expect(body.seasons).toEqual([])
  })

  it('binds with position= and returns only that player’s seasons', async () => {
    const body = await (await get('name=Byron%20Young&sport=NFL&position=LB')).json()
    expect(body.ambiguous).toBe(false)
    expect(body.seasons.map((s: { season: string; team: string }) => `${s.season}:${s.team}`)).toEqual([
      '2026:LAR', '2025:LAR', '2024:LAR',
    ])
  })
})
