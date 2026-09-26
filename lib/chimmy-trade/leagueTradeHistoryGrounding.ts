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

/**
 * What the `get_league_trade_history` tool asks for, as opposed to the push block.
 *
 * 🛑 EIGHT TRADES WITH NO MANAGER NAMES IS WHY CHIMMY SAID THE HISTORY "ISN'T ITEMIZED".
 * The push block was sized to sit inside a 30k grounding budget beside twenty other
 * blocks, and it printed "one side got [..] for [..]" — so "what did Layes23 trade
 * away?" had no answer even when the block arrived intact. A tool result is read on
 * its own, so it can afford the whole season and both managers' names.
 */
export type TradeHistoryQuery = {
  /** Only this season's trades. */
  season?: number | null
  /** Only trades this manager was on either side of (Sleeper username or team name, case-insensitive). */
  manager?: string | null
  /** Only trades that moved a player whose name contains this (case-insensitive). */
  player?: string | null
  /** How many trades to list. */
  maxShown?: number
  /** How many stored rows to read — two per trade, one from each side. */
  scanLimit?: number
}

/** The tool path's sizes: a season of trades in a busy league, both sides stored. */
export const TOOL_TRADES_SHOWN = 30
export const TOOL_TRADE_SCAN_LIMIT = 600

type TradeRow = {
  transactionId: string
  week: number
  season: number
  tradeDate: Date | null
  playersGiven: unknown
  playersReceived: unknown
  picksGiven: unknown
  picksReceived: unknown
  partnerName?: string | null
  partnerRosterId?: number | null
  history?: { sleeperUsername: string | null } | null
}

function sameName(a: string | null | undefined, b: string): boolean {
  return typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase()
}

type TeamLabel = { label: string; names: string[] }

/**
 * Who each side of a trade was, by the league's own team names.
 *
 * 🛑 NEITHER STORED NAME IS A NAME. Measured on the test copy 2026-09-25: all 17,033 `LeagueTrade`
 * rows carry `partnerName = null`, and `LeagueTradeHistory.sleeperUsername` holds the Sleeper USER
 * ID (`1208593130748645376`), not a username. So a block built from them alone printed numbers and
 * "another manager". What the row does carry is joinable: the user id is `LeagueTeam.platformUserId`
 * and `partnerRosterId` is the Sleeper roster id, `LeagueTeam.externalId`.
 *
 * ⚠ READ ACROSS EVERY `leagues` ROW FOR THIS SLEEPER LEAGUE. One Sleeper league can sit under several
 * rows (KBFL has four), and the row a question arrives with need not be the one holding the teams.
 * The requested row's teams win where both have one.
 */
async function readTeamLabels(
  leagueId: string,
  league: { platform: string; platformLeagueId: string },
): Promise<{ byUser: Map<string, TeamLabel>; byRoster: Map<string, TeamLabel> }> {
  const byUser = new Map<string, TeamLabel>()
  const byRoster = new Map<string, TeamLabel>()
  try {
    const siblings = await prisma.league.findMany({
      where: { platform: league.platform, platformLeagueId: league.platformLeagueId },
      select: { id: true },
    })
    const ids = [leagueId, ...siblings.map((s) => s.id).filter((id) => id !== leagueId)]
    const teams = await prisma.leagueTeam.findMany({
      where: { leagueId: { in: ids } },
      select: { leagueId: true, externalId: true, platformUserId: true, teamName: true, ownerName: true },
    })
    teams.sort((a, b) => ids.indexOf(a.leagueId) - ids.indexOf(b.leagueId))
    for (const t of teams) {
      const team = t.teamName?.trim() ?? ''
      const owner = t.ownerName?.trim() ?? ''
      const label = team && owner && team.toLowerCase() !== owner.toLowerCase() ? `${team} (${owner})` : team || owner
      if (!label) continue
      const entry = { label, names: [team, owner].filter(Boolean) }
      if (t.platformUserId && !byUser.has(t.platformUserId)) byUser.set(t.platformUserId, entry)
      if (t.externalId && !byRoster.has(t.externalId)) byRoster.set(t.externalId, entry)
    }
  } catch {
    // No team names means the ids below fall back to plain wording — never a guess.
  }
  return { byUser, byRoster }
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
 * Why this block is or is not in the prompt.
 *
 * 🛑 `null` WAS SEVEN DIFFERENT ANSWERS WEARING ONE FACE. On 2026-09-20 Chimmy
 * told a manager it could not see their league's trade history while 27 ingested
 * trades sat in the database, whose players resolve 13 of 13 to correct names —
 * and nothing recorded whether this function declined to build the block, or
 * built it and had it dropped downstream by `applyGroundingBudget`. Those have
 * opposite fixes, so the reason is now carried rather than collapsed.
 */
/**
 * The opening words of the block, used both to write the heading and to check
 * downstream whether it survived into the final prompt.
 *
 * ⚠ ONE CONSTANT, BECAUSE A COPY WOULD DRIFT. A survival check that hardcodes
 * this string keeps passing after the heading is reworded, which would report a
 * dropped block as present — the failure it exists to detect.
 */
export const TRADE_HISTORY_BLOCK_MARKER = 'COMPLETED TRADE HISTORY for this league'

export type TradeHistoryOutcome =
  | { kind: 'ok'; text: string; uniqueTrades: number; shown: number; unresolvedPlayers: number }
  | { kind: 'missing-args' }
  | { kind: 'league-lookup-failed' }
  /** The id handed in is not a `leagues.id`. This repo has more than one league-id space. */
  | { kind: 'league-not-found' }
  | { kind: 'no-platform-league-id' }
  | { kind: 'not-sleeper'; platform: string }
  | { kind: 'history-lookup-failed' }
  | { kind: 'no-history-rows' }
  | { kind: 'trade-lookup-failed' }
  | { kind: 'no-trade-rows'; historyCount: number }

/**
 * What has actually been traded in this league, with the reason attached when
 * there is no block to add.
 */
export async function buildLeagueTradeHistoryOutcome(
  leagueId: string,
  userId: string,
  query: TradeHistoryQuery = {},
): Promise<TradeHistoryOutcome> {
  if (!leagueId || !userId) return { kind: 'missing-args' }
  const maxShown = Math.max(1, Math.min(query.maxShown ?? MAX_TRADES_SHOWN, 60))
  const scanLimit = Math.max(2, Math.min(query.scanLimit ?? TRADE_SCAN_LIMIT, 1000))
  const managerFilter = query.manager?.trim() ? query.manager.trim() : null
  const playerFilter = query.player?.trim() ? query.player.trim().toLowerCase() : null
  const seasonFilter = typeof query.season === 'number' && Number.isFinite(query.season) ? query.season : null

  let league: { platform: string; platformLeagueId: string; sport: string; season: number } | null
  try {
    league = await prisma.league.findUnique({
      where: { id: leagueId },
      select: { platform: true, platformLeagueId: true, sport: true, season: true },
    })
  } catch {
    return { kind: 'league-lookup-failed' }
  }
  if (!league) return { kind: 'league-not-found' }
  if (!league.platformLeagueId) return { kind: 'no-platform-league-id' }
  // Ingestion is Sleeper-only; another platform's league has no rows here and a
  // silent empty block would read as "this league has never traded".
  if (league.platform.toLowerCase() !== 'sleeper') return { kind: 'not-sleeper', platform: league.platform }

  let histories: Array<{ id: string }>
  try {
    histories = await prisma.leagueTradeHistory.findMany({
      where: { sleeperLeagueId: league.platformLeagueId },
      select: { id: true },
    })
  } catch {
    return { kind: 'history-lookup-failed' }
  }
  if (histories.length === 0) return { kind: 'no-history-rows' }

  let rows: TradeRow[]
  try {
    rows = (await prisma.leagueTrade.findMany({
      where: {
        historyId: { in: histories.map((h) => h.id) },
        ...(seasonFilter != null ? { season: seasonFilter } : {}),
      },
      orderBy: { tradeDate: 'desc' },
      take: scanLimit,
      select: {
        transactionId: true,
        week: true,
        season: true,
        tradeDate: true,
        playersGiven: true,
        playersReceived: true,
        picksGiven: true,
        picksReceived: true,
        partnerName: true,
        partnerRosterId: true,
        history: { select: { sleeperUsername: true } },
      },
    })) as unknown as TradeRow[]
  } catch {
    return { kind: 'trade-lookup-failed' }
  }
  if (rows.length === 0) return { kind: 'no-trade-rows', historyCount: histories.length }

  const teams = await readTeamLabels(leagueId, league)
  /** The manager whose history row this is — stored as a Sleeper user id on current rows. */
  const sideA = (r: TradeRow): TeamLabel => {
    const raw = r.history?.sleeperUsername?.trim() ?? ''
    const team = raw ? teams.byUser.get(raw) : undefined
    if (team) return { label: team.label, names: [raw, ...team.names] }
    // An older row may hold a real username; a bare number is an id we could not name.
    return { label: raw && !/^\d+$/.test(raw) ? raw : 'an unnamed manager', names: raw ? [raw] : [] }
  }
  /** The other side, by stored name when there is one, else by roster id. */
  const sideB = (r: TradeRow): TeamLabel => {
    const stored = r.partnerName?.trim() ?? ''
    const team = r.partnerRosterId != null ? teams.byRoster.get(String(r.partnerRosterId)) : undefined
    return { label: stored || team?.label || 'another manager', names: [stored, ...(team?.names ?? [])].filter(Boolean) }
  }
  /** "Tigre" finds "ElTigre164": managers are named loosely in a question. */
  const namesMatch = (side: TeamLabel, filter: string): boolean => {
    const f = filter.toLowerCase()
    return side.names.some((n) => (f.length >= 3 ? n.toLowerCase().includes(f) : sameName(n, filter)))
  }

  /*
   * One history row exists per MANAGER per league, so a single trade is stored
   * once from each side and would otherwise be reported twice — as two different
   * trades running in opposite directions.
   *
   * When the question is about one manager, keep THEIR side of the deal, so
   * "what did X get" reads from X's perspective rather than their partner's.
   */
  const byTx = new Map<string, TradeRow>()
  for (const r of rows) {
    const kept = byTx.get(r.transactionId)
    if (!kept) {
      byTx.set(r.transactionId, r)
    } else if (managerFilter && !namesMatch(sideA(kept), managerFilter) && namesMatch(sideA(r), managerFilter)) {
      byTx.set(r.transactionId, r)
    }
  }
  const unique = [...byTx.values()]
  const involved = managerFilter
    ? unique.filter((r) => namesMatch(sideA(r), managerFilter) || namesMatch(sideB(r), managerFilter))
    : unique

  /*
   * A player filter needs names for every candidate trade, not just the ones
   * shown — otherwise a trade past the first page could never match. Without one,
   * only the trades shown are resolved, which is what the push block always did.
   */
  const nameScope = playerFilter ? involved : involved.slice(0, maxShown)
  const allIds = nameScope.flatMap((r) => [...idList(r.playersGiven), ...idList(r.playersReceived)])
  const names = await resolveNames([...new Set(allIds)], league.sport)

  const matching = playerFilter
    ? involved.filter((r) =>
        [...idList(r.playersGiven), ...idList(r.playersReceived)].some((id) =>
          (names.get(id) ?? '').toLowerCase().includes(playerFilter),
        ),
      )
    : involved
  const shown = matching.slice(0, maxShown)

  const bySeason = new Map<number, number>()
  for (const r of unique) bySeason.set(r.season, (bySeason.get(r.season) ?? 0) + 1)
  const seasonSummary = [...bySeason.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([s, n]) => `${s}: ${n}`)
    .join(', ')

  const filters = [
    seasonFilter != null ? `season ${seasonFilter}` : null,
    managerFilter ? `manager "${managerFilter}"` : null,
    playerFilter ? `player "${query.player!.trim()}"` : null,
  ].filter((f): f is string => Boolean(f))

  const lines: string[] = [
    `${TRADE_HISTORY_BLOCK_MARKER} (Sleeper league ${league.platformLeagueId}).`,
    `These trades ALREADY HAPPENED. None of them is a pending offer, and nothing here is awaiting the user's response.`,
    `Trades on file in the window read: ${unique.length} (${seasonSummary}).`,
  ]
  if (filters.length > 0) {
    lines.push(`Filtered to ${filters.join(', ')}: ${matching.length} trade${matching.length === 1 ? '' : 's'}.`)
    const unnamedInScope = playerFilter ? [...new Set(allIds)].filter((id) => !names.has(id)).length : 0
    if (unnamedInScope > 0) {
      lines.push(
        `${unnamedInScope} traded player(s) in this window have no name on file, so a player match can miss a trade — say so rather than claiming the player was never traded.`,
      )
    }
  }
  // Both sides are stored, so a full scan window means older trades were not read.
  if (rows.length >= scanLimit) {
    lines.push('Older trades exist beyond this window; say so if the question reaches further back.')
  }
  lines.push(
    shown.length === 0
      ? 'No trade in the window read matches that filter.'
      : shown.length < matching.length
        ? `Most recent ${shown.length} of ${matching.length}:`
        : `All ${shown.length}, most recent first:`,
  )

  let totalUnresolved = 0
  for (const r of shown) {
    const recv = describeSide(idList(r.playersReceived), pickList(r.picksReceived), names)
    const give = describeSide(idList(r.playersGiven), pickList(r.picksGiven), names)
    totalUnresolved += recv.unresolved + give.unresolved
    const when = r.tradeDate ? r.tradeDate.toISOString().slice(0, 10) : `week ${r.week}`
    lines.push(`- ${when} (${r.season} wk ${r.week}): ${sideA(r).label} got [${recv.text}] from ${sideB(r).label} for [${give.text}].`)
  }
  if (teams.byRoster.size > 0 || teams.byUser.size > 0) {
    lines.push("Managers are named by the league's CURRENT team names; a team that has since changed hands shows its current name.")
  }

  lines.push(
    'LIMITS: no trade values are stored for these — do NOT state what any of them was worth, who won, or assign a grade. Each line is one deal read from the first manager\'s side; in a two-team deal the second manager got what the first gave up (a three-team deal names only one partner).',
  )
  if (totalUnresolved > 0) {
    lines.push(
      `${totalUnresolved} traded player(s) could not be matched to a name. Say so if it matters; never guess who they were.`,
    )
  }

  return {
    kind: 'ok',
    text: lines.join('\n'),
    uniqueTrades: unique.length,
    shown: shown.length,
    unresolvedPlayers: totalUnresolved,
  }
}

/**
 * The original string-or-null contract, kept so existing callers are untouched.
 *
 * ⚠ A caller that needs to know WHY there is no block must use
 * `buildLeagueTradeHistoryOutcome`. Collapsing back to `null` here is exactly
 * the loss of information this module now exists to avoid — it is fine for a
 * caller that only wants to append a block, and useless for diagnosis.
 */
export async function buildLeagueTradeHistoryContext(
  leagueId: string,
  userId: string,
): Promise<string | null> {
  const outcome = await buildLeagueTradeHistoryOutcome(leagueId, userId)
  return outcome.kind === 'ok' ? outcome.text : null
}
