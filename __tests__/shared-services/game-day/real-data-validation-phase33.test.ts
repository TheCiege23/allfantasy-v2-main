// @vitest-environment node
/**
 * Phase 33 — real execution against .env.test, no mocks. Run with:
 * DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2-) npx vitest run __tests__/shared-services/game-day/real-data-validation-phase33.test.ts
 *
 * This is NOT a unit test with fixtures — it calls the real Game Day OS
 * functions against the real, already-imported Sleeper leagues and real
 * cross-league manager overlap discovered during this phase's SQL audit,
 * and asserts on what is ACTUALLY returned (including honest "unavailable"
 * states), not what we'd like to be returned. Skipped automatically when
 * DATABASE_URL isn't pointed at a real database (prisma.league returns null).
 */
import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { buildLeagueGameDayContext } from '@/lib/shared-services/game-day/GameDayContextAssembler'
import { computeUserPlayerExposure } from '@/lib/shared-services/game-day/UserPlayerExposureService'
import { computeGameWindows } from '@/lib/shared-services/game-day/GameWindowService'

// Real leagues confirmed via direct SQL audit this phase (platform: 'sleeper', genuinely imported).
const REAL_SLEEPER_LEAGUE_IDS = [
  'a6f74157-b569-4dfd-86a6-2231a83d8e0f',
  'e4bb3f31-2ac2-4f24-b67a-1654d1ad5893',
  '02225ffc-926e-47a5-bd76-ff41e8bea83c',
]
// Real AllFantasy userId confirmed (via direct SQL audit) to own real rosters in 2 of the 3 leagues above,
// via a QA/dev-seed platformUserId link (same technique established in Phase 16).
const REAL_CROSS_LEAGUE_USER_ID = '9791bae0-e47f-418a-ae40-285f6a2e7887'

describe('Game Day OS — real .env.test execution (Phase 33)', () => {
  it('computeUserPlayerExposure returns real cross-league exposure for a real manager rostered in 2+ real leagues', async () => {
    const league = await prisma.league.findUnique({ where: { id: REAL_SLEEPER_LEAGUE_IDS[0] } })
    if (!league) {
      console.warn('Skipping: DATABASE_URL is not pointed at the real .env.test database.')
      return
    }

    const result = await computeUserPlayerExposure({ userId: REAL_CROSS_LEAGUE_USER_ID })

    console.log(`[Phase 33 real result] computeUserPlayerExposure: ${result.exposures.length} distinct players, connectedLeagueCount=${result.connectedLeagueCount}`)
    expect(result.connectedLeagueCount).toBeGreaterThanOrEqual(2)
    const multiLeaguePlayers = result.exposures.filter((e) => e.leagueCount >= 2)
    console.log(`[Phase 33 real result] ${multiLeaguePlayers.length} real players rostered in 2+ of this user's leagues`)
  })

  it('buildLeagueGameDayContext against a real Sleeper league honestly reports its real data-availability state', async () => {
    const league = await prisma.league.findUnique({ where: { id: REAL_SLEEPER_LEAGUE_IDS[0] } })
    if (!league) {
      console.warn('Skipping: DATABASE_URL is not pointed at the real .env.test database.')
      return
    }

    const ctx = await buildLeagueGameDayContext({
      leagueId: REAL_SLEEPER_LEAGUE_IDS[0],
      viewerUserId: league.userId,
    })

    console.log('[Phase 33 real result] buildLeagueGameDayContext:', JSON.stringify({ matchupState: ctx.matchupState.state, unavailableReason: ctx.unavailableReason, hasMatchup: ctx.matchup != null, missingDataReason: ctx.matchupState.attribution.missingDataReason }))
    // Real finding this phase: this real league has 0 RedraftMatchup/WeeklyMatchup rows,
    // so we expect an honest non-crashing result, not a fabricated matchup.
    // Phase 34, Track A: this real league also has 0 TeamWeekResult rows -- post-fix,
    // this must be 'unavailable' with a truthful reason, never a fabricated 'bye'.
    expect(ctx.leagueId).toBe(REAL_SLEEPER_LEAGUE_IDS[0])
    expect(ctx.matchupState.state).toBe('unavailable')
    expect(ctx.matchupState.attribution.missingDataReason).toContain('no_team_week_result_for_week')
  })

  it('computeGameWindows against the real (empty) FantasyScheduleGame table returns an honest empty result, not a crash', async () => {
    const league = await prisma.league.findUnique({ where: { id: REAL_SLEEPER_LEAGUE_IDS[0] } })
    if (!league) {
      console.warn('Skipping: DATABASE_URL is not pointed at the real .env.test database.')
      return
    }

    const windows = await computeGameWindows({ sport: 'NFL', season: '2026', week: 4 })
    console.log('[Phase 33 real result] computeGameWindows (real, empty FantasyScheduleGame table):', JSON.stringify(windows))
    // Real finding this phase: FantasyScheduleGame has 0 rows in .env.test.
    expect(windows).toEqual([])
  })
})
