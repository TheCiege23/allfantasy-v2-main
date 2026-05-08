// @vitest-environment node
/**
 * Phase 4 — Pause / resume / timer tests.
 *
 * Covers the DraftTimerService pure helpers + DraftSessionService pause/resume
 * DB transitions. Pause-blocks-autopick is already locked by Phase 3's
 * `status_paused` short-circuit test in queue-and-autopick.test.ts.
 *
 * Run: npm run test:phase4:pause-resume-timer
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { computeTimerEndAt, computeTimerState } from '@/lib/live-draft-engine/DraftTimerService'
import {
  pauseDraftSession,
  resumeDraftSession,
} from '@/lib/live-draft-engine/DraftSessionService'
import {
  seedManualPickFixture,
  sweepManualPickFixtureLeftovers,
  type ManualPickFixture,
} from './_helpers/manual-pick-fixture'

let prisma: PrismaClient
let fixture: ManualPickFixture

beforeAll(async () => {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_PRISMA_URL) {
    throw new Error('Phase 4 tests need DATABASE_URL or POSTGRES_PRISMA_URL.')
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

describe('computeTimerEndAt — pure', () => {
  it('returns now + timerSeconds', () => {
    const from = new Date('2026-01-01T00:00:00Z')
    const result = computeTimerEndAt(60, from)
    expect(result.getTime()).toBe(from.getTime() + 60_000)
  })

  it('clamps negative timerSeconds to 0', () => {
    const from = new Date('2026-01-01T00:00:00Z')
    const result = computeTimerEndAt(-5, from)
    expect(result.getTime()).toBe(from.getTime())
  })
})

describe('computeTimerState — pure', () => {
  it('returns status=none when session is not in_progress and not paused', () => {
    const result = computeTimerState({
      status: 'pre_draft',
      timerSeconds: 90,
      timerEndAt: new Date(),
      pausedRemainingSeconds: null,
      overnightFrozenPickSeconds: null,
    })
    expect(result.status).toBe('none')
    expect(result.remainingSeconds).toBeNull()
  })

  it('returns status=running with positive remainingSeconds when timerEndAt is in the future', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const timerEndAt = new Date(now.getTime() + 30_000)
    const result = computeTimerState(
      { status: 'in_progress', timerSeconds: 90, timerEndAt, pausedRemainingSeconds: null, overnightFrozenPickSeconds: null },
      now,
    )
    expect(result.status).toBe('running')
    expect(result.remainingSeconds).toBe(30)
    expect(result.pauseReason).toBeNull()
  })

  it('returns status=expired when timerEndAt has passed', () => {
    const now = new Date('2026-01-01T00:00:00Z')
    const timerEndAt = new Date(now.getTime() - 10_000)
    const result = computeTimerState(
      { status: 'in_progress', timerSeconds: 90, timerEndAt, pausedRemainingSeconds: null, overnightFrozenPickSeconds: null },
      now,
    )
    expect(result.status).toBe('expired')
    expect(result.remainingSeconds).toBe(0)
  })

  it('returns status=paused with the frozen pausedRemainingSeconds when paused', () => {
    const result = computeTimerState({
      status: 'paused',
      timerSeconds: 90,
      timerEndAt: null,
      pausedRemainingSeconds: 42,
      overnightFrozenPickSeconds: null,
    })
    expect(result.status).toBe('paused')
    expect(result.remainingSeconds).toBe(42)
    expect(result.pauseReason).toBe('commissioner')
    expect(result.timerEndAt).toBeNull()
  })
})

describe('pauseDraftSession — DB transitions', () => {
  it('freezes timerEndAt, captures pausedRemainingSeconds, sets status=paused, increments version', async () => {
    const before = await prisma.draftSession.findUniqueOrThrow({ where: { id: fixture.sessionId } })
    expect(before.status).toBe('in_progress')
    expect(before.timerEndAt).not.toBeNull()
    const versionBefore = before.version

    const ok = await pauseDraftSession(fixture.leagueId, 'phase4-commissioner')
    expect(ok).toBe(true)

    const after = await prisma.draftSession.findUniqueOrThrow({ where: { id: fixture.sessionId } })
    expect(after.status).toBe('paused')
    expect(after.timerEndAt).toBeNull()
    expect(after.pausedRemainingSeconds).not.toBeNull()
    expect(after.pausedRemainingSeconds).toBeGreaterThan(0)
    expect(after.pausedRemainingSeconds).toBeLessThanOrEqual(90)
    expect(after.pausedByUserId).toBe('phase4-commissioner')
    expect(after.version).toBe(versionBefore + 1)
  })

  it('returns false when the session is already paused (idempotent guard)', async () => {
    await pauseDraftSession(fixture.leagueId, null)
    const second = await pauseDraftSession(fixture.leagueId, null)
    expect(second).toBe(false)
  })

  it('returns false when there is no DraftSession', async () => {
    await prisma.draftSession.delete({ where: { id: fixture.sessionId } })
    const ok = await pauseDraftSession(fixture.leagueId, null)
    expect(ok).toBe(false)
    // Re-seed so afterEach cleanup() doesn't trip on missing session.
    await fixture.cleanup()
    fixture = await seedManualPickFixture({ prisma })
  })
})

describe('resumeDraftSession — DB transitions', () => {
  it('returns to status=in_progress, recomputes timerEndAt as a future Date, clears pause state, increments version', async () => {
    const ok1 = await pauseDraftSession(fixture.leagueId, null)
    expect(ok1).toBe(true)
    const paused = await prisma.draftSession.findUniqueOrThrow({ where: { id: fixture.sessionId } })
    const versionBefore = paused.version

    const ok2 = await resumeDraftSession(fixture.leagueId)
    expect(ok2).toBe(true)

    const resumed = await prisma.draftSession.findUniqueOrThrow({ where: { id: fixture.sessionId } })
    expect(resumed.status).toBe('in_progress')
    expect(resumed.timerEndAt).not.toBeNull()
    // Server-authoritative: the new timerEndAt must be in the future per the
    // server's clock, not whatever the client thought it was.
    expect(resumed.timerEndAt!.getTime()).toBeGreaterThan(Date.now())
    expect(resumed.pausedRemainingSeconds).toBeNull()
    expect(resumed.pausedByUserId).toBeNull()
    expect(resumed.version).toBe(versionBefore + 1)
  })

  it('returns false when the session is not paused (cannot resume an in-progress draft)', async () => {
    const ok = await resumeDraftSession(fixture.leagueId)
    expect(ok).toBe(false)
  })

  it('keeps the same on-clock manager — pause/resume must not advance the pick', async () => {
    const before = await prisma.draftSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
      include: { picks: true },
    })
    const slotOrderBefore = JSON.stringify(before.slotOrder)
    const picksBefore = before.picks.length
    const nextOverallBefore = before.nextOverallPick

    await pauseDraftSession(fixture.leagueId, null)
    await resumeDraftSession(fixture.leagueId)

    const after = await prisma.draftSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
      include: { picks: true },
    })
    expect(JSON.stringify(after.slotOrder)).toBe(slotOrderBefore)
    expect(after.picks).toHaveLength(picksBefore)
    expect(after.nextOverallPick).toBe(nextOverallBefore)
  })
})

describe('server-authoritative timerEndAt', () => {
  it('pause then resume produces a fresh timerEndAt regardless of any prior client view', async () => {
    // Stamp a clearly-stale timerEndAt directly via Prisma to simulate a client
    // that thinks the timer ends 10 minutes ago. The pause+resume cycle must
    // overwrite it with a server-computed value.
    const stale = new Date(Date.now() - 10 * 60_000)
    await prisma.draftSession.update({
      where: { id: fixture.sessionId },
      data: { timerEndAt: stale },
    })

    await pauseDraftSession(fixture.leagueId, null)
    await resumeDraftSession(fixture.leagueId)

    const after = await prisma.draftSession.findUniqueOrThrow({ where: { id: fixture.sessionId } })
    expect(after.timerEndAt).not.toBeNull()
    expect(after.timerEndAt!.getTime()).toBeGreaterThan(Date.now())
    // And specifically NOT the stale value the test wrote above.
    expect(after.timerEndAt!.getTime()).not.toBe(stale.getTime())
  })
})
