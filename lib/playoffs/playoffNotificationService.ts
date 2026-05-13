import "server-only"
import { prisma } from "@/lib/prisma"
import { dispatchNotification } from "@/lib/notifications/NotificationDispatcher"
import type { PlayoffSport } from "./types"

// ─── Round label helpers ──────────────────────────────────────────────────────

const ROUND_LABELS: Record<string, string> = {
  round_1: "First Round",
  conference_semifinals: "Conference Semifinals",
  conference_finals: "Conference Finals",
  finals: "Finals",
}

function roundLabel(round: string): string {
  return ROUND_LABELS[round] ?? round.replace(/_/g, " ")
}

// ─── Clinch notification ──────────────────────────────────────────────────────

type ClinchInput = {
  challengeId: string
  challengeName: string
  sport: PlayoffSport
  /** Series ID of the newly clinched series */
  seriesId: string
  homeTeamName: string
  awayTeamName: string
  winnerTeamName: string
  round: string
}

/**
 * Notify all pool participants when a series is clinched.
 *
 * Message is personalised per entry:
 *  — ✅ Correct pick   — shows points earned
 *  — ❌ Wrong pick     — shows winner
 *  — 📊 No pick        — neutral update
 *
 * Deduped per (series, entry) pair so repeated cron ticks don't re-fire.
 * All errors are swallowed; this is non-fatal to the sync pipeline.
 */
export async function notifySeriesClinched(input: ClinchInput): Promise<void> {
  const { challengeId, challengeName, sport, seriesId, homeTeamName, awayTeamName, winnerTeamName, round } = input
  const sportLabel = sport === "nba" ? "NBA" : "NHL"
  const roundName = roundLabel(round)

  try {
    const [entries, picks] = await Promise.all([
      (prisma as any).playoffBracketEntry.findMany({
        where: { challengeId },
        select: { id: true, userId: true, name: true },
      }) as Promise<Array<{ id: string; userId: string; name: string }>>,

      (prisma as any).playoffBracketPick.findMany({
        where: { challengeId, seriesId },
        select: { entryId: true, pickTeamName: true, isCorrect: true, pointsAwarded: true },
      }) as Promise<Array<{ entryId: string; pickTeamName: string; isCorrect: boolean | null; pointsAwarded: number }>>,
    ])

    const pickByEntryId = new Map(picks.map((p) => [p.entryId, p]))

    await Promise.allSettled(
      entries.map(async (entry) => {
        const pick = pickByEntryId.get(entry.id)

        let title: string
        let body: string

        if (!pick) {
          title = `${winnerTeamName} win the ${sportLabel} ${roundName}`
          body = `${homeTeamName} vs ${awayTeamName} is final. Check your scores in ${challengeName}.`
        } else if (pick.isCorrect === true) {
          title = `✅ Correct — ${winnerTeamName} wins`
          body = `+${pick.pointsAwarded} pts in ${challengeName}. Your ${roundName} pick paid off!`
        } else {
          title = `${winnerTeamName} wins the ${roundName}`
          body = `Your pick (${pick.pickTeamName}) was wrong. Check your updated score in ${challengeName}.`
        }

        await dispatchNotification({
          userIds: [entry.userId],
          category: "bracket_updates",
          productType: "bracket",
          type: "playoff_series_clinched",
          title,
          body,
          severity: "medium",
          actionHref: `/brackets/leagues/${challengeId}`,
          actionLabel: "View Bracket",
          // One notification per (series, entry) — never re-fires even if cron ticks after clinch
          dedupePrefix: `playoff_clinch:${seriesId}:${entry.id}`,
          meta: { challengeId, seriesId, winnerTeamName, sport, round },
        })
      })
    )
  } catch (err) {
    console.warn("[PlayoffNotifications] notifySeriesClinched failed silently", { challengeId, seriesId, err })
  }
}

// ─── Rank-improved notification ───────────────────────────────────────────────

type PreScoringEntry = { userId: string; rank: number | null }

/**
 * Notify participants whose rank improved after rescoring.
 * `prevRanks` is a map from entryId → { userId, rank } loaded BEFORE scoring ran.
 * Only fires when the new rank is numerically lower (i.e. better) than the old.
 * Deduped by (challenge, entry, new-rank) so the same rank won't re-notify.
 */
export async function notifyRankImproved(input: {
  challengeId: string
  challengeName: string
  prevRanks: Map<string, PreScoringEntry>
  newRanks: Array<{ entryId: string; rank: number; totalScore: number; correctPicks: number }>
}): Promise<void> {
  const { challengeId, challengeName, prevRanks, newRanks } = input

  const dispatches = newRanks.flatMap((result) => {
    const prev = prevRanks.get(result.entryId)
    if (!prev?.userId) return []

    // Only notify on improvement (lower rank number = better)
    if (prev.rank === null || result.rank >= prev.rank) return []

    return [
      dispatchNotification({
        userIds: [prev.userId],
        category: "bracket_updates",
        productType: "bracket",
        type: "playoff_rank_improved",
        title: `You moved to #${result.rank} in ${challengeName}!`,
        body: `${result.totalScore} pts · ${result.correctPicks} correct pick${result.correctPicks !== 1 ? "s" : ""}`,
        severity: "low",
        actionHref: `/brackets/leagues/${challengeId}`,
        actionLabel: "See Leaderboard",
        // Includes new rank in dedupe key — moving to the same rank twice doesn't re-fire,
        // but moving to a different (better) rank will fire again.
        dedupePrefix: `playoff_rank_up:${challengeId}:${result.entryId}:${result.rank}`,
        meta: { challengeId, rank: result.rank, totalScore: result.totalScore },
      }).catch((err) => {
        console.warn("[PlayoffNotifications] rank-improve dispatch error", { userId: prev.userId, err })
      }),
    ]
  })

  await Promise.allSettled(dispatches).catch((err) => {
    console.warn("[PlayoffNotifications] notifyRankImproved batch error", { challengeId, err })
  })
}

// ─── Bracket submitted notification ──────────────────────────────────────────

/**
 * Confirm to the submitter that their bracket is locked in.
 * Also pings the pool owner (if different) as a commissioner alert.
 * Deduped per entryId so re-submits don't spam.
 */
export async function notifyBracketSubmitted(input: {
  challengeId: string
  challengeName: string
  entryId: string
  entryName: string
  submitterUserId: string
  ownerUserId: string
}): Promise<void> {
  const { challengeId, challengeName, entryId, entryName, submitterUserId, ownerUserId } = input

  try {
    await Promise.allSettled([
      // Confirm to submitter
      dispatchNotification({
        userIds: [submitterUserId],
        category: "bracket_updates",
        productType: "bracket",
        type: "playoff_bracket_submitted",
        title: "Bracket submitted! 🎉",
        body: `"${entryName}" is locked in for ${challengeName}. Good luck!`,
        severity: "low",
        actionHref: `/brackets/leagues/${challengeId}`,
        actionLabel: "View Pool",
        dedupePrefix: `playoff_submitted:${entryId}`,
        meta: { challengeId, entryId },
      }),

      // Ping pool owner if different user
      ...(ownerUserId !== submitterUserId
        ? [
            dispatchNotification({
              userIds: [ownerUserId],
              category: "commissioner_alerts",
              productType: "bracket",
              type: "playoff_new_entry",
              title: `New bracket in ${challengeName}`,
              body: `"${entryName}" was just submitted to your pool.`,
              severity: "low",
              actionHref: `/brackets/leagues/${challengeId}`,
              actionLabel: "View Pool",
              dedupePrefix: `playoff_new_entry:${entryId}`,
              meta: { challengeId, entryId },
            }),
          ]
        : []),
    ])
  } catch (err) {
    console.warn("[PlayoffNotifications] notifyBracketSubmitted error", { challengeId, entryId, err })
  }
}

// ─── Invite accepted notification ────────────────────────────────────────────

/**
 * Notify the pool owner when a new participant joins via invite link.
 * Deduped per (challenge, joiner) pair so the owner only gets one ping per person.
 */
export async function notifyInviteAccepted(input: {
  challengeId: string
  challengeName: string
  ownerUserId: string
  joinerUserId: string
  joinerName: string
}): Promise<void> {
  const { challengeId, challengeName, ownerUserId, joinerUserId, joinerName } = input

  // Owner joining their own pool — don't self-notify
  if (ownerUserId === joinerUserId) return

  try {
    await dispatchNotification({
      userIds: [ownerUserId],
      category: "commissioner_alerts",
      productType: "bracket",
      type: "playoff_invite_accepted",
      title: `${joinerName} joined ${challengeName}`,
      body: "A new participant accepted your invite and created a bracket.",
      severity: "low",
      actionHref: `/brackets/leagues/${challengeId}`,
      actionLabel: "View Pool",
      dedupePrefix: `playoff_invite_accepted:${challengeId}:${joinerUserId}`,
      meta: { challengeId, joinerUserId },
    })
  } catch (err) {
    console.warn("[PlayoffNotifications] notifyInviteAccepted error", { challengeId, joinerUserId, err })
  }
}

// ─── Bracket lock reminder ────────────────────────────────────────────────────

/**
 * Send lock reminders to participants who have NOT yet submitted their bracket.
 *
 * Looks at the earliest `startsAt` across all series in the challenge to
 * determine lock time.  Fires only when within `windowHours` of that time.
 *
 * Deduped per (challenge, entry) so each user gets at most one reminder
 * per bracket per lock window, regardless of how many times the cron runs.
 */
export async function notifyBracketLockReminder(input: {
  challengeId: string
  challengeName: string
  windowHours?: number
}): Promise<void> {
  const { challengeId, challengeName, windowHours = 24 } = input

  try {
    // Find first scheduled tipoff (= bracket lock time)
    const firstSeries = await (prisma as any).playoffBracketSeries.findFirst({
      where: { challengeId, startsAt: { not: null } },
      orderBy: { startsAt: "asc" },
      select: { startsAt: true },
    }) as { startsAt: Date } | null

    if (!firstSeries?.startsAt) return

    const lockAt = new Date(firstSeries.startsAt)
    const now = new Date()
    const hoursUntilLock = (lockAt.getTime() - now.getTime()) / (1000 * 60 * 60)

    // Only fire within the reminder window and before lock
    if (hoursUntilLock <= 0 || hoursUntilLock > windowHours) return

    // Find entries that haven't been submitted yet
    const unsubmittedEntries = await (prisma as any).playoffBracketEntry.findMany({
      where: { challengeId, submittedAt: null },
      select: { id: true, userId: true, name: true },
    }) as Array<{ id: string; userId: string; name: string }>

    if (unsubmittedEntries.length === 0) return

    const hoursRounded = Math.round(hoursUntilLock)
    const timeLabel = hoursRounded <= 1 ? "less than 1 hour" : `${hoursRounded} hours`

    await Promise.allSettled(
      unsubmittedEntries.map((entry) =>
        dispatchNotification({
          userIds: [entry.userId],
          category: "bracket_updates",
          productType: "bracket",
          type: "playoff_lock_reminder",
          title: `⏰ Bracket locks in ${timeLabel}`,
          body: `"${entry.name}" in ${challengeName} isn't submitted yet. Lock it in before the first tipoff!`,
          severity: "high",
          actionHref: `/brackets/leagues/${challengeId}`,
          actionLabel: "Submit Bracket",
          // Per-entry dedupe: each user gets one reminder per lock window
          dedupePrefix: `playoff_lock_reminder:${challengeId}:${entry.id}`,
          meta: { challengeId, lockAt: lockAt.toISOString(), hoursUntilLock: Math.round(hoursUntilLock) },
        }).catch((err) => {
          console.warn("[PlayoffNotifications] lock-reminder dispatch error", { userId: entry.userId, err })
        })
      )
    )

    console.log(
      `[PlayoffNotifications] lock reminder sent to ${unsubmittedEntries.length} unsubmitted entries in ${challengeId} (${timeLabel} until lock)`
    )
  } catch (err) {
    console.warn("[PlayoffNotifications] notifyBracketLockReminder error", { challengeId, err })
  }
}
