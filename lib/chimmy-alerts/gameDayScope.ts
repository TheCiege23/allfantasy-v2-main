/**
 * Which injured starters the sweep may speak about, in which sport — pure, so the cron route stays
 * a thin shell.
 *
 * Guap, 2026-10-08: "if the user has a player playing in the Thursday Night Football game, the user
 * should get a notification as soon as the injured players list is announced … Do the same for all
 * game days for all sports." Until then the injured-starter sweep read NFL leagues only
 * (hydrateInjuredStarters defaulted `sport` to 'NFL').
 *
 * ⚠ NFL KEEPS ITS EXACT BEHAVIOUR. A Wednesday "Out" for a Sunday game is worth saying on
 * Wednesday, and that is how the NFL alert has always worked. Everything below only decides what
 * the OTHER sports add.
 *
 * ⚠ A DAILY SPORT SPEAKS ONLY ON ITS GAME DAY. An NBA starter on a two-week injury is "Out" every
 * morning for two weeks; without a game in the next GAME_DAY_HOURS there is nothing to fix today,
 * and saying it daily is how notifications get turned off. A player with no game on file says
 * nothing at all — `lockAt` null in a daily sport is the off-season, not "soon".
 *
 * ⚠ AND ONLY IN A LEAGUE BEING PLAYED NOW. The portfolio reads every roster row the account has,
 * every season. A 2025-26 NBA league still holds last April's lineup, and a player in it who is Out
 * tonight would raise an alert about a league nobody is playing. `isCurrentSeasonLeague` drops it.
 */

/** A daily sport's alert fires only when the player's game starts within this many hours. */
export const GAME_DAY_HOURS = 18
/** NCAAF is weekly like the NFL, but needs a game on file inside this many days. */
export const WEEKLY_WINDOW_DAYS = 6

/** Sports whose season straddles New Year — a league's season is stored as the start year or the end year depending on the platform. */
const SPLIT_SEASON = new Set(['NBA', 'NHL', 'NCAAB', 'SOCCER'])

function norm(sport: string | null | undefined): string {
  return String(sport ?? '').trim().toUpperCase()
}

/** The NFL alert is unchanged; this switch reverts the other sports without a deploy. */
export function allSportsInjuryAlertsEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.INJURY_ALERTS_NFL_ONLY !== '1'
}

/**
 * Is a league of this sport and season being played now? Split seasons (NBA, NHL, NCAAB, soccer)
 * accept the start year OR the end year, because ESPN stores 2026-27 as 2027 and Sleeper as 2026.
 * Unknown sports fall back to the calendar year.
 */
export function isCurrentSeasonLeague(sport: string | null | undefined, season: number | null | undefined, now: Date): boolean {
  if (typeof season !== 'number' || !Number.isFinite(season)) return false
  const s = norm(sport)
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() // 0 = January
  if (SPLIT_SEASON.has(s)) {
    // A new split season opens in August (soccer) / October (NBA, NHL, NCAAB); August is early enough for both.
    const start = month >= 7 ? year : year - 1
    return season === start || season === start + 1
  }
  if (s === 'NFL' || s === 'NCAAF') {
    // January and February are the previous season's playoffs and bowls.
    return season === (month <= 1 ? year - 1 : year)
  }
  return season === year
}

/**
 * May the sweep alert about this starter now? NFL (and a signal with no sport, which was always
 * NFL here): yes, as before. NCAAF: a game on file in the next WEEKLY_WINDOW_DAYS. Every daily
 * sport: a game starting in the next GAME_DAY_HOURS.
 */
export function onGameDay(signal: { sport?: string | null; lockAt?: string | null }, now: Date): boolean {
  const s = norm(signal.sport)
  if (s === '' || s === 'NFL') return true
  const kickoff = signal.lockAt ? Date.parse(signal.lockAt) : Number.NaN
  if (!Number.isFinite(kickoff)) return false
  const ms = kickoff - now.getTime()
  if (ms <= 0) return false
  const windowMs = s === 'NCAAF' ? WEEKLY_WINDOW_DAYS * 24 * 3_600_000 : GAME_DAY_HOURS * 3_600_000
  return ms <= windowMs
}
