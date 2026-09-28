/**
 * Fantasy OS — is it an NFL game day right now?
 *
 * Used by the five-minute active lane to decide how many leagues a tick must reach. On a game day
 * the lane sizes itself so every imported league's rosters and transactions refresh at least every
 * {@link GAME_DAY_REFRESH_TARGET_MINUTES} minutes; the rest of the week it sizes itself to
 * {@link OFF_DAY_REFRESH_TARGET_MINUTES} minutes.
 *
 * ⚠ READ FROM `SportsGame`, NOT FROM THE WEEKDAY. "It is Sunday" is not "there are games today" —
 * a Saturday in December, a Wednesday Christmas game, a Friday opener in Brazil and a London
 * 9:30am kickoff all fall outside any Thu/Sun/Mon rule, and the one in `SleeperCacheLayer` reads
 * UTC weekdays, so it also misses the second half of every Monday and Thursday night game (those
 * finish on the next UTC day). The schedule table already holds every kickoff, from four sources.
 *
 * The window opens {@link GAME_DAY_LEAD_MS} before a kickoff — inactives, lineup locks and the
 * morning's injury news land then — and stays open {@link GAME_DAY_TAIL_MS} after the last one,
 * which covers a game plus overtime and the lineup/waiver moves made while it is on.
 *
 * ⚠ A FAILED READ ANSWERS "NOT A GAME DAY". That keeps the lane at its normal, cheaper size, which
 * is today's behaviour, rather than guessing its way into four times the provider load.
 */
import { prisma } from '@/lib/prisma'

export const GAME_DAY_LEAD_MS = 4 * 60 * 60_000
export const GAME_DAY_TAIL_MS = 4 * 60 * 60_000
/** The freshness the lane promises every in-season imported league on a game day. */
export const GAME_DAY_REFRESH_TARGET_MINUTES = 20
/**
 * The freshness it promises the rest of the week.
 *
 * 🛑 OFF A GAME DAY THE SLICE USED TO BE A FIXED 4 LEAGUES PER PROVIDER PER TICK — about a 6-hour
 * lap across ~285 Sleeper leagues. Trades mostly happen BETWEEN game days, so that is where the
 * slow reads landed: measured on production 2026-09-28 over 72h, Sleeper trades were first written
 * a median 8 minutes after completing, but the Friday-evening ones 186 and 222 minutes after, every
 * one of them in a league the lane covers. The lane ran every 5 minutes throughout; it just read 4
 * Sleeper leagues each time. Guap set the off-day target to 60 minutes (2026-09-28).
 */
export const OFF_DAY_REFRESH_TARGET_MINUTES = 60

/** Pure form, for tests: is any kickoff inside [now - tail, now + lead]? */
export function isInGameDayWindow(kickoffs: ReadonlyArray<Date | null | undefined>, now: Date): boolean {
  const t = now.getTime()
  return kickoffs.some((k) => {
    if (!k) return false
    const at = k.getTime()
    return at >= t - GAME_DAY_TAIL_MS && at <= t + GAME_DAY_LEAD_MS
  })
}

export async function isNflGameDayWindow(now: Date = new Date()): Promise<boolean> {
  const t = now.getTime()
  /* try, not `.catch`: a synchronous throw (no delegate on a mocked client) must also answer false. */
  try {
    const game = await prisma.sportsGame.findFirst({
      where: {
        sport: { in: ['NFL', 'nfl'] },
        startTime: { gte: new Date(t - GAME_DAY_TAIL_MS), lte: new Date(t + GAME_DAY_LEAD_MS) },
      },
      select: { startTime: true },
    })
    return isInGameDayWindow([game?.startTime], now)
  } catch {
    return false
  }
}
