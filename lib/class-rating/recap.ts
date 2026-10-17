import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { CLASS_MODEL_VERSION } from '@/lib/class-rating/engine'
import { CLASS_SPORT } from '@/lib/class-rating/store'

/**
 * The weekly Class recap — "Your Class rating is up 14 this week" — the reason to come back after a
 * weekend of games. Ported from PR #1753's skill recap onto the Class core (owner ruling, 2026-10-01).
 *
 * ── WHY IT IS SIMPLER THAN #1753's ──────────────────────────────────────────────────────────────
 * #1753 snapshotted its whole rating board every Tuesday and diffed the next week against it. The
 * Class game log already stores every week's move per person (`manager_rating_events.ratingDelta`),
 * so a recap is a SUM of the rows since the last one. No baseline board, no weekday: it is queued
 * when the writer rates a week it had not rated before.
 *
 * ⚠ THE FIRST RUN ONLY RECORDS WHERE IT STARTS. A recap against nothing would report a manager's
 * whole career as "this week".
 *
 * ⚠ IT NOTIFIES REAL PEOPLE, SO IT IS OFF UNTIL SOMEONE TURNS IT ON. Recaps are always computed and
 * queued; they are only SENT when `CLASS_RECAP_NOTIFICATIONS=true`, through `dispatchNotification`,
 * which honours each user's settings for the `matchup_results` category. Sent in batches: the queue is
 * a document, each fire drains up to `RECAP_BATCH`, and the next fire continues.
 */

export const RECAP_STATE_KEY = 'class-rating:v1:recap'
export const RECAP_BATCH = 40
const RETENTION_DAYS = 60

export type RecapItem = { userId: string; title: string; body: string }
type RecapQueue = { period: number; pending: RecapItem[]; sent: number; failed: number }
export type RecapState = { lastPeriod: number | null; queue: RecapQueue | null }

export type RecapRow = {
  userId: string
  delta: number
  w: number
  l: number
  t: number
  apWins: number
  apGames: number
  established: boolean
  classLevel: number | null
  division: number | null
  rating: number
  rd: number
}

const signedInt = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0')

/** One recap from one manager's rows since the last recap. Pure; exported for tests. */
export function recapFor(r: RecapRow): RecapItem {
  const delta = Math.round(r.delta)
  const title =
    delta > 0
      ? `Your Class rating is up ${delta} this week`
      : delta < 0
        ? `Your Class rating slipped ${-delta} this week`
        : 'Your Class rating held steady this week'
  const apWins = Number.isInteger(r.apWins) ? String(r.apWins) : r.apWins.toFixed(1)
  const h2h = r.w + r.l + r.t > 0 ? ` (${r.w}-${r.l}${r.t ? `-${r.t}` : ''} head-to-head)` : ''
  const standing =
    r.established && r.classLevel != null && r.division != null
      ? `Now Class ${r.classLevel} · Division ${r.division}, rating ${Math.round(r.rating)} ±${Math.round(r.rd)}.`
      : `Still provisional — rating ${Math.round(r.rating)} ±${Math.round(r.rd)}.`
  return {
    userId: r.userId,
    title,
    body: `You outscored ${apWins} of ${r.apGames} teams across your leagues${h2h}, ${signedInt(delta)} rating. ${standing} See every week behind it.`,
  }
}

async function readState(): Promise<RecapState> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: RECAP_STATE_KEY }, select: { data: true } })
  const d = row?.data as Partial<RecapState> | undefined
  return {
    lastPeriod: typeof d?.lastPeriod === 'number' ? d.lastPeriod : null,
    queue: d?.queue && typeof d.queue === 'object' && Array.isArray((d.queue as RecapQueue).pending) ? (d.queue as RecapQueue) : null,
  }
}

async function writeState(state: RecapState, now: Date): Promise<void> {
  const data = state as unknown as Prisma.InputJsonValue
  const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 86_400_000)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: RECAP_STATE_KEY },
    create: { cacheKey: RECAP_STATE_KEY, data, expiresAt },
    update: { data, expiresAt },
  })
}

export type RecapCounts = { queued: number; baseline: number; sent: number; failed: number; remaining: number; errors: string[] }

export function emptyRecapCounts(): RecapCounts {
  return { queued: 0, baseline: 0, sent: 0, failed: 0, remaining: 0, errors: [] }
}

/**
 * Called right after the writer replaced the tables. Queues a recap for every AF manager with rated
 * weeks newer than the last recap, then moves the marker. A rebuild with no new week queues nothing.
 */
export async function queueClassRecaps(now: Date = new Date()): Promise<RecapCounts> {
  const out = emptyRecapCounts()
  const [newest] = await prisma.$queryRaw<Array<{ period: number | null }>>`
    SELECT max(season * 100 + week) AS period FROM manager_rating_events
     WHERE sport = ${CLASS_SPORT} AND "modelVersion" = ${CLASS_MODEL_VERSION}`
  const period = newest?.period == null ? null : Number(newest.period)
  if (period == null) return out
  const state = await readState()
  if (state.lastPeriod == null) {
    await writeState({ ...state, lastPeriod: period }, now)
    out.baseline = 1
    return out
  }
  if (period <= state.lastPeriod) return out

  const rows = await prisma.$queryRaw<
    Array<{
      userId: string
      delta: number
      w: number
      l: number
      t: number
      apWins: number
      apGames: number
      established: boolean
      classLevel: number | null
      division: number | null
      rating: number
      rd: number
    }>
  >`
    WITH best AS (
      SELECT DISTINCT ON ("userId") "userId", "subjectKey", rating, rd, established, "classLevel", division
        FROM manager_ratings
       WHERE "userId" IS NOT NULL AND sport = ${CLASS_SPORT} AND "modelVersion" = ${CLASS_MODEL_VERSION}
       ORDER BY "userId", established DESC, games DESC, "subjectKey"
    )
    SELECT b."userId", b.rating, b.rd, b.established, b."classLevel", b.division,
           sum(e."ratingDelta")::float8 AS delta,
           count(*) FILTER (WHERE e.result = 'W')::int AS w,
           count(*) FILTER (WHERE e.result = 'L')::int AS l,
           count(*) FILTER (WHERE e.result = 'T')::int AS t,
           sum(e."allPlayWins")::float8 AS "apWins",
           sum(e."allPlayGames")::int AS "apGames"
      FROM best b
      JOIN manager_rating_events e
        ON e."subjectKey" = b."subjectKey" AND e.sport = ${CLASS_SPORT} AND e."modelVersion" = ${CLASS_MODEL_VERSION}
     WHERE e.season * 100 + e.week > ${state.lastPeriod}
     GROUP BY b."userId", b.rating, b.rd, b.established, b."classLevel", b.division`
  const pending = rows.map((r) =>
    recapFor({
      userId: r.userId,
      delta: Number(r.delta),
      w: Number(r.w),
      l: Number(r.l),
      t: Number(r.t),
      apWins: Number(r.apWins),
      apGames: Number(r.apGames),
      established: r.established,
      classLevel: r.classLevel == null ? null : Number(r.classLevel),
      division: r.division == null ? null : Number(r.division),
      rating: Number(r.rating),
      rd: Number(r.rd),
    }),
  )
  await writeState({ lastPeriod: period, queue: { period, pending, sent: 0, failed: 0 } }, now)
  out.queued = pending.length
  return out
}

/** Send up to `batch` queued recaps. A no-op unless `CLASS_RECAP_NOTIFICATIONS=true`. */
export async function drainClassRecaps(now: Date = new Date(), batch = RECAP_BATCH): Promise<RecapCounts> {
  const out = emptyRecapCounts()
  if (String(process.env.CLASS_RECAP_NOTIFICATIONS ?? '').toLowerCase() !== 'true') return out
  const state = await readState()
  const queue = state.queue
  if (!queue || queue.pending.length === 0) return out

  // Imported here, not at module load: the dispatcher's graph is wide, and the cron route must not fail
  // to load because a notification transport is misconfigured.
  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  const take = queue.pending.slice(0, batch)
  // Written back BEFORE sending: a crash mid-batch loses at most that batch, never sends it twice.
  await writeState({ ...state, queue: { ...queue, pending: queue.pending.slice(batch) } }, now)

  for (const item of take) {
    try {
      await dispatchNotification({
        userIds: [item.userId],
        category: 'matchup_results',
        type: 'class_weekly_recap',
        title: item.title,
        body: item.body,
        actionHref: '/core/rankings?scope=class',
        actionLabel: 'See my weeks',
        severity: 'low',
        dedupePrefix: `class-recap:${queue.period}`,
      })
      out.sent += 1
    } catch (e) {
      out.failed += 1
      out.errors.push(`class_recap ${item.userId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  out.remaining = Math.max(0, queue.pending.length - take.length)
  const after = await readState()
  if (after.queue && after.queue.period === queue.period) {
    await writeState({ ...after, queue: { ...after.queue, sent: after.queue.sent + out.sent, failed: after.queue.failed + out.failed } }, now)
  }
  return out
}
