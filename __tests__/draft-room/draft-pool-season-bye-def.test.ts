import { describe, expect, it, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({ stats: vi.fn(), games: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerSeasonStats: { findMany: mocks.stats },
    sportsGame: { findMany: mocks.games },
  },
}))

import {
  loadRollingInsightsStatsDetailByPlayerIds,
  pickPoolStatSeason,
} from '@/lib/draft/analytics/nfl-rolling-insights-draft-analytics'
import { nflDraftSeasonLine } from '@/lib/draft-room/nflDraftSeasonLine'
import { byeWeekForTeam, loadDraftPoolByeWeekMap } from '@/lib/draft-room/draftPoolByeWeeks'
import {
  buildSleeperPoolStatColumnDefs,
  getDraftStatColumnsForSport,
  getStatValueForDraftPlayer,
} from '@/lib/draft-room/draftSportStatColumns'

const at = (iso: string) => new Date(iso)

/** The production rows behind the report, 2026-11-19 (season, games, rushing). */
const fieldsAndAllen = [
  { playerId: 'fields', season: '2026', gamesPlayed: 2, fantasyPointsPerGame: null, fantasyPoints: null,
    stats: { rushing_attempts: 3, rushing_yards: 0 }, updatedAt: at('2026-11-18T00:00:00Z') },
  { playerId: 'fields', season: '2025', gamesPlayed: 9, fantasyPointsPerGame: 15.6, fantasyPoints: 140.7,
    stats: { rushing_attempts: 71, rushing_yards: 383 }, updatedAt: at('2026-09-11T00:00:00Z') },
  { playerId: 'allen', season: '2026', gamesPlayed: 8, fantasyPointsPerGame: 37.4, fantasyPoints: 299.6,
    stats: { rushing_attempts: 60, rushing_yards: 275 }, updatedAt: at('2026-11-18T00:00:00Z') },
  { playerId: 'allen', season: '2025', gamesPlayed: 17, fantasyPointsPerGame: 22, fantasyPoints: 374,
    stats: { rushing_attempts: 112, rushing_yards: 579 }, updatedAt: at('2026-09-11T00:00:00Z') },
  // Hurt all of 2026: has a 2025 line and nothing this year.
  { playerId: 'hurt', season: '2025', gamesPlayed: 16, fantasyPointsPerGame: 14, fantasyPoints: 224,
    stats: { rushing_attempts: 200, rushing_yards: 900 }, updatedAt: at('2026-09-11T00:00:00Z') },
]

beforeEach(() => {
  mocks.stats.mockReset()
  mocks.games.mockReset()
})

describe('one season for the whole stat column', () => {
  it('picks the newest season once it has genuinely started', () => {
    expect(pickPoolStatSeason(fieldsAndAllen, ['2026', '2025'])).toBe('2026')
  })

  it('stays on last season in a preseason draft, when almost nobody has played yet', () => {
    const preseason = [
      ...Array.from({ length: 20 }, (_, i) => ({ playerId: `p${i}`, season: '2025', gamesPlayed: 17 })),
      { playerId: 'p0', season: '2026', gamesPlayed: 1 },
    ]
    expect(pickPoolStatSeason(preseason, ['2026', '2025'])).toBe('2025')
  })

  it('returns null when no candidate season has games', () => {
    expect(pickPoolStatSeason([{ playerId: 'a', season: '2026', gamesPlayed: 0 }], ['2026', '2025'])).toBeNull()
  })

  it("gives Fields and Allen the SAME season — Fields' 2026, not his 2025", async () => {
    mocks.stats.mockResolvedValue(fieldsAndAllen)
    const out = await loadRollingInsightsStatsDetailByPlayerIds(['fields', 'allen', 'hurt'], {
      candidateSeasons: ['2026', '2025'],
    })
    expect(out.get('fields')?.season).toBe('2026')
    expect(out.get('fields')?.gamesPlayed).toBe(2)
    expect((out.get('fields')?.stats as Record<string, number>).rushing_attempts).toBe(3)
    expect(out.get('allen')?.season).toBe('2026')
    // No 2026 games → no line (em dash), never his 2025 numbers.
    expect(out.has('hurt')).toBe(false)
  })

  it('keeps the old per-player pick when no candidate seasons are given (PPG callers)', async () => {
    mocks.stats.mockResolvedValue(fieldsAndAllen)
    const out = await loadRollingInsightsStatsDetailByPlayerIds(['fields'])
    expect(out.get('fields')?.season).toBe('2025')
  })

  it('refuses a box from the season before the pool season', () => {
    const row = { season: '2025', gamesPlayed: 9, fantasyPointsPerGame: 15.6, fantasyPointsSeason: 140.7,
      updatedAt: new Date(), stats: { rushing_attempts: 71, rushing_yards: 383 } }
    expect(nflDraftSeasonLine(row, undefined, 'QB', 2026, () => 1)).toBeNull()
    expect(nflDraftSeasonLine(row, undefined, 'QB', 2025, () => 1)?.splits.rushing.att).toBe(71)
  })
})

describe('NFL bye weeks', () => {
  it('reads the club through the abbreviation aliases', () => {
    const map = { JAX: 8, WAS: 12, BUF: 7 }
    expect(byeWeekForTeam(map, 'BUF')).toBe(7)
    expect(byeWeekForTeam(map, 'jac')).toBe(8)
    expect(byeWeekForTeam(map, 'WSH')).toBe(12)
  })

  it('says "unknown" (null), never a guess, for a missing club, a free agent or no team', () => {
    const map = { BUF: 7 }
    expect(byeWeekForTeam(map, 'KC')).toBeNull()
    expect(byeWeekForTeam(map, null)).toBeNull()
    expect(byeWeekForTeam(map, '')).toBeNull()
  })

  it('does not look up college byes (school names do not match the schedule yet)', async () => {
    expect(await loadDraftPoolByeWeekMap('NCAAF', 2026)).toEqual({})
    expect(mocks.games).not.toHaveBeenCalled()
  })

  it('returns an empty map when the schedule read fails', async () => {
    mocks.games.mockRejectedValue(new Error('db down'))
    expect(await loadDraftPoolByeWeekMap('NFL', 2026)).toEqual({})
  })
})

describe('team defense and kicker columns', () => {
  it('gives DEF / DST rows team-defense headers, not offense or IDP ones', () => {
    for (const pos of ['DEF', 'DST', 'D/ST']) {
      const keys = buildSleeperPoolStatColumnDefs('NFL', { position: pos }).map((c) => c.key)
      expect(keys).toEqual(['pts', 'avg', 'dst_sack', 'dst_int', 'dst_fr', 'dst_td', 'dst_pa'])
      expect(getDraftStatColumnsForSport('NFL', { position: pos }).map((c) => c.key)).toContain('dst_pa')
    }
  })

  it('still gives a real IDP player (LB) the IDP headers', () => {
    expect(buildSleeperPoolStatColumnDefs('NFL', { position: 'LB' }).map((c) => c.key)).toContain('idp_tkl')
  })

  it('shows a kicker his field goals and extra points from the season box', () => {
    const cols = buildSleeperPoolStatColumnDefs('NFL', { position: 'K' })
    expect(cols.map((c) => c.key)).toEqual(['pts', 'avg', 'fgm', 'xpm'])
    const player = {
      nflDraftProjectionSplits: {
        source: 'rolling_insights_stats' as const, projectedPoints: 98, projectedPointsPerGame: 9.8,
        rushing: { att: null, yds: null, td: null }, receiving: { rec: null, tar: null, yds: null, td: null },
        passing: { cmp: null, att: null, yds: null, td: null, int: null }, kicking: { fg: 21, xpt: 30 },
      },
    }
    expect(getStatValueForDraftPlayer(player, cols.find((c) => c.key === 'fgm')!)).toBe(21)
    expect(getStatValueForDraftPlayer(player, cols.find((c) => c.key === 'xpm')!)).toBe(30)
  })
})
