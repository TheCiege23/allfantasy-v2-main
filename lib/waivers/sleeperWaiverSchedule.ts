import { Prisma, type PrismaClient } from '@prisma/client'

import type { WaiverSchedule } from '@/lib/core-app/waiverRunClock'
import { loadObservedWaiverSchedules, OBSERVED_TIME_ZONE, type ObservedWaiverSchedule } from './observedWaiverSchedule'

/**
 * The waiver schedule a Sleeper league's screens show: OBSERVED from its own processed claims
 * first, else read off Sleeper's own settings — `daily_waivers_hour` for a league Sleeper says runs
 * DAILY, and Wednesday at that hour for a non-daily league on `waiver_day_of_week = 2`.
 *
 * ── Why the setting is trusted now, and only this much of it ──────────────────────────────────
 * `daily_waivers_hour` IS the Pacific hour a league's claims resolve: measured 2026-10-03 on
 * production, it equalled the observed Pacific hour in 246 of 249 leagues holding both, across ~20
 * distinct hours — not just the default 0 (contracts/sleeper/GAPS.md S-06). So a league too quiet
 * to have been observed still gets its real hour.
 *
 * ── A non-daily league: ONE measured value, never a base ─────────────────────────────────────
 * Which weekday `waiver_day_of_week` names in general is NOT established (GAPS.md S-05: the leagues
 * that could separate the readings point against the obvious one). But the value `2` is measured on
 * its own: of the 27 observed leagues with `daily_waivers = 0` and `2`, a Wednesday run at
 * `daily_waivers_hour` really happens in 25 — 19 run Wednesday only, exactly; 6 run nightly (so the
 * Wednesday run is real, the other nights unshown); 2 run another day (Friday, Monday). So `2` →
 * Wednesday, and nothing else: `0`, `1` or any other value gets no schedule, because no rule here
 * converts a day number into a weekday. Do NOT generalise this into `(w + 1) % 7` — that IS the
 * unmeasured base, and the `1` leagues contradict it.
 *
 * A daily schedule is never given to a non-daily league: it would count down to a run every night
 * that does not happen.
 *
 * Observed wins over the setting when both exist: it is this league's measured behaviour.
 */

export type SleeperWaiverSchedule =
  | ({ source: 'observed' } & ObservedWaiverSchedule)
  | { source: 'sleeper_setting'; schedule: WaiverSchedule }

/** The ONE `waiver_day_of_week` value measured to name a weekday (S-05): 2 → Wednesday (JS 3). */
const MEASURED_WAIVER_DAY: Readonly<Record<number, number>> = { 2: 3 }

/** Sleeper's own schedule from `League.settings`, or null. Pure. */
export function scheduleFromSleeperSetting(settings: unknown): WaiverSchedule | null {
  const s = settings && typeof settings === 'object' ? (settings as Record<string, unknown>) : null
  const raw = s?.sleeper_waiver_schedule
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
  if (!r) return null
  const h = r.daily_waivers_hour
  if (typeof h !== 'number' || !Number.isInteger(h) || h < 0 || h > 23) return null
  const time = `${String(h).padStart(2, '0')}:00`
  if (r.daily_waivers === 1) return { dayOfWeek: null, time, timeZone: OBSERVED_TIME_ZONE }
  if (r.daily_waivers !== 0 || typeof r.waiver_day_of_week !== 'number') return null
  const dayOfWeek = MEASURED_WAIVER_DAY[r.waiver_day_of_week]
  return dayOfWeek == null ? null : { dayOfWeek, time, timeZone: OBSERVED_TIME_ZONE }
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
