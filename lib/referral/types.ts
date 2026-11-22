export type ReferralAudience = "user" | "creator"
type ReferralStatus = "clicked" | "signed_up" | "engaged" | "onboarded" | "rewarded" | "blocked"
export type ReferralRewardStatus = "pending" | "claimable" | "redeemed" | "expired" | "blocked"
export type ReferralRewardKind = "xp" | "badge" | "perk" | "bundle"
export type ReferralRewardTriggerType = "signup" | "onboarding_completed"
export type LeaderboardSort = "signups" | "clicks" | "rewards" | "onboarded"

export interface ReferralRewardDefinition {
  key: string
  type: string
  label: string
  description?: string | null
  triggerType: ReferralRewardTriggerType
  audience: "all" | ReferralAudience
  rewardKind: ReferralRewardKind
  value: number
  badgeType?: string | null
  badgeName?: string | null
  badgeDescription?: string | null
  badgeTier?: string | null
  maxAwardsPerUser: number
  minSuccessfulReferrals: number
  isClaimable: boolean
  isActive: boolean
  config?: Record<string, unknown> | null
}

export interface ReferralStats {
  clicks: number
  shares: number
  signups: number
  onboarded: number
  creatorReferrals: number
  claimableRewards: number
  pendingRewards: number
  redeemedRewards: number
  totalRewardValue: number
  conversionRate: number
}

interface ReferralMilestone {
  signups: number
  label: string
  achieved: boolean
}

export interface ReferralProgress {
  audience: ReferralAudience
  tier: { id: string; label: string }
  nextMilestone: { signups: number; label: string } | null
  milestones: ReferralMilestone[]
  signups: number
  clicks: number
  shares: number
  onboarded: number
  claimableRewards: number
  pendingRewards: number
  redeemedRewards: number
  progressPct: number
  onboardingCompletionRate: number
}

export interface ReferralRewardView {
  id: string
  type: string
  rewardKind: ReferralRewardKind
  label: string
  description: string | null
  value: number
  status: ReferralRewardStatus
  grantedAt: string
  redeemedAt: string | null
  claimLabel: string
  helperText: string | null
  badgeType?: string | null
}

export interface ReferralLeaderboardEntry {
  rank: number
  userId: string
  displayName: string | null
  username: string
  avatarUrl: string | null
  isCreator: boolean
  signups: number
  clicks: number
  shares: number
  onboarded: number
  redeemedRewards: number
  tier: string
}

export interface ReferredUserView {
  referredUserId: string
  displayName: string | null
  createdAt: string
  status: ReferralStatus
  kind: ReferralAudience
  onboardingStep: string | null
}

interface ReferralCTAView {
  id: string
  title: string
  description: string
  href: string
  label: string
  variant: "default" | "rewards" | "leaderboard"
}

export interface ReferralFunnelView {
  clicked: number
  signedUp: number
  engaged: number
  onboarded: number
  rewarded: number
}

export interface ReferralDashboardData {
  code: string
  link: string
  audience: ReferralAudience
  stats: ReferralStats
  progress: ReferralProgress
  rewards: ReferralRewardView[]
  leaderboard: ReferralLeaderboardEntry[]
  referred: ReferredUserView[]
  funnel: ReferralFunnelView
  ctaCards: ReferralCTAView[]
  updatedAt: string
}
