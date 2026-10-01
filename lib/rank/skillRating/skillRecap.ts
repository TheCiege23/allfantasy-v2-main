import 'server-only'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { percentileRank, type SkillBoard } from '@/lib/rank/skillRating/skillRatingStore'

/**
 * The weekly skill recap — "NFL skill +18 this week (2-0)" — the reason to come
 * back after a weekend of games.
 *
 * ── HOW A WEEK IS MEASURED ───────────────────────────────────────────────────
 * Every Tuesday (Eastern), after Monday night, the day's board is compared with a
 * BASELINE saved the previous Tuesday. A manager whose game count in a sport rose
 * gets one recap covering every sport they played. Then today's board becomes the
 * baseline. The first Tuesday only saves a baseline — a recap against nothing
 * would report a manager's whole career as "this week".
 *
 * ⚠ IT NOTIFIES REAL PEOPLE, SO IT IS OFF UNTIL SOMEONE TURNS IT ON.
 * Recaps are always computed and queued; they are only SENT when
 * `SKILL_RECAP_NOTIFICATIONS=true`. Sending goes through `dispatchNotification`,
 * which honours each user's settings for the `matchup_results` category.
 *
 * ⚠ SENT IN BATCHES, NOT ALL AT ONCE. One notification per user, sequentially,
 * inside a cron with a 240s budget, does not fit a few hundred users. The queue is
 * a document; each fire drains up to `RECAP_BATCH` and the next fire continues.
 */

export const RECAP_BASELINE_KEY = 'skill-rating:v1:recap-baseline'
export const RECAP_QUEUE_KEY = 'skill-rating:v1:recap-queue'
const RETENTION_DAYS = 60
export const RECAP_BATCH = 40
/** Tuesday, in `Intl` weekday-short form. */
const RECAP_WEEKDAY = 'Tue'

type SportLine = { r: number; g: number; w: number; l: number; t: number }
export type RecapBaseline = { date: string; users: Record<string, Record<string, SportLine>> }

export type RecapItem = {
  userId: string
  title: string
  body: string
  /** Sports in the recap, best first — also what the link opens on. */
  sports: string[]
}
export type RecapQueue = { date: string; pending: RecapItem[]; sent: number; failed: number }

function easternWeekday(now: Date): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(now)
}

export function baselineFrom(board: SkillBoard): RecapBaseline {
  const users: RecapBaseline['users'] = {}
  for (const [sport, sb] of Object.entries(board.sports)) {
    for (const row of sb.rows) {
      const u = (users[row.u] ??= {})
      u[sport] = { r: row.r, g: row.g, w: row.w, l: row.l, t: row.t }
    }
  }
  return { date: board.date, users }
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '±0'
}

/**
 * Pure: one recap per manager who played since `prev`. Exported for tests.
 */
export function buildRecaps(prev: RecapBaseline, board: SkillBoard): RecapItem[] {
  type Move = { sport: string; delta: number; w: number; l: number; t: number; rating: number; percentile: number | null }
  const byUser = new Map<string, Move[]>()
  for (const [sport, sb] of Object.entries(board.sports)) {
    for (const row of sb.rows) {
      const before = prev.users[row.u]?.[sport]
      const games = row.g - (before?.g ?? 0)
      if (games <= 0) continue
      const move: Move = {
        sport,
        delta: Math.round(row.r - (before?.r ?? 1500)),
        w: row.w - (before?.w ?? 0),
        l: row.l - (before?.l ?? 0),
        t: row.t - (before?.t ?? 0),
        rating: Math.round(row.r),
        percentile: percentileRank(sb.percentiles, row.r - 2 * row.rd),
      }
      const list = byUser.get(row.u)
      if (list) list.push(move)
      else byUser.set(row.u, [move])
    }
  }

  const out: RecapItem[] = []
  for (const [userId, moves] of byUser) {
    moves.sort((a, b) => b.w + b.l + b.t - (a.w + a.l + a.t) || b.delta - a.delta)
    const lead = moves[0]
    const rec = (m: Move) => `${m.w}-${m.l}${m.t ? `-${m.t}` : ''}`
    const title =
      lead.delta > 0
        ? `Your ${lead.sport} skill is up ${lead.delta} this week`
        : lead.delta < 0
          ? `Your ${lead.sport} skill slipped ${-lead.delta} this week`
          : `Your ${lead.sport} skill held steady this week`
    const parts = moves.map(
      (m) => `${m.sport} ${signed(m.delta)} (${rec(m)}), now ${m.rating}${m.percentile != null ? ` — better than ${m.percentile}% of managers` : ''}`,
    )
    out.push({ userId, title, body: `${parts.join('. ')}. See every game and who you beat.`, sports: moves.map((m) => m.sport) })
  }
  return out
}

async function readDoc<T>(key: string, guard: (v: unknown) => v is T): Promise<T | null> {
  const row = await prisma.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { data: true } }).catch(() => null)
  return row && guard(row.data) ? row.data : null
}

async function writeDoc(key: string, value: unknown, now: Date) {
  const data = value as Prisma.InputJsonValue
  const expiresAt = new Date(now.getTime() + RETENTION_DAYS * 86_400_000)
  await prisma.sportsDataCache.upsert({
    where: { cacheKey: key },
    create: { cacheKey: key, data, expiresAt },
    update: { data, expiresAt },
  })
}

const isBaseline = (v: unknown): v is RecapBaseline =>
  !!v && typeof v === 'object' && typeof (v as RecapBaseline).date === 'string' && typeof (v as RecapBaseline).users === 'object'
const isQueue = (v: unknown): v is RecapQueue =>
  !!v && typeof v === 'object' && typeof (v as RecapQueue).date === 'string' && Array.isArray((v as RecapQueue).pending)

export type RecapCounts = { queued: number; baselineWritten: number; sent: number; failed: number; remaining: number; errors: string[] }

export function emptyRecapCounts(): RecapCounts {
  return { queued: 0, baselineWritten: 0, sent: 0, failed: 0, remaining: 0, errors: [] }
}

/**
 * Called right after a fresh board is written. On a Tuesday, queue this week's
 * recaps and roll the baseline; on any other day, nothing.
 */
export async function queueWeeklyRecaps(board: SkillBoard, now: Date = new Date()): Promise<RecapCounts> {
  const out = emptyRecapCounts()
  if (easternWeekday(now) !== RECAP_WEEKDAY) return out
  const prev = await readDoc(RECAP_BASELINE_KEY, isBaseline)
  if (prev?.date === board.date) return out
  if (prev) {
    const items = buildRecaps(prev, board)
    await writeDoc(RECAP_QUEUE_KEY, { date: board.date, pending: items, sent: 0, failed: 0 } satisfies RecapQueue, now)
    out.queued = items.length
  }
  await writeDoc(RECAP_BASELINE_KEY, baselineFrom(board), now)
  out.baselineWritten = 1
  return out
}

/**
 * Send up to `RECAP_BATCH` queued recaps. A no-op unless
 * `SKILL_RECAP_NOTIFICATIONS=true`, and when the queue is empty.
 */
export async function drainSkillRecaps(now: Date = new Date(), batch = RECAP_BATCH): Promise<RecapCounts> {
  const out = emptyRecapCounts()
  if (String(process.env.SKILL_RECAP_NOTIFICATIONS ?? '').toLowerCase() !== 'true') return out
  const queue = await readDoc(RECAP_QUEUE_KEY, isQueue)
  if (!queue || queue.pending.length === 0) return out

  // Imported here, not at module load: the dispatcher's graph is wide, and the cron route must not
  // fail to load because a notification transport is misconfigured.
  const { dispatchNotification } = await import('@/lib/notifications/NotificationDispatcher')
  const take = queue.pending.slice(0, batch)
  // Written back BEFORE sending: a crash mid-batch loses at most that batch, never sends it twice.
  await writeDoc(RECAP_QUEUE_KEY, { ...queue, pending: queue.pending.slice(batch) }, now)

  for (const item of take) {
    try {
      await dispatchNotification({
        userIds: [item.userId],
        category: 'matchup_results',
        type: 'skill_weekly_recap',
        title: item.title,
        body: item.body,
        actionHref: `/core/rankings?scope=skill&sport=${encodeURIComponent(item.sports[0] ?? 'NFL')}`,
        actionLabel: 'See my games',
        severity: 'low',
        dedupePrefix: `skill-recap:${queue.date}`,
      })
      out.sent += 1
    } catch (e) {
      out.failed += 1
      out.errors.push(`skill_recap ${item.userId}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  out.remaining = Math.max(0, queue.pending.length - take.length)
  const after = await readDoc(RECAP_QUEUE_KEY, isQueue)
  if (after && after.date === queue.date) {
    await writeDoc(RECAP_QUEUE_KEY, { ...after, sent: after.sent + out.sent, failed: after.failed + out.failed }, now)
  }
  return out
}
