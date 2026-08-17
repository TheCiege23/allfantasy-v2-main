import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { DEFAULT_SIGNUP_TIMEZONE } from '@/lib/signup/timezones'
import { DEFAULT_THEME } from '@/lib/theme/constants'

export async function ensureSharedAccountProfile(input: {
  userId: string
  displayName?: string | null
  /**
   * The signup consent tick, carried across the OAuth redirect (see signupConsentCookie).
   * Without it an OAuth account was created with `ageConfirmedAt` null even when the user
   * HAD checked the box, so every later gate reported they never confirmed.
   *
   * Only ever set, never cleared: this runs on every authenticated request, and passing
   * `false` for an already-confirmed user must not retract a real prior confirmation.
   */
  ageConfirmed?: boolean
}): Promise<void> {
  const consentedAt = input.ageConfirmed ? new Date() : null
  // Age is deliberately NOT part of this update payload: it is written by the guarded
  // updateMany below so a repeat sign-in can never overwrite the ORIGINAL consent
  // timestamp with a later one. The date it was given is the record.
  const update = input.displayName ? { displayName: input.displayName } : {}
  try {
    if (consentedAt) {
      // Set only when currently null. updateMany takes a filter, so this is one
      // conditional write rather than a read-then-write that could race.
      await prisma.userProfile.updateMany({
        where: { userId: input.userId, ageConfirmedAt: null },
        data: { ageConfirmedAt: consentedAt },
      })
    }
    await prisma.userProfile.upsert({
      where: { userId: input.userId },
      update,
      create: {
        userId: input.userId,
        preferredLanguage: 'en',
        timezone: DEFAULT_SIGNUP_TIMEZONE,
        themePreference: DEFAULT_THEME,
        ...(input.displayName ? { displayName: input.displayName } : {}),
        ...(consentedAt ? { ageConfirmedAt: consentedAt } : {}),
      },
    })
  } catch (error) {
    // A page load fires many authenticated requests in parallel; two of them can
    // both miss the row and race the create, tripping the userId unique
    // constraint (P2002). The row now exists, so settle to the intended state
    // with a plain update instead of failing the whole request (which would
    // 500 getServerSession and every API call behind it).
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      await prisma.userProfile
        .update({ where: { userId: input.userId }, data: update })
        .catch(() => undefined)
      return
    }
    throw error
  }
}
