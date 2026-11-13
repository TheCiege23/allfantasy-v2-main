/**
 * [NEW] C2C Basketball schedule adapter.
 * Dual-track: NBA game days + NCAAB game days overlay.
 * Identifies college-only, pro-only, and overlap windows.
 */

import type { LeagueScheduleAdapter, FantasyWeekPlan, WeekVolumeProfile, NbaScheduleConfig, FantasyDayEvent, DayVolume } from '../types'
import { classifyDay } from '../NbaGameVolumeService'

export class C2CScheduleAdapter implements LeagueScheduleAdapter {
  resolveFantasyWeek(
    volumeProfile: WeekVolumeProfile,
    config: NbaScheduleConfig,
    context?: Record<string, unknown>
  ): FantasyWeekPlan {
    const events: FantasyDayEvent[] = []
    const scoringDays: string[] = []

    // NBA game days from volume profile
    const nbaGameDates = new Set(volumeProfile.days.filter((d) => d.gameCount > 0).map((d) => d.date))

    // NCAAB game dates (passed via context if pre-loaded, or empty)
    const ncaabGameDates = new Set((context?.ncaabGameDates as string[]) ?? [])

    // Classify each day
    for (const d of volumeProfile.days) {
      const hasNba = nbaGameDates.has(d.date)
      const hasNcaab = ncaabGameDates.has(d.date)

      if (hasNba && hasNcaab) {
        scoringDays.push(d.date)
        events.push({
          date: d.date,
          role: 'scoring',
          label: 'NBA + NCAAB overlap',
          description: 'Both pro and college games count for scoring.',
        })
      } else if (hasNba) {
        scoringDays.push(d.date)
        events.push({
          date: d.date,
          role: 'scoring',
          label: 'NBA only',
          description: 'Pro track scoring day.',
        })
      } else if (hasNcaab) {
        scoringDays.push(d.date)
        events.push({
          date: d.date,
          role: 'scoring',
          label: 'NCAAB only',
          description: 'College track scoring day.',
        })
      }
    }

    // Admin day for promotion/devy processing on least-busy day
    let adminDay: string | null = null
    if (config.useDynamicLowVolumeDays && volumeProfile.leastBusyDay) {
      adminDay = volumeProfile.leastBusyDay.date
      events.push({
        date: adminDay,
        role: 'admin',
        label: 'C2C admin',
        description: 'Promotion window, rights processing, dual-track reconciliation.',
      })
    }

    return {
      season: volumeProfile.season,
      week: volumeProfile.week,
      scoringDays,
      ceremonyDay: null,
      adminDay,
      transitionDay: null,
      eliminationDay: null,
      statusUpdateDay: null,
      events: events.sort((a, b) => a.date.localeCompare(b.date)),
      nonScoringDays: volumeProfile.days
        .filter((d) => !scoringDays.includes(d.date))
        .map((d) => d.date),
      volumeProfile,
    }
  }
}

