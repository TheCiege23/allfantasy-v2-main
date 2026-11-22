import 'server-only'

/**
 * Exile team claims by sealed bid (optional; `exileClaimMode: 'faab_bid'`).
 *
 * The original league: "You must place FAAB claims to win your team. If you don't win, waivers will
 * be open." Each Exile period, exiles bid from a weekly Exile budget (`exileBidBudget` — Exile
 * dollars, never main-island FAAB) on a real team until the commissioner's close time. At the close
 * the highest bid wins each team, a tie goes to the EARLIER bid, and nobody wins two. Winners have
 * that team reserved; everyone else claims an open team first-come, exactly as today.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { easternDayTimeOnOrAfter, resolveExileTeamBids } from './survivorSideGameRules'
import { SIDE_GAME_ACTIONS, sideGameEntity } from './survivorSideGameLedger'
import { appendSideGameRow, inSideGameLock, loadSideGameState, type SideGameLeague } from './survivorSideGameStore'
import { awardExileTeams, exileFirstGames, exileTeamKey, exileWeekForInstant, exileWeekWindow } from './exileRosterService'

type Tx = Prisma.TransactionClient

export interface ExileBidWindow {
  week: number
  opensAt: Date
  closesAt: Date
  /** Team keys whose first game this period is after the close — the only teams worth a bid. */
  openTeams: Set<string>
}

/** The current Exile period's bid window, or null when there is no verified calendar for it. */
export async function exileBidWindow(league: Pick<SideGameLeague, 'sport' | 'season' | 'sideGames'>, now: Date, week?: number): Promise<ExileBidWindow | null> {
  const db = prisma as unknown as Tx
  const wk = week ?? (await exileWeekForInstant(db, league.sport, league.season, now))
  if (!wk) return null
  const window = await exileWeekWindow(db, league.sport, league.season, wk)
  if (!window) return null
  const closesAt = easternDayTimeOnOrAfter(window.start, league.sideGames.exileBidCloseDay, league.sideGames.exileBidCloseTime)
  // A close set after the period ends would never let anyone claim; it closes at the period's end.
  const close = closesAt.getTime() < window.end.getTime() ? closesAt : new Date(window.end.getTime() - 60_000)
  const firsts = await exileFirstGames(db, league.sport, league.season, wk, window.start, window.end)
  return { week: wk, opensAt: window.start, closesAt: close, openTeams: new Set([...firsts].filter(([, at]) => at.getTime() > close.getTime()).map(([key]) => key)) }
}

/** Has the period's bidding closed and been settled? Claims wait for it in bid mode. */
export async function exileBidGate(league: SideGameLeague, week: number, now: Date): Promise<'first_come' | 'bidding' | 'settling' | 'settled'> {
  if (league.sideGames.exileClaimMode !== 'faab_bid') return 'first_come'
  const window = await exileBidWindow(league, now, week).catch(() => null)
  if (!window) return 'first_come'
  const state = await loadSideGameState(prisma, league.id)
  if (state.exileBids.get(week)?.resolved) return 'settled'
  if (now.getTime() < window.closesAt.getTime()) return 'bidding'
  // Nobody bid: nothing to wait for.
  return (state.exileBids.get(week)?.bids.length ?? 0) === 0 ? 'settled' : 'settling'
}

/**
 * Settle every Exile period whose bidding has closed. Idempotent: the reservations are written
 * first (each skips a manager who already holds a team), then the resolution row, so a crash in
 * between recomputes the same awards on the next tick.
 */
export async function settleDueExileTeamBids(league: SideGameLeague, now: Date): Promise<number> {
  if (league.sideGames.exileClaimMode !== 'faab_bid') return 0
  const state = await loadSideGameState(prisma, league.id)
  let settled = 0
  for (const [week, wk] of state.exileBids) {
    if (wk.resolved) continue
    const window = await exileBidWindow(league, now, week).catch(() => null)
    if (!window || now.getTime() < window.closesAt.getTime()) continue
    const valid = wk.bids.filter((b) => window.openTeams.has(exileTeamKey(league.sport, b.team)) && b.amount <= league.sideGames.exileBidBudget)
    const awards = resolveExileTeamBids(league.sport, valid)
    await awardExileTeams(league.id, week, awards)
    await inSideGameLock(league.id, async (db) => {
      const st = await loadSideGameState(db, league.id)
      await appendSideGameRow(db, st, {
        leagueId: league.id, entity: sideGameEntity.exileBids(week), action: SIDE_GAME_ACTIONS.exileBidsResolved, week,
        key: `xbidres:${week}`, data: { awards, bidCount: wk.bids.length },
      })
    })
    settled++
  }
  return settled
}
