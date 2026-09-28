import 'server-only'

import type { Prisma } from '@prisma/client'

import { getBaseUrl } from '@/lib/get-base-url'
import { resolveNotificationPreferences } from '@/lib/notification-settings/NotificationPreferenceResolver'
import type { NotificationPreferences } from '@/lib/notification-settings/types'
import { dispatchNotification, type DispatchNotificationParams } from '@/lib/notifications/NotificationDispatcher'
import { prisma } from '@/lib/prisma'
import { getSettingsProfile } from '@/lib/user-settings'
import { loadChimmyAlertPreferences } from './ChimmyAlertPreferencesService'
import type { ScheduledGame } from './lineupCheck'
import type { ChimmyAlertUserPreferences } from './types'

/**
 * What every weekly Chimmy message shares — the lineup check before the main slate, the waiver
 * check on Tuesday. Who is in the audience, whose settings say no, how "once a week" is enforced,
 * and how it is handed to the dispatcher. Each check keeps its own "what is worth saying" and its
 * own window; this is the plumbing under both, so the two cannot drift on the rules that protect
 * people from being over-messaged.
 *
 * ── 🛑 ONCE PER USER PER WEEK, AND THE CLAIM IS NOT THE IN-APP ROW ─────────────────────────────
 * The injured-starter sweep dedupes on the bell entry's `sourceKey`. That entry is only written
 * when in-app is on for the category, so a user who keeps email and turns the bell off would be
 * emailed every run. Here the claim is a `SportsDataCache` row CREATED by primary key before
 * anything is sent: a second run, or the second worker replica, fails the create and sends
 * nothing. At most once — a send that fails after the claim is not retried, which beats a manager
 * receiving the same message twelve times.
 *
 * ── ONE SWITCH IN NOTIFICATION SETTINGS, FINER ONES IN CHIMMY'S ────────────────────────────────
 * Both checks send under `lineup_reminders` ("Chimmy's weekly lineup & waiver checks"). Chimmy's
 * own alert controls mute them apart: the Lineup class silences the lineup check, the Waivers class
 * the waiver check.
 */

/** Both weekly checks ride this category — see the header. */
export const PROACTIVE_CATEGORY = 'lineup_reminders' as const

/** Long enough to outlive the week; the claim key carries the week, so it cannot block the next. */
export const CLAIM_TTL_MS = 8 * 24 * 60 * 60 * 1000

const QUARTER_HOUR_MS = 15 * 60 * 1000

export type ProactiveAudienceLeague = {
  id: string
  name: string | null
  leagueVariant: string | null
  bestBallMode: boolean | null
  /** For "one message line per REAL league" — see lib/core-app/realLeague.ts. */
  platform?: string | null
  platformLeagueId?: string | null
  season?: number | null
}

export type ProactiveUserSettings = {
  notifications: NotificationPreferences
  chimmy: ChimmyAlertUserPreferences | null
}

export interface ProactiveDeliveryDeps {
  now: () => Date
  loadAudience: (season: number, onlyUserId: string | null) => Promise<Map<string, ProactiveAudienceLeague[]>>
  loadSettings: (userId: string) => Promise<ProactiveUserSettings | null>
  /** Read-only: has this week's message already gone to this user? */
  alreadySent: (key: string) => Promise<boolean>
  /** Atomically claim this week's message for this user. False when someone already has. */
  claim: (key: string, expiresAt: Date) => Promise<boolean>
  dispatch: (params: DispatchNotificationParams) => Promise<void>
  baseUrl: () => string
}

function prismaCode(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : null
}

/**
 * The NFL regular-season games of one week.
 *
 * 🛑 `seasonType: 'regular'` IS LOAD-BEARING. Measured 2026-09-24: the `espn_live` and
 * `thesportsdb` sources file preseason games under week 2, 3 and 4 with NO seasonType, so an
 * unfiltered week-4 read returns August kickoffs — every player on those teams reads as locked
 * since August, and the week reads as already started.
 */
export async function loadRegularSeasonGames(season: number, week: number): Promise<ScheduledGame[]> {
  const rows = await prisma.sportsGame.findMany({
    where: { sport: 'NFL', season, week, seasonType: 'regular', startTime: { not: null } },
    select: { homeTeam: true, awayTeam: true, startTime: true },
  })
  return rows.flatMap((r) => (r.startTime ? [{ homeTeam: r.homeTeam, awayTeam: r.awayTeam, startTime: r.startTime }] : []))
}

export const proactiveDeliveryDeps: ProactiveDeliveryDeps = {
  now: () => new Date(),
  loadAudience: async (season, onlyUserId) => {
    const rows = await prisma.leagueTeam.findMany({
      where: {
        claimedByUserId: onlyUserId ? onlyUserId : { not: null },
        league: { season, sport: 'NFL' },
      },
      select: {
        claimedByUserId: true,
        league: {
          select: {
            id: true,
            name: true,
            leagueVariant: true,
            bestBallMode: true,
            platform: true,
            platformLeagueId: true,
            season: true,
          },
        },
      },
    })
    const out = new Map<string, ProactiveAudienceLeague[]>()
    for (const r of rows) {
      if (!r.claimedByUserId) continue
      const list = out.get(r.claimedByUserId) ?? []
      if (!list.some((l) => l.id === r.league.id)) list.push(r.league)
      out.set(r.claimedByUserId, list)
    }
    return out
  },
  loadSettings: async (userId) => {
    const profile = await getSettingsProfile(userId)
    if (!profile) return null
    const chimmy = await loadChimmyAlertPreferences(userId).catch(() => null)
    return {
      notifications: resolveNotificationPreferences(profile.notificationPreferences as NotificationPreferences | null),
      chimmy,
    }
  },
  alreadySent: async (key) =>
    (await prisma.sportsDataCache.findUnique({ where: { cacheKey: key }, select: { cacheKey: true } })) != null,
  claim: async (key, expiresAt) => {
    try {
      await prisma.sportsDataCache.create({
        data: { cacheKey: key, expiresAt, data: { claimedAt: new Date().toISOString() } as Prisma.InputJsonValue },
      })
      return true
    } catch (e) {
      if (prismaCode(e) === 'P2002') return false
      throw e
    }
  },
  dispatch: dispatchNotification,
  baseUrl: getBaseUrl,
}

/** The category switch, global and master — per-league overrides are the caller's, per league. */
export function categoryOn(settings: ProactiveUserSettings): boolean {
  const n = settings.notifications
  return n.globalEnabled !== false && Boolean(n.categories?.[PROACTIVE_CATEGORY]?.enabled)
}

/**
 * Sorted, then rotated by a stride that moves the starting point each quarter hour — so a time
 * budget that always binds cannot starve the same people every run.
 */
export function rotation<T>(items: T[], now: Date): T[] {
  if (items.length < 2) return items
  const start = (Math.floor(now.getTime() / QUARTER_HOUR_MS) * 7919) % items.length
  return [...items.slice(start), ...items.slice(0, start)]
}
