import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression coverage for the championship-count mismatch
 * (AF_DATA_PROVENANCE_AUDIT.md demo risk #6).
 *
 * The dashboard RankingsCard reads the top-level `careerChampionships` field; the /af-rankings
 * CareerStats surface reads `rank.championshipCount`. These used to diverge because
 * `rank.championshipCount` read a raw legacy-table-only count while the dashboard read the
 * branch-aware career stats. This drives the real GET handler and asserts BOTH response fields
 * resolve to the same branch-aware championship number for a user with linked history.
 *
 * NOTE (disclosed): in the imported+legacy MAIN branch, `rank.championshipCount` uses the
 * freshly-computed `careerStats.championships` while top-level `careerChampionships` prefers the
 * persisted denorm `career_championships`. They agree whenever the denorm is consistent with the
 * computed stats (the normal, post-rank-recalc state exercised here). Neither reads the raw
 * legacy-only path anymore — that is the fix this test locks in.
 */

const RANK_CALC_DATE = new Date('2026-01-01T00:00:00.000Z')

// Branch-aware merged denorm row (snake_case DB columns) — career_championships = 3 is the
// mixed-history count written by calculateAndSaveRank (Sleeper imports + legacy + native).
const denormRow = {
  rank_tier: 'Grizzled Vet',
  xp_total: 12345,
  xp_level: 10,
  legacy_career_tier: 3,
  legacy_career_tier_name: 'Veteran',
  legacy_career_level: 10,
  legacy_career_xp: 12345,
  career_wins: 40,
  career_losses: 20,
  career_championships: 3,
  career_playoff_appearances: 5,
  career_seasons_played: 6,
  career_leagues_played: 6,
  rank_calculated_at: RANK_CALC_DATE,
}

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/rank/calculateRank', () => ({ calculateAndSaveRank: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    // Both loadProfileRankDenorm (selects career_championships) and loadProfileRankFlags
    // (selects league_import_detail_pending) go through $queryRaw — route by SQL content.
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join(' ') : String(strings)
      if (/career_championships/i.test(sql)) return [denormRow]
      if (/league_import_detail_pending/i.test(sql)) {
        return [{ league_import_detail_pending: false, rank_calculated_at: RANK_CALC_DATE }]
      }
      return []
    }),
    appUser: {
      findUnique: vi.fn(async () => ({
        id: 'user-1',
        legacyUserId: 'legacy-1',
        username: 'testuser',
        displayName: 'Test User',
        legacyUser: { sleeperUsername: 'sleeperTest' },
      })),
    },
    // Null cache -> the no-rankCache branch, which routes both dual fields off the denorm.
    legacyUserRankCache: { findUnique: vi.fn(async () => null) },
  },
}))

import { GET } from '@/app/api/user/rank/route'
import { getServerSession } from 'next-auth'

function req() {
  return new Request('http://localhost:3000/api/user/rank')
}

describe('GET /api/user/rank — championship count (provenance #6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1' } } as never)
  })

  it('401s when unauthenticated', async () => {
    vi.mocked(getServerSession).mockResolvedValueOnce(null as never)
    const res = await GET(req())
    expect(res.status).toBe(401)
  })

  it('the dashboard field and the /af-rankings field report the SAME championship count', async () => {
    const res = await GET(req())
    const data = await res.json()

    // (a) dashboard RankingsCard reads data.careerChampionships
    // (b) /af-rankings CareerStats reads data.rank.championshipCount
    expect(data.careerChampionships).toBe(3)
    expect(data.rank.championshipCount).toBe(3)
    expect(data.careerChampionships).toBe(data.rank.championshipCount)

    // ...and both trace to the single branch-aware source, careerStats.championships.
    expect(data.careerStats.championships).toBe(3)
    expect(data.stats.championships).toBe(3)
    expect(new Set([
      data.careerChampionships,
      data.rank.championshipCount,
      data.careerStats.championships,
      data.stats.championships,
    ]).size).toBe(1)
  })

  it('surfaces the branch-aware denorm count, not a hardcoded zero', async () => {
    const res = await GET(req())
    const data = await res.json()
    expect(data.rank.championshipCount).toBeGreaterThan(0)
    expect(data.careerChampionships).toBeGreaterThan(0)
  })
})
