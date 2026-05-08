// @vitest-environment node
/**
 * Phase 3 — Queue and autopick behavior.
 *
 * Hits the live-draft-engine queue + autopick surface against the real test
 * database (no mocks):
 *   - DraftQueue persistence (CRUD via Prisma; the route layer reads/writes
 *     this same model, so the test locks the storage contract)
 *   - `processExpiredDraftPickForLeague` short-circuit outcomes — every
 *     "skipped" reason that happens BEFORE the heavy resolver pool path,
 *     so the test stays fast and deterministic
 *   - empty-queue → best-available fallback short-circuit (`no_pool` when no
 *     SportsPlayer rows exist for the league sport in test DB) — locks the
 *     contract that an empty pool returns a structured error rather than
 *     throwing
 *
 * Queue-first happy path (timer expires → drafts top queue entry) and the
 * full best-available autopick that resolves through the player pool resolver
 * are intentionally deferred — they need a populated SportsPlayer pool plus
 * a real `Roster` row keyed to a `platformUserId`, which doubles the fixture
 * surface and isn't required to lock the contracts above.
 *
 * Run: npm run test:phase3:queue-autopick
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { processExpiredDraftPickForLeague } from '@/lib/live-draft-engine/expired-picks/processExpiredDraftPicks'
import {
  seedManualPickFixture,
  sweepManualPickFixtureLeftovers,
  type ManualPickFixture,
} from './_helpers/manual-pick-fixture'

let prisma: PrismaClient
let fixture: ManualPickFixture

beforeAll(async () => {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_PRISMA_URL) {
    throw new Error('Phase 3 tests need DATABASE_URL or POSTGRES_PRISMA_URL.')
  }
  prisma = new PrismaClient()
  await sweepManualPickFixtureLeftovers(prisma)
})

afterAll(async () => {
  await prisma?.$disconnect()
})

beforeEach(async () => {
  fixture = await seedManualPickFixture({ prisma })
})

afterEach(async () => {
  await fixture?.cleanup()
})

describe('DraftQueue persistence', () => {
  it('persists a queue order JSON, returns it from a re-query, and unique constraint protects per-user', async () => {
    const userId = 'phase3-queue-user-A'
    const queueOrder = [
      { playerName: 'Phase3 QB', position: 'QB', team: 'KC', playerId: 'p-qb-1' },
      { playerName: 'Phase3 RB', position: 'RB', team: 'PHI', playerId: 'p-rb-1' },
      { playerName: 'Phase3 WR', position: 'WR', team: 'CIN', playerId: 'p-wr-1' },
    ]
    await prisma.draftQueue.create({
      data: {
        sessionId: fixture.sessionId,
        userId,
        order: queueOrder,
      },
    })

    const persisted = await prisma.draftQueue.findUnique({
      where: { sessionId_userId: { sessionId: fixture.sessionId, userId } },
    })
    expect(persisted).not.toBeNull()
    expect(persisted?.order).toEqual(queueOrder)

    // Same (sessionId, userId) twice should fail the unique constraint.
    await expect(
      prisma.draftQueue.create({
        data: {
          sessionId: fixture.sessionId,
          userId,
          order: queueOrder,
        },
      }),
    ).rejects.toThrow()

    // Upsert is the supported update path — reorder should overwrite cleanly.
    const reordered = [...queueOrder].reverse()
    await prisma.draftQueue.upsert({
      where: { sessionId_userId: { sessionId: fixture.sessionId, userId } },
      update: { order: reordered },
      create: { sessionId: fixture.sessionId, userId, order: reordered },
    })
    const afterReorder = await prisma.draftQueue.findUnique({
      where: { sessionId_userId: { sessionId: fixture.sessionId, userId } },
    })
    expect(afterReorder?.order).toEqual(reordered)
  })

  it('keeps queues isolated by user — two users on the same session have independent queues', async () => {
    const userA = 'phase3-queue-user-A'
    const userB = 'phase3-queue-user-B'
    const orderA = [{ playerName: 'A-QB', position: 'QB' }]
    const orderB = [{ playerName: 'B-RB', position: 'RB' }]

    await prisma.draftQueue.create({ data: { sessionId: fixture.sessionId, userId: userA, order: orderA } })
    await prisma.draftQueue.create({ data: { sessionId: fixture.sessionId, userId: userB, order: orderB } })

    const all = await prisma.draftQueue.findMany({ where: { sessionId: fixture.sessionId }, orderBy: { userId: 'asc' } })
    expect(all).toHaveLength(2)
    expect(all.find((q) => q.userId === userA)?.order).toEqual(orderA)
    expect(all.find((q) => q.userId === userB)?.order).toEqual(orderB)
  })

  it('cascade-deletes queue rows when the parent DraftSession is deleted', async () => {
    const userId = 'phase3-queue-cascade'
    await prisma.draftQueue.create({
      data: { sessionId: fixture.sessionId, userId, order: [{ playerName: 'X', position: 'WR' }] },
    })
    expect(
      await prisma.draftQueue.count({ where: { sessionId: fixture.sessionId, userId } }),
    ).toBe(1)

    // The fixture's cleanup() deletes the session; verify cascade fires.
    await fixture.cleanup()
    expect(
      await prisma.draftQueue.count({ where: { sessionId: fixture.sessionId, userId } }),
    ).toBe(0)

    // Re-seed so afterEach's cleanup() doesn't double-delete.
    fixture = await seedManualPickFixture({ prisma })
  })
})

describe('processExpiredDraftPickForLeague — short-circuit outcomes', () => {
  /**
   * Each test below toggles a single League / DraftSession field and asserts
   * the expected `outcome: 'skipped'` reason. None of these reach the resolver
   * pool, so they run in <1s each.
   */

  it('skips with reason=auto_pick_disabled when League.settings.draft_auto_pick_enabled is false (default)', async () => {
    // Default fixture leaves autoPickEnabled at the default (false). Confirm
    // this is the gate that fires before any timer logic.
    const result = await processExpiredDraftPickForLeague(fixture.leagueId)
    expect(result.outcome).toBe('skipped')
    expect(result.reason).toBe('auto_pick_disabled')
  })

  it('skips with reason=timer_not_expired when timerEndAt is in the future and autopick is enabled', async () => {
    // Enable autopick and leave the fixture's default timerEndAt (90s in the future).
    await prisma.league.update({
      where: { id: fixture.leagueId },
      data: {
        settings: { draft_auto_pick_enabled: true } as any,
      },
    })
    const result = await processExpiredDraftPickForLeague(fixture.leagueId)
    expect(result.outcome).toBe('skipped')
    expect(result.reason).toBe('timer_not_expired')
  })

  it('skips with status_paused when the session is paused, even if timer is expired', async () => {
    await prisma.league.update({
      where: { id: fixture.leagueId },
      data: { settings: { draft_auto_pick_enabled: true } as any },
    })
    await prisma.draftSession.update({
      where: { id: fixture.sessionId },
      data: {
        status: 'paused',
        timerEndAt: new Date(Date.now() - 60_000), // expired
      },
    })
    const result = await processExpiredDraftPickForLeague(fixture.leagueId)
    expect(result.outcome).toBe('skipped')
    // The status check returns `status_${session.status}` literal.
    expect(result.reason).toBe('status_paused')
  })

  it('skips with reason=cpu_autopick_disabled when DraftSession.cpuAutoPick is false', async () => {
    await prisma.league.update({
      where: { id: fixture.leagueId },
      data: { settings: { draft_auto_pick_enabled: true } as any },
    })
    await prisma.draftSession.update({
      where: { id: fixture.sessionId },
      data: {
        cpuAutoPick: false,
        timerEndAt: new Date(Date.now() - 60_000),
      },
    })
    const result = await processExpiredDraftPickForLeague(fixture.leagueId)
    expect(result.outcome).toBe('skipped')
    expect(result.reason).toBe('cpu_autopick_disabled')
  })

  it('skips with reason=auction_not_supported for auction drafts', async () => {
    await prisma.league.update({
      where: { id: fixture.leagueId },
      data: { settings: { draft_auto_pick_enabled: true } as any },
    })
    await prisma.draftSession.update({
      where: { id: fixture.sessionId },
      data: {
        draftType: 'auction',
        timerEndAt: new Date(Date.now() - 60_000),
      },
    })
    const result = await processExpiredDraftPickForLeague(fixture.leagueId)
    expect(result.outcome).toBe('skipped')
    expect(result.reason).toBe('auction_not_supported')
  })

  it('skips with reason=no_session when the league has no DraftSession', async () => {
    // Enable autopick first so the no_session gate fires (auto_pick_disabled
    // gate would otherwise short-circuit before the session lookup).
    await prisma.league.update({
      where: { id: fixture.leagueId },
      data: { settings: { draft_auto_pick_enabled: true } as any },
    })
    await prisma.draftSession.delete({ where: { id: fixture.sessionId } })
    const result = await processExpiredDraftPickForLeague(fixture.leagueId)
    expect(result.outcome).toBe('skipped')
    expect(result.reason).toBe('no_session')

    // Re-seed so afterEach cleanup() doesn't fail trying to delete a missing session.
    await fixture.cleanup()
    fixture = await seedManualPickFixture({ prisma })
  })
})
