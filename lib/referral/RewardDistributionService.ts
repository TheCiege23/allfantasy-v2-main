/**
 * RewardDistributionService — configurable referral rewards with XP/badge integration.
 */

import { prisma } from "@/lib/prisma"
import { getTierFromXP, getXPRemainingToNextTier } from "@/lib/xp-progression/TierResolver"
import type {
  ReferralAudience,
  ReferralRewardDefinition,
  ReferralRewardKind,
  ReferralRewardStatus,
  ReferralRewardTriggerType,
  ReferralRewardView,
} from "./types"

export const REWARD_TYPE_SIGNUP = "referral_signup"

type ResolvedRewardDefinition = ReferralRewardDefinition & { id: string | null }

const REDEEM_RATE_LIMIT_PER_MINUTE = 20
const XP_SPORT = "MULTI"

const DEFAULT_REWARD_DEFINITIONS: readonly ReferralRewardDefinition[] = [
  {
    key: "default_referral_signup_xp",
    type: REWARD_TYPE_SIGNUP,
    label: "Referral XP",
    description: "Earn XP when a friend signs up with your referral code.",
    triggerType: "signup",
    audience: "all",
    rewardKind: "xp",
    value: 50,
    maxAwardsPerUser: 0,
    minSuccessfulReferrals: 0,
    isClaimable: true,
    isActive: true,
  },
  {
    key: "default_referral_onboarding_badge",
    type: "referral_onboarding_badge",
    label: "Referral Finisher badge",
    description: "Claim a badge when one of your referrals completes onboarding.",
    triggerType: "onboarding_completed",
    audience: "user",
    rewardKind: "badge",
    value: 25,
    badgeType: "referral_finisher",
    badgeName: "Referral Finisher",
    badgeDescription: "Brought a new manager all the way through onboarding.",
    badgeTier: "bronze",
    maxAwardsPerUser: 0,
    minSuccessfulReferrals: 0,
    isClaimable: true,
    isActive: true,
  },
  {
    key: "default_creator_onboarding_badge",
    type: "creator_referral_badge",
    label: "Creator growth badge",
    description: "Creators earn a higher-tier badge when a referred fan completes onboarding.",
    triggerType: "onboarding_completed",
    audience: "creator",
    rewardKind: "badge",
    value: 75,
    badgeType: "creator_growth",
    badgeName: "Creator Growth",
    badgeDescription: "Expanded your AllFantasy community with a completed referral.",
    badgeTier: "silver",
    maxAwardsPerUser: 0,
    minSuccessfulReferrals: 0,
    isClaimable: true,
    isActive: true,
  },
] as const

function normalizeRewardKind(value: string | null | undefined): ReferralRewardKind {
  switch ((value ?? "").trim().toLowerCase()) {
    case "badge":
      return "badge"
    case "perk":
      return "perk"
    case "bundle":
      return "bundle"
    case "xp":
    default:
      return "xp"
  }
}

function normalizeRewardStatus(value: string | null | undefined): ReferralRewardStatus {
  switch ((value ?? "").trim().toLowerCase()) {
    case "pending":
      return "pending"
    case "redeemed":
      return "redeemed"
    case "expired":
      return "expired"
    case "blocked":
      return "blocked"
    case "claimable":
    default:
      return "claimable"
  }
}

function matchesAudience(
  ruleAudience: "all" | ReferralAudience,
  referralAudience: ReferralAudience
): boolean {
  return ruleAudience === "all" || ruleAudience === referralAudience
}

function getClaimLabel(rewardKind: ReferralRewardKind): string {
  switch (rewardKind) {
    case "badge":
      return "Claim badge"
    case "perk":
      return "Unlock reward"
    case "bundle":
      return "Claim bundle"
    case "xp":
    default:
      return "Claim XP"
  }
}

function getHelperText(
  rewardKind: ReferralRewardKind,
  status: ReferralRewardStatus,
  description?: string | null
): string | null {
  if (status === "pending") {
    return "This reward will unlock after the referral reaches the next required milestone."
  }
  if (status === "redeemed") {
    return "Reward applied to your account."
  }
  if (description?.trim()) return description.trim()
  if (rewardKind === "xp") return "Adds referral XP to your progression profile."
  if (rewardKind === "badge") return "Awards a referral badge inside your achievement case."
  return "Referral reward ready to claim."
}

async function getResolvedRewardDefinitions(): Promise<ResolvedRewardDefinition[]> {
  const rules = await prisma.referralRewardRule.findMany({
    where: { isActive: true },
    orderBy: [{ triggerType: "asc" }, { createdAt: "asc" }],
  })

  if (rules.length === 0) {
    return DEFAULT_REWARD_DEFINITIONS.map((rule) => ({ ...rule, id: null }))
  }

  return rules.map((rule) => ({
    id: rule.id,
    key: rule.key,
    type: rule.type,
    label: rule.label,
    description: rule.description,
    triggerType: (rule.triggerType as ReferralRewardTriggerType) ?? "signup",
    audience: ((rule.audience as "all" | ReferralAudience) ?? "all"),
    rewardKind: normalizeRewardKind(rule.rewardKind),
    value: rule.value,
    badgeType: rule.badgeType,
    badgeName: rule.badgeName,
    badgeDescription: rule.badgeDescription,
    badgeTier: rule.badgeTier,
    maxAwardsPerUser: rule.maxAwardsPerUser,
    minSuccessfulReferrals: rule.minSuccessfulReferrals,
    isClaimable: rule.isClaimable,
    isActive: rule.isActive,
    config: (rule.config as Record<string, unknown> | null) ?? null,
  }))
}

async function getRewardDefinitionByType(type: string): Promise<ResolvedRewardDefinition | null> {
  const definitions = await getResolvedRewardDefinitions()
  return definitions.find((definition) => definition.type === type) ?? null
}

async function grantXPReward(userId: string, rewardType: string, value: number): Promise<void> {
  if (value <= 0) return

  await prisma.$transaction(async (tx) => {
    await tx.xPEvent.create({
      data: {
        managerId: userId,
        eventType: rewardType.startsWith("creator_") ? "creator_referral_bonus" : "referral_bonus",
        xpValue: value,
        sport: XP_SPORT,
      },
    })

    const aggregate = await tx.xPEvent.aggregate({
      where: { managerId: userId },
      _sum: { xpValue: true },
    })
    const totalXP = Number(aggregate._sum.xpValue ?? 0)

    await tx.managerXPProfile.upsert({
      where: { managerId: userId },
      create: {
        managerId: userId,
        totalXP,
        currentTier: getTierFromXP(totalXP),
        xpToNextTier: getXPRemainingToNextTier(totalXP),
      },
      update: {
        totalXP,
        currentTier: getTierFromXP(totalXP),
        xpToNextTier: getXPRemainingToNextTier(totalXP),
      },
    })
  })
}

async function grantBadgeReward(
  userId: string,
  definition: ResolvedRewardDefinition,
  rewardId: string
): Promise<void> {
  const badgeType = definition.badgeType ?? `${definition.type}_${rewardId}`
  const existing = await prisma.aIBadge.findFirst({
    where: { userId, badgeType },
    select: { id: true },
  })
  if (existing) return

  await prisma.aIBadge.create({
    data: {
      userId,
      badgeType,
      badgeName: definition.badgeName ?? definition.label,
      description: definition.badgeDescription ?? definition.description ?? definition.label,
      tier: definition.badgeTier ?? "bronze",
      xpReward: Math.max(0, definition.value),
      data: {
        source: "referral_reward",
        rewardId,
        rewardType: definition.type,
      },
    },
  })
}

async function applyReward(
  reward: {
    id: string
    userId: string
    type: string
    rewardKind: string
    value: number
  },
  definition: ResolvedRewardDefinition | null
): Promise<void> {
  const rewardKind = normalizeRewardKind(reward.rewardKind)
  if (rewardKind === "xp") {
    await grantXPReward(reward.userId, reward.type, reward.value)
    return
  }

  if (rewardKind === "badge") {
    const badgeDefinition =
      definition ??
      ({
        id: null,
        key: reward.type,
        type: reward.type,
        label: reward.type,
        description: reward.type,
        triggerType: "signup",
        audience: "all",
        rewardKind: "badge",
        value: reward.value,
        badgeType: reward.type,
        badgeName: reward.type,
        badgeDescription: reward.type,
        badgeTier: "bronze",
        maxAwardsPerUser: 0,
        minSuccessfulReferrals: 0,
        isClaimable: true,
        isActive: true,
        config: null,
      } satisfies ResolvedRewardDefinition)
    await grantBadgeReward(reward.userId, badgeDefinition, reward.id)
  }
}

async function getSuccessfulReferralCount(referrerId: string): Promise<number> {
  return prisma.referral.count({
    where: { referrerId, signupCompletedAt: { not: null } },
  })
}

export async function grantRewardsForTrigger(input: {
  referrerId: string
  referralId: string
  audience: ReferralAudience
  triggerType: ReferralRewardTriggerType
}): Promise<{ created: number }> {
  const successfulReferralCount = await getSuccessfulReferralCount(input.referrerId)
  const definitions = (await getResolvedRewardDefinitions()).filter(
    (definition) =>
      definition.isActive &&
      definition.triggerType === input.triggerType &&
      matchesAudience(definition.audience, input.audience) &&
      successfulReferralCount >= definition.minSuccessfulReferrals
  )

  let created = 0
  for (const definition of definitions) {
    const existing = await prisma.referralReward.findFirst({
      where: {
        userId: input.referrerId,
        referralId: input.referralId,
        type: definition.type,
      },
      select: { id: true },
    })
    if (existing) continue

    if (definition.maxAwardsPerUser > 0) {
      const existingCount = await prisma.referralReward.count({
        where: {
          userId: input.referrerId,
          type: definition.type,
        },
      })
      if (existingCount >= definition.maxAwardsPerUser) continue
    }

    await prisma.$transaction(async (tx) => {
      await tx.referralReward.create({
        data: {
          userId: input.referrerId,
          referralId: input.referralId,
          rewardRuleId: definition.id ?? undefined,
          type: definition.type,
          rewardKind: definition.rewardKind,
          label: definition.label,
          value: definition.value,
          status: definition.isClaimable ? "claimable" : "pending",
          metadata: {
            description: definition.description ?? null,
            badgeType: definition.badgeType ?? null,
            triggerType: definition.triggerType,
          },
        },
      })

      await tx.referralEvent.create({
        data: {
          referrerId: input.referrerId,
          referralId: input.referralId,
          type: "reward_granted",
          metadata: {
            rewardType: definition.type,
            rewardKind: definition.rewardKind,
            triggerType: definition.triggerType,
          },
        },
      })
    })
    created += 1
  }

  if (created > 0) {
    await prisma.referral.update({
      where: { id: input.referralId },
      data: { rewardGrantedAt: new Date() },
    })
  }

  return { created }
}

export async function grantRewardForSignup(
  referrerId: string,
  options?: { referralId?: string | null; audience?: ReferralAudience }
): Promise<{ id: string | null; created: number }> {
  if (!options?.referralId) {
    const reward = await prisma.referralReward.create({
      data: {
        userId: referrerId,
        type: REWARD_TYPE_SIGNUP,
        rewardKind: "xp",
        label: "Referral XP",
        value: 50,
        status: "claimable",
        metadata: { description: "Earn XP when a friend signs up with your referral code." },
      },
      select: { id: true },
    })
    return { id: reward.id, created: 1 }
  }

  const result = await grantRewardsForTrigger({
    referrerId,
    referralId: options.referralId,
    audience: options.audience ?? "user",
    triggerType: "signup",
  })

  const latest = await prisma.referralReward.findFirst({
    where: {
      userId: referrerId,
      referralId: options.referralId,
    },
    orderBy: { grantedAt: "desc" },
    select: { id: true },
  })

  return { id: latest?.id ?? null, created: result.created }
}

export async function listRewards(userId: string): Promise<ReferralRewardView[]> {
  const rewards = await prisma.referralReward.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { grantedAt: "desc" }],
    select: {
      id: true,
      type: true,
      rewardKind: true,
      label: true,
      value: true,
      status: true,
      grantedAt: true,
      redeemedAt: true,
      metadata: true,
    },
  })

  const definitions = await getResolvedRewardDefinitions()
  const definitionByType = new Map(definitions.map((definition) => [definition.type, definition]))

  return rewards.map((reward) => {
    const definition = definitionByType.get(reward.type)
    const rewardKind = normalizeRewardKind(reward.rewardKind)
    const status = normalizeRewardStatus(reward.status)
    const description =
      typeof (reward.metadata as Record<string, unknown> | null)?.description === "string"
        ? String((reward.metadata as Record<string, unknown>).description)
        : definition?.description ?? null
    const badgeType =
      typeof (reward.metadata as Record<string, unknown> | null)?.badgeType === "string"
        ? String((reward.metadata as Record<string, unknown>).badgeType)
        : definition?.badgeType ?? null

    return {
      id: reward.id,
      type: reward.type,
      rewardKind,
      label: reward.label ?? definition?.label ?? reward.type,
      description,
      value: reward.value,
      status,
      grantedAt: reward.grantedAt.toISOString(),
      redeemedAt: reward.redeemedAt?.toISOString() ?? null,
      claimLabel: getClaimLabel(rewardKind),
      helperText: getHelperText(rewardKind, status, description),
      badgeType,
    }
  })
}

export async function redeemReward(
  rewardId: string,
  userId: string
): Promise<{ ok: true; reward: ReferralRewardView } | { ok: false; error: string }> {
  const reward = await prisma.referralReward.findFirst({
    where: { id: rewardId, userId },
    select: {
      id: true,
      userId: true,
      type: true,
      rewardKind: true,
      label: true,
      value: true,
      status: true,
      grantedAt: true,
      redeemedAt: true,
      metadata: true,
    },
  })
  if (!reward) return { ok: false, error: "Reward not found" }

  const status = normalizeRewardStatus(reward.status)
  if (status === "redeemed") return { ok: false, error: "Already claimed" }
  if (status !== "claimable") return { ok: false, error: "Reward is not claimable yet" }

  const since = new Date()
  since.setMinutes(since.getMinutes() - 1)
  const recentRedeems = await prisma.referralReward.count({
    where: { userId, status: "redeemed", redeemedAt: { gte: since } },
  })
  if (recentRedeems >= REDEEM_RATE_LIMIT_PER_MINUTE) {
    return { ok: false, error: "Too many claims; try again shortly" }
  }

  const redeemedAt = new Date()
  await prisma.referralReward.update({
    where: { id: rewardId },
    data: { status: "redeemed", redeemedAt },
  })

  const definition = await getRewardDefinitionByType(reward.type)
  await applyReward(
    {
      id: reward.id,
      userId: reward.userId,
      type: reward.type,
      rewardKind: reward.rewardKind,
      value: reward.value,
    },
    definition
  )

  await prisma.referralEvent.create({
    data: {
      referrerId: userId,
      type: "reward_redeemed",
      metadata: {
        rewardId: reward.id,
        rewardType: reward.type,
        rewardKind: reward.rewardKind,
      },
    },
  })

  const view = (await listRewards(userId)).find((entry) => entry.id === rewardId)
  if (!view) {
    return { ok: false, error: "Reward state could not be refreshed" }
  }

  return { ok: true, reward: view }
}

export function getRewardLabel(type: string): string {
  const fallback = DEFAULT_REWARD_DEFINITIONS.find((definition) => definition.type === type)
  return fallback?.label ?? type
}
