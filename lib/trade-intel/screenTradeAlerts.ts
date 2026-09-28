import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * A trade alert raised by a SCREEN's read, not only by the cron (trade system handoff, Phase 2:
 * "When a user's screen sees a new offer, claim and send it then").
 *
 * The screens that show pending offers — the /core Trade Center, the league Trades tab, the home
 * band, the cross-league strip — already scan Sleeper for them, about once a minute while open. When
 * one of those scans finds a pending offer, this runs the same slice-read-and-notify the 5-minute
 * sweep runs (`detectAndNotifyLeague` with the current weeks), so the managers in that offer hear
 * about it within about a minute of anyone looking, rather than at the next sweep.
 *
 * ⚠ THROTTLED ACROSS EVERYONE, NOT PER VIEWER. One claim row per league per minute
 * (`trade-notify:screen:v1:<league>:<minute>`), created with a unique key, so ten managers with the
 * same league open cost one run a minute, not ten — on any number of server instances.
 *
 * ⚠ NOTHING HERE CAN SEND TWICE. The run plans against the league's seen record and every email and
 * push is claimed per recipient (`claimSend`), so a screen run and a cron run over the same offer
 * deliver it once between them.
 *
 * ⚠ A SCREEN NEVER BOOTSTRAPS A LEAGUE (`bootstrapBudget: 0`): a league with no seen record is left
 * to the cron's full read, so a page view can never be the thing that decides what counts as history.
 *
 * ⚠ FAILS CLOSED ON THE CLAIM. If the claim row cannot be written, nothing runs: a database that
 * cannot take one insert should not be handed a notify pass by every page view. The cron still runs.
 *
 * Kill switch: TRADE_ALERT_FROM_SCREEN_DISABLED=1.
 */

export const SCREEN_ALERT_CLAIM_PREFIX = 'trade-notify:screen:v1:'
export const SCREEN_ALERT_WINDOW_MS = 60_000
const CLAIM_TTL_MS = 24 * 60 * 60 * 1000

export type ScreenAlertOutcome = 'ran' | 'throttled' | 'skipped' | 'failed'

function prismaCode(e: unknown): string | null {
  return e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : null
}

export async function alertFromScreenRead(
  sleeperLeagueId: string,
  weeks: ReadonlyArray<number>,
  nowMs: number = Date.now(),
): Promise<ScreenAlertOutcome> {
  try {
    if (process.env.TRADE_ALERT_FROM_SCREEN_DISABLED === '1') return 'skipped'
    if (!sleeperLeagueId?.trim() || weeks.length === 0) return 'skipped'

    const cacheKey = `${SCREEN_ALERT_CLAIM_PREFIX}${sleeperLeagueId}:${Math.floor(nowMs / SCREEN_ALERT_WINDOW_MS)}`
    try {
      await prisma.sportsDataCache.create({
        data: { cacheKey, data: { at: new Date(nowMs).toISOString() }, expiresAt: new Date(nowMs + CLAIM_TTL_MS) },
      })
    } catch (e) {
      return prismaCode(e) === 'P2002' ? 'throttled' : 'failed'
    }

    // Loaded here, not at the top: the notify service imports the scan that calls this.
    const { detectAndNotifyLeague } = await import('@/lib/trade-intel/tradeNotifyService')
    await detectAndNotifyLeague(sleeperLeagueId, { weeks, bootstrapBudget: { left: 0 } })
    return 'ran'
  } catch (err) {
    console.warn('[trade-alert-screen] notify pass failed', {
      sleeperLeagueId,
      name: err instanceof Error ? err.name : typeof err,
    })
    return 'failed'
  }
}

/**
 * Fire-and-forget from a screen's read: the page never waits on a notify pass, and a failure never
 * reaches it. Returns the promise for tests; production callers do not await it.
 */
export function triggerAlertFromScreenRead(sleeperLeagueId: string, weeks: ReadonlyArray<number>): Promise<ScreenAlertOutcome> {
  return alertFromScreenRead(sleeperLeagueId, weeks).catch(() => 'failed' as const)
}
