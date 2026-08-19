/**
 * PROMPT 149 — Onboarding progress and checklist state.
 * Derives completion from profile, league count, and EngagementEvent; records milestones.
 */

import { prisma } from "@/lib/prisma"
import { getSettingsProfile } from "@/lib/user-settings/SettingsQueryService"
import type {
  OnboardingChecklistState,
  OnboardingChecklistTask,
  OnboardingChecklistTaskId,
  OnboardingMilestoneEventType,
} from "./types"

const CHECKLIST_SPEC: Record<
  OnboardingChecklistTaskId,
  { label: string; description: string; href: string; ctaLabel: string }
> = {
  select_sports: {
    label: "Select your favorite sports (multi-select)",
    description: "Choose all sports you follow for a personalized experience.",
    href: "/onboarding/funnel",
    ctaLabel: "Set sports",
  },
  choose_tools: {
    label: "Choose preferred tools",
    description: "Try Trade Analyzer, Mock Draft, Brackets, or Chimmy AI.",
    href: "/legacy?tab=trade",
    ctaLabel: "Explore tools",
  },
  connect_platforms: {
    label: "Connect your fantasy platforms",
    description: "Link all your supported platforms for seamless import and sync.",
    href: "/dashboard?connect=platforms",
    ctaLabel: "Connect platforms",
  },
  visit_ai_tools: {
    label: "Visit the AI Tools page",
    description: "Explore all available AI tools to supercharge your league.",
    href: "/ai/tools",
    ctaLabel: "AI Tools",
  },
  join_or_create_league: {
    label: "Join or create your first league",
    description: "Create a league or join one with a code.",
    href: "/leagues",
    ctaLabel: "Leagues",
  },
  first_ai_action: {
    label: "Try your first AI action",
    description: "Use Chimmy or any AI feature once.",
    href: "/chimmy",
    ctaLabel: "Open Chimmy",
  },
  share_invite_link: {
    label: "Share your invite link",
    description: "Invite friends with your unique referral link.",
    href: "/referral",
    ctaLabel: "Share invite",
  },
  referral_share: {
    label: "Refer a friend or share",
    description: "Share AllFantasy and grow your league.",
    href: "/referral",
    ctaLabel: "Share",
  },
}

const TASK_ORDER: OnboardingChecklistTaskId[] = [
  "select_sports",
  "choose_tools",
  "connect_platforms",
  "visit_ai_tools",
  "join_or_create_league",
  "first_ai_action",
  "share_invite_link",
  "referral_share",
]

/**
 * Returns current checklist state from profile, leagues, and engagement events.
 */
export async function getChecklistState(userId: string): Promise<OnboardingChecklistState> {

  // Fetch all needed data for new tasks
  const [
    profile,
    leagueCount,
    toolVisit,
    firstAi,
    referralShare,
    aiToolsVisit,
    inviteLinkShare
  ] = await Promise.all([
    getSettingsProfile(userId),
    (prisma as any).league.count({ where: { userId } }).catch(() => 0),
    prisma.engagementEvent.findFirst({
      where: { userId, eventType: "onboarding_tool_visit" },
      select: { id: true },
    }),
    prisma.engagementEvent.findFirst({
      where: { userId, eventType: "onboarding_first_ai" },
      select: { id: true },
    }),
    prisma.engagementEvent.findFirst({
      where: { userId, eventType: "onboarding_referral_share" },
      select: { id: true },
    }),
    prisma.engagementEvent.findFirst({
      where: { userId, eventType: "onboarding_ai_tools_visit" },
      select: { id: true },
    }),
    prisma.engagementEvent.findFirst({
      where: { userId, eventType: "onboarding_invite_link_share" },
      select: { id: true },
    }),
  ])

  const preferredSports = profile?.preferredSports
  const hasSports = Array.isArray(preferredSports) && preferredSports.length > 0

  // Platform connect logic: check if major platforms are linked (only sleeper and discord available)
  const platformsToCheck = [
    profile?.sleeperUsername,
    profile?.discordUserId
  ]
  const allPlatformsConnected = platformsToCheck.filter(Boolean).length >= 1 // Adjust threshold as needed

  const completed: Record<OnboardingChecklistTaskId, boolean> = {
    select_sports: hasSports,
    choose_tools: !!toolVisit,
    connect_platforms: allPlatformsConnected,
    visit_ai_tools: !!aiToolsVisit,
    join_or_create_league: leagueCount > 0,
    first_ai_action: !!firstAi,
    share_invite_link: !!inviteLinkShare,
    referral_share: !!referralShare,
  }

  const tasks: OnboardingChecklistTask[] = TASK_ORDER.map((id) => {
    const spec = CHECKLIST_SPEC[id]
    return {
      id,
      label: spec.label,
      description: spec.description,
      href: spec.href,
      ctaLabel: spec.ctaLabel,
      completed: completed[id],
    }
  })

  const completedCount = tasks.filter((t) => t.completed).length
  const totalCount = tasks.length

  return {
    tasks,
    completedCount,
    totalCount,
    isFullyComplete: completedCount >= totalCount,
  }
}

/**
 * Records an onboarding milestone event (event-based tracking).
 */
export async function recordMilestone(
  userId: string,
  eventType: OnboardingMilestoneEventType,
  meta?: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const dedupeWindowStart = new Date(Date.now() - 2 * 60 * 60 * 1000)
    const recent = await prisma.engagementEvent.findFirst({
      where: {
        userId,
        eventType,
        createdAt: { gte: dedupeWindowStart },
      },
      select: { id: true },
    })
    if (recent) {
      return { ok: true }
    }

    await prisma.engagementEvent.create({
      data: {
        userId,
        eventType,
        meta: meta ?? undefined,
      },
    })
    return { ok: true }
  } catch (e) {
    console.error("[OnboardingProgressService] recordMilestone error:", e)
    return { ok: false, error: "Failed to record milestone" }
  }
}
