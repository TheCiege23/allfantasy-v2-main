// @vitest-environment node
/**
 * Phase 34, Track B — real execution against .env.test, no mocks. Run with:
 * DATABASE_URL=$(grep DATABASE_URL .env.test | cut -d= -f2-) npx vitest run __tests__/shared-services/commissioner/real-data-validation-phase34.test.ts
 *
 * This is a real-execution audit, not a fixture unit test — it calls
 * lib/shared-services/commissioner/'s real entry points against real leagues
 * found via this phase's own SQL audit, and reports/asserts on what is
 * ACTUALLY returned. Skipped automatically when DATABASE_URL isn't pointed
 * at a real database.
 */
import { describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { evaluateCommissionerShadow } from '@/lib/shared-services/commissioner/CommissionerShadowService'
import { InMemoryCommissionerShadowResultStore } from '@/lib/shared-services/commissioner/CommissionerShadowResultStore'

// The most active real league found in this phase's SQL audit (84 real RedraftMatchup rows,
// platform: 'manual', a real user-created league with real standings/season data).
const REAL_ACTIVE_LEAGUE_ID = '4a1853d7-f272-4a01-88e8-0230d224f32f'
// A real Sleeper-imported league (platform: 'sleeper'), confirmed real via Phase 30-33's audits.
const REAL_SLEEPER_LEAGUE_ID = 'a6f74157-b569-4dfd-86a6-2231a83d8e0f'

describe('Commissioner OS — real .env.test execution (Phase 34, Track B, audit only)', () => {
  it('evaluateCommissionerShadow executes against a real, active manual-platform league without crashing', async () => {
    const league = await prisma.league.findUnique({ where: { id: REAL_ACTIVE_LEAGUE_ID }, select: { userId: true } })
    if (!league) {
      console.warn('Skipping: DATABASE_URL is not pointed at the real .env.test database.')
      return
    }

    const store = new InMemoryCommissionerShadowResultStore()
    const evaluation = await evaluateCommissionerShadow({ leagueId: REAL_ACTIVE_LEAGUE_ID, requestingUserId: league.userId, resultStore: store })

    console.log('[Phase 34 real result] active league:', JSON.stringify({
      role: evaluation.context.requestingUserRole,
      missionControlAvailable: evaluation.context.missionControl.leagueHealth.available,
      leagueHealthCategory: evaluation.health.category ?? null,
      pulseScore: evaluation.pulse?.compositeScore ?? null,
      attentionItemCount: evaluation.attentionItems.length,
      rankingAvailable: evaluation.ranking != null,
      formatAwareness: evaluation.context.formatAwareness,
      briefSectionCount: evaluation.brief ? Object.keys(evaluation.brief).length : 0,
      divergenceCount: evaluation.divergence.length,
    }))

    expect(evaluation.context.leagueId).toBe(REAL_ACTIVE_LEAGUE_ID)
  })

  it('evaluateCommissionerShadow executes against a real Sleeper-imported league without crashing', async () => {
    const league = await prisma.league.findUnique({ where: { id: REAL_SLEEPER_LEAGUE_ID }, select: { userId: true } })
    if (!league) {
      console.warn('Skipping: DATABASE_URL is not pointed at the real .env.test database.')
      return
    }

    const store = new InMemoryCommissionerShadowResultStore()
    const evaluation = await evaluateCommissionerShadow({ leagueId: REAL_SLEEPER_LEAGUE_ID, requestingUserId: league.userId, resultStore: store })

    console.log('[Phase 34 real result] sleeper league:', JSON.stringify({
      role: evaluation.context.requestingUserRole,
      missionControlAvailable: evaluation.context.missionControl.leagueHealth.available,
      leagueHealthCategory: evaluation.health.category ?? null,
      pulseScore: evaluation.pulse?.compositeScore ?? null,
      attentionItemCount: evaluation.attentionItems.length,
      rankingAvailable: evaluation.ranking != null,
      formatAwareness: evaluation.context.formatAwareness,
    }))

    expect(evaluation.context.leagueId).toBe(REAL_SLEEPER_LEAGUE_ID)
  })
})
