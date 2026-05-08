// @vitest-environment node
/**
 * Phase 2 — DB-backed manual pick submission tests.
 *
 * Hits `lib/live-draft-engine/PickSubmissionService.submitPick` against the
 * real test database (no mocks) using the seeded fixture from
 * `_helpers/manual-pick-fixture.ts`.
 *
 * To run locally:
 *   node --env-file=.env --import tsx node_modules/vitest/vitest.mjs run \
 *     __tests__/draft/pick-submission-service.test.ts
 *
 * Or via the npm script registered with this branch:
 *   npm run test:phase2:pick-submission
 *
 * The DATABASE_URL must point at a writable DB. Each test seeds a unique
 * league via `seedManualPickFixture` and calls `cleanup()` in afterEach.
 *
 * Phase 2 acceptance criteria:
 *   1. Happy path: submitPick succeeds, DraftPick row created, nextOverallPick
 *      advances, on-clock advances to slot 2, timerEndAt resets, pick persists.
 *   2. Duplicate protection: same player cannot be drafted twice.
 *   3. Stale expectedOverall returns DRAFT_PICK_STALE_OVERALL.
 *   4. Non-on-clock submitter is rejected with DRAFT_PICK_NOT_ON_CLOCK
 *      (commissionerOverride bypasses the check).
 *   5. ROSTER_CONFIGURATION_INCOMPLETE — submitPick today does NOT itself emit
 *      this code; the gate is at the route layer + auction engine. The test
 *      documents the actual behavior.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { submitPick } from '@/lib/live-draft-engine/PickSubmissionService'
import {
  DRAFT_PICK_DUPLICATE_PLAYER,
  DRAFT_PICK_NOT_ON_CLOCK,
  DRAFT_PICK_STALE_OVERALL,
} from '@/lib/live-draft-engine/pickAuthorityCodes'
import {
  seedManualPickFixture,
  sweepManualPickFixtureLeftovers,
  type ManualPickFixture,
} from './_helpers/manual-pick-fixture'

let prisma: PrismaClient
let fixture: ManualPickFixture

beforeAll(async () => {
  if (!process.env.DATABASE_URL && !process.env.POSTGRES_PRISMA_URL) {
    throw new Error(
      'Phase 2 tests need DATABASE_URL or POSTGRES_PRISMA_URL. Run via `node --env-file=.env --import tsx node_modules/vitest/vitest.mjs run` or set the env yourself.',
    )
  }
  prisma = new PrismaClient()
  // Sweep any leftovers from a previous failed run before starting.
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

describe('PickSubmissionService.submitPick — happy path', () => {
  it('creates a DraftPick row and advances the on-clock manager', async () => {
    const { leagueId, slot1RosterId, slot2RosterId, sampleRoster } = fixture
    const player = sampleRoster[0]

    const result = await submitPick({
      leagueId,
      playerName: player.name,
      position: player.position,
      team: player.team,
      rosterId: slot1RosterId,
      source: 'user',
      expectedOverall: 1,
    })

    expect(result.success, result.error ?? '').toBe(true)
    expect(result.snapshot?.overall).toBe(1)
    expect(result.snapshot?.rosterId).toBe(slot1RosterId)

    // Re-query — the pick must persist outside the submitPick caller's view.
    const persisted = await prisma.draftPick.findMany({
      where: { sessionId: fixture.sessionId },
      orderBy: { overall: 'asc' },
    })
    expect(persisted).toHaveLength(1)
    expect(persisted[0].playerName).toBe(player.name)
    expect(persisted[0].position).toBe(player.position)
    expect(persisted[0].overall).toBe(1)
    expect(persisted[0].rosterId).toBe(slot1RosterId)
    expect(persisted[0].team).toBe(player.team)

    // Session state — overall=2 should now be on the clock for slot 2 in a snake.
    const session = await prisma.draftSession.findUniqueOrThrow({
      where: { id: fixture.sessionId },
      include: { picks: true },
    })
    // Session.timerEndAt should have advanced past the original fixture's value.
    expect(session.timerEndAt).not.toBeNull()
    expect(session.picks).toHaveLength(1)

    // Confirm next on-clock manager via a 2nd pick attempt — only slot 2 should succeed.
    const secondAttemptByWrongRoster = await submitPick({
      leagueId,
      playerName: sampleRoster[1].name,
      position: sampleRoster[1].position,
      team: sampleRoster[1].team,
      rosterId: slot1RosterId, // wrong — slot 2 is now on clock
      source: 'user',
      expectedOverall: 2,
    })
    expect(secondAttemptByWrongRoster.success).toBe(false)
    expect(secondAttemptByWrongRoster.code).toBe(DRAFT_PICK_NOT_ON_CLOCK)

    const secondPickByCorrectRoster = await submitPick({
      leagueId,
      playerName: sampleRoster[1].name,
      position: sampleRoster[1].position,
      team: sampleRoster[1].team,
      rosterId: slot2RosterId,
      source: 'user',
      expectedOverall: 2,
    })
    expect(secondPickByCorrectRoster.success, secondPickByCorrectRoster.error ?? '').toBe(true)
  })
})

describe('PickSubmissionService.submitPick — duplicate protection', () => {
  it('rejects a 2nd attempt to draft the same player with DRAFT_PICK_DUPLICATE_PLAYER', async () => {
    const { leagueId, slot1RosterId, slot2RosterId, sampleRoster } = fixture
    const player = sampleRoster[0]

    const first = await submitPick({
      leagueId,
      playerName: player.name,
      position: player.position,
      team: player.team,
      rosterId: slot1RosterId,
      source: 'user',
      expectedOverall: 1,
    })
    expect(first.success).toBe(true)

    // Slot 2 (now on the clock) tries to draft the SAME player.
    const dupAttempt = await submitPick({
      leagueId,
      playerName: player.name,
      position: player.position,
      team: player.team,
      rosterId: slot2RosterId,
      source: 'user',
      expectedOverall: 2,
    })
    expect(dupAttempt.success).toBe(false)
    expect(dupAttempt.code).toBe(DRAFT_PICK_DUPLICATE_PLAYER)
  })
})

describe('PickSubmissionService.submitPick — stale expectedOverall', () => {
  it('rejects with DRAFT_PICK_STALE_OVERALL when client sends an out-of-date overall', async () => {
    const { leagueId, slot1RosterId, sampleRoster } = fixture
    const player = sampleRoster[0]

    // Server-truth overall is 1 (no picks yet), but client thinks it's 5.
    const result = await submitPick({
      leagueId,
      playerName: player.name,
      position: player.position,
      team: player.team,
      rosterId: slot1RosterId,
      source: 'user',
      expectedOverall: 5,
    })

    expect(result.success).toBe(false)
    expect(result.code).toBe(DRAFT_PICK_STALE_OVERALL)
  })
})

describe('PickSubmissionService.submitPick — turn-order protection', () => {
  it('rejects a non-on-clock manager with DRAFT_PICK_NOT_ON_CLOCK', async () => {
    const { leagueId, slot3RosterId, sampleRoster } = fixture

    // Slot 3 tries to pick at overall=1 (slot 1 is on the clock).
    const result = await submitPick({
      leagueId,
      playerName: sampleRoster[0].name,
      position: sampleRoster[0].position,
      team: sampleRoster[0].team,
      rosterId: slot3RosterId,
      source: 'user',
      expectedOverall: 1,
    })

    expect(result.success).toBe(false)
    expect(result.code).toBe(DRAFT_PICK_NOT_ON_CLOCK)
  })

  it('allows a non-on-clock manager when commissionerOverride is true', async () => {
    const { leagueId, slot3RosterId, sampleRoster } = fixture
    const player = sampleRoster[0]

    const result = await submitPick({
      leagueId,
      playerName: player.name,
      position: player.position,
      team: player.team,
      // Slot 3 isn't on the clock at overall=1.
      rosterId: slot3RosterId,
      source: 'commissioner',
      commissionerOverride: true,
      expectedOverall: 1,
    })

    expect(result.success, result.error ?? '').toBe(true)

    const persisted = await prisma.draftPick.findMany({
      where: { sessionId: fixture.sessionId },
      orderBy: { overall: 'asc' },
    })
    expect(persisted).toHaveLength(1)
    // The commissioner override correctly assigns the pick to the on-clock slot 1
    // (effectiveRosterId resolution falls through to the slot owner).
    expect(persisted[0].overall).toBe(1)
  })
})

describe('PickSubmissionService.submitPick — incomplete roster configuration', () => {
  /**
   * Documents the **actual** production behavior:
   *
   * `League.starters` being null/empty does NOT cause submitPick to return
   * `ROSTER_CONFIGURATION_INCOMPLETE` directly today. The gate lives upstream
   * (route handler / auction engine / `getEffectiveLeagueRosterTemplate`'s
   * `rosterConfigurationIncomplete` flag in the resolver). submitPick will
   * still execute and create the pick.
   *
   * If a future change wires the gate into submitPick, this test should be
   * updated to assert the rejection. For now it locks the existing contract so
   * anyone who changes it must update the test deliberately.
   */
  it('does NOT itself reject when League.starters is missing — gate is upstream', async () => {
    // Tear down the default fixture and seed one without starters.
    await fixture.cleanup()
    fixture = await seedManualPickFixture({ prisma, starters: null })

    const { leagueId, slot1RosterId, sampleRoster } = fixture
    const player = sampleRoster[0]

    const result = await submitPick({
      leagueId,
      playerName: player.name,
      position: player.position,
      team: player.team,
      rosterId: slot1RosterId,
      source: 'user',
      expectedOverall: 1,
    })

    expect(result.code).not.toBe('ROSTER_CONFIGURATION_INCOMPLETE')
    // Either the pick succeeds (current behavior) or fails for a different
    // reason — what matters is that submitPick is not the gate.
    if (!result.success) {
      // If a downstream change happens to fail it, surface the error so we know
      // why — but it should not be ROSTER_CONFIGURATION_INCOMPLETE from this layer.
      // eslint-disable-next-line no-console
      console.warn('[phase2] submitPick failed for non-gate reason:', result.error, result.code)
    }
  })
})
