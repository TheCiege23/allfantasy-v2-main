import { RANK_LEVELS, getLevelFromXp } from "@/lib/rank/levels"
import { getTierFromXP, getXPRemainingToNextTier } from "@/lib/xp-progression/TierResolver"
import { MANAGER_CLASS_BAND } from "@/lib/league-join/managerClass"

const MAX_TIER = RANK_LEVELS.length

export interface ResolvedCareerTierProfile {
  userId: string | null
  careerTier: number
  tierName: string
  totalXP: number
  source: "user_profile" | "xp_profile" | "legacy_cache" | "seeded_default" | "fallback"
  seededProfile: boolean
}

export function clampCareerTier(value: unknown, fallback = 1): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return Math.max(1, Math.min(MAX_TIER, Math.floor(fallback)))
  return Math.max(1, Math.min(MAX_TIER, Math.floor(n)))
}

function readTierCandidate(raw: Record<string, unknown>): unknown {
  if (raw.requiredCareerTier != null) return raw.requiredCareerTier
  if (raw.leagueTier != null) return raw.leagueTier
  if (raw.careerTier != null) return raw.careerTier
  if (raw.minCareerTier != null) return raw.minCareerTier
  if (raw.tier != null) return raw.tier
  return null
}

export function extractLeagueCareerTier(scoringRules: unknown, fallbackTier: number): number {
  if (scoringRules == null || typeof scoringRules !== "object" || Array.isArray(scoringRules)) {
    return clampCareerTier(fallbackTier)
  }

  const raw = scoringRules as Record<string, unknown>
  const candidate = readTierCandidate(raw)
  return clampCareerTier(candidate, clampCareerTier(fallbackTier))
}

/**
 * Discovery shows a league when it sits inside the viewer's manager-class band —
 * the same ±2 the join gate enforces (`lib/league-join/managerClass.ts`). Was ±1
 * until 2026-10-01, so discovery hid leagues a manager was allowed to join.
 */
export function isLeagueVisibleForCareerTier(userTier: number, leagueTier: number, distance = MANAGER_CLASS_BAND): boolean {
  const safeUserTier = clampCareerTier(userTier)
  const safeLeagueTier = clampCareerTier(leagueTier)
  return Math.abs(safeUserTier - safeLeagueTier) <= Math.max(0, Math.floor(distance))
}

export function getCareerTierFromTotalXP(totalXP: number): number {
  const safeXP = Math.max(0, Math.floor(Number.isFinite(totalXP) ? totalXP : 0))
  const resolved = getLevelFromXp(safeXP)
  return clampCareerTier(resolved.level, 1)
}

export function getCareerTierName(tier: number): string {
  const safeTier = clampCareerTier(tier, 1)
  const row = RANK_LEVELS.find((r) => r.level === safeTier)
  return row?.name ?? RANK_LEVELS[0]?.name ?? "Undrafted"
}

export function getMinimumXPForCareerTier(tier: number): number {
  const safeTier = clampCareerTier(tier, 1)
  const row = RANK_LEVELS.find((r) => r.level === safeTier) ?? RANK_LEVELS[0]
  return row?.minXp ?? 0
}

async function readUserProfileLevel(
  prismaLike: any,
  userId: string,
): Promise<{ level: number; xp: number | null } | null> {
  if (typeof prismaLike?.userProfile?.findUnique !== "function") return null
  try {
    const profile = await prismaLike.userProfile.findUnique({
      where: { userId },
      select: { xpLevel: true, legacyCareerLevel: true, xpTotal: true },
    })
    const raw = profile?.xpLevel ?? profile?.legacyCareerLevel
    if (raw == null) return null
    const xp = profile?.xpTotal == null ? null : Number(profile.xpTotal)
    return { level: clampCareerTier(raw, 1), xp: xp != null && Number.isFinite(xp) ? xp : null }
  } catch {
    return null
  }
}

export async function ensureUserCareerTier(
  prismaLike: any,
  userId: string | null | undefined,
  fallback = 1
): Promise<ResolvedCareerTierProfile> {
  const safeFallback = clampCareerTier(fallback, 1)
  if (!userId) {
    return {
      userId: null,
      careerTier: safeFallback,
      tierName: getCareerTierName(safeFallback),
      totalXP: getMinimumXPForCareerTier(safeFallback),
      source: "fallback",
      seededProfile: false,
    }
  }

  /*
   * ⚠ THE LADDER LEVEL FIRST. `UserProfile.xpLevel` is the level the Rankings tab
   * shows and the join gate checks. `ManagerXPProfile.totalXP` below is a
   * DIFFERENT XP system (Bronze–Legendary GM, 0–1000) and pushing it through the
   * 350,000-XP ladder put nearly every manager at Level 1–5 in discovery while the
   * join gate saw their real level. It stays as the fallback for managers who
   * have never had a ladder level calculated.
   */
  const profileLevel = await readUserProfileLevel(prismaLike, userId)
  if (profileLevel != null) {
    return {
      userId,
      careerTier: profileLevel.level,
      tierName: getCareerTierName(profileLevel.level),
      totalXP: profileLevel.xp ?? getMinimumXPForCareerTier(profileLevel.level),
      source: "user_profile",
      seededProfile: false,
    }
  }

  try {
    const [appUser, xpProfile] = await Promise.all([
      prismaLike.appUser.findUnique({
        where: { id: userId },
        select: {
          id: true,
          legacyUser: {
            select: {
              rankCache: {
                select: {
                  careerTier: true,
                },
              },
            },
          },
        },
      }),
      prismaLike.managerXPProfile.findUnique({
        where: { managerId: userId },
        select: {
          totalXP: true,
        },
      }),
    ])

    if (xpProfile) {
      const totalXP = Math.max(0, Number(xpProfile.totalXP ?? 0))
      const careerTier = getCareerTierFromTotalXP(totalXP)
      return {
        userId,
        careerTier,
        tierName: getCareerTierName(careerTier),
        totalXP,
        source: "xp_profile",
        seededProfile: false,
      }
    }

    const legacyTier = clampCareerTier(appUser?.legacyUser?.rankCache?.careerTier, safeFallback)
    const seedTier = legacyTier
    const seedXP = getMinimumXPForCareerTier(seedTier)
    const seededCurrentTier = getTierFromXP(seedXP)
    const seededXpToNextTier = getXPRemainingToNextTier(seedXP)

    if (appUser?.id) {
      await prismaLike.managerXPProfile.upsert({
        where: { managerId: userId },
        create: {
          managerId: userId,
          totalXP: seedXP,
          currentTier: seededCurrentTier,
          xpToNextTier: seededXpToNextTier,
        },
        update: {
          totalXP: seedXP,
          currentTier: seededCurrentTier,
          xpToNextTier: seededXpToNextTier,
        },
      })
    }

    return {
      userId,
      careerTier: seedTier,
      tierName: getCareerTierName(seedTier),
      totalXP: seedXP,
      source: appUser?.legacyUser?.rankCache?.careerTier != null ? "legacy_cache" : "seeded_default",
      seededProfile: !!appUser?.id,
    }
  } catch {
    return {
      userId,
      careerTier: safeFallback,
      tierName: getCareerTierName(safeFallback),
      totalXP: getMinimumXPForCareerTier(safeFallback),
      source: "fallback",
      seededProfile: false,
    }
  }
}

export async function resolveUserCareerTier(
  prismaLike: any,
  userId: string | null | undefined,
  fallback = 1
): Promise<number> {
  const resolved = await ensureUserCareerTier(prismaLike, userId, fallback)
  return clampCareerTier(resolved.careerTier, fallback)
}
