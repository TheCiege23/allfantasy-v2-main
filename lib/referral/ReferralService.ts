/**
 * ReferralService — referral codes, attribution, onboarding tracking, and stats.
 */

import * as prismaJson from '@/lib/prisma-json'
import { Prisma } from "@prisma/client"
import crypto from "crypto"
import { prisma } from "@/lib/prisma"
import { grantRewardForSignup, grantRewardsForTrigger } from "./RewardDistributionService"
import type {
  ReferralAudience,
  ReferralStats,
  ReferredUserView,
} from "./types"

const REFERRAL_CODE_LENGTH = 10
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
const ONBOARDING_COMPLETION_STEPS = new Set([
  "onboarding_first_league",
  "onboarding_first_ai",
  "onboarding_completed",
  "completed",
])

function generateCode(): string {
  let code = ""
  const bytes = crypto.randomBytes(REFERRAL_CODE_LENGTH)
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i += 1) {
    code += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length]
  }
  return code
}

function normalizeAudience(isCreator: boolean): ReferralAudience {
  return isCreator ? "creator" : "user"
}

export async function getOrCreateReferralCode(userId: string): Promise<{ code: string }> {
  const existing = await prisma.referralCode.findFirst({
    where: { userId, status: "active" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { code: true },
  })
  if (existing) return { code: existing.code }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode()
    const found = await prisma.referralCode.findUnique({ where: { code }, select: { id: true } })
    if (found) continue

    await prisma.referralCode.create({
      data: {
        userId,
        code,
        isPrimary: true,
        status: "active",
      },
    })
    return { code }
  }

  const fallback = `${generateCode()}${Date.now().toString(36).slice(-4)}`.slice(0, 14)
  await prisma.referralCode.create({
    data: {
      userId,
      code: fallback,
      isPrimary: true,
      status: "active",
    },
  })
  return { code: fallback }
}

export function buildReferralLink(code: string, baseUrl: string): string {
  const base = baseUrl.replace(/\/$/, "")
  return `${base}/?ref=${encodeURIComponent(code)}`
}

export async function getReferrerIdByCode(code: string): Promise<string | null> {
  const row = await prisma.referralCode.findUnique({
    where: { code: code.trim().toUpperCase() },
    select: { userId: true, status: true },
  })
  if (!row || row.status !== "active") return null
  return row.userId
}

export async function recordClick(
  referrerId: string,
  metadata?: { userAgent?: string; referralCode?: string | null }
): Promise<void> {
  const normalizedCode = metadata?.referralCode?.trim().toUpperCase() ?? null
  const code = normalizedCode
    ? await prisma.referralCode.findUnique({
        where: { code: normalizedCode },
        select: { id: true },
      })
    : null

  await prisma.$transaction(async (tx) => {
    await tx.referralEvent.create({
      data: {
        referrerId,
        codeId: code?.id,
        type: "click",
        metadata: {
          userAgent: metadata?.userAgent ?? null,
        },
      },
    })

    if (code?.id) {
      await tx.referralCode.update({
        where: { id: code.id },
        data: {
          lastUsedAt: new Date(),
        },
      })
    }
  })
}

export async function recordShare(
  referrerId: string,
  channel: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const code = await prisma.referralCode.findFirst({
    where: { userId: referrerId, status: "active" },
    orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  })

  await prisma.$transaction(async (tx) => {
    await tx.referralEvent.create({
      data: {
        referrerId,
        codeId: code?.id,
        type: "share",
        channel,
        metadata: prismaJson.toPrismaNullableJsonInput(metadata ?? undefined),
      },
    })

    if (code?.id) {
      await tx.referralCode.update({
        where: { id: code.id },
        data: {
          shareCount: { increment: 1 },
          lastSharedAt: new Date(),
        },
      })
    }
  })
}

export async function attributeSignup(
  referredUserId: string,
  referralCode: string
): Promise<{ referrerId: string; referralId: string; audience: ReferralAudience } | null> {
  const normalizedCode = referralCode.trim().toUpperCase()
  const code = await prisma.referralCode.findUnique({
    where: { code: normalizedCode },
    select: {
      id: true,
      userId: true,
      status: true,
      user: {
        select: {
          creatorProfile: { select: { id: true } },
        },
      },
    },
  })

  if (!code || code.status !== "active") return null
  return attributeSignupToReferrer(referredUserId, code.userId, {
    referralCodeId: code.id,
    audience: normalizeAudience(!!code.user.creatorProfile),
  })
}

export async function attributeSignupToReferrer(
  referredUserId: string,
  referrerId: string,
  options?: { referralCodeId?: string | null; audience?: ReferralAudience }
): Promise<{ referrerId: string; referralId: string; audience: ReferralAudience } | null> {
  if (!referrerId || referrerId === referredUserId) return null

  const audience = options?.audience ?? "user"
  const existing = await prisma.referral.findFirst({
    where: { referredUserId },
    select: { id: true, referrerId: true, kind: true },
  })
  if (existing) {
    return existing.referrerId === referrerId
      ? {
          referrerId,
          referralId: existing.id,
          audience: (existing.kind as ReferralAudience) ?? audience,
        }
      : null
  }

  try {
    const created = await prisma.$transaction(async (tx) => {
      const referral = await tx.referral.create({
        data: {
          referrerId,
          referredUserId,
          referralCodeId: options?.referralCodeId ?? undefined,
          kind: audience,
          status: "signed_up",
          signupCompletedAt: new Date(),
        },
        select: { id: true },
      })

      await tx.referralEvent.create({
        data: {
          referrerId,
          referredUserId,
          referralId: referral.id,
          codeId: options?.referralCodeId ?? undefined,
          type: "signup",
        },
      })

      if (options?.referralCodeId) {
        await tx.referralCode.update({
          where: { id: options.referralCodeId },
          data: {
            successfulReferralCount: { increment: 1 },
            lastUsedAt: new Date(),
          },
        })
      }

      return referral
    })

    await grantRewardForSignup(referrerId, {
      referralId: created.id,
      audience,
    })

    return { referrerId, referralId: created.id, audience }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
      throw error
    }
    const raced = await prisma.referral.findFirst({
      where: { referredUserId },
      select: { id: true, referrerId: true, kind: true },
    })
    if (!raced || raced.referrerId !== referrerId) return null
    return {
      referrerId,
      referralId: raced.id,
      audience: (raced.kind as ReferralAudience) ?? audience,
    }
  }
}

export async function recordReferralOnboardingStep(
  referredUserId: string,
  step: string,
  metadata?: Record<string, unknown>
): Promise<{ updated: boolean; referralId: string | null }> {
  const referral = await prisma.referral.findFirst({
    where: { referredUserId },
    select: {
      id: true,
      referrerId: true,
      kind: true,
      onboardingStartedAt: true,
      onboardingCompletedAt: true,
    },
  })
  if (!referral) return { updated: false, referralId: null }

  const now = new Date()
  const completed = ONBOARDING_COMPLETION_STEPS.has(step)

  await prisma.$transaction(async (tx) => {
    await tx.referral.update({
      where: { id: referral.id },
      data: {
        onboardingStep: step,
        onboardingStartedAt: referral.onboardingStartedAt ?? now,
        onboardingCompletedAt: completed ? referral.onboardingCompletedAt ?? now : referral.onboardingCompletedAt,
        status: completed ? "onboarded" : "engaged",
      },
    })

    await tx.referralEvent.create({
      data: {
        referrerId: referral.referrerId,
        referredUserId,
        referralId: referral.id,
        type: "onboarding_step",
        onboardingStep: step,
        metadata: prismaJson.toPrismaNullableJsonInput(metadata ?? undefined),
      },
    })
  })

  if (completed && !referral.onboardingCompletedAt) {
    await grantRewardsForTrigger({
      referrerId: referral.referrerId,
      referralId: referral.id,
      audience: (referral.kind as ReferralAudience) ?? "user",
      triggerType: "onboarding_completed",
    })
  }

  return { updated: true, referralId: referral.id }
}

export async function getReferralStats(userId: string): Promise<ReferralStats> {
  const [clicks, shares, signups, onboarded, creatorReferrals, rewardCounts, rewardValue] = await Promise.all([
    prisma.referralEvent.count({ where: { referrerId: userId, type: "click" } }),
    prisma.referralEvent.count({ where: { referrerId: userId, type: "share" } }),
    prisma.referral.count({ where: { referrerId: userId, signupCompletedAt: { not: null } } }),
    prisma.referral.count({ where: { referrerId: userId, onboardingCompletedAt: { not: null } } }),
    prisma.referral.count({ where: { referrerId: userId, kind: "creator", signupCompletedAt: { not: null } } }),
    prisma.referralReward.groupBy({
      by: ["status"],
      where: { userId },
      _count: { id: true },
    }),
    prisma.referralReward.aggregate({
      where: { userId, status: "redeemed" },
      _sum: { value: true },
    }),
  ])

  const rewardCountMap = new Map(
    rewardCounts.map((entry) => [entry.status.toLowerCase(), entry._count.id ?? 0])
  )

  return {
    clicks,
    shares,
    signups,
    onboarded,
    creatorReferrals,
    claimableRewards: rewardCountMap.get("claimable") ?? 0,
    pendingRewards: rewardCountMap.get("pending") ?? 0,
    redeemedRewards: rewardCountMap.get("redeemed") ?? 0,
    totalRewardValue: Number(rewardValue._sum.value ?? 0),
    conversionRate: clicks > 0 ? Number(((signups / clicks) * 100).toFixed(1)) : 0,
  }
}

export async function getReferredUsers(referrerId: string): Promise<ReferredUserView[]> {
  const referrals = await prisma.referral.findMany({
    where: { referrerId, referredUserId: { not: null } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: {
      referredUserId: true,
      kind: true,
      status: true,
      onboardingStep: true,
      createdAt: true,
    },
  })
  const userIds = referrals
    .map((referral) => referral.referredUserId)
    .filter((value): value is string => Boolean(value))

  const users = userIds.length
    ? await prisma.appUser.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true },
      })
    : []
  const userMap = new Map(users.map((user) => [user.id, user]))

  return referrals.map((referral) => ({
    referredUserId: referral.referredUserId!,
    displayName: userMap.get(referral.referredUserId!)?.displayName ?? null,
    createdAt: referral.createdAt.toISOString(),
    status: (referral.status as ReferredUserView["status"]) ?? "signed_up",
    kind: (referral.kind as ReferralAudience) ?? "user",
    onboardingStep: referral.onboardingStep ?? null,
  }))
}
