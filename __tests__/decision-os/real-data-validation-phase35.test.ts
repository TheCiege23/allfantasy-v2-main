// @vitest-environment node
/**
 * Phase 35, Track B — real execution against .env.test, no mocks. Run with:
 * DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2-) npx vitest run __tests__/decision-os/real-data-validation-phase35.test.ts
 *
 * Real-execution audit (not a fixture unit test) of Manager OS's two composition
 * functions against real leagues/managers found during this phase's own audit.
 * Reports/asserts on what is ACTUALLY returned. Skipped automatically when
 * DATABASE_URL isn't pointed at a real database.
 */
import { describe, expect, it } from 'vitest'

// Module-level guard: importing @/lib/prisma without a DATABASE_URL throws at
// load time, which turned this deliberately-DB-gated audit suite into a hard
// failure in DB-less environments. Skip the whole suite cleanly instead and
// lazy-import the DB-touching modules inside the tests.
const HAS_DB = Boolean(
  process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL,
)
const describeDb = HAS_DB ? describe : describe.skip

const REAL_SLEEPER_LEAGUE_ID = 'a6f74157-b569-4dfd-86a6-2231a83d8e0f'
// Real roster platformUserId (raw Sleeper numeric owner id) confirmed via this session's
// own SQL audits to own a real roster in the league above.
const REAL_SLEEPER_MANAGER_ID = '603671080950886400'
// Real AllFantasy userId confirmed (Phase 33-34) to own real rosters across 8 real leagues.
const REAL_MULTI_LEAGUE_USER_ID = '9791bae0-e47f-418a-ae40-285f6a2e7887'

describeDb('Manager OS — real .env.test execution (Phase 35, Track B, audit only)', () => {
  it('resolveUserOsSnapshot executes against a real Sleeper league/manager without crashing', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { resolveUserOsSnapshot } = await import('@/lib/decision-os/userOs')
    const league = await prisma.league.findUnique({ where: { id: REAL_SLEEPER_LEAGUE_ID } })
    if (!league) {
      console.warn('Skipping: DATABASE_URL is not pointed at the real .env.test database.')
      return
    }

    const snapshot = await resolveUserOsSnapshot(REAL_SLEEPER_LEAGUE_ID, REAL_SLEEPER_MANAGER_ID)

    console.log('[Phase 35 real result] resolveUserOsSnapshot:', JSON.stringify({
      available: snapshot.available,
      reason: snapshot.available ? null : snapshot.reason,
      participationTier: snapshot.available ? snapshot.teamHealth.participationTier : null,
      retentionRisk: snapshot.available ? snapshot.teamHealth.retentionRisk : null,
    }))
    expect(() => snapshot.available).not.toThrow()
  })

  it('resolveManagerCommandCenterSnapshot executes against a real multi-league user without crashing', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { resolveManagerCommandCenterSnapshot } = await import('@/lib/decision-os/managerCommandCenter')
    const rosters = await prisma.roster.findMany({ where: { platformUserId: REAL_MULTI_LEAGUE_USER_ID }, select: { leagueId: true } })
    if (rosters.length === 0) {
      console.warn('Skipping: DATABASE_URL is not pointed at the real .env.test database, or the real fixture user is absent.')
      return
    }
    const leagueIds = [...new Set(rosters.map((r) => r.leagueId))]

    const snapshot = await resolveManagerCommandCenterSnapshot(REAL_MULTI_LEAGUE_USER_ID, leagueIds)

    console.log('[Phase 35/36 real result] resolveManagerCommandCenterSnapshot:', JSON.stringify({
      leagueIdsQueried: leagueIds.length,
      totalLeagues: snapshot.totalLeagues,
      healthyLeagueCount: snapshot.healthyLeagueCount,
      atRiskLeagueCount: snapshot.atRiskLeagueCount,
      insufficientDataLeagueCount: snapshot.insufficientDataLeagueCount,
      unavailableLeagueCount: snapshot.unavailableLeagueCount,
      attentionQueueLength: snapshot.attentionQueue.length,
      recommendationCount: snapshot.recommendations.length,
      warnings: snapshot.warnings,
    }))
    // Phase 36 real validation: before the truthfulness fix, all 8 real leagues were classified
    // at-risk purely from missing activity data. After the fix, only leagues with real relative
    // evidence of disengagement (other managers in the same league DO have activity) count as
    // at-risk; the rest are honestly insufficient_data, not fabricated health or fabricated risk.
    expect(leagueIds.length).toBeGreaterThanOrEqual(2)
    expect(snapshot.atRiskLeagueCount).toBeLessThan(leagueIds.length)
    expect(snapshot.healthyLeagueCount + snapshot.atRiskLeagueCount + snapshot.unavailableLeagueCount + snapshot.insufficientDataLeagueCount).toBe(snapshot.totalLeagues)
  })
})
