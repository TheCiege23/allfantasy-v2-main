import 'server-only'

import { prisma } from '@/lib/prisma'
import { listAdviceUsers } from '@/lib/chimmy-advice/adviceStore'
import { addAdviceKey, startSitAdviceKey } from '@/lib/chimmy-advice/adviceKeys'
import { resolveCurrentWeek } from '@/lib/core-app/currentWeek'
import { resolveChimmyAdviceOutcomes, type ReceiptsLeague } from '@/lib/core-app/decisionReceipts'
import { buildAdviceLearningSnapshot, LEARNING_WINDOW_DAYS, type AdviceOutcome } from './learningSnapshot'
import { ADVICE_LEARNING_CACHE_KEY, readAdviceLearningSnapshot, resetAdviceLearningMemo } from './learningStore'

export { ADVICE_LEARNING_CACHE_KEY, readAdviceLearningSnapshot }

/**
 * WHAT CHIMMY HAS LEARNED — the server half: rebuild the snapshot, and read it back.
 *
 * User decision 2026-09-16 ("Recompute, no new table"): the snapshot lives in ONE
 * `SportsDataCache` row and is rebuilt from scratch by `/api/cron/decision-os-intelligence-maintenance`.
 * That cron fires every ten minutes; the rebuild runs only when the stored snapshot is older than
 * RECOMPUTE_AFTER_MS, so most ticks cost one indexed read.
 *
 * ⚠ THE ROW OUTLIVES ITS REBUILD INTERVAL ON PURPOSE. `purgeExpiredCache` deletes expired
 * SportsDataCache rows every hour from `/api/cron/reap-sync-runs` (since 2026-09-17; before that
 * nothing called it, so this comment described a purge that never ran). `expiresAt` is therefore set
 * eight days out, well past the six-hour rebuild: a cron outage leaves Chimmy reading an older
 * snapshot, not none.
 *
 * ⚠ A MISSING ADVICE TABLE IS "UNAVAILABLE", and nothing is written: an empty snapshot would read
 * as "nothing to learn from", which is a different claim.
 */

export const RECOMPUTE_AFTER_MS = 6 * 60 * 60 * 1000
const SNAPSHOT_TTL_MS = 8 * 24 * 60 * 60 * 1000
/** The most users one rebuild resolves, most recently advised first. */
export const MAX_LEARNING_USERS = 300
const USER_CONCURRENCY = 4
const DEFAULT_BUDGET_MS = 20_000

export type AdviceLearningRun =
  | { status: 'fresh'; computedAt: string }
  | { status: 'unavailable' }
  | { status: 'computed'; users: number; resolvedUsers: number; outcomes: number; calls: number; complete: boolean; ms: number }

export async function recomputeAdviceLearning(
  opts: { now?: Date; force?: boolean; budgetMs?: number } = {},
): Promise<AdviceLearningRun> {
  const now = opts.now ?? new Date()
  const started = Date.now()
  const budgetMs = opts.budgetMs ?? DEFAULT_BUDGET_MS

  if (!opts.force) {
    const existing = await readAdviceLearningSnapshot({ fresh: true })
    const age = existing ? now.getTime() - Date.parse(existing.computedAt) : Number.POSITIVE_INFINITY
    if (existing && age >= 0 && age < RECOMPUTE_AFTER_MS) return { status: 'fresh', computedAt: existing.computedAt }
  }

  const since = new Date(now.getTime() - LEARNING_WINDOW_DAYS * 86_400_000)
  const listed = await listAdviceUsers({ since, limit: MAX_LEARNING_USERS + 1 })
  if (!listed) return { status: 'unavailable' }
  const users = listed.slice(0, MAX_LEARNING_USERS)
  let complete = listed.length <= MAX_LEARNING_USERS

  const leagueRows = users.length
    ? await prisma.league.findMany({
        where: { id: { in: [...new Set(users.flatMap((u) => u.leagueIds))] } },
        select: { id: true, name: true, platform: true, platformLeagueId: true, season: true },
      })
    : []
  const leagueById = new Map<string, ReceiptsLeague>(leagueRows.map((l) => [l.id, l]))

  const outcomes: AdviceOutcome[] = []
  let resolvedUsers = 0
  let next = 0
  const worker = async () => {
    while (next < users.length) {
      if (Date.now() - started > budgetMs) {
        complete = false
        return
      }
      const user = users[next++]!
      const leagues = user.leagueIds.map((id) => leagueById.get(id)).filter((l): l is ReceiptsLeague => Boolean(l))
      try {
        const week = await resolveCurrentWeek(leagues.map((l) => l.platformLeagueId ?? '').filter(Boolean))
        const resolved = await resolveChimmyAdviceOutcomes({
          userId: user.userId,
          leagues,
          currentWeek: week?.week ?? null,
          since,
        })
        if (!resolved) continue
        outcomes.push(...toOutcomes(user.userId, resolved))
        resolvedUsers += 1
      } catch {
        // One user's unreadable data never stops the others; the snapshot says it is incomplete.
        complete = false
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(USER_CONCURRENCY, users.length) }, worker))

  const snapshot = buildAdviceLearningSnapshot(outcomes, { now, complete, users: resolvedUsers })
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: ADVICE_LEARNING_CACHE_KEY },
    create: { cacheKey: ADVICE_LEARNING_CACHE_KEY, data: snapshot as never, expiresAt: new Date(now.getTime() + SNAPSHOT_TTL_MS) },
    update: { data: snapshot as never, expiresAt: new Date(now.getTime() + SNAPSHOT_TTL_MS) },
  })
  resetAdviceLearningMemo()

  return {
    status: 'computed',
    users: users.length,
    resolvedUsers,
    outcomes: outcomes.length,
    calls: snapshot.totals.calls,
    complete,
    ms: Date.now() - started,
  }
}

/** One user's resolved receipts, joined back to the advice they came from. */
export function toOutcomes(
  userId: string,
  resolved: NonNullable<Awaited<ReturnType<typeof resolveChimmyAdviceOutcomes>>>,
): AdviceOutcome[] {
  const byKey = new Map<string, (typeof resolved.advice)[number]>()
  for (const a of resolved.advice) {
    if (a.adviceType === 'start_sit' && a.alt) byKey.set(startSitAdviceKey(a.leagueId, a.season, a.week, a.rec.key, a.alt.key), a)
    else if (a.adviceType === 'add') byKey.set(addAdviceKey(a.leagueId, a.season, a.week, a.rec.key), a)
  }
  const out: AdviceOutcome[] = []
  for (const r of resolved.startSits) {
    const a = byKey.get(r.id)
    if (!a) continue
    out.push({
      userId,
      key: r.id,
      adviceType: 'start_sit',
      confidencePct: a.confidencePct,
      givenAt: a.givenAt,
      call: r.call,
      followed: r.followed,
    })
  }
  for (const r of resolved.adds) {
    const a = byKey.get(r.id)
    if (!a) continue
    out.push({
      userId,
      key: r.id,
      adviceType: 'add',
      confidencePct: a.confidencePct,
      givenAt: a.givenAt,
      followed: r.added ? 'yes' : 'no',
    })
  }
  return out
}
