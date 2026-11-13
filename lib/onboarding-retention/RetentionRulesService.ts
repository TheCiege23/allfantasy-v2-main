/**
 * PROMPT 149 — Retention rules: recap cards, return nudges, unfinished reminders,
 * weekly AI summaries, creator recommendations, sport-season prompts.
 * Sport-aware (NFL, NHL, NBA, MLB, NCAAB, NCAAF, SOCCER).
 */

import { prisma } from "@/lib/prisma"
import { getSettingsProfile } from "@/lib/user-settings/SettingsQueryService"
import { DEFAULT_SPORT, normalizeToSupportedSport, SUPPORTED_SPORTS } from "@/lib/sport-scope"
import type { RetentionNudge } from "./types"

/** Rough "in season" windows per sport (month); used for sport-season prompts. */
const SPORT_SEASON_MONTHS: Record<string, number[]> = {
  NFL: [9, 10, 11, 12, 1],
  NHL: [10, 11, 12, 1, 2, 3, 4],
  NBA: [10, 11, 12, 1, 2, 3, 4],
  MLB: [3, 4, 5, 6, 7, 8, 9],
  NCAAB: [11, 12, 1, 2, 3, 4],
  NCAAF: [8, 9, 10, 11, 12, 1],
  SOCCER: [8, 9, 10, 11, 12, 1, 2, 3, 4, 5],
}

const SAFE_NUDGE_HREFS = [
  "/dashboard",
  "/feed",
  "/onboarding/funnel",
  "/leagues",
  "/chimmy",
  "/creators",
  "/app",
] as const

function sanitizeNudgeHref(href: string): string {
  if (!href || typeof href !== "string") return "/dashboard"
  if (href.startsWith("http://") || href.startsWith("https://")) return href
  if (!href.startsWith("/")) return "/dashboard"
  if (SAFE_NUDGE_HREFS.some((prefix) => href === prefix || href.startsWith(`${prefix}/`))) {
    return href
  }
  return "/dashboard"
}

function isSportInSeason(sport: string): boolean {
  const months = SPORT_SEASON_MONTHS[sport]
  if (!months) return false
  const m = new Date().getMonth() + 1
  return months.includes(m)
}

/**
 * Return nudges: e.g. "You haven't checked your lineup this week."
 */
async function getReturnNudges(userId: string): Promise<RetentionNudge[]> {
  const lastEngagement = await prisma.engagementEvent
    .findFirst({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    })
    .catch(() => null)

  const nudges: RetentionNudge[] = []
  const now = new Date()
  const daysSince = lastEngagement
    ? Math.floor((now.getTime() - lastEngagement.createdAt.getTime()) / (24 * 60 * 60 * 1000))
    : 999

  if (daysSince >= 7) {
    nudges.push({
      id: "return_nudge_week",
      type: "return_nudge",
      title: "We miss you",
      body: "Your leagues and brackets are waiting. Check your lineup or create a new pool.",
      href: sanitizeNudgeHref("/dashboard"),
      ctaLabel: "Go to dashboard",
    })
  }
  if (daysSince >= 3 && daysSince < 7) {
    nudges.push({
      id: "return_nudge_few_days",
      type: "return_nudge",
      title: "Quick check-in",
      body: "See how your teams are doing and get the latest AI insights.",
      href: sanitizeNudgeHref("/feed"),
      ctaLabel: "View feed",
    })
  }

  return nudges
}

/**
 * Unfinished action reminders: e.g. incomplete profile, no league joined.
 */
async function getUnfinishedReminders(userId: string): Promise<RetentionNudge[]> {
  const [profile, leagueCount, funnelComplete] = await Promise.all([
    getSettingsProfile(userId),
    (prisma as any).league.count({ where: { userId } }).catch(() => 0),
    prisma.userProfile.findUnique({
      where: { userId },
      select: { onboardingCompletedAt: true },
    }),
  ])

  const nudges: RetentionNudge[] = []

  if (!funnelComplete?.onboardingCompletedAt) {
    nudges.push({
      id: "reminder_onboarding",
      type: "unfinished_reminder",
      title: "Finish getting started",
      body: "Complete the quick setup to personalize your experience.",
      href: sanitizeNudgeHref("/onboarding/funnel"),
      ctaLabel: "Continue setup",
    })
  }

  if (leagueCount === 0) {
    nudges.push({
      id: "reminder_no_league",
      type: "unfinished_reminder",
      title: "Create or join a league",
      body: "Connect a league or create one to unlock full features.",
      href: sanitizeNudgeHref("/leagues"),
      ctaLabel: "Leagues",
    })
  }

  return nudges
}

/**
 * Recap cards: e.g. "Your week in review."
 */
async function getRecapCards(userId: string): Promise<RetentionNudge[]> {
  const nudges: RetentionNudge[] = []
  nudges.push({
    id: "recap_weekly",
    type: "recap",
    title: "Your weekly recap",
    body: "See your league standings and recent activity.",
    href: sanitizeNudgeHref("/dashboard"),
    ctaLabel: "View recap",
  })
  return nudges
}

/**
 * Weekly AI summary CTA.
 */
async function getWeeklySummaryNudges(userId: string): Promise<RetentionNudge[]> {
  return [
    {
      id: "nudge_weekly_ai_summary",
      type: "weekly_summary",
      title: "Weekly AI summary",
      body: "Get a personalized summary of your leagues and trends from Chimmy.",
      href: sanitizeNudgeHref("/chimmy"),
      ctaLabel: "Get summary",
    },
  ]
}

/**
 * AI check-in: friendly prompt to chat with Chimmy for a tip or league check-in.
 */
async function getAICheckInNudges(userId: string): Promise<RetentionNudge[]> {
  return [
    {
      id: "ai_check_in",
      type: "ai_check_in",
      title: "Chimmy check-in",
      body: "Get a quick tip or ask how your league is doing. Your AI assistant is here to help.",
      href: sanitizeNudgeHref("/chimmy"),
      ctaLabel: "Check in with Chimmy",
    },
  ]
}

/**
 * Creator league recommendations (public creator leagues by user's preferred sports).
 */
async function getCreatorLeagueRecommendations(userId: string): Promise<RetentionNudge[]> {
  const profile = await getSettingsProfile(userId)
  const sports = ((profile?.preferredSports as string[] | null) ?? [])
    .map((sport) => normalizeToSupportedSport(sport))
    .filter((sport) => (SUPPORTED_SPORTS as readonly string[]).includes(String(sport)))
    .map((sport) => String(sport))
  const limit = 2

  const where: { isPublic: true; creator?: { visibility: string } } = { isPublic: true }
  if (sports.length > 0) {
    (where as any).sport = { in: sports.filter((s) => (SUPPORTED_SPORTS as readonly string[]).includes(s)) }
  }

  const leagues = await (prisma as any).creatorLeague
    .findMany({
      where: { ...where, creator: { visibility: "public" } },
      orderBy: { memberCount: "desc" },
      take: limit,
      include: { creator: { select: { handle: true, displayName: true } } },
    })
    .catch(() => [])

  return leagues.slice(0, 2).map((l: any) => ({
    id: `creator_rec_${l.id}`,
    type: "creator_recommendation" as const,
    title: `Join ${l.name}`,
    body: l.creator?.displayName
      ? `By ${l.creator.displayName} · ${l.memberCount ?? 0} members`
      : `${l.memberCount ?? 0} members`,
    href: sanitizeNudgeHref(l.creator?.handle ? `/creators/${l.creator.handle}` : "/creators"),
    ctaLabel: "View",
    sport: l.sport ?? null,
    meta: { creatorLeagueId: l.id },
  }))
}

/**
 * Sport-season based prompts (e.g. "NFL season is here — set your lineup").
 */
async function getSportSeasonPrompts(userId: string): Promise<RetentionNudge[]> {
  const profile = await getSettingsProfile(userId)
  const profileSports = ((profile?.preferredSports as string[] | null) ?? [])
    .map((sport) => normalizeToSupportedSport(sport))
    .filter((sport) => (SUPPORTED_SPORTS as readonly string[]).includes(String(sport)))
    .map((sport) => String(sport))
  const sports = profileSports.length > 0 ? profileSports : [DEFAULT_SPORT]
  const nudges: RetentionNudge[] = []

  const labels: Record<string, string> = {
    NFL: "NFL",
    NHL: "NHL",
    NBA: "NBA",
    MLB: "MLB",
    NCAAF: "NCAA Football",
    NCAAB: "NCAA Basketball",
    SOCCER: "Soccer",
  }

  for (const sport of sports) {
    if (!(SUPPORTED_SPORTS as readonly string[]).includes(sport)) continue
    if (!isSportInSeason(sport)) continue
    nudges.push({
      id: `sport_season_${sport}`,
      type: "sport_season_prompt",
      title: `${labels[sport] ?? sport} season`,
      body: "Stay on top of your lineup and waiver wire.",
      href: sanitizeNudgeHref("/app"),
      ctaLabel: "Open app",
      sport,
    })
    break
  }

  return nudges
}

/**
 * All retention rules combined (raw list; caller applies anti-spam and dismissals).
 */
export async function getAllRetentionNudges(userId: string): Promise<RetentionNudge[]> {
  const [
    returnNudges,
    reminders,
    recaps,
    weeklySummary,
    aiCheckIn,
    creatorRecs,
    sportPrompts,
  ] = await Promise.all([
    getReturnNudges(userId),
    getUnfinishedReminders(userId),
    getRecapCards(userId),
    getWeeklySummaryNudges(userId),
    getAICheckInNudges(userId),
    getCreatorLeagueRecommendations(userId),
    getSportSeasonPrompts(userId),
  ])

  return [
    ...reminders,
    ...returnNudges,
    ...recaps,
    ...weeklySummary,
    ...aiCheckIn,
    ...creatorRecs,
    ...sportPrompts,
  ]
}
