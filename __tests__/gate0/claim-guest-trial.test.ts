// @vitest-environment node
/**
 * AF_GATE0 §3.5 / §6 — signup migration is idempotent: claiming the guest trial twice must
 * attach the LegacyUser exactly once (no duplicate leagues on replay). Also covers the
 * OAuth-first "account already exists / already linked" path and the 409 conflict guard.
 *
 * Uses a REAL signed guest token (so verifyGuestSessionToken runs for real) and a stateful
 * Prisma mock so the second call observes the FK written by the first.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { signGuestSessionToken } from '@/lib/guest-mode/guestSessionToken'

const { prismaMock, state } = vi.hoisted(() => {
  const state = { legacyUserId: null as string | null }
  const prismaMock = {
    appUser: {
      findUnique: vi.fn(async () => ({ legacyUserId: state.legacyUserId })),
      findFirst: vi.fn(async () => null),
      update: vi.fn(async ({ data }: { data: { legacyUserId: string } }) => {
        state.legacyUserId = data.legacyUserId
        return { id: 'user-1', legacyUserId: state.legacyUserId }
      }),
    },
    legacyUser: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) =>
        where?.id === 'legacy-1'
          ? {
              id: 'legacy-1',
              sleeperUsername: 'theghost',
              sleeperUserId: 'sl-1',
              displayName: 'The Ghost',
              avatar: null,
              avatarUrl: null,
            }
          : null,
      ),
    },
    userProfile: {
      findFirst: vi.fn(async () => null),
      upsert: vi.fn(async () => ({})),
    },
    legacyLeague: {
      count: vi.fn(async () => 0),
    },
    // Third identity store. linkAfUserToLegacy now writes it in the SAME transaction as
    // the other two, so the duplicate-league gate can never read a link the other stores
    // already recorded.
    platformIdentity: {
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({})),
      update: vi.fn(async () => ({})),
    },
    // The three identity writes are atomic; the mock runs the callback against itself so
    // the stateful assertions above still observe them.
    $transaction: vi.fn(async (fn: (tx: unknown) => unknown) => fn(prismaMock)),
  }
  return { prismaMock, state }
})

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/ranking/computeAndSaveRank', () => ({ computeAndSaveRank: vi.fn(async () => null) }))

// Imported after the mocks are registered.
import { claimGuestTrialForUser } from '@/lib/legacy/claimGuestTrialForUser'

beforeEach(() => {
  state.legacyUserId = null
  vi.clearAllMocks()
})

describe('claimGuestTrialForUser — idempotent signup migration', () => {
  it('links the LegacyUser on first claim, then is a no-op on replay (no duplicate)', async () => {
    const token = await signGuestSessionToken({ legacyUserId: 'legacy-1', sleeperUsername: 'theghost' })

    const first = await claimGuestTrialForUser('user-1', token)
    expect(first).toEqual({ claimed: true, legacyUserId: 'legacy-1' })
    expect(prismaMock.appUser.update).toHaveBeenCalledTimes(1)

    // Replay (e.g. a second sign-in / re-run of events.signIn) must NOT re-link.
    const replay = await claimGuestTrialForUser('user-1', token)
    expect(replay.claimed).toBe(false)
    expect(replay).toMatchObject({ reason: 'already-linked' })
    expect(prismaMock.appUser.update).toHaveBeenCalledTimes(1) // still once — no duplicate claim
  })

  it('writes the PlatformIdentity row the duplicate-league gate reads', async () => {
    // Without this row resolveLinkedAccounts finds no siblings, so a second account
    // belonging to the same human would join the same league unchallenged. A link that
    // populated only the two older stores would leave the gate blind.
    const token = await signGuestSessionToken({ legacyUserId: 'legacy-1', sleeperUsername: 'theghost' })

    await claimGuestTrialForUser('user-1', token)

    expect(prismaMock.platformIdentity.create).toHaveBeenCalledTimes(1)
    expect(prismaMock.platformIdentity.create.mock.calls[0][0].data).toMatchObject({
      userId: 'user-1',
      platform: 'sleeper',
      platformUserId: 'sl-1',
      platformUsername: 'theghost',
    })
  })

  it('refuses the whole link when the Sleeper id is on another profile (no half-write)', async () => {
    // Previously this case updated AppUser.legacyUserId and then silently SKIPPED the
    // profile write, leaving the account linked in one store and unlinked in another.
    const token = await signGuestSessionToken({ legacyUserId: 'legacy-1', sleeperUsername: 'theghost' })
    prismaMock.userProfile.findFirst.mockResolvedValueOnce({ userId: 'someone-else' })

    const result = await claimGuestTrialForUser('user-1', token)

    expect(result.claimed).toBe(false)
    expect(prismaMock.appUser.update).not.toHaveBeenCalled()
    expect(prismaMock.userProfile.upsert).not.toHaveBeenCalled()
    expect(prismaMock.platformIdentity.create).not.toHaveBeenCalled()
  })

  it('is a no-op when there is no guest token (the common sign-in case)', async () => {
    const result = await claimGuestTrialForUser('user-1', undefined)
    expect(result).toEqual({ claimed: false, reason: 'no-token' })
    expect(prismaMock.appUser.update).not.toHaveBeenCalled()
  })

  it('refuses to steal a LegacyUser already claimed by a different AF login (409)', async () => {
    const token = await signGuestSessionToken({ legacyUserId: 'legacy-1', sleeperUsername: 'theghost' })
    prismaMock.appUser.findFirst.mockResolvedValueOnce({ id: 'someone-else' })

    const result = await claimGuestTrialForUser('user-1', token)
    expect(result.claimed).toBe(false)
    expect(result).toMatchObject({ reason: 'conflict' })
    expect(prismaMock.appUser.update).not.toHaveBeenCalled()
  })

  it('is a no-op when the LegacyUser row is gone (verified cookie, purged data)', async () => {
    const token = await signGuestSessionToken({ legacyUserId: 'gone', sleeperUsername: 'x' })
    const result = await claimGuestTrialForUser('user-1', token)
    expect(result.claimed).toBe(false)
    expect(result).toMatchObject({ reason: 'legacy-missing' })
    expect(prismaMock.appUser.update).not.toHaveBeenCalled()
  })
})
