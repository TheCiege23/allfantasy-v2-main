/**
 * Referral leaderboard and creator referral tiers.
 */

import { prisma } from "@/lib/prisma"
import type { LeaderboardSort, ReferralAudience, ReferralLeaderboardEntry, ReferralProgress } from "./types"

const REFERRAL_TIERS = [
  { minSignups: 0, id: "starter", label: "Starter" },
  { minSignups: 3, id: "bronze", label: "Bronze Ambassador" },
  { minSignups: 10, id: "silver", label: "Silver Ambassador" },
  { minSignups: 25, id: "gold", label: "Gold Ambassador" },
  { minSignups: 50, id: "elite", label: "Elite Ambassador" },
  { minSignups: 100, id: "legend", label: "Legend" },
] as const

export function getTierForSignups(
  signups: number,
  _audience?: ReferralAudience
): { id: string; label: string } {
  let matched: (typeof REFERRAL_TIERS)[number] = REFERRAL_TIERS[0]
  for (const tier of REFERRAL_TIERS) {
    if (signups >= tier.minSignups) matched = tier
  }
  return { id: matched.id, label: matched.label }
}

type LeaderboardAggregate = {
  signups: number
  clicks: number
  shares: number
  onboarded: number
  redeemedRewards: number
}

export async function getReferralLeaderboard(
  options: { limit?: number; sortBy?: LeaderboardSort } = {}
): Promise<ReferralLeaderboardEntry[]> {
  const limit = Math.min(options.limit ?? 50, 100)
  const sortBy = options.sortBy ?? "signups"

  const [signupCounts, onboardedCounts, clickCounts, shareCounts, redeemedCounts] = await Promise.all([
    prisma.referral.groupBy({
      by: ["referrerId"],
      where: { signupCompletedAt: { not: null } },
      _count: { id: true },
    }),
    prisma.referral.groupBy({
      by: ["referrerId"],
      where: { onboardingCompletedAt: { not: null } },
      _count: { id: true },
    }),
    prisma.referralEvent.groupBy({
      by: ["referrerId"],
      where: { type: "click" },
      _count: { id: true },
    }),
    prisma.referralEvent.groupBy({
      by: ["referrerId"],
      where: { type: "share" },
      _count: { id: true },
    }),
    prisma.referralReward.groupBy({
      by: ["userId"],
      where: { status: "redeemed" },
      _count: { id: true },
    }),
  ])

  const userIds = [...new Set([
    ...signupCounts.map((row) => row.referrerId),
    ...onboardedCounts.map((row) => row.referrerId),
    ...clickCounts.map((row) => row.referrerId),
    ...shareCounts.map((row) => row.referrerId),
    ...redeemedCounts.map((row) => row.userId),
  ])]

  if (userIds.length === 0) return []

  const users = await prisma.appUser.findMany({
    where: { id: { in: userIds } },
    select: {
      id: true,
      displayName: true,
      username: true,
      avatarUrl: true,
      creatorProfile: { select: { id: true } },
    },
  })

  const aggregateMap = new Map<string, LeaderboardAggregate>()
  for (const userId of userIds) {
    aggregateMap.set(userId, {
      signups: signupCounts.find((row) => row.referrerId === userId)?._count.id ?? 0,
      clicks: clickCounts.find((row) => row.referrerId === userId)?._count.id ?? 0,
      shares: shareCounts.find((row) => row.referrerId === userId)?._count.id ?? 0,
      onboarded: onboardedCounts.find((row) => row.referrerId === userId)?._count.id ?? 0,
      redeemedRewards: redeemedCounts.find((row) => row.userId === userId)?._count.id ?? 0,
    })
  }

  const entries = users.map<ReferralLeaderboardEntry>((user) => {
    const aggregate = aggregateMap.get(user.id) ?? {
      signups: 0,
      clicks: 0,
      shares: 0,
      onboarded: 0,
      redeemedRewards: 0,
    }
    const tier = getTierForSignups(aggregate.signups, user.creatorProfile ? "creator" : "user")
    return {
      rank: 0,
      userId: user.id,
      displayName: user.displayName ?? null,
      username: user.username,
      avatarUrl: user.avatarUrl ?? null,
      isCreator: !!user.creatorProfile,
      signups: aggregate.signups,
      clicks: aggregate.clicks,
      shares: aggregate.shares,
      onboarded: aggregate.onboarded,
      redeemedRewards: aggregate.redeemedRewards,
      tier: tier.label,
    }
  })

  const sortKey: keyof LeaderboardAggregate =
    sortBy === "clicks"
      ? "clicks"
      : sortBy === "rewards"
        ? "redeemedRewards"
        : sortBy === "onboarded"
          ? "onboarded"
          : "signups"

  entries.sort((left, right) => {
    const leftValue = aggregateMap.get(left.userId)?.[sortKey] ?? 0
    const rightValue = aggregateMap.get(right.userId)?.[sortKey] ?? 0
    if (rightValue !== leftValue) return rightValue - leftValue
    return left.username.localeCompare(right.username)
  })

  return entries.slice(0, limit).map((entry, index) => ({
    ...entry,
    rank: index + 1,
  }))
}

export async function getReferrerProgress(userId: string): Promise<ReferralProgress> {
  const [stats, creatorProfile] = await Promise.all([
    Promise.all([
      prisma.referral.count({ where: { referrerId: userId, signupCompletedAt: { not: null } } }),
      prisma.referralEvent.count({ where: { referrerId: userId, type: "click" } }),
      prisma.referralEvent.count({ where: { referrerId: userId, type: "share" } }),
      prisma.referral.count({ where: { referrerId: userId, onboardingCompletedAt: { not: null } } }),
      prisma.referralReward.count({ where: { userId, status: "claimable" } }),
      prisma.referralReward.count({ where: { userId, status: "pending" } }),
      prisma.referralReward.count({ where: { userId, status: "redeemed" } }),
    ]),
    prisma.creatorProfile.findUnique({
      where: { userId },
      select: { id: true },
    }),
  ])

  const [signups, clicks, shares, onboarded, claimableRewards, pendingRewards, redeemedRewards] = stats
  const audience: ReferralAudience = creatorProfile ? "creator" : "user"
  const tier = getTierForSignups(signups, audience)
  const milestones = REFERRAL_TIERS.map((milestone) => ({
    signups: milestone.minSignups,
    label: milestone.label,
    achieved: signups >= milestone.minSignups,
  }))
  const nextMilestone = milestones.find((milestone) => !milestone.achieved) ?? null
  const progressPct = nextMilestone
    ? Math.min(100, Math.round((signups / Math.max(1, nextMilestone.signups)) * 100))
    : 100

  return {
    audience,
    tier,
    nextMilestone: nextMilestone ? { signups: nextMilestone.signups, label: nextMilestone.label } : null,
    milestones,
    signups,
    clicks,
    shares,
    onboarded,
    claimableRewards,
    pendingRewards,
    redeemedRewards,
    progressPct,
    onboardingCompletionRate: signups > 0 ? Number(((onboarded / signups) * 100).toFixed(1)) : 0,
  }
}
