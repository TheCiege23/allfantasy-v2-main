import { prisma } from "@/lib/prisma"
import { Prisma } from "@prisma/client"
import type {
  LegacyImportConnectionStatus,
  LegacyImportProviderId,
  ProviderConnectionStatus,
  SignInProviderId,
  UserProfileForSettings,
  UserSettingsRecord,
  UserSettingsUpdatePayload,
} from "./types"

const SIGN_IN_PROVIDER_IDS: SignInProviderId[] = [
  "google",
  "apple",
  "spotify",
  "facebook",
  "instagram",
  "x",
  "tiktok",
]

const SIGN_IN_PROVIDER_NAMES: Record<SignInProviderId, string> = {
  google: "Google",
  apple: "Apple",
  spotify: "Spotify",
  facebook: "Facebook",
  instagram: "Instagram",
  x: "X (Twitter)",
  tiktok: "TikTok",
}

const LEGACY_PROVIDER_IDS: LegacyImportProviderId[] = [
  "sleeper",
  "yahoo",
  "espn",
  "mfl",
  "fleaflicker",
  "fantrax",
]

function isProviderConfigured(providerId: SignInProviderId): boolean {
  switch (providerId) {
    case "google":
      return !!(
        process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
      )
    case "apple":
      return !!(process.env.APPLE_CLIENT_ID && process.env.APPLE_CLIENT_SECRET)
    case "facebook":
    case "spotify":
    case "instagram":
    case "x":
    case "tiktok":
      return false
    default:
      return false
  }
}

function normalizeProviderForSettings(provider: string): SignInProviderId | null {
  const lowered = provider.trim().toLowerCase()
  if (lowered === "twitter") return "x"
  if (SIGN_IN_PROVIDER_IDS.includes(lowered as SignInProviderId)) {
    return lowered as SignInProviderId
  }
  return null
}

function resolveSecurityRecoveryMethods(
  profile: UserProfileForSettings
): ("email" | "phone")[] {
  const methods: ("email" | "phone")[] = []
  if (profile.email && profile.emailVerifiedAt) methods.push("email")
  if (profile.phone && profile.phoneVerifiedAt) methods.push("phone")
  return methods
}

async function resolveProviderConnections(
  userId: string
): Promise<ProviderConnectionStatus[]> {
  const accounts = await (prisma as any).authAccount
    .findMany({
      where: { userId },
      select: { provider: true },
    })
    .catch(() => [])

  const linkedSet = new Set(
    (accounts as { provider: string }[])
      .map((entry) => normalizeProviderForSettings(entry.provider))
      .filter(Boolean) as SignInProviderId[]
  )

  return SIGN_IN_PROVIDER_IDS.map((providerId) => ({
    id: providerId,
    name: SIGN_IN_PROVIDER_NAMES[providerId],
    configured: isProviderConfigured(providerId),
    linked: linkedSet.has(providerId),
  }))
}

async function resolveSleeperImportConnection(
  sleeperUsername: string | null
): Promise<LegacyImportConnectionStatus> {
  const normalizedSleeperUsername = sleeperUsername?.trim().toLowerCase() ?? null
  if (!normalizedSleeperUsername) {
    return {
      id: "sleeper",
      linked: false,
      available: true,
      importStatus: null,
    }
  }

  const legacyUser = await (prisma as any).legacyUser
    .findUnique({
      where: { sleeperUsername: normalizedSleeperUsername },
      select: { id: true },
    })
    .catch(() => null)

  if (!legacyUser) {
    return {
      id: "sleeper",
      linked: true,
      available: true,
      importStatus: "not_started",
    }
  }

  const lastJob = await (prisma as any).legacyImportJob
    .findFirst({
      where: { userId: legacyUser.id },
      orderBy: { createdAt: "desc" },
      select: { status: true, completedAt: true, error: true },
    })
    .catch(() => null)

  return {
    id: "sleeper",
    linked: true,
    available: true,
    importStatus: lastJob?.status ?? "none",
    lastJobAt: lastJob?.completedAt
      ? new Date(lastJob.completedAt).toISOString()
      : undefined,
    error: lastJob?.error ?? undefined,
  }
}

async function resolveImportConnections(
  profile: UserProfileForSettings
): Promise<LegacyImportConnectionStatus[]> {
  const sleeper = await resolveSleeperImportConnection(profile.sleeperUsername)
  const placeholders = LEGACY_PROVIDER_IDS.filter((id) => id !== "sleeper").map(
    (id): LegacyImportConnectionStatus => ({
      id,
      linked: false,
      available: false,
      importStatus: null,
    })
  )
  return [sleeper, ...placeholders]
}

export async function getUserSettingsRecord(
  userId: string,
  profile: UserProfileForSettings
): Promise<UserSettingsRecord> {
  const [providerConnections, importConnections] = await Promise.all([
    resolveProviderConnections(userId),
    resolveImportConnections(profile),
  ])

  const acceptedAt = profile.ageConfirmedAt
    ? profile.ageConfirmedAt.toISOString()
    : null

  return {
    userId,
    notificationSettings: profile.notificationPreferences ?? null,
    providerConnections,
    importConnections,
    legalAcceptanceState: {
      ageVerified: !!profile.ageConfirmedAt,
      termsAccepted: !!profile.ageConfirmedAt,
      disclaimerAccepted: !!profile.ageConfirmedAt,
      acceptedAt,
    },
    securityPreferences: {
      emailVerified: !!profile.emailVerifiedAt,
      phoneVerified: !!profile.phoneVerifiedAt,
      hasPassword: profile.hasPassword,
      recoveryMethods: resolveSecurityRecoveryMethods(profile),
    },
    updatedAt: profile.updatedAt,
  }
}

export async function saveUserSettings(
  userId: string,
  payload: UserSettingsUpdatePayload
): Promise<{ ok: boolean; error?: string }> {
  try {
    if (payload.notificationSettings !== undefined) {
      const notificationSettingsValue =
        payload.notificationSettings === null
          ? Prisma.JsonNull
          : (payload.notificationSettings as Prisma.InputJsonValue)
      await prisma.userProfile.upsert({
        where: { userId },
        update: { notificationPreferences: notificationSettingsValue },
        create: {
          userId,
          notificationPreferences: notificationSettingsValue,
        },
      })
    }
    return { ok: true }
  } catch (error) {
    console.error("[UserSettingsService] saveUserSettings error:", error)
    return { ok: false, error: "Failed to save settings" }
  }
}
