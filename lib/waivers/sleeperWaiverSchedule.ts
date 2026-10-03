import { Prisma, type PrismaClient } from '@prisma/client'

import type { WaiverSchedule } from '@/lib/core-app/waiverRunClock'
import { loadObservedWaiverSchedules, OBSERVED_TIME_ZONE, type ObservedWaiverSchedule } from './observedWaiverSchedule'

/**
 * The waiver schedule a Sleeper league's screens show: OBSERVED from its own processed claims
 * first, else read off Sleeper's own `daily_waivers_hour` setting for a league Sleeper says runs
 * DAILY.
 *
 * ── Why the setting is trusted now, and only this much of it ──────────────────────────────────
 * `daily_waivers_hour` IS the Pacific hour a league's claims resolve: measured 2026-10-03 on
 * production, it equalled the observed Pacific hour in 246 of 249 leagues holding both, across ~20
 * distinct hours — not just the default 0 (contracts/sleeper/GAPS.md S-06). So a league too quiet
 * to have been observed still gets its real hour.
 *
 * 🛑 ONLY FOR `daily_waivers === 1`. A non-daily league runs on one weekday, and which weekday
 * `waiver_day_of_week` names is NOT established (GAPS.md S-05: the leagues that could separate the
 * readings point against the obvious one). A daily schedule for such a league would count down to a
 * run every night that does not happen — so it gets nothing, and the screens keep saying so.
 *
 * Observed wins over the setting when both exist: it is this league's measured behaviour.
 */

export type SleeperWaiverSchedule =
  | ({ source: 'observed' } & ObservedWaiverSchedule)
  | { source: 'sleeper_setting'; schedule: WaiverSchedule }

/** Sleeper's own daily schedule from `League.settings`, or null. Pure. */
export function scheduleFromSleeperSetting(settings: unknown): WaiverSchedule | null {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : null
  const raw = s?.sleeper_waiver_schedule
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!r || r.daily_waivers !== 1) return null
  const h = r.daily_waivers_hour
  if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23) return null
  return { dayOfWeek: null, time: `${String(h).padStart(2, '0')}:00`, timeZone: OBSERVED_TIME_ZONE }
}

/**
 * Schedules for many Sleeper leagues: one observed read, plus one settings read for the leagues it
 * left without an answer. ⚠ The settings read is BY REAL LEAGUE, like the observed one: an AF twin
 * that has not synced since the setting started being stored borrows the twin that has.
 */
export async function loadSleeperWaiverSchedules(
  prisma: Pick<PrismaClient, 'league' | '$queryRaw'>,
  leagueIds: readonly string[],
): Promise<Map<string, SleeperWaiverSchedule>> {
  const out = new Map<string, SleeperWaiverSchedule>()
  const ids = [...new Set(leagueIds)].filter(Boolean)
  if (ids.length === 0) return out

  const observed = await loadObservedWaiverSchedules(prisma, ids).catch(() => new Map<string, ObservedWaiverSchedule>())
  for (const [id, o] of observed) out.set(id, { source: 'observed', ...o })

  const missing = ids.filter((id) => !out.has(id))
  if (missing.length === 0) return out
  /* A failed settings read costs the fallback, never the observed answers already in hand. */
  const rows = await Promise.resolve()
    .then(() => prisma.$queryRaw<Array<{ id: string; raw: unknown }>>(Prisma.sql`
      SELECT a.id, t.raw
      FROM "leagues" a
      JOIN LATERAL (
        SELECT b.settings->'sleeper_waiver_schedule' AS raw
        FROM "leagues" b
        WHERE b.platform = 'sleeper'
          AND b."platformLeagueId" = a."platformLeagueId"
          AND b.settings ? 'sleeper_waiver_schedule'
        ORDER BY b."updatedAt" DESC
        LIMIT 1
      ) t ON true
      WHERE a.id = ANY(${missing}::text[]) AND a.platform = 'sleeper'
    `))
    .catch(() => [] as Array<{ id: string; raw: unknown }>)
  for (const r of rows) {
    const schedule = scheduleFromSleeperSetting({ sleeper_waiver_schedule: r.raw })
    if (schedule) out.set(r.id, { source: 'sleeper_setting', schedule })
  }
  return out
}
