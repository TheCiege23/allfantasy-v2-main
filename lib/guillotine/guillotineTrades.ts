import { prisma } from '@/lib/prisma'
import {
  GUILLOTINE_SETTINGS_KEY,
  CHOPPED_TEAM_TRADE_MESSAGE,
  guillotineSettingsBag as bag,
  readGuillotineTrades,
  tradesClosedMessage,
  tradesShouldBeClosed,
} from './guillotineTradeRules'

export * from './guillotineTradeRules'

/**
 * Trades in a Guilly league (owner's list, 2026-11-25: "trades close when N teams remain").
 *
 * Stored in `League.settings.guillotineSettings`, the object lib/league-trade-engine/tradeSettingsResolver.ts
 * has always read `tradesAllowed` from — and which nothing wrote, so every Guilly league was trade-free:
 *
 *   tradesAllowed            the commissioner's switch. Absent = off, as before.
 *   tradesCloseAtTeamsLeft   trades close once this many teams (or fewer) are left. Absent = never.
 *   tradesClosed             written by syncGuillotineTradeClose, never by a person: true while the teams alive
 *                            are at or under the line. The resolver is synchronous and cannot count teams, so the
 *                            count is taken where it changes (a chop, an undo, a save) and the answer kept here.
 *
 * Closing binds like the trade deadline: no new offer and no accept after it; a trade accepted before it may finish
 * its review. A chopped team never trades: its pending offers are cancelled by the chop, and a new offer or an
 * accept that involves it is refused.
 */

type Db = Pick<typeof prisma, 'roster' | 'guillotineRosterState'>

/** Teams alive: every roster without a chop record, the way the chop engine counts them. */
export async function countAliveTeams(leagueId: string, db: Db = prisma): Promise<number> {
  const [all, chopped] = await Promise.all([
    db.roster.count({ where: { leagueId } }),
    db.guillotineRosterState.count({ where: { leagueId, choppedAt: { not: null } } }),
  ])
  return all - chopped
}

/**
 * Make `tradesClosed` match the teams alive now. Run after a chop, after an undo and after the rules are saved;
 * idempotent, under the league row lock (League.settings has other writers). Returns whether trades are closed.
 */
export async function syncGuillotineTradeClose(leagueId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM leagues WHERE id = ${leagueId} FOR UPDATE`
    const row = await tx.league.findUnique({ where: { id: leagueId }, select: { settings: true, guillotineMode: true } })
    if (!row?.guillotineMode) return false
    const rules = readGuillotineTrades(row.settings)
    const closed = tradesShouldBeClosed(rules, await countAliveTeams(leagueId, tx))
    if (closed === rules.tradesClosed) return closed
    const settings = { ...((row.settings as Record<string, unknown> | null) ?? {}) }
    const g = { ...bag(settings) }
    if (closed) g.tradesClosed = true
    else delete g.tradesClosed
    await tx.league.update({ where: { id: leagueId }, data: { settings: { ...settings, [GUILLOTINE_SETTINGS_KEY]: g } as object } })
    return closed
  })
}

/**
 * After a week's chop: cancel the chopped teams' pending offers, then close trades if the field is now small
 * enough. Read from the chop records, so the engine's recovery branch finishes it the same way.
 */
export async function settleTradesAfterChop(leagueId: string, week: number): Promise<void> {
  const chopped = await prisma.guillotineRosterState.findMany({ where: { leagueId, choppedInPeriod: week, choppedAt: { not: null } }, select: { rosterId: true } })
  if (chopped.length) {
    const rosters = await prisma.roster.findMany({ where: { id: { in: chopped.map((c) => c.rosterId) } }, select: { redraftRosterId: true } })
    const { voidPendingRedraftTradesForRoster } = await import('@/lib/redraft/voidPendingTradesForElimination')
    for (const r of rosters) if (r.redraftRosterId) await voidPendingRedraftTradesForRoster(leagueId, r.redraftRosterId)
  }
  await syncGuillotineTradeClose(leagueId)
}

/**
 * Why a Guilly trade between these teams (redraft roster ids) cannot be offered or accepted now, or null. One league
 * read and out for every other league. `ignoreClosed`: a commissioner's approval forces past a closed window, as it
 * does past the deadline; it never makes a chopped team trade.
 */
export async function guillotineTradeRefusal(
  leagueId: string,
  redraftRosterIds: readonly string[],
  opts: { ignoreClosed?: boolean } = {},
): Promise<string | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { guillotineMode: true, settings: true } })
  if (!league?.guillotineMode) return null
  const ids = [...new Set(redraftRosterIds.filter(Boolean))]
  if (ids.length) {
    const rosters = await prisma.roster.findMany({ where: { leagueId, redraftRosterId: { in: ids } }, select: { id: true } })
    const chopped = rosters.length
      ? await prisma.guillotineRosterState.count({ where: { leagueId, rosterId: { in: rosters.map((r) => r.id) }, choppedAt: { not: null } } })
      : 0
    if (chopped > 0) return CHOPPED_TEAM_TRADE_MESSAGE
  }
  const rules = readGuillotineTrades(league.settings)
  if (!opts.ignoreClosed && rules.tradesClosed) return tradesClosedMessage(rules.tradesCloseAtTeamsLeft)
  return null
}
