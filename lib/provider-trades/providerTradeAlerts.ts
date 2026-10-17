/**
 * New-trade alerts for leagues that are NOT on Sleeper (2026-10-08) — the pure half.
 *
 * Sleeper trades already buzz phones: `tradeNotifyService` diffs each Sleeper league's feed every 15
 * minutes and pushes "Trade accepted in {league}". Native AllFantasy leagues push through the trade
 * engine's own fan-out. Imported leagues on every other platform had nothing — a trade in an ESPN
 * league reached the home's trade band (it reads `LeagueTrade`) and never anyone's phone.
 *
 * The source is the same `LeagueTrade` rows the band reads, written by the 30-minute live collector
 * (lib/import-os/collector/persistLiveTrades.ts), so the push can never name a trade /core does not
 * show. Measured in production that day: ESPN is the only non-Sleeper platform with rows (28, two
 * leagues); Fantrax, MFL and Yahoo record none, and start alerting the day their imports do.
 *
 * ⚠ ESPN SPLITS ONE TRADE INTO TWO TRANSACTIONS. Measured: `9b07…` has team FF3B receiving a player and
 * `9ac4…`, at the same instant between the same two teams, has B3DB receiving one — each half reads
 * "got nothing" on one side. Taken one transaction at a time that is two half-trades and two pushes.
 * So rows are grouped by transaction, then transactions are merged when they share the league, the
 * instant and the pair of teams. Two genuinely separate trades between the same two teams at the same
 * import instant would merge too; the message is still true of what moved, which is the trade-off.
 *
 * Pure: no prisma, no clock.
 */

export type ProviderTradeRow = {
  platform: string
  platformLeagueId: string
  /** The provider's id for the team on this side (`LeagueTradeHistory.sleeperUsername`, despite the name). */
  sideId: string
  transactionId: string
  tradeDate: Date
  sport: string
  playersReceived: string[]
  picksReceived: number
}

export type ProviderTradeSide = { sideId: string; players: string[]; picks: number }

export type ProviderTrade = {
  /** Stable across sweeps: platform, league, instant and the sorted team pair. */
  key: string
  platform: string
  platformLeagueId: string
  sport: string
  tradeDate: Date
  transactionIds: string[]
  sides: ProviderTradeSide[]
}

export function groupProviderTrades(rows: readonly ProviderTradeRow[]): ProviderTrade[] {
  // 1. Rows -> transactions, one side per team.
  const byTx = new Map<string, { row: ProviderTradeRow; sides: Map<string, ProviderTradeSide> }>()
  for (const r of rows) {
    const k = `${r.platform}|${r.platformLeagueId}|${r.transactionId}`
    const tx = byTx.get(k) ?? { row: r, sides: new Map() }
    const side = tx.sides.get(r.sideId) ?? { sideId: r.sideId, players: [], picks: 0 }
    for (const p of r.playersReceived) if (!side.players.includes(p)) side.players.push(p)
    side.picks += r.picksReceived
    tx.sides.set(r.sideId, side)
    byTx.set(k, tx)
  }
  // 2. Transactions -> trades: same league, same instant, same pair of teams.
  const trades = new Map<string, ProviderTrade>()
  for (const { row, sides } of byTx.values()) {
    const pair = [...sides.keys()].sort().join('+')
    const key = `${row.platform}:${row.platformLeagueId}:${row.tradeDate.toISOString()}:${pair}`
    const trade = trades.get(key) ?? {
      key,
      platform: row.platform,
      platformLeagueId: row.platformLeagueId,
      sport: row.sport,
      tradeDate: row.tradeDate,
      transactionIds: [],
      sides: [],
    }
    trade.transactionIds.push(row.transactionId)
    for (const s of sides.values()) {
      const held = trade.sides.find((x) => x.sideId === s.sideId)
      if (!held) trade.sides.push({ ...s, players: [...s.players] })
      else {
        for (const p of s.players) if (!held.players.includes(p)) held.players.push(p)
        held.picks += s.picks
      }
    }
    trades.set(key, trade)
  }
  return [...trades.values()].sort((a, b) => a.tradeDate.getTime() - b.tradeDate.getTime())
}

const BODY_MAX = 180

/**
 * "Trade in Washington Pro Knockout" / "Team A gets Bijan Robinson · Team B gets 2 picks".
 * An unresolved player is said as "a player", never a raw provider id; a side with nothing on record
 * says so rather than vanishing (a FAAB-only side, or one the import did not capture).
 */
export function renderProviderTrade(
  trade: ProviderTrade,
  leagueName: string,
  teamName: (sideId: string) => string,
  playerName: (playerId: string) => string | null,
): { title: string; body: string } {
  const sideLine = (s: ProviderTradeSide) => {
    const names = s.players.map((p) => playerName(p) ?? 'a player')
    const assets = [...names, ...(s.picks > 0 ? [`${s.picks} ${s.picks === 1 ? 'pick' : 'picks'}`] : [])]
    return `${teamName(s.sideId)} gets ${assets.length ? assets.join(', ') : 'nothing on record'}`
  }
  let body = trade.sides.map(sideLine).join(' · ')
  if (body.length > BODY_MAX) body = `${body.slice(0, BODY_MAX - 1).trimEnd()}…`
  return { title: `Trade in ${leagueName}`, body }
}
