import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import {
  closeRecommendationOutcomeUndecided,
  resolveRecommendationOutcome,
} from '@/lib/ai/outcomes/trackRecommendationOutcome'

/**
 * CLOSE THE HALF OF THE OUTCOME LOOP THAT HAD NO CALLER.
 *
 * 🛑 `resolveRecommendationOutcome` HAS EXISTED WITH ZERO CALLERS. `AiRecommendationOutcome`
 * rows are written when a recommendation is SERVED, with `followed` left NULL because nothing
 * is known yet — and nothing ever came back to fill it in. Every follow-rate, every
 * "users who followed AI scored higher" comparison, every per-type and per-league outcome
 * breakdown in `lib/ai/admin/getAIMetrics.ts` reads that column.
 *
 * ⚠ THOSE DASHBOARDS ARE NOT LYING TODAY, AND THAT IS WHY THIS IS SAFE TO ADD. They guard
 * every denominator and say "Not enough resolved outcomes to compare follow vs ignore yet."
 * So the bug was never a false number — it was a permanently empty one. This gives them
 * something true to read rather than correcting something false.
 *
 * SCOPE: `war_room_pick` ONLY, deliberately. That is the one recommendation type where both
 * halves exist — a live writer (seven war-room routes, via `logAiRecommendation`) and a
 * groundable outcome (`draft_picks`, which records what the manager actually took). Waiver
 * and trade advice have no comparable signal in this database yet: `waiver_claims` is empty,
 * and pointing a resolver at an empty table would produce a confident follow-rate computed
 * from nothing, which is worse than the blank it replaces.
 */

/** The recommendation type written by `/api/war-room/recommend`. */
const WAR_ROOM_PICK = 'war_room_pick'

/**
 * Picks that were not a decision.
 *
 * 🛑 AN AUTOPICK IS NOT SOMEBODY IGNORING ADVICE, AND COUNTING IT AS ONE IS HOW A FOLLOW-RATE
 * BECOMES A MEASURE OF WHO FELL ASLEEP. A manager who times out gets a pick chosen for them by
 * the engine; scoring that as "ignored" would push the rate down hardest for exactly the
 * sessions where nobody was reading the recommendation at all. Those rows are left UNRESOLVED
 * rather than resolved-as-ignored — "we cannot say" is a different fact from "they said no",
 * and this column is the one place that distinction survives.
 */
const NON_DECISION_SOURCES = new Set(['auto', 'random', 'draft_completion', 'draft_reset'])

/**
 * A recommendation whose manager has still not picked after this long belongs to a draft that was
 * abandoned or never resumed. Kept open, it would sit in the oldest-first batch forever.
 */
export const ABANDONED_AFTER_DAYS = 14

export type DraftOutcomeResolution = {
  examined: number
  resolved: number
  followed: number
  ignored: number
  /** No pick has been made since the recommendation — the answer is not knowable yet. */
  pendingNoPickYet: number
  /** The next pick was an autopick or engine action; deliberately left unresolved. */
  skippedNonDecision: number
  /** The log row was missing, or carried no player name to compare against. */
  skippedUnusable: number
  /** No pick after ABANDONED_AFTER_DAYS — closed as undecidable rather than re-read forever. */
  closedAbandoned: number
}

function emptyResult(): DraftOutcomeResolution {
  return {
    examined: 0,
    resolved: 0,
    followed: 0,
    ignored: 0,
    pendingNoPickYet: 0,
    skippedNonDecision: 0,
    skippedUnusable: 0,
    closedAbandoned: 0,
  }
}

/** The recommended player's name, as `/api/war-room/recommend` writes it. */
function recommendedPlayerName(outputJson: unknown): string | null {
  if (!outputJson || typeof outputJson !== 'object' || Array.isArray(outputJson)) return null
  const pickNow = (outputJson as Record<string, unknown>).pickNow
  if (typeof pickNow !== 'string') return null
  const trimmed = pickNow.trim()
  return trimmed.length > 0 ? trimmed : null
}

/**
 * Resolve `followed` for served draft recommendations whose manager has since picked.
 *
 * ⚠ `outcomeScore` IS DELIBERATELY NOT SET, AND THE COMMENT IS THE POINT. Whether a pick was
 * GOOD is a different question from whether the advice was TAKEN, and answering it honestly
 * needs the player's subsequent production — which this database cannot key to a drafted
 * player today (see the roster/player id-space problem). Writing a placeholder score here
 * would give `getAIMetrics` a number to average that means nothing, and an averaged
 * meaningless number is indistinguishable from a real one on a chart. Follow-rate first;
 * scoring is its own piece of work with its own data prerequisite.
 *
 * Bounded and fail-open by construction: it runs inside a ten-minute cron beside other work,
 * so it takes a batch and returns, and a telemetry failure must never fail that cron.
 */
export async function resolveDraftRecommendationOutcomes(opts?: {
  limit?: number
  now?: Date
}): Promise<DraftOutcomeResolution> {
  const limit = Math.max(1, Math.min(500, opts?.limit ?? 100))
  const now = opts?.now ?? new Date()
  const result = emptyResult()

  const pending = await prisma.aiRecommendationOutcome.findMany({
    /*
     * 🛑 `resolvedAt: null` IS WHAT KEEPS THIS FROM STALLING. Without it, rows that can never
     * resolve (unusable, autopicks, abandoned drafts) stayed `followed: null` forever, the batch
     * is oldest-first, and once `limit` of them piled up nothing newer was ever examined. Those
     * rows are now CLOSED below — `resolvedAt` set, `followed` still null — and skipped here.
     */
    where: { type: WAR_ROOM_PICK, followed: null, resolvedAt: null },
    select: { recommendationId: true },
    orderBy: { createdAt: 'asc' },
    take: limit,
  })
  result.examined = pending.length
  if (pending.length === 0) return result

  const logs = await prisma.aiRecommendationLog.findMany({
    where: { id: { in: pending.map((p) => p.recommendationId) } },
    select: {
      id: true,
      userId: true,
      draftSessionId: true,
      outputJson: true,
      createdAt: true,
    },
  })
  const logById = new Map(logs.map((l) => [l.id, l]))

  for (const row of pending) {
    const log = logById.get(row.recommendationId)
    const recommended = log ? recommendedPlayerName(log.outputJson) : null

    /*
     * No log row, no draft session, or no player name to compare. Left unresolved on purpose:
     * these are recommendations we cannot judge, not recommendations that were ignored.
     */
    if (!log || !log.draftSessionId || !log.userId || !recommended) {
      result.skippedUnusable += 1
      await closeRecommendationOutcomeUndecided(row.recommendationId)
      continue
    }

    /*
     * The manager's FIRST pick after the recommendation was served.
     *
     * ⚠ Ordered by the pick's own clock, not by row id. `pickedAt` is when the pick happened
     * and `createdAt` is when the row was written; a backfilled or repaired row can carry a
     * `createdAt` far from the moment of the pick, and ordering by insertion would then compare
     * the advice against somebody else's turn.
     */
    const nextPick = await prisma.draftPick.findFirst({
      where: {
        sessionId: log.draftSessionId,
        ownerUserId: log.userId,
        OR: [{ pickedAt: { gt: log.createdAt } }, { pickedAt: null, createdAt: { gt: log.createdAt } }],
      },
      select: { playerName: true, source: true, pickedAt: true, createdAt: true, overall: true },
      orderBy: [{ pickedAt: 'asc' }, { createdAt: 'asc' }],
    })

    if (!nextPick) {
      const ageMs = now.getTime() - log.createdAt.getTime()
      if (ageMs > ABANDONED_AFTER_DAYS * 86_400_000) {
        result.closedAbandoned += 1
        await closeRecommendationOutcomeUndecided(row.recommendationId)
        continue
      }
      /* The draft has not reached them yet. Ask again next run. */
      result.pendingNoPickYet += 1
      continue
    }

    if (nextPick.source && NON_DECISION_SOURCES.has(nextPick.source)) {
      result.skippedNonDecision += 1
      await closeRecommendationOutcomeUndecided(row.recommendationId)
      continue
    }

    const followed = normalizePlayerName(nextPick.playerName) === normalizePlayerName(recommended)
    await resolveRecommendationOutcome(row.recommendationId, { followed })

    result.resolved += 1
    if (followed) result.followed += 1
    else result.ignored += 1
  }

  return result
}
