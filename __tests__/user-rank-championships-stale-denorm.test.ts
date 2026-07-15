import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Regression coverage for the championship-count divergence under DENORM STALENESS
 * (AF_DATA_PROVENANCE_AUDIT.md demo risk #6 follow-up).
 *
 * Sibling file `user-rank-championships.test.ts` drives the EARLY response branch
 * (null legacyUserRankCache), where `careerStats` is built straight from the denorm,
 * so both surfaces trivially agree. THIS file drives the FINAL full branch
 * (non-null rankCache + imported League.import_* rows), where `careerStats` is a
 * FRESH per-request recompute that can differ from the persisted denorm:
 *
 *   - dashboard RankingsCard / CareerProgressionStrip read top-level `career*`
 *     (always denorm-preferred), and
 *   - /af-rankings AfRankingsClient reads BOTH `rank.*` and top-level `career*`.
 *
 * Before the fix, `rank.championshipCount` read the FRESH `careerStats.championships`
 * while top-level `careerChampionships` preferred the persisted denorm — so an
 * established user who imported a new title WITHOUT triggering a rank recalc (GET only
 * recalculates when forceRecalculate || rank_calculated_at is null || rank_tier is
 * empty) would momentarily see two different numbers across the two surfaces.
 *
 * The fix routes EVERY cross-referenced career total (championships + wins + losses +
 * playoff appearances + seasons) through ONE denorm-preferred `resolved*` value, so the
 * two surfaces always match. The denorm is the canonical all-source snapshot
 * (calculateAndSaveRank merges Sleeper imports + legacy + native AF leagues), so
 * preferring it also avoids undercounting native/mixed history; the fresh recompute is
 * only ever the fallback when the denorm has never been written.
 *
 * Scenario below: denorm (persisted) says 2 championships; a fresh import shows 3.
 * Post-fix, BOTH surfaces report the consistent denorm value (2), never a 2-vs-3 split.
 */

const RANK_CALC_DATE = new Date('2026-01-01T00:00:00.000Z')

// STALE persisted denorm (snake_case DB columns). These are deliberately DIFFERENT
// from the fresh import compute below so a regression (reading fresh in `rank.*`) shows
// up as a mismatch. Note the DB<->API swap: career_leagues_played -> API seasonsPlayed,
// career_seasons_played -> API leaguesPlayed.
const staleDenormRow = {
  rank_tier: 'Grizzled Vet',
  xp_total: 12345,
  xp_level: 10,
  legacy_career_tier: 3,
  legacy_career_tier_name: 'Veteran',
  legacy_career_level: 10,
  legacy_career_xp: 12345,
  career_wins: 30,
  career_losses: 20,
  career_championships: 2, // stale: one title behind the fresh import compute (3)
  career_playoff_appearances: 4,
  career_seasons_played: 9, // -> API leaguesPlayed
  career_leagues_played: 7, // -> API seasonsPlayed
  rank_calculated_at: RANK_CALC_DATE, // non-null + non-empty tier => GET does NOT recalc
}

// Fresh imported League.import_* rows: 3 distinct seasons, all championships, all made
// playoffs => careerStats.championships = 3, totalWins = 45, totalLosses = 15,
// playoffAppearances = 3, seasonsPlayed = 3, leaguesPlayed = 3.
const importedRows = [2023, 2024, 2025].map((season) => ({
  season,
  import_wins: 15,
  import_losses: 5,
  import_ties: 0,
  import_made_playoffs: true,
  import_won_championship: true,
}))

vi.mock('next-auth', () => ({ getServerSession: vi.fn() }))
vi.mock('@/lib/auth', () => ({ authOptions: {} }))
vi.mock('@/lib/rank/calculateRank', () => ({ calculateAndSaveRank: vi.fn(async () => {}) }))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    // Route the two $queryRaw call sites by SQL content: the denorm select
    // (career_championships), the flags select (league_import_detail_pending), and the
    // imported-rows select (import_wins ... FROM leagues).
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
      const sql = Array.isArray(strings) ? strings.join(' ') : String(strings)
      if (/career_championships/i.test(sql)) return [staleDenormRow]
      if (/league_import_detail_pending/i.test(sql)) {
        return [{ league_import_detail_pending: false, rank_calculated_at: RANK_CALC_DATE }]
      }
      if (/import_wins/i.test(sql)) return importedRows
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
    // NON-null cache -> the final full branch (not the denorm-only early branch), where
    // careerStats is recomputed fresh and can diverge from the persisted denorm.
    legacyUserRankCache: {
      findUnique: vi.fn(async () => ({ careerXp: 5000n, lastCalculatedAt: RANK_CALC_DATE })),
    },
    legacyAIReport: { findFirst: vi.fn(async () => null) },
    legacyLeague: { findMany: vi.fn(async () => []) },
  },
}))

import { GET } from '@/app/api/user/rank/route'
import { getServerSession } from 'next-auth'

function req() {
  return new Request('http://localhost:3000/api/user/rank')
}

describe('GET /api/user/rank — championship count under STALE denorm (provenance #6 follow-up)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(getServerSession).mockResolvedValue({ user: { id: 'user-1' } } as never)
  })

  it('reaches the final full branch (fresh careerStats differs from the stale denorm)', async () => {
    const data = await (await GET(req())).json()
    // Fresh, single-source import compute is still surfaced honestly via careerStats/stats.
    // Its value (3) differing from the converged surfaces below is what proves we exercised
    // the FINAL branch (in the early branch careerStats == denorm, so nothing would diverge).
    expect(data.careerStats.championships).toBe(3)
    expect(data.stats.championships).toBe(3)
    expect(data.imported).toBe(true)
  })

  it('the dashboard field and the /af-rankings field report the SAME championship count', async () => {
    const data = await (await GET(req())).json()
    // (a) dashboard RankingsCard reads data.careerChampionships
    // (b) /af-rankings AfRankingsClient reads data.rank.championshipCount
    expect(data.careerChampionships).toBe(data.rank.championshipCount)
    // ...and both resolve to the canonical persisted denorm (2), NOT the fresh import
    // count (3). This is the assertion that fails on the pre-fix code, where
    // rank.championshipCount read the fresh careerStats (3) while the dashboard read 2.
    expect(data.rank.championshipCount).toBe(2)
    expect(data.careerChampionships).toBe(2)
  })

  it('every cross-referenced career total agrees between rank.* and top-level career*', async () => {
    const data = await (await GET(req())).json()
    // /af-rankings renders BOTH blocks, so each rank.* field must equal its top-level twin.
    expect(data.rank.championshipCount).toBe(data.careerChampionships)
    expect(data.rank.totalWins).toBe(data.careerWins)
    expect(data.rank.totalLosses).toBe(data.careerLosses)
    expect(data.rank.playoffAppearances).toBe(data.careerPlayoffAppearances)
    expect(data.rank.seasonsPlayed).toBe(data.careerSeasonsPlayed)

    // All resolve to the persisted denorm values (option b), including the DB<->API swap
    // (career_leagues_played 7 -> seasonsPlayed; career_seasons_played 9 -> leaguesPlayed).
    expect(data.rank.totalWins).toBe(30)
    expect(data.rank.totalLosses).toBe(20)
    expect(data.rank.playoffAppearances).toBe(4)
    expect(data.rank.seasonsPlayed).toBe(7)
    expect(data.careerLeaguesPlayed).toBe(9)
  })

  it('does not zero out a real persisted denorm value when the fresh compute is narrower', async () => {
    const data = await (await GET(req())).json()
    // The whole point of denorm-preference: a real persisted count is never discarded in
    // favor of a narrower/absent fresh recompute.
    expect(data.careerChampionships).toBeGreaterThan(0)
    expect(data.rank.championshipCount).toBeGreaterThan(0)
  })
})
