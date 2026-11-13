import "server-only"
import { prisma } from "@/lib/prisma"
import {
  resolveWorldCupEffectivePickLockAt,
} from "./worldCupBracketBuilder"
import { getWorldCupChallengeIncompleteSummary } from "./worldCupBracketCompletionService"
import { WORLD_CUP_BRACKET_EVENT_TYPES } from "./worldCupBracketEvents"
import { worldCupIdempotencyKeys } from "./worldCupBracketEventIdempotency"
import { emitWorldCupBracketChatEvent } from "./worldCupBracketEventService"
import { notifyWorldCupDeadlineReminder } from "./worldCupNotifications"
import { sendWorldCupLockReminderEmails } from "./worldCupLockReminderEmail"

const WINDOW_MS = 20 * 60 * 1000

const WORLD_CUP_LOCK_REMINDER_BUCKETS = [
  { key: "24h", ms: 24 * 3600 * 1000 },
  { key: "6h", ms: 6 * 3600 * 1000 },
  { key: "1h", ms: 3600 * 1000 },
  { key: "15m", ms: 15 * 60 * 1000 },
  { key: "locked", ms: 0 },
] as const

type WorldCupLockReminderBucketKey =
  (typeof WORLD_CUP_LOCK_REMINDER_BUCKETS)[number]["key"]

function lockReminderBucketToEventType(
  bucketKey: string
): string {
  switch (bucketKey) {
    case "24h":
      return WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER_24H
    case "6h":
      return WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER_6H
    case "1h":
      return WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER_1H
    case "15m":
      return WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER_15M
    case "locked":
      return WORLD_CUP_BRACKET_EVENT_TYPES.BRACKET_LOCKED
    default:
      return WORLD_CUP_BRACKET_EVENT_TYPES.LOCK_REMINDER
  }
}

function lockFingerprint(lockAt: Date) {
  return lockAt.toISOString().slice(0, 16)
}

async function emitLockReminderForChallenge(input: {
  challengeId: string
  name: string
  pickLockAt: Date
  bucketKey: WorldCupLockReminderBucketKey
}): Promise<{ ok: boolean; duplicate?: boolean; skipped?: boolean }> {
  const summary = await getWorldCupChallengeIncompleteSummary(input.challengeId)
  const incomplete = summary?.incompleteEntries.length ?? 0
  const totalMissing = summary?.totalMissingPicks ?? 0

  const lockLabel = input.pickLockAt.toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  })

  const title =
    input.bucketKey === "locked"
      ? "Bracket lock reached"
      : input.bucketKey === "24h"
        ? "24 hours until bracket lock"
        : input.bucketKey === "6h"
          ? "6 hours until bracket lock"
          : input.bucketKey === "1h"
            ? "1 hour until bracket lock"
            : "15 minutes until bracket lock"

  const bodyParts =
    input.bucketKey === "locked"
      ? [
          `"${input.name}" — picks should be locked now (${lockLabel}).`,
          incomplete > 0
            ? `${incomplete} bracket${incomplete === 1 ? "" : "s"} still incomplete — commissioner may still adjust depending on league rules.`
            : "All tracked brackets look complete.",
        ]
      : [
          `"${input.name}" locks at ${lockLabel}.`,
          incomplete > 0
            ? `${incomplete} incomplete bracket${incomplete === 1 ? "" : "s"}, ~${totalMissing} pick${totalMissing === 1 ? "" : "s"} remaining across the pool. Finish every matchup before kickoff.`
            : "All brackets look complete — double-check chalk and champion picks.",
        ]

  const eventType = lockReminderBucketToEventType(input.bucketKey)

  const idempotencyKey = worldCupIdempotencyKeys.lockReminderWindow(
    input.challengeId,
    input.bucketKey,
    lockFingerprint(input.pickLockAt)
  )

  const result = await emitWorldCupBracketChatEvent({
    challengeId: input.challengeId,
    eventType,
    eventTitle: title,
    eventBody: bodyParts.join(" "),
    idempotencyKey,
    metadata: {
      bucket: input.bucketKey,
      incompleteBracketCount: incomplete,
      totalMissingPicks: totalMissing,
      lockAt: input.pickLockAt.toISOString(),
    },
    isAiGenerated: false,
  })
  if (result.ok && !result.duplicate && !result.skipped && input.bucketKey !== "locked") {
    // Fire in-app + SMS notification and email in parallel — neither blocks the other.
    await Promise.allSettled([
      notifyWorldCupDeadlineReminder({
        challengeId: input.challengeId,
        poolName: input.name,
        reminder: bodyParts.join(" "),
        sourceId: idempotencyKey,
      }),
      sendWorldCupLockReminderEmails({
        challengeId: input.challengeId,
        poolName: input.name,
        bucketKey: input.bucketKey,
        pickLockAt: input.pickLockAt,
      }),
    ])
  }
  return result
}

/** Cron: scan all open challenges with a lock time — one emit per bucket per lock fingerprint. */
export async function runWorldCupBracketLockReminders(): Promise<{
  emitted: number
}> {
  // Batch 1: challenges with an explicit pickLockAt (manual / custom strategy)
  const explicitChallenges = await prisma.worldCupBracketChallenge.findMany({
    where: {
      pickLockAt: { not: null },
      status: { notIn: ["locked", "final"] },
    },
    select: {
      id: true,
      name: true,
      pickLockAt: true,
    },
  })

  // Batch 2: tournament_start challenges — effective lock is derived from match
  // start times via resolveWorldCupEffectivePickLockAt. They have pickLockAt: null
  // so they were previously skipped entirely.
  const tournamentStartChallenges = await (prisma as any).worldCupBracketChallenge.findMany({
    where: {
      pickLockStrategy: "tournament_start",
      pickLockAt: null,
      status: { notIn: ["locked", "final"] },
    },
    select: {
      id: true,
      name: true,
      pickLockStrategy: true,
      pickLockAt: true,
      matches: {
        select: {
          id: true,
          round: true,
          status: true,
          startsAt: true,
          homeTeamId: true,
          awayTeamId: true,
          homeTeamName: true,
          awayTeamName: true,
          winnerTeamId: true,
          winnerTeamName: true,
        },
      },
    },
  })

  // Resolve effective lock times for tournament_start challenges
  const resolvedTournamentStart: Array<{ id: string; name: string; pickLockAt: Date }> = []
  for (const c of tournamentStartChallenges) {
    const effectiveLockAt = resolveWorldCupEffectivePickLockAt({
      pickLockStrategy: c.pickLockStrategy,
      pickLockAt: c.pickLockAt,
      matches: c.matches,
    })
    if (effectiveLockAt) {
      resolvedTournamentStart.push({ id: c.id, name: c.name, pickLockAt: effectiveLockAt })
    }
  }

  const allChallenges = [
    ...explicitChallenges.map((c: { id: string; name: string; pickLockAt: Date }) => ({ id: c.id, name: c.name, pickLockAt: c.pickLockAt! })),
    ...resolvedTournamentStart,
  ]

  let emitted = 0
  const now = Date.now()

  for (const c of allChallenges) {
    const lockAt = c.pickLockAt
    const lockMs = lockAt.getTime()

    for (const b of WORLD_CUP_LOCK_REMINDER_BUCKETS) {
      const targetMs = lockMs - b.ms
      const delta = now - targetMs
      if (delta < 0 || delta > WINDOW_MS) continue

      const r = await emitLockReminderForChallenge({
        challengeId: c.id,
        name: c.name,
        pickLockAt: lockAt,
        bucketKey: b.key,
      })
      if (r.ok && !r.duplicate && !r.skipped) emitted++
    }
  }

  return { emitted }
}

/** Single-challenge sweep (commissioner test hook / targeted cron). */
export async function runWorldCupLockRemindersForChallenge(
  challengeId: string
): Promise<{ emitted: number }> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    select: {
      id: true,
      name: true,
      pickLockAt: true,
      status: true,
    },
  })
  if (!challenge?.pickLockAt) return { emitted: 0 }

  let emitted = 0
  const now = Date.now()
  const lockMs = challenge.pickLockAt.getTime()

  for (const b of WORLD_CUP_LOCK_REMINDER_BUCKETS) {
    const targetMs = lockMs - b.ms
    const delta = now - targetMs
    if (delta < 0 || delta > WINDOW_MS) continue

    const r = await emitLockReminderForChallenge({
      challengeId: challenge.id,
      name: challenge.name,
      pickLockAt: challenge.pickLockAt,
      bucketKey: b.key,
    })
    if (r.ok && !r.duplicate && !r.skipped) emitted++
  }

  return { emitted }
}

export function describeWorldCupLockReminderSchedule(input: {
  pickLockAt: Date | null
  effectiveLockAt: Date | null
}) {
  const lockAt = input.effectiveLockAt ?? input.pickLockAt
  if (!lockAt) {
    return { lockAtIso: null as string | null, windows: [] as Array<{ key: string; firesAtIso: string }> }
  }
  const lockMs = lockAt.getTime()
  const windows = WORLD_CUP_LOCK_REMINDER_BUCKETS.filter((b) => b.key !== "locked").map(
    (b) => ({
      key: b.key,
      firesAtIso: new Date(lockMs - b.ms).toISOString(),
    })
  )
  return {
    lockAtIso: lockAt.toISOString(),
    windows,
  }
}

/** Effective lock time for messaging (matches bracket builder). */
export async function getWorldCupChallengeEffectiveLockAt(
  challengeId: string
): Promise<Date | null> {
  const challenge = await prisma.worldCupBracketChallenge.findUnique({
    where: { id: challengeId },
    include: { matches: true },
  })
  if (!challenge) return null
  return resolveWorldCupEffectivePickLockAt({
    pickLockStrategy: challenge.pickLockStrategy,
    pickLockAt: challenge.pickLockAt,
    matches: challenge.matches,
  })
}

/** Public picks URL for bracket entries (World Cup challenge hub). */
export function worldCupBracketPicksPublicUrl(challengeId: string): string {
  const base = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? ""
  const path = `/brackets/world-cup/${challengeId}/picks`
  return base ? `${base}${path}` : path
}
