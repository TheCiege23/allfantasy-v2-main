// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** The admin `update_config` action used to store any string or NaN it was sent; it now uses the editor's rule. */

const m = vi.hoisted(() => ({ evictions: 0, upserts: [] as unknown[] }))

vi.mock('@prisma/client', () => ({ Prisma: { JsonNull: null } }))
vi.mock('@/lib/prisma', () => ({ prisma: { bigBrotherCycle: { count: vi.fn(async () => m.evictions) } } }))
vi.mock('@/lib/big-brother/BigBrotherLeagueConfig', () => ({
  getBigBrotherConfig: async () => ({ configId: 'cfg', juryStartMode: 'after_eliminations', juryStartAfterEliminations: 7, juryStartWhenRemaining: null, juryStartWeek: null }),
  upsertBigBrotherConfig: vi.fn(async (_id: string, input: unknown) => { m.upserts.push(input) }),
}))
vi.mock('@/lib/big-brother/BigBrotherAutomationService', () => ({ runAutomation: vi.fn() }))
vi.mock('@/lib/big-brother/BigBrotherPhaseStateMachine', () => ({ getCurrentCycleForLeague: async () => null, transitionPhase: vi.fn(), createFirstCycleIfNeeded: vi.fn() }))
vi.mock('@/lib/big-brother/BigBrotherNominationEnforcement', () => ({ runAutoNomination: vi.fn() }))
vi.mock('@/lib/big-brother/BigBrotherEvictionService', () => ({ closeEviction: vi.fn() }))
vi.mock('@/lib/big-brother/BigBrotherVoteEngine', () => ({ tallyEvictionVotes: vi.fn() }))
vi.mock('@/lib/big-brother/BigBrotherRosterReleaseEngine', () => ({ releaseEvictedRoster: vi.fn() }))
vi.mock('@/lib/big-brother/bigBrotherGuard', () => ({ getExcludedRosterIds: vi.fn() }))
vi.mock('@/lib/big-brother/BigBrotherAuditLog', () => ({ appendBigBrotherAudit: vi.fn() }))

import { runBigBrotherAdminAction } from '@/lib/big-brother/BigBrotherAdminService'

beforeEach(() => {
  m.evictions = 0
  m.upserts.length = 0
})

describe('admin update_config', () => {
  it('writes a valid change', async () => {
    expect(await runBigBrotherAdminAction({ leagueId: 'lg', action: 'update_config', params: { evictionTieBreakMode: 'hoh_vote' } })).toMatchObject({ ok: true })
    expect(m.upserts).toEqual([{ evictionTieBreakMode: 'hoh_vote' }])
  })

  it('refuses an unknown value, a NaN number and a late finale change, writing nothing', async () => {
    expect(await runBigBrotherAdminAction({ leagueId: 'lg', action: 'update_config', params: { evictionTieBreakMode: 'coin_flip' } })).toMatchObject({ ok: false })
    expect(await runBigBrotherAdminAction({ leagueId: 'lg', action: 'update_config', params: { juryStartWeek: 'soon' } })).toMatchObject({ ok: false })
    m.evictions = 1
    expect(await runBigBrotherAdminAction({ leagueId: 'lg', action: 'update_config', params: { finaleFormat: 'final_3' } })).toMatchObject({ ok: false })
    expect(m.upserts).toEqual([])
  })
})
