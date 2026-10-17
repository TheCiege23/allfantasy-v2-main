import { prisma } from "@/lib/prisma"
import { resolveLanguage } from "@/lib/i18n/constants"
import { getUserSettingsRecord } from "./UserSettingsService"
import { resolveSharedProfileBootstrap } from "./SharedProfileBootstrapService"
import { updateUserProfile } from "./UserProfileService"
import type { SettingsSnapshot, UserProfileForSettings } from "./types"
import { readEmailSubscription } from "@/lib/email/emailSubscription"

/**
 * Fetches the full profile and account data needed for the settings UI.
 * Used by Settings page and SettingsModal.
 */
/** Columns that exist on all deployed DBs — used when full `queryBaseProfile` fails (migration lag). */
const SAFE_USER_PROFILE_SELECT = {
  displayName: true,
  timezone: true,
  deviceTimezoneLastSeen: true,
  deviceTimeLastSeen: true,
  timeMismatchFlag: true,
  lastTimeContextAt: true,
  preferredLanguage: true,
  themePreference: true,
  avatarPreset: true,
  phone: true,
  phoneVerifiedAt: true,
  emailVerifiedAt: true,
  ageConfirmedAt: true,
  verificationMethod: true,
  profileComplete: true,
  sleeperUsername: true,
  sleeperUserId: true,
  sleeperLinkedAt: true,
  spotifyDisplayName: true,
  spotifyConnectedAt: true,
  bio: true,
  onboardingStep: true,
  createdAt: true,
  updatedAt: true,
} as const

const SAFE_PROFILE_RANK_SELECT = {
  rankTier: true,
  xpLevel: true,
  xpTotal: true,
  rankCalculatedAt: true,
  careerWins: true,
  careerChampionships: true,
  careerSeasonsPlayed: true,
  careerLeaguesPlayed: true,
} as const

type SafeProfileRankSelectResult = {
  rankTier: string | null
  xpLevel: number | null
  xpTotal: bigint | number | null
  rankCalculatedAt: Date | null
  careerWins: number | null
  careerChampionships: number | null
  careerSeasonsPlayed: number | null
  careerLeaguesPlayed: number | null
}

async function queryOptionalProfileRankFields(userId: string): Promise<SafeProfileRankSelectResult | null> {
  try {
    return await prisma.userProfile.findUnique({
      where: { userId },
      select: SAFE_PROFILE_RANK_SELECT,
    })
  } catch (err: unknown) {
    console.warn(
      "[getSettingsSnapshot] optional rank fields unavailable (migration lag):",
      err instanceof Error ? err.message : err
    )
    return null
  }
}

async function queryBaseProfile(
  userId: string
): Promise<Omit<UserProfileForSettings, "settings"> | null> {
  const optionalRank = await queryOptionalProfileRankFields(userId)
  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      emailVerified: true,
      displayName: true,
      avatarUrl: true,
      passwordHash: true,
      profile: {
        select: {
          displayName: true,
          timezone: true,
          deviceTimezoneLastSeen: true,
          deviceTimeLastSeen: true,
          timeMismatchFlag: true,
          lastTimeContextAt: true,
          preferredLanguage: true,
          themePreference: true,
          avatarPreset: true,
          phone: true,
          phoneVerifiedAt: true,
          emailVerifiedAt: true,
          ageConfirmedAt: true,
          verificationMethod: true,
          profileComplete: true,
          sleeperUsername: true,
          sleeperUserId: true,
          sleeperLinkedAt: true,
          discordUserId: true,
          discordUsername: true,
          discordEmail: true,
          discordAvatar: true,
          discordGuildId: true,
          discordConnectedAt: true,
          spotifyDisplayName: true,
          spotifyConnectedAt: true,
          bio: true,
          preferredSports: true,
          notificationPreferences: true,
          onboardingStep: true,
          onboardingCompletedAt: true,
          sessionIdleTimeoutMinutes: true,
          updatedAt: true,
          chimmyTtsVoiceId: true,
        },
      },
    },
  })

  if (!user) return null

  const profile = user.profile
  const preferredLanguage = profile?.preferredLanguage ? resolveLanguage(profile.preferredLanguage) : null
  const resolvedEmailVerifiedAt = profile?.emailVerifiedAt ?? user.emailVerified ?? null

  return {
    userId: user.id,
    username: user.username,
    email: user.email ?? null,
    displayName: profile?.displayName ?? user.displayName ?? null,
    profileImageUrl: user.avatarUrl ?? null,
    avatarPreset: profile?.avatarPreset ?? null,
    preferredLanguage,
    timezone: profile?.timezone ?? null,
    deviceTimezoneLastSeen: profile?.deviceTimezoneLastSeen?.trim() || null,
    deviceTimeLastSeen: profile?.deviceTimeLastSeen ?? null,
    timeMismatchFlag: profile?.timeMismatchFlag ?? false,
    lastTimeContextAt: profile?.lastTimeContextAt ?? null,
    themePreference: (profile?.themePreference as "dark" | "light" | "legacy") ?? null,
    phone: profile?.phone ?? null,
    phoneVerifiedAt: profile?.phoneVerifiedAt ?? null,
    emailVerifiedAt: resolvedEmailVerifiedAt,
    ageConfirmedAt: profile?.ageConfirmedAt ?? null,
    verificationMethod:
      profile?.verificationMethod === "PHONE" || profile?.verificationMethod === "EMAIL"
        ? profile.verificationMethod
        : null,
    hasPassword: !!(user as any).passwordHash,
    profileComplete: profile?.profileComplete ?? false,
    sleeperUsername: profile?.sleeperUsername ?? null,
    sleeperUserId: profile?.sleeperUserId ?? null,
    sleeperLinkedAt: profile?.sleeperLinkedAt ?? null,
    discordUserId: profile?.discordUserId ?? null,
    discordUsername: profile?.discordUsername ?? null,
    discordEmail: profile?.discordEmail ?? null,
    discordAvatar: profile?.discordAvatar ?? null,
    discordGuildId: profile?.discordGuildId ?? null,
    discordConnectedAt: profile?.discordConnectedAt ?? null,
    spotifyDisplayName: profile?.spotifyDisplayName ?? null,
    spotifyConnectedAt: profile?.spotifyConnectedAt ?? null,
    bio: profile?.bio ?? null,
    preferredSports: Array.isArray(profile?.preferredSports)
      ? (profile.preferredSports as string[])
      : profile?.preferredSports
        ? [profile.preferredSports as string]
        : null,
    notificationPreferences: (profile?.notificationPreferences as Record<string, unknown> | null) ?? null,
    onboardingStep: profile?.onboardingStep ?? null,
    onboardingCompletedAt: profile?.onboardingCompletedAt ?? null,
    sessionIdleTimeoutMinutes:
      typeof profile?.sessionIdleTimeoutMinutes === "number"
        ? profile.sessionIdleTimeoutMinutes
        : null,
      rankTier: optionalRank?.rankTier ?? null,
      xpLevel: optionalRank?.xpLevel ?? null,
      xpTotal: optionalRank?.xpTotal != null ? Number(optionalRank.xpTotal) : null,
      rankCalculatedAt: optionalRank?.rankCalculatedAt ?? null,
      careerWins: optionalRank?.careerWins ?? null,
      careerChampionships: optionalRank?.careerChampionships ?? null,
      careerSeasonsPlayed: optionalRank?.careerSeasonsPlayed ?? null,
      careerLeaguesPlayed: optionalRank?.careerLeaguesPlayed ?? null,
    chimmyTtsVoiceId:
      typeof profile?.chimmyTtsVoiceId === "string" && profile.chimmyTtsVoiceId.trim()
        ? profile.chimmyTtsVoiceId.trim()
        : null,
    updatedAt: profile?.updatedAt ?? new Date(),
  }
}

async function queryBaseProfileMinimal(
  userId: string
): Promise<Omit<UserProfileForSettings, "settings"> | null> {
  const user = await prisma.appUser.findUnique({
    where: { id: userId },
    select: {
      id: true,
      username: true,
      email: true,
      emailVerified: true,
      displayName: true,
      avatarUrl: true,
      passwordHash: true,
      profile: {
        select: SAFE_USER_PROFILE_SELECT,
      },
    },
  })

  if (!user) return null

  const profile = user.profile
  const preferredLanguage = profile?.preferredLanguage ? resolveLanguage(profile.preferredLanguage) : null
  const resolvedEmailVerifiedAt = profile?.emailVerifiedAt ?? user.emailVerified ?? null

  return {
    userId: user.id,
    username: user.username,
    email: user.email ?? null,
    displayName: profile?.displayName ?? user.displayName ?? null,
    profileImageUrl: user.avatarUrl ?? null,
    avatarPreset: profile?.avatarPreset ?? null,
    preferredLanguage,
    timezone: profile?.timezone ?? null,
    deviceTimezoneLastSeen: profile?.deviceTimezoneLastSeen?.trim() || null,
    deviceTimeLastSeen: profile?.deviceTimeLastSeen ?? null,
    timeMismatchFlag: profile?.timeMismatchFlag ?? false,
    lastTimeContextAt: profile?.lastTimeContextAt ?? null,
    themePreference: (profile?.themePreference as "dark" | "light" | "legacy") ?? null,
    phone: profile?.phone ?? null,
    phoneVerifiedAt: profile?.phoneVerifiedAt ?? null,
    emailVerifiedAt: resolvedEmailVerifiedAt,
    ageConfirmedAt: profile?.ageConfirmedAt ?? null,
    verificationMethod:
      profile?.verificationMethod === "PHONE" || profile?.verificationMethod === "EMAIL"
        ? profile.verificationMethod
        : null,
    hasPassword: !!(user as any).passwordHash,
    profileComplete: profile?.profileComplete ?? false,
    sleeperUsername: profile?.sleeperUsername ?? null,
    sleeperUserId: profile?.sleeperUserId ?? null,
    sleeperLinkedAt: profile?.sleeperLinkedAt ?? null,
    discordUserId: null,
    discordUsername: null,
    discordEmail: null,
    discordAvatar: null,
    discordGuildId: null,
    discordConnectedAt: null,
    spotifyDisplayName: profile?.spotifyDisplayName ?? null,
    spotifyConnectedAt: profile?.spotifyConnectedAt ?? null,
    bio: profile?.bio ?? null,
    preferredSports: null,
    notificationPreferences: null,
    onboardingStep: profile?.onboardingStep ?? null,
    onboardingCompletedAt: null,
    sessionIdleTimeoutMinutes: null,
    rankTier: null,
    xpLevel: null,
    xpTotal: null,
    rankCalculatedAt: null,
    careerWins: null,
    careerChampionships: null,
    careerSeasonsPlayed: null,
    careerLeaguesPlayed: null,
    chimmyTtsVoiceId: null,
    updatedAt: profile?.updatedAt ?? new Date(),
  }
}

export async function getSettingsSnapshot(
  userId: string
): Promise<SettingsSnapshot | null> {
  let baseProfile: Omit<UserProfileForSettings, "settings"> | null = null
  try {
    baseProfile = await queryBaseProfile(userId)
  } catch (err: unknown) {
    console.error(
      "[getSettingsSnapshot] queryBaseProfile failed (will retry minimal fields):",
      err instanceof Error ? err.message : err
    )
    try {
      baseProfile = await queryBaseProfileMinimal(userId)
      console.warn("[getSettingsSnapshot] recovered using SAFE_USER_PROFILE_SELECT only")
    } catch (err2: unknown) {
      console.error(
        "[getSettingsSnapshot] FULL ERROR (minimal profile):",
        err2 instanceof Error
          ? JSON.stringify({ name: err2.name, message: err2.message, stack: err2.stack }, null, 2)
          : JSON.stringify(err2, null, 2),
      )
      throw err2
    }
  }
  if (!baseProfile) return null

  const bootstrapped = resolveSharedProfileBootstrap({
    profile: baseProfile,
  })

  if (Object.keys(bootstrapped.patchPayload).length > 0) {
    await updateUserProfile(userId, bootstrapped.patchPayload)
  }

  const profileWithSettingsPlaceholder: UserProfileForSettings = {
    ...bootstrapped.profile,
    // One indexed lookup; the dispatcher reads it from here, so it costs no second query there.
    emailSubscription: await readEmailSubscription(bootstrapped.profile.email),
    settings: null,
  }

  const settings = await getUserSettingsRecord(
    userId,
    profileWithSettingsPlaceholder
  )

  const profile: UserProfileForSettings = {
    ...profileWithSettingsPlaceholder,
    settings,
  }

  return {
    profile,
    settings,
  }
}

export async function getSettingsProfile(
  userId: string
): Promise<UserProfileForSettings | null> {
  const snapshot = await getSettingsSnapshot(userId)
  return snapshot?.profile ?? null
}
