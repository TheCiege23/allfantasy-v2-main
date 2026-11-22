/**
 * The simulator's clock. Every canonical runtime the season sim calls takes an optional `now`; the sim
 * always passes `clock.now()` so a whole season runs in milliseconds and every timestamp in its output
 * is a function of the season calendar, never of the wall clock.
 *
 * ⚠ Engine code that reads `new Date()` directly (or `getServerNowUTC()`) is invisible to this clock.
 * The pure runtimes used here all accept `now`, which is why they are the ones the sim drives.
 */

export type SimClock = {
  now(): Date
  set(at: Date): void
  advanceMs(ms: number): void
}

export function createSimClock(start: Date): SimClock {
  let current = start.getTime()
  return {
    now: () => new Date(current),
    set: (at: Date) => {
      current = at.getTime()
    },
    advanceMs: (ms: number) => {
      current += ms
    },
  }
}

const DAY_MS = 86_400_000

/**
 * Kickoff Thursday of an NFL week, 17:00 UTC. Week 1 of a season is the second Thursday of September,
 * which is close enough to the real calendar for lock and deadline logic that is keyed on week numbers.
 */
export function nflWeekStart(season: number, week: number): Date {
  const sept1 = new Date(Date.UTC(season, 8, 1, 17, 0, 0))
  const toThursday = (4 - sept1.getUTCDay() + 7) % 7
  const firstThursday = sept1.getTime() + toThursday * DAY_MS
  return new Date(firstThursday + 7 * DAY_MS + (week - 1) * 7 * DAY_MS)
}

/** Waivers clear the Wednesday before a week's kickoff, 10:00 UTC. */
export function nflWaiverRunAt(season: number, week: number): Date {
  const kickoff = nflWeekStart(season, week)
  return new Date(Date.UTC(kickoff.getUTCFullYear(), kickoff.getUTCMonth(), kickoff.getUTCDate() - 1, 10, 0, 0))
}

/** A draft the Saturday before week 1. */
export function nflDraftAt(season: number): Date {
  return new Date(nflWeekStart(season, 1).getTime() - 5 * DAY_MS)
}
