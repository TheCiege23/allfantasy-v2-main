import type { prisma } from '@/lib/prisma'

/**
 * "App opened" rows — the data behind the people counts on /admin/apps (2026-11-21).
 *
 * One `AnalyticsEvent` row per device, per platform, per UTC day: the browser sends one
 * ping a day (components/analytics/AppOpenPing.tsx) and this module drops repeats, so
 * the table grows by roughly one row per active device per day.
 *
 * Replaces reading these numbers from PostHog: they now live in our own database, so
 * the page never depends on a third party's API key or billing.
 *
 * Read-only labelling. The platform comes from the page (the Android app is only
 * detectable in the browser), so never gate or grant anything on it.
 */

export const APP_OPEN_EVENT = 'app_open'

export const RECORDED_PLATFORMS = ['ios_app', 'android_app', 'web'] as const
export type RecordedPlatform = (typeof RECORDED_PLATFORMS)[number]

/**
 * The platform to record. The iOS app's User-Agent marker is visible to the server, so
 * it wins over whatever the page sent; anything unrecognised is dropped (null).
 */
export function resolveAppPlatform(claimed: unknown, userAgent: string | null): RecordedPlatform | null {
  if (userAgent && /AllFantasyiOS/.test(userAgent)) return 'ios_app'
  const value = typeof claimed === 'string' ? claimed : ''
  if (value === 'ios_app') return null // claims the iOS app without its marker
  return (RECORDED_PLATFORMS as readonly string[]).includes(value) ? (value as RecordedPlatform) : null
}

export function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
}

type Db = Pick<typeof prisma, 'analyticsEvent'>

export type AppOpenOutcome = 'recorded' | 'duplicate' | 'no_person'

/**
 * Records one app open unless this device already has one for this platform today.
 * The device is the `af_anon_id` cookie (falling back to the signed-in user), the same
 * key the admin page counts by.
 */
export async function recordAppOpen(
  db: Db,
  args: {
    platform: RecordedPlatform
    sessionId: string | null
    userId: string | null
    iapBuild?: boolean
    path?: string | null
    userAgent?: string | null
    now?: Date
  },
): Promise<AppOpenOutcome> {
  const now = args.now ?? new Date()
  if (!args.sessionId && !args.userId) return 'no_person'
  const who = args.sessionId ? { sessionId: args.sessionId } : { userId: args.userId }
  const today = await db.analyticsEvent.findMany({
    where: { event: APP_OPEN_EVENT, createdAt: { gte: utcDayStart(now) }, ...who },
    select: { meta: true },
    take: 10,
  })
  if (today.some((row) => (row.meta as { app_platform?: unknown } | null)?.app_platform === args.platform)) return 'duplicate'

  const meta: Record<string, unknown> = { app_platform: args.platform }
  if (args.platform === 'ios_app' && typeof args.iapBuild === 'boolean') meta.ios_iap_build = args.iapBuild
  await db.analyticsEvent.create({
    data: {
      event: APP_OPEN_EVENT,
      sessionId: args.sessionId,
      userId: args.userId,
      path: args.path ?? null,
      userAgent: args.userAgent ?? null,
      meta: meta as object,
      createdAt: now,
    },
  })
  return 'recorded'
}
