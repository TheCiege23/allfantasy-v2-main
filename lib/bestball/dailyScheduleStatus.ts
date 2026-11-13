/**
 * IS DAILY BEST BALL ABLE TO SCORE THIS SEASON YET?
 *
 * Daily best ball cuts each week into US Eastern days from the regular-season opener
 * (`resolveDailySportWeekWindow`). The opener comes from the curated table
 * (lib/season-week/dailySportSeasonStarts.ts) or, for a season past it, from the schedule already in
 * Postgres (lib/season-week/deriveDailySportSeasonStart.ts — only games the feed itself labels regular
 * season count, so a preseason game can never become week 1).
 *
 * When neither has an opener — a dynasty league's next season before opening night is ingested — the
 * stat sync declines the week and the scorer cannot cut days. That used to be visible only as a server
 * log line. This is the one answer the commissioner panel and the Best Ball tab read, so both can say
 * "daily scoring is waiting for the season schedule" instead of saying nothing.
 *
 * Reads Postgres only (through `ensureDailySportSeasonStart`); no provider call.
 */
import type { DeriveSeasonStartDeps } from '@/lib/season-week/deriveDailySportSeasonStart'
import { ensureDailySportSeasonStart } from '@/lib/season-week/deriveDailySportSeasonStart'
import { resolveDailySportSeasonStart } from '@/lib/season-week/dailySportSeasonStarts'
import { bestBallSportSupportsDaily } from './scoringPeriod'

export type DailyBestBallScheduleStatus = {
  /** `waiting`: no recorded or derivable opener, so daily weeks cannot be scored yet. */
  state: 'ready' | 'waiting'
  season: number
}

/**
 * The status for a daily-capable sport's season, or null for a sport that has no daily best ball.
 * An unreadable schedule reports `waiting` only when no opener is known either way — never a guess.
 */
export async function loadDailyBestBallScheduleStatus(
  args: { sport: string | null | undefined; season: number | null | undefined },
  deps: DeriveSeasonStartDeps,
): Promise<DailyBestBallScheduleStatus | null> {
  const sport = String(args.sport ?? '').trim().toUpperCase()
  const season = Number(args.season)
  if (!bestBallSportSupportsDaily(sport) || !Number.isInteger(season) || season <= 0) return null
  await ensureDailySportSeasonStart(sport, season, deps).catch(() => null)
  return { state: resolveDailySportSeasonStart(sport, season) ? 'ready' : 'waiting', season }
}

/** The Best Ball tab's sentence for a daily league whose season has no opener yet; null otherwise. */
export function dailyScheduleWaitingNotice(status: DailyBestBallScheduleStatus | null): string | null {
  if (!status || status.state !== 'waiting') return null
  return (
    `Daily scoring is waiting for the ${status.season} season schedule. The regular-season opener is not in ` +
    'our stored schedule yet, so this league’s weeks cannot be scored day by day until it is. Daily scoring ' +
    'starts on its own once the opener arrives.'
  )
}

const warned = new Set<string>()

/** Test seam: forget which sport/seasons have been warned about. */
export function resetDailyBestBallScheduleWarnings(): void {
  warned.clear()
}

/**
 * Logged (once per process, sport and season) when the daily scorer has no opener and hands the week to
 * the weekly path. The UI says the same thing through `loadDailyBestBallScheduleStatus`.
 */
export function warnDailyBestBallWaitingForSchedule(sport: string, season: number): void {
  const key = `${sport}:${season}`
  if (warned.has(key)) return
  warned.add(key)
  console.warn(
    `[bestball] daily best ball ${sport} ${season}: no recorded or derivable regular-season opener, so the ` +
      'week cannot be cut into days; the commissioner panel and Best Ball tab show "waiting for the season ' +
      'schedule". Add the opener to lib/season-week/dailySportSeasonStarts.ts once published, or wait for ' +
      'opening night to be ingested.',
  )
}
