// @vitest-environment node
/**
 * Names are user-generated content (App Store guideline 1.2). Sign-up refused an offensive
 * username, but Settings' username change skipped the check and no path ever checked a display
 * name — what other managers read on every chat message. lib/moderation/offensiveName is now the
 * one filter, and every path that sets a name goes through it.
 *
 * (Test words are the mild ones the chat filter's own suite already uses.)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  appUserFindFirst: vi.fn(),
  appUserUpdate: vi.fn(),
  profileUpsert: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    appUser: { findFirst: h.appUserFindFirst, update: h.appUserUpdate },
    userProfile: { upsert: h.profileUpsert },
  },
}))

import { isOffensiveDisplayName, isOffensiveUsername } from '@/lib/moderation/offensiveName'
import { hasProfanityInUsername } from '@/lib/signup/UsernameProfanityGuard'
import { resolveOnboardingProfile } from '@/lib/signup/OnboardingProfileResolver'
import { updateUserProfile } from '@/lib/user-settings/UserProfileService'

beforeEach(() => {
  vi.clearAllMocks()
  h.appUserFindFirst.mockResolvedValue(null)
  h.appUserUpdate.mockResolvedValue({})
  h.profileUpsert.mockResolvedValue({})
})

describe('isOffensiveUsername', () => {
  it('catches a swear however a handle hides it', () => {
    for (const u of ['shit', 'SHIT', 'shit_guy', 'ShitGuy', 'shit99', 'big_bastard', 'xxfuckxx']) {
      expect(isOffensiveUsername(u), u).toBe(true)
    }
  })

  // A handle has no spaces, so the substring list (unchanged, used at sign-up before this change)
  // still applies to it and can over-match — 'Scunthorpe' is refused as a username, not as a name.
  it('passes ordinary handles, including ones with a swear inside a real word (control)', () => {
    for (const u of ['gridiron_guru', 'Dickerson22', 'class_act', 'grass_king', 'assist_man', 'cockpit_pilot']) {
      expect(isOffensiveUsername(u), u).toBe(false)
    }
  })

  it('is what the sign-up guard now uses', () => {
    expect(hasProfanityInUsername('ShitGuy')).toBe(true)
    expect(hasProfanityInUsername('gridiron_guru')).toBe(false)
  })
})

describe('isOffensiveDisplayName', () => {
  it('catches a whole-word swear in a display name', () => {
    for (const n of ['Big Shit', 'the bastards', 'Fucking Legend']) expect(isOffensiveDisplayName(n), n).toBe(true)
  })

  it('never rejects a real surname that merely contains one (control)', () => {
    for (const n of ['Eric Dickerson', 'Emily Dickenson', 'Scunthorpe United', 'Glass Cannon', 'Bassett']) {
      expect(isOffensiveDisplayName(n), n).toBe(false)
    }
  })
})

describe('onboarding (complete-profile)', () => {
  it('refuses an offensive display name, and an offensive username split with an underscore', () => {
    expect(resolveOnboardingProfile({ displayName: 'Big Shit' })).toMatchObject({ ok: false, code: 'DISPLAYNAME_PROFANE' })
    expect(resolveOnboardingProfile({ displayName: 'Ada', username: 'shit_guy' })).toMatchObject({ ok: false, code: 'USERNAME_PROFANE' })
  })

  it('accepts a clean profile (control)', () => {
    expect(resolveOnboardingProfile({ displayName: 'Eric Dickerson', username: 'gridiron_guru' })).toMatchObject({ ok: true })
  })
})

describe('Settings (updateUserProfile) — the path that had no check at all', () => {
  it('refuses an offensive username and writes nothing', async () => {
    expect(await updateUserProfile('u1', { username: 'ShitGuy' })).toEqual({ ok: false, error: 'Please choose a different username.' })
    expect(h.appUserUpdate).not.toHaveBeenCalled()
  })

  it('refuses an offensive display name before any other field is saved', async () => {
    expect(await updateUserProfile('u1', { displayName: 'Big Shit', timezone: 'America/New_York' } as never)).toEqual({
      ok: false,
      error: 'Please choose a different display name.',
    })
    expect(h.appUserUpdate).not.toHaveBeenCalled()
    expect(h.profileUpsert).not.toHaveBeenCalled()
  })

  it('refuses a display name longer than the cap, and writes nothing', async () => {
    const res = await updateUserProfile('u1', { displayName: 'x'.repeat(51) } as never)
    expect(res.ok).toBe(false)
    expect(h.appUserUpdate).not.toHaveBeenCalled()
    expect(h.profileUpsert).not.toHaveBeenCalled()
  })

  it('accepts a display name at exactly the cap (control)', async () => {
    expect((await updateUserProfile('u1', { displayName: 'x'.repeat(50) } as never)).ok).toBe(true)
  })

  it('still saves a clean username (control)', async () => {
    await updateUserProfile('u1', { username: 'gridiron_guru' })
    expect(h.appUserUpdate).toHaveBeenCalledWith({ where: { id: 'u1' }, data: { username: 'gridiron_guru' } })
  })
})
