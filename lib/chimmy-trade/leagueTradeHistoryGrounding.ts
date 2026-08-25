import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveSleeperPlayerIdentities } from '@/lib/players/sleeperPlayerCrosswalk'

/**
 * COMPLETED TRADES IN THIS LEAGUE → CHIMMY.
 *
 * ⚠ THIS IS WHERE REAL TRADES ACTUALLY ARE. `redraft_trade_proposals` — the table
 * AllFantasy's own trade system writes, and the one
 * `pendingTradeDecisionGrounding` reads — is EMPTY in production (0 rows), because
 * only 1 of 110 leagues is native. Every real trade came in from Sleeper and
 * landed in `LeagueTrade`: 7,781 rows, refreshed daily, 667 of them this season.
 * Measured 2026-08-25.
 *
 * ⚠ COMPLETED, NEVER PENDING. `LeagueTrade` has no status column; it is history
 * reconstructed from Sleeper transactions. Sleeper does expose `pending`, but only
 * while the veto window is open and nothing here polls for it. So this block can
 * say what HAS happened and must never imply a live offer is waiting.
 *
 * ⚠ NO VALUES. `valueGiven` / `valueReceived` are populated on ZERO of 7,781 rows.
 * The block states that outright rather than omitting it, because a model handed
 * an asset list and no values will otherwise price the trade itself and present
 * the result as ours.
 */

/** Enough to establish a pattern without crowding the rest of the prompt. */
const MAX_TRADES_SHOWN = 8
/** Read a wider window than we show, because deduping collapses both sides. */
const TRADE_SCAN_LIMIT = 60

type TradeRow = {
  transactionId: string
  week: number
  season: number
  tradeDate: Date | null
  playersGiven: unknown
  playersReceived: unknown
  picksGiven: unknown
  picksReceived: unknown
}

function idList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((v): v is string => typeof v === 'string' && v.length > 0)
}

function pickList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((p) => {
      if (!p || typeof p !== 'object') return null
      const { round, season } = p as { round?: unknown; season?: unknown }
      if (round == null) return null
      return `${season ?? '?'} R${round}`
    })
    .filter((s): s is string => Boolean(s))
}

/**
 * Sleeper player ids to names, via the shared crosswalk.
 *
 * ⚠ THE CROSSWALK IS THE ONLY WAY TO DO THIS. There is no column joining Sleeper
 * ids to `Player.id`, and the naive `SportsPlayer.externalId` lookup this used to
 * do resolves only 15% of traded ids — the crosswalk's second hop through our own
 * roster rows lifts it to 42%. It is sport-filtered for the same reason as before:
 * `externalId` is unique only within one.
 */
async function resolveNames(ids: string[], sport: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  if (ids.length === 0) return out
  try {
    const { byId } = await resolveSleeperPlayerIdentities(ids, sport)
    for (const [id, identity] of byId) {
      if (identity.name) out.set(id, identity.name)
    }
  } catch {
    // A failed lookup means "unnamed", which the caller reports honestly.
  }
  return out
}

function describeSide(
  ids: string[],
  picks: string[],
  names: Map<string, string>,
): { text: string; unresolved: number } {
  const named: string[] = []
  let unresolved = 0
  for (const id of ids) {
    const name = names.get(id)
    if (name) named.push(name)
    else unresolved += 1
  }
  const parts = [...named, ...picks]
  if (unresolved > 0) parts.push(`${unresolved} unidentified player${unresolved === 1 ? '' : 's'}`)
  return { text: parts.length ? parts.join(', ') : 'nothing', unresolved }
}

/**
 * What has actually been traded in this league. Returns null when the league is
 * not Sleeper-backed or has no ingested history, so the prompt gains no empty
 * section.
 */
export async function buildLeagueTradeHistoryContext(
  leagueId: string,
  userId: string,
): Promise<string | null> {
  if (!leagueId || !userId) return null

  let league: { platform: string; platformLeagueId: string; sport: string; season: number } | null
  try {
    league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { platform: true, platformLeagueId: true, sport: true, season: true },
    })
  } catch {
    return null
  }
  if (!league?.platformLeagueId) return null
  // Ingestion is Sleeper-only; another platform's league has no rows here and a
  // silent empty block would read as "this league has never traded".
  if (league.platform.toLowerCase() !== 'sleeper') return null

  let histories: Array<{ id: string }>
  try {
    histories = await prisma.leagueTradeHistory.findMany({
      where: { sleeperLeagueId: league.platformLeagueId },
      select: { id: true },
    })
  } catch {
    return null
  }
  if (histories.length === 0) return null

  let rows: TradeRow[]
  try {
    rows = (await prisma.leagueTrade.findMany({
      where: { historyId: { in: histories.map((h) => h.id) } },
      orderBy: { tradeDate: 'desc' },
      take: TRADE_SCAN_LIMIT,
      select: {
        transactionId: true,
        week: true,
        season: true,
        tradeDate: true,
        playersGiven: true,
        playersReceived: true,
        picksGiven: true,
        picksReceived: true,
      },
    })) as unknown as TradeRow[]
  } catch {
    return null
  }
  if (rows.length === 0) return null

  /*
   * One history row exists per MANAGER per league, so a single trade is stored
   * once from each side and would otherwise be reported twice — as two different
   * trades running in opposite directions.
   */
  const seen = new Set<string>()
  const unique = rows.filter((r) => {
    if (seen.has(r.transactionId)) return false
    seen.add(r.transactionId)
    return true
  })

  const shown = unique.slice(0, MAX_TRADES_SHOWN)
  const allIds = shown.flatMap((r) => [...idList(r.playersGiven), ...idList(r.playersReceived)])
  const names = await resolveNames([...new Set(allIds)], league.sport)

  const bySeason = new Map<number, number>()
  for (const r of unique) bySeason.set(r.season, (bySeason.get(r.season) ?? 0) + 1)
  const seasonSummary = [...bySeason.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([s, n]) => `${s}: ${n}`)
    .join(', ')

  const lines: string[] = [
    `COMPLETED TRADE HISTORY for this league (Sleeper league ${league.platformLeagueId}).`,
    `These trades ALREADY HAPPENED. None of them is a pending offer, and nothing here is awaiting the user's response.`,
    `Trades on file in the window read: ${unique.length} (${seasonSummary}).`,
    `Most recent ${shown.length}:`,
  ]

  let totalUnresolved = 0
  for (const r of shown) {
    const recv = describeSide(idList(r.playersReceived), pickList(r.picksReceived), names)
    const give = describeSide(idList(r.playersGiven), pickList(r.picksGiven), names)
    totalUnresolved += recv.unresolved + give.unresolved
    const when = r.tradeDate ? r.tradeDate.toISOString().slice(0, 10) : `week ${r.week}`
    lines.push(`- ${when} (${r.season} wk ${r.week}): one side got [${recv.text}] for [${give.text}].`)
  }

  lines.push(
    'LIMITS: no trade values are stored for these — do NOT state what any of them was worth, who won, or assign a grade. Sides are recorded from one manager\'s perspective, so treat "got" and "gave" as one direction of the deal, not a judgement.',
  )
  if (totalUnresolved > 0) {
    lines.push(
      `${totalUnresolved} traded player(s) could not be matched to a name. Say so if it matters; never guess who they were.`,
    )
  }

  return lines.join('\n')
}
