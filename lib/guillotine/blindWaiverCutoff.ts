/**
 * The guillotine blind FAAB auction: during the blind window before the sport's scheduled waiver run
 * (and the hold anchored on a chop), claims are HELD, so every bid on a chopped team's players is
 * settled together, highest bid first, instead of first-come-first-served.
 *
 * ⚠ ONE RULE, TWO WAIVER ENGINES. This lived privately in lib/redraft/waiverEngine.ts, which settles
 * `RedraftWaiverClaim` — but the native league's waiver screen files `WaiverClaim` rows, settled by
 * lib/waiver-wire/process-engine.ts, which never held anything. So a native Guilly league's claims on
 * a chopped roster went out in claim order. Both engines now read the cutoff here.
 */
import { prisma } from '@/lib/prisma'
import { getChopHoldStart, getWaiverBlindWindowStart } from './sportConfig'

/**
 * NBA and NFL (owner's decision, 2026-10-17); MLB and NHL added 2026-10-27, once their Guilly schedules
 * were re-timed to their real week windows (lib/guillotine/sportConfig.ts) so the window covers the
 * chop. Other sports settle every run until their schedules are checked.
 */
export const BLIND_WAIVER_GUILLOTINE_SPORTS: ReadonlySet<string> = new Set(['NBA', 'NFL', 'MLB', 'NHL'])

export type BlindWaiverLeague = { sport: string | null; guillotineMode: boolean | null; leagueVariant: string | null }

/**
 * Pure. Claims submitted BEFORE the returned instant are due; later ones wait for the run. Null when
 * nothing is held (not a blind-auction Guilly league, or outside every window).
 */
export function isBlindAuctionLeague(league: BlindWaiverLeague): boolean {
  const isGuillotine = league.guillotineMode === true || String(league.leagueVariant ?? '').toLowerCase() === 'guillotine'
  return isGuillotine && BLIND_WAIVER_GUILLOTINE_SPORTS.has(String(league.sport ?? '').toUpperCase())
}

export function blindWaiverCutoff(league: BlindWaiverLeague, lastChopAt: Date | null | undefined, now: Date): Date | null {
  if (!isBlindAuctionLeague(league)) return null
  const sport = String(league.sport ?? '').toUpperCase()
  // The earlier of the calendar window and a hold anchored on the chop itself (an early or late chop).
  const starts = [getWaiverBlindWindowStart(sport, now), getChopHoldStart(sport, lastChopAt, now)].filter((d): d is Date => d != null)
  if (starts.length === 0) return null
  return new Date(Math.min(...starts.map((d) => d.getTime())))
}

/** Reads the league and its latest chop. Never throws: an unreadable row means no hold, as before. */
export async function guillotineClaimsCutoff(leagueId: string, now: Date, known?: BlindWaiverLeague | null): Promise<Date | null> {
  let league: BlindWaiverLeague | null = known ?? null
  if (!league) {
    try {
      league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true, guillotineMode: true, leagueVariant: true } })
    } catch {
      return null
    }
  }
  if (!league) return null
  // Skip the chop read for every league the rule cannot apply to.
  if (!isBlindAuctionLeague(league)) return null
  let lastChop: { choppedAt: Date | null } | null = null
  try {
    lastChop = await prisma.guillotineRosterState.findFirst({
      where: { leagueId, choppedAt: { not: null } },
      orderBy: { choppedAt: 'desc' },
      select: { choppedAt: true },
    })
  } catch {
    lastChop = null
  }
  return blindWaiverCutoff(league, lastChop?.choppedAt, now)
}
