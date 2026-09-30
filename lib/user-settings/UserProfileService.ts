import { prisma } from "@/lib/prisma"
import { isAllowedSessionIdleMinutes } from "@/lib/auth/session-idle-constants"
import { SUPPORTED_SPORTS, isSupportedSport } from "@/lib/sport-scope"
import { isSelectableChimmyTtsVoiceId } from "@/lib/tts/voices"
import { validateUsername } from "@/lib/auth/username-validation"
import {
  isOffensiveDisplayName,
  isOffensiveUsername,
  OFFENSIVE_DISPLAY_NAME_MESSAGE,
  OFFENSIVE_USERNAME_MESSAGE,
} from "@/lib/moderation/offensiveName"
import type { ProfileUpdatePayload } from "./types"

/**
 * Updates user profile fields that are editable from Settings.
 * Username can be changed here (validated + uniqueness). Email/phone use dedicated flows.
 */

export async function updateUserProfile(
  userId: string,
  payload: ProfileUpdatePayload
): Promise<{ ok: boolean; error?: string }> {
  if (payload.chimmyTtsVoiceId !== undefined) {
    const v = payload.chimmyTtsVoiceId
    if (v !== null && v !== "" && !isSelectableChimmyTtsVoiceId(v)) {
      return { ok: false, error: "Invalid Chimmy voice selection" }
    }
  }

  /*
   * 🛑 THE SIGN-UP NAME FILTER WAS SKIPPED HERE. A username rejected at sign-up could be set from
   * Settings the next day, and a display name — what other managers see on every chat message —
   * was never checked anywhere (lib/moderation/offensiveName). Checked before ANY write, so a
   * refused name leaves the rest of the payload unsaved too rather than half-applied.
   */
  if (typeof payload.displayName === "string" && isOffensiveDisplayName(payload.displayName.trim())) {
    return { ok: false, error: OFFENSIVE_DISPLAY_NAME_MESSAGE }
  }

  if (payload.username !== undefined && payload.username !== null) {
    const validation = validateUsername(String(payload.username))
    if (!validation.ok) {
      return { ok: false, error: validation.reason }
    }
    const { normalized } = validation
    if (isOffensiveUsername(normalized)) {
      return { ok: false, error: OFFENSIVE_USERNAME_MESSAGE }
    }
    const taken = await prisma.appUser.findFirst({
      where: { username: { equals: normalized, mode: "insensitive" }, NOT: { id: userId } },
      select: { id: true },
    })
    if (taken) {
      return { ok: false, error: "Username is already taken" }
    }
    try {
      await prisma.appUser.update({
        where: { id: userId },
        data: { username: normalized },
      })
    } catch {
      return { ok: false, error: "Failed to update username" }
    }
  }

  const updateProfile: Record<string, unknown> = {}
  if (payload.displayName !== undefined) updateProfile.displayName = payload.displayName?.trim() || null
  if (payload.preferredLanguage !== undefined) updateProfile.preferredLanguage = payload.preferredLanguage || null
  if (payload.timezone !== undefined) updateProfile.timezone = payload.timezone || null
  if (payload.themePreference !== undefined) updateProfile.themePreference = payload.themePreference || null
  if (payload.avatarPreset !== undefined) updateProfile.avatarPreset = payload.avatarPreset || null
  if (payload.bio !== undefined) updateProfile.bio = payload.bio?.trim() || null
  if (payload.preferredSports !== undefined) {
    const normalizedSports =
      Array.isArray(payload.preferredSports) && payload.preferredSports.length > 0
        ? SUPPORTED_SPORTS.filter((sport) =>
            payload.preferredSports?.some(
              (candidate) =>
                isSupportedSport(String(candidate).toUpperCase()) &&
                String(candidate).toUpperCase() === sport
            )
          )
        : []
    updateProfile.preferredSports =
      normalizedSports.length > 0 ? normalizedSports : null
  }
  if (payload.notificationPreferences !== undefined)
    updateProfile.notificationPreferences = payload.notificationPreferences ?? null
  if (payload.clearSleeperLink === true) {
    updateProfile.sleeperUsername = null
    updateProfile.sleeperLinkedAt = null
    updateProfile.sleeperUserId = null
    updateProfile.sleeperVerifiedAt = null
  }
  if (payload.onboardingStep !== undefined) updateProfile.onboardingStep = payload.onboardingStep ?? null
  if (payload.onboardingCompletedAt !== undefined)
    updateProfile.onboardingCompletedAt = payload.onboardingCompletedAt ?? null
  if (payload.sessionIdleTimeoutMinutes !== undefined) {
    const v = payload.sessionIdleTimeoutMinutes
    if (v === null || v === 0) {
      updateProfile.sessionIdleTimeoutMinutes = null
    } else if (isAllowedSessionIdleMinutes(v)) {
      updateProfile.sessionIdleTimeoutMinutes = v
    } else {
      return { ok: false, error: "Invalid session timeout value" }
    }
  }
  if (payload.chimmyTtsVoiceId !== undefined) {
    const v = payload.chimmyTtsVoiceId
    updateProfile.chimmyTtsVoiceId =
      v === null || v === "" ? null : String(v).trim() || null
  }

  try {
    if (Object.keys(updateProfile).length > 0) {
      await prisma.userProfile.upsert({
        where: { userId },
        update: updateProfile as Parameters<typeof prisma.userProfile.upsert>[0]["update"],
        create: {
          userId,
          ...updateProfile,
        } as Parameters<typeof prisma.userProfile.upsert>[0]["create"],
      })
    }

    const appUserUpdate: Record<string, unknown> = {}
    if (payload.displayName !== undefined) {
      appUserUpdate.displayName = payload.displayName?.trim() || null
    }
    if (payload.avatarUrl !== undefined) {
      appUserUpdate.avatarUrl = payload.avatarUrl || null
    }
    if (Object.keys(appUserUpdate).length > 0) {
      await prisma.appUser.update({
        where: { id: userId },
        data: appUserUpdate,
      })
    }

    return { ok: true }
  } catch (e) {
    console.error("[UserProfileService] updateUserProfile error:", e)
    return { ok: false, error: "Failed to save profile" }
  }
}
