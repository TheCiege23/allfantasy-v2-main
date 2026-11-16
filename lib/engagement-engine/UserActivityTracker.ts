import { prisma } from "@/lib/prisma"
import type { EngagementEventType, EngagementEventMeta } from "./types"

function toDateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`
}

/**
 * Tracks app user engagement events for retention analytics and weekly recaps.
 */
export async function recordEngagementEvent(
  userId: string,
  eventType: EngagementEventType,
  meta?: EngagementEventMeta
): Promise<boolean> {
  try {
    await (prisma as any).engagementEvent.create({
      data: {
        userId,
        eventType,
        meta: meta ?? undefined,
      },
    })
    return true
  } catch (e) {
    console.error("[UserActivityTracker] recordEngagementEvent error:", e)
    return false
  }
}

interface ActivitySummary {
  leagueViews: number
  bracketViews: number
  aiUses: number
  lastActiveAt: Date | null
}

/**
 * Aggregate activity for a user since a given date (e.g. last 7 days for weekly recap).
 */
export async function getActivitySummary(
  userId: string,
  since: Date
): Promise<ActivitySummary> {
  const events = await (prisma as any).engagementEvent.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { eventType: true, createdAt: true },
  }).catch(() => [])

  let leagueViews = 0
  let bracketViews = 0
  let aiUses = 0
  let lastActiveAt: Date | null = null

  for (const e of events) {
    if (e.createdAt && (!lastActiveAt || new Date(e.createdAt) > lastActiveAt)) {
      lastActiveAt = new Date(e.createdAt)
    }
    switch (e.eventType) {
      case "league_view":
        leagueViews++
        break
      case "bracket_view":
        bracketViews++
        break
      case "ai_used":
      case "trade_analyzer":
      case "mock_draft":
      case "waiver_ai":
      case "chimmy_chat":
        aiUses++
        break
      default:
        break
    }
  }

  return { leagueViews, bracketViews, aiUses, lastActiveAt }
}

interface EngagementStreakData {
  currentStreak: number
  longestStreak: number
  activeDaysCount: number
  todayActive: boolean
}

/**
 * Compute engagement streak from events (non-gambling: consecutive days with any app activity).
 * currentStreak = consecutive days ending today; longestStreak = max consecutive in history.
 */
export async function getEngagementStreak(userId: string): Promise<EngagementStreakData> {
  const since = new Date()
  since.setDate(since.getDate() - 366)

  const events = await (prisma as any).engagementEvent.findMany({
    where: { userId, createdAt: { gte: since } },
    select: { createdAt: true },
  }).catch(() => [])

  const daysSet = new Set<string>()
  for (const e of events) {
    if (e.createdAt) daysSet.add(toDateKey(new Date(e.createdAt)))
  }
  const sortedDays = Array.from(daysSet).sort().reverse()
  const today = toDateKey(new Date())

  let currentStreak = 0
  if (daysSet.has(today)) {
    let check = today
    for (;;) {
      if (!daysSet.has(check)) break
      currentStreak++
      const next = new Date(check + "T12:00:00Z")
      next.setUTCDate(next.getUTCDate() - 1)
      check = toDateKey(next)
    }
  }

  let longestStreak = 0
  let run = 0
  for (let i = 0; i < sortedDays.length; i++) {
    const d = sortedDays[i]!
    if (i === 0) {
      run = 1
    } else {
      const prev = sortedDays[i - 1]!
      const diff = daysDiff(prev, d)
      if (diff === 1) run++
      else run = 1
    }
    longestStreak = Math.max(longestStreak, run)
  }

  return {
    currentStreak,
    longestStreak: Math.max(longestStreak, currentStreak),
    activeDaysCount: sortedDays.length,
    todayActive: daysSet.has(today),
  }
}

function daysDiff(dayA: string, dayB: string): number {
  const a = new Date(dayA + "T12:00:00Z").getTime()
  const b = new Date(dayB + "T12:00:00Z").getTime()
  return Math.round((a - b) / (24 * 60 * 60 * 1000))
}
