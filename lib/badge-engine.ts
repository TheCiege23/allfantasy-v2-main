import { prisma } from '@/lib/prisma'

export interface Badge {
  id?: string
  badgeType: string
  badgeName: string
  description: string
  tier: 'bronze' | 'silver' | 'gold' | 'diamond'
  xpReward: number
  icon: string
}

const BADGE_DEFINITIONS: Record<string, Omit<Badge, 'id'>> = {
  first_trade_analysis: {
    badgeType: 'first_trade_analysis',
    badgeName: 'Trade Analyst',
    description: 'Ran your first trade analysis',
    tier: 'bronze',
    xpReward: 25,
    icon: '📊',
  },
  trade_master_10: {
    badgeType: 'trade_master_10',
    badgeName: 'Trade Master',
    description: 'Analyzed 10 trades',
    tier: 'silver',
    xpReward: 100,
    icon: '🏆',
  },
  trade_master_50: {
    badgeType: 'trade_master_50',
    badgeName: 'Trade Guru',
    description: 'Analyzed 50 trades',
    tier: 'gold',
    xpReward: 500,
    icon: '👑',
  },
  first_simulation: {
    badgeType: 'first_simulation',
    badgeName: 'Simulator',
    description: 'Ran your first Monte Carlo simulation',
    tier: 'bronze',
    xpReward: 50,
    icon: '🎲',
  },
  simulation_pro: {
    badgeType: 'simulation_pro',
    badgeName: 'Simulation Pro',
    description: 'Ran 10 simulations',
    tier: 'silver',
    xpReward: 200,
    icon: '🔬',
  },
  ai_chat_starter: {
    badgeType: 'ai_chat_starter',
    badgeName: 'Chimmy Advisor',
    description: 'Had your first Chimmy chat conversation',
    tier: 'bronze',
    xpReward: 15,
    icon: '💬',
  },
  ai_chat_50: {
    badgeType: 'ai_chat_50',
    badgeName: 'Chimmy Whisperer',
    description: 'Sent 50 messages to Chimmy assistant',
    tier: 'silver',
    xpReward: 150,
    icon: '🧠',
  },
  league_importer: {
    badgeType: 'league_importer',
    badgeName: 'League Connected',
    description: 'Imported your first league',
    tier: 'bronze',
    xpReward: 30,
    icon: '🔗',
  },
  multi_league: {
    badgeType: 'multi_league',
    badgeName: 'Multi-League Manager',
    description: 'Imported 5+ leagues',
    tier: 'silver',
    xpReward: 150,
    icon: '🌐',
  },
  waiver_wire: {
    badgeType: 'waiver_wire',
    badgeName: 'Waiver Wire Hunter',
    description: 'Used Chimmy waiver wire analysis',
    tier: 'bronze',
    xpReward: 25,
    icon: '🎯',
  },
  strategy_planner: {
    badgeType: 'strategy_planner',
    badgeName: 'Season Strategist',
    description: 'Generated a season strategy plan',
    tier: 'bronze',
    xpReward: 40,
    icon: '📋',
  },
  accurate_prediction: {
    badgeType: 'accurate_prediction',
    badgeName: 'Crystal Ball',
    description: 'Chimmy prediction matched the actual outcome',
    tier: 'gold',
    xpReward: 300,
    icon: '🔮',
  },
  social_sharer: {
    badgeType: 'social_sharer',
    badgeName: 'Influencer',
    description: 'Shared analysis on social media',
    tier: 'bronze',
    xpReward: 20,
    icon: '📢',
  },
  data_explorer: {
    badgeType: 'data_explorer',
    badgeName: 'Data Explorer',
    description: 'Explored player stats from 3+ data sources',
    tier: 'silver',
    xpReward: 75,
    icon: '🗺️',
  },
  guardian_follower: {
    badgeType: 'guardian_follower',
    badgeName: 'Guardian Follower',
    description: 'Followed 5 Chimmy Decision Guardian recommendations',
    tier: 'silver',
    xpReward: 100,
    icon: '🛡️',
  },
  // PROMPT 307 — Achievement system (progression only, no money rewards)
  first_win: {
    badgeType: 'first_win',
    badgeName: 'First Win',
    description: 'Won your first matchup',
    tier: 'bronze',
    xpReward: 25,
    icon: '🏆',
  },
  best_draft: {
    badgeType: 'best_draft',
    badgeName: 'Best Draft',
    description: 'Had the best draft in your league (by grade or result)',
    tier: 'gold',
    xpReward: 150,
    icon: '📋',
  },
  highest_score: {
    badgeType: 'highest_score',
    badgeName: 'Highest Score',
    description: 'Scored the most points in a single week in your league',
    tier: 'silver',
    xpReward: 75,
    icon: '🔥',
  },
  draft_completed: {
    badgeType: 'draft_completed',
    badgeName: 'Draft Complete',
    description: 'Completed your first league draft',
    tier: 'bronze',
    xpReward: 50,
    icon: '✅',
  },
  ten_wins: {
    badgeType: 'ten_wins',
    badgeName: 'Ten Wins',
    description: 'Reached 10 wins across your leagues',
    tier: 'silver',
    xpReward: 100,
    icon: '🌟',
  },
}

export async function checkAndAwardBadge(
  userId: string,
  sleeperUsername: string | undefined,
  badgeType: string
): Promise<Badge | null> {
  const definition = BADGE_DEFINITIONS[badgeType]
  if (!definition) return null

  const existing = await prisma.aIBadge.findFirst({
    where: { userId, badgeType },
  })

  if (existing) return null

  const badge = await prisma.aIBadge.create({
    data: {
      userId,
      sleeperUsername,
      badgeType: definition.badgeType,
      badgeName: definition.badgeName,
      description: definition.description,
      tier: definition.tier,
      xpReward: definition.xpReward,
      data: { icon: definition.icon },
    },
  })

  return {
    id: badge.id,
    ...definition,
  }
}

export async function checkMilestoneBadges(
  userId: string,
  sleeperUsername: string | undefined,
  action: string,
  count: number
): Promise<Badge[]> {
  const awarded: Badge[] = []

  const milestoneMap: Record<string, { count: number; badge: string }[]> = {
    trade_analysis: [
      { count: 1, badge: 'first_trade_analysis' },
      { count: 10, badge: 'trade_master_10' },
      { count: 50, badge: 'trade_master_50' },
    ],
    simulation: [
      { count: 1, badge: 'first_simulation' },
      { count: 10, badge: 'simulation_pro' },
    ],
    ai_chat: [
      { count: 1, badge: 'ai_chat_starter' },
      { count: 50, badge: 'ai_chat_50' },
    ],
    league_import: [
      { count: 1, badge: 'league_importer' },
      { count: 5, badge: 'multi_league' },
    ],
  }

  const milestones = milestoneMap[action] || []
  for (const m of milestones) {
    if (count >= m.count) {
      const badge = await checkAndAwardBadge(userId, sleeperUsername, m.badge)
      if (badge) awarded.push(badge)
    }
  }

  return awarded
}

export async function getUserBadges(userId: string): Promise<any[]> {
  return prisma.aIBadge.findMany({
    where: { userId },
    orderBy: { earnedAt: 'desc' },
  })
}

export async function getUserBadgeCount(userId: string): Promise<number> {
  return prisma.aIBadge.count({
    where: { userId },
  })
}

export async function getUserTotalXP(userId: string): Promise<number> {
  const badges = await prisma.aIBadge.findMany({
    where: { userId },
    select: { xpReward: true },
  })
  return badges.reduce((sum, b) => sum + b.xpReward, 0)
}

export function getBadgeDefinitions(): Record<string, Omit<Badge, 'id'>> {
  return BADGE_DEFINITIONS
}
