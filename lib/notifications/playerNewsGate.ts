import 'server-only'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { readPlayerNewsLevel, routePlayerNews, type PlayerNewsLevel, type PlayerNewsRelation } from '@/lib/notification-settings/playerNewsLevel'
import { isInstantBucket, type StatusBucket } from './playerNewsStatus'
import type { DispatchNotificationParams } from './NotificationDispatcher'

/**
 * The one gate every player-news sender goes through (owner's call, 2026-10-22). It decides, per
 * person, whether a story is pushed now, saved for the daily digest, or not sent at all.
 *
 *   1. LEVEL — the person's Settings › Notifications › Player news choice (playerNewsLevel.ts).
 *   2. ONE ALERT PER PLAYER, PER STATUS, PER DAY, ACROSS EVERY SENDER — the news feed
 *      (PlayerNewsNotificationService), the injury sync (engagement-alerts/injuryAlerts) and the team
 *      workspace alerts all claim the same key: `pn-told:v1:<ET day>:<user>:<player>:<status>`. A
 *      player ruled out by two feeds and in three leagues is one alert; a player going from
 *      questionable to out the same day is still a second, because the status changed.
 *   3. CHANNELS — instant is push + bell and never email; digest is the bell only, and the daily
 *      "Roster news" email (playerNewsDigest.ts) collects it.
 *
 * `plan` reads; `markTold` writes AFTER a successful send, so a failed dispatch retries cleanly.
 * Reads fail OPEN to today's behaviour minus email: unreadable levels read as the default, an
 * unreadable ledger as "nobody told yet".
 */

const TOLD_TTL_MS = 3 * 86_400_000

export type PlayerNewsSubject = {
  /** PlayerIdentityMap.id when known — shared by every sender — else a sender-scoped stable key. */
  playerKey: string
  /** The status bucket for injury news, or `news:<category>` for a trade, signing, release… */
  bucket: StatusBucket | `news:${string}`
}

/** Legacy classification retained for source metadata; all relevant news now uses instant delivery. */
const INSTANT_NEWS = /^news:(trade|release|signing|suspension|roster_move|waiver|retirement)$/

export function subjectIsInstantWorthy(subject: PlayerNewsSubject): boolean {
  return subject.bucket.startsWith('news:') ? INSTANT_NEWS.test(subject.bucket) : isInstantBucket(subject.bucket as StatusBucket)
}

export type PlayerNewsPlan = { instant: string[]; digest: string[]; suppressed: string[] }

export function easternDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now)
}

export function toldKey(userId: string, subject: PlayerNewsSubject, now: Date): string {
  return `pn-told:v1:${easternDay(now)}:${userId}:${subject.playerKey}:${subject.bucket}`
}

type Deps = {
  readLevels?: (ids: string[]) => Promise<Map<string, PlayerNewsLevel>>
  readTold?: (keys: string[]) => Promise<Set<string>>
  now?: Date
}

async function readLevels(ids: string[]): Promise<Map<string, PlayerNewsLevel>> {
  const rows = await prisma.userProfile.findMany({ where: { userId: { in: ids } }, select: { userId: true, notificationPreferences: true } })
  return new Map(rows.map(r => [r.userId, readPlayerNewsLevel(r.notificationPreferences)]))
}

async function readTold(keys: string[]): Promise<Set<string>> {
  const rows = await prisma.sportsDataCache.findMany({ where: { cacheKey: { in: keys } }, select: { cacheKey: true } })
  return new Set(rows.map(r => r.cacheKey))
}

export async function planPlayerNews(
  userIds: string[],
  subject: PlayerNewsSubject,
  relationOf: (userId: string) => PlayerNewsRelation,
  deps: Deps = {},
): Promise<PlayerNewsPlan> {
  const plan: PlayerNewsPlan = { instant: [], digest: [], suppressed: [] }
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return plan
  const now = deps.now ?? new Date()
  const keys = new Map(ids.map(id => [id, toldKey(id, subject, now)]))
  const [levels, told] = await Promise.all([
    (deps.readLevels ?? readLevels)(ids).catch(() => new Map<string, PlayerNewsLevel>()),
    (deps.readTold ?? readTold)([...keys.values()]).catch(() => new Set<string>()),
  ])
  const instantWorthy = subjectIsInstantWorthy(subject)
  for (const id of ids) {
    if (told.has(keys.get(id)!)) { plan.suppressed.push(id); continue }
    const route = routePlayerNews(levels.get(id) ?? readPlayerNewsLevel(null), relationOf(id), { instantWorthy })
    if (route === 'drop') plan.suppressed.push(id)
    else plan[route].push(id)
  }
  return plan
}

/** Record that these people were told. Best effort: a lost write costs at most one repeat. */
export async function markPlayerNewsTold(userIds: string[], subject: PlayerNewsSubject, now: Date = new Date()): Promise<void> {
  const ids = [...new Set(userIds.filter(Boolean))]
  if (!ids.length) return
  try {
    await prisma.sportsDataCache.createMany({
      data: ids.map(id => ({ cacheKey: toldKey(id, subject, now), expiresAt: new Date(now.getTime() + TOLD_TTL_MS), data: { at: now.toISOString() } as Prisma.InputJsonValue })),
      skipDuplicates: true,
    })
  } catch {
    // Best effort, as documented above.
  }
}

/** What the daily digest needs to group a bell row by league, team and position. */
export type PlayerNewsDigestInfo = { playerName: string; team?: string | null; position?: string | null; status?: string | null; starter?: boolean }

/**
 * The two dispatches a plan becomes. Instant: push + bell, never email. Digest: bell only.
 * Both bell rows carry `meta.playerNews`, which is what the daily digest email reads.
 */
export function playerNewsDispatches(
  params: DispatchNotificationParams,
  plan: PlayerNewsPlan,
  info: PlayerNewsDigestInfo,
  starterOf: (userId: string) => boolean = () => info.starter === true,
): DispatchNotificationParams[] {
  const out: DispatchNotificationParams[] = []
  const skip = {
    instant: { ...params.skipChannels, sms: params.skipChannels?.sms ?? true, email: true },
    digest: { ...params.skipChannels, sms: true, email: true, push: true },
  }
  for (const delivery of ['instant', 'digest'] as const) {
    const ids = params.userIds.filter(id => plan[delivery].includes(id))
    for (const starter of [true, false]) {
      const group = ids.filter(id => starterOf(id) === starter)
      if (group.length) out.push({ ...params, userIds: group, meta: { ...(params.meta ?? {}), playerNews: { ...info, starter, delivery } }, skipChannels: skip[delivery] })
    }
  }
  return out
}

/** One person's player-news level; the default when it cannot be read. */
export async function readPlayerNewsLevelFor(userId: string): Promise<PlayerNewsLevel> {
  try {
    return (await readLevels([userId])).get(userId) ?? readPlayerNewsLevel(null)
  } catch {
    return readPlayerNewsLevel(null)
  }
}

/**
 * Claim today's one designed player-news email for this person (Eastern day). True = this caller may
 * send it. A claim that cannot be written reads as already used: an extra email is the failure this
 * exists to prevent.
 */
export async function claimPlayerNewsEmailToday(userId: string, now: Date = new Date()): Promise<boolean> {
  try {
    await prisma.sportsDataCache.create({ data: { cacheKey: `pn-email:v1:${easternDay(now)}:${userId}`, expiresAt: new Date(now.getTime() + TOLD_TTL_MS), data: { at: now.toISOString() } as Prisma.InputJsonValue } })
    return true
  } catch {
    return false
  }
}
