/**
 * Competitive Edge for a TRADE decision — what one manager has actually done in this league's
 * trades, stated as counts and bound to the deal on the table. Pure: the loader
 * (./tradeEdgeLoader.ts) supplies the league's graded trade history and the deal.
 *
 * 🛑 THE CONTRACT (docs/DECISION_OS_COMPETITIVE_EDGE_PRIVACY_STATUS.md, Milestone 32):
 *   - FACTS, NEVER LABELS. Every line is a count over completed trades — "took on a WR in 4 of
 *     9 trades" — never a trait ("likes WRs", "a shark", "a gambler"). The retired profile engine
 *     sold labels; this sells evidence a reader can check.
 *   - NO ACCEPTANCE ODDS. Nothing here predicts whether they will say yes. That needs calibration
 *     (Milestone 34) this does not have.
 *   - BOUND TO THE MOVE AND THE MANAGER. The lines about the positions and picks in THIS deal come
 *     first and are marked `bearsOnDeal`; the manager is matched by their Sleeper user id, which is
 *     the same person across seasons even when a team changes hands.
 *   - COVERAGE AND FRESHNESS ARE PART OF THE ANSWER. Below TRADE_FLOOR completed trades no pattern
 *     is shown at all — two trades are an anecdote — and the payload says how many trades, which
 *     seasons, and as of when.
 */

export const TRADE_FLOOR = 3

export type EdgeDealAsset = { kind: 'player'; position: string | null } | { kind: 'pick' }

export type EdgeTradeSide = {
  ownerId: string | null
  playersIn: Array<{ position: string | null }>
  playersOut: Array<{ position: string | null }>
  picksIn: unknown[]
  picksOut: unknown[]
}

export type EdgeTrade = {
  id: string
  season: string
  week: number
  createdIso: string
  sides: EdgeTradeSide[]
}

export type EdgeFact = {
  /** Stable id for the line (tests, analytics). Deliberately NOT `competitive_edge.*` — the Decision
   *  OS envelope silently drops that prefix (lib/decision-os/envelope/serialize.ts). */
  key: string
  text: string
  /** True when the line is about a position or pick that is in THIS deal. */
  bearsOnDeal: boolean
}

export type TradeEdge = {
  manager: { name: string; teamExternalId: string }
  coverage: {
    source: 'sleeper_trade_history'
    /** Completed trades this manager was part of, across every season read. */
    trades: number
    seasons: string[]
    /** What the history could not read that would hide a trade — the count is a floor when non-empty. */
    gaps: string[]
    firstSeason: string | null
    lastTradeAt: string | null
    /** When the history was read. */
    asOf: string
    /** The history is older than its refresh window, or the last refresh failed. */
    stale: boolean
    /** At least TRADE_FLOOR trades — the position and pick lines are shown only then. */
    sufficient: boolean
    shortfall: string | null
  }
  facts: EdgeFact[]
}

const SKIP_POSITIONS = new Set(['', 'PICK', 'FAAB', 'UNKNOWN', 'N/A'])

function pos(p: string | null | undefined): string | null {
  const v = String(p ?? '').trim().toUpperCase()
  return v && !SKIP_POSITIONS.has(v) ? v : null
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

function day(iso: string | null): string | null {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' }).format(d)
}

export function buildTradeEdge(input: {
  trades: EdgeTrade[]
  /** The manager's Sleeper user id — `LeagueTeam.platformUserId`. */
  managerOwnerId: string
  managerName: string
  teamExternalId: string
  /** The viewer's Sleeper user id, for "N of them with you". */
  viewerOwnerId: string | null
  /** What the MANAGER would receive and send in the deal on the table. */
  deal: { theyGet: EdgeDealAsset[]; theySend: EdgeDealAsset[] }
  seasonsScanned: string[]
  /** The history's own `missing` notes; only the ones that could hide a trade are kept. */
  historyGaps: string[]
  asOf: string
  stale: boolean
}): TradeEdge {
  const theirs = input.trades
    .map((t) => ({ t, side: t.sides.find((s) => s.ownerId === input.managerOwnerId) }))
    .filter((x): x is { t: EdgeTrade; side: EdgeTradeSide } => Boolean(x.side))
    .sort((a, b) => a.t.createdIso.localeCompare(b.t.createdIso))

  const n = theirs.length
  const withViewer = input.viewerOwnerId
    ? theirs.filter(({ t }) => t.sides.some((s) => s.ownerId === input.viewerOwnerId)).length
    : null
  const firstSeason = n > 0 ? theirs.map(({ t }) => t.season).sort()[0]! : null
  const lastTradeAt = n > 0 ? theirs[n - 1]!.t.createdIso : null
  const sufficient = n >= TRADE_FLOOR
  const name = input.managerName

  const facts: EdgeFact[] = []

  // ── bound to the deal: its positions and picks, only once there is a pattern to read ────────
  if (sufficient) {
    const tradesWhere = (pred: (s: EdgeTradeSide) => boolean) => theirs.filter(({ side }) => pred(side)).length
    const getPositions = [...new Set(input.deal.theyGet.flatMap((a) => (a.kind === 'player' ? [pos(a.position)] : [])))]
    const sendPositions = [...new Set(input.deal.theySend.flatMap((a) => (a.kind === 'player' ? [pos(a.position)] : [])))]

    for (const p of getPositions) {
      if (!p) continue
      const x = tradesWhere((s) => s.playersIn.some((pl) => pos(pl.position) === p))
      const total = theirs.reduce((sum, { side }) => sum + side.playersIn.filter((pl) => pos(pl.position) === p).length, 0)
      facts.push({
        key: `trade.acquired.${p}`,
        text:
          x === 0
            ? `${name} hasn't taken on a ${p} in any of their ${n} trades.`
            : `${name} took on a ${p} in ${x} of their ${n} trades (${plural(total, p)} in all).`,
        bearsOnDeal: true,
      })
    }
    for (const p of sendPositions) {
      if (!p) continue
      const x = tradesWhere((s) => s.playersOut.some((pl) => pos(pl.position) === p))
      facts.push({
        key: `trade.sent.${p}`,
        text:
          x === 0
            ? `${name} hasn't sent away a ${p} in any of their ${n} trades.`
            : `${name} sent away a ${p} in ${x} of their ${n} trades.`,
        bearsOnDeal: true,
      })
    }
    if (input.deal.theyGet.some((a) => a.kind === 'pick')) {
      const x = tradesWhere((s) => s.picksIn.length > 0)
      facts.push({
        key: 'trade.picks.acquired',
        text: `${name} took on draft picks in ${x} of their ${n} trades.`,
        bearsOnDeal: true,
      })
    }
    if (input.deal.theySend.some((a) => a.kind === 'pick')) {
      const x = tradesWhere((s) => s.picksOut.length > 0)
      facts.push({
        key: 'trade.picks.sent',
        text: `${name} gave up draft picks in ${x} of their ${n} trades.`,
        bearsOnDeal: true,
      })
    }

    // The deal's SHAPE — fewer pieces back than they send, or more — against how their trades went.
    const pieces = (s: EdgeTradeSide) => ({ got: s.playersIn.length + s.picksIn.length, gave: s.playersOut.length + s.picksOut.length })
    const dealGot = input.deal.theyGet.length
    const dealGave = input.deal.theySend.length
    if (dealGot > 0 && dealGave > 0 && dealGot !== dealGave) {
      const fewer = dealGot < dealGave
      const x = tradesWhere((s) => {
        const p = pieces(s)
        return fewer ? p.got < p.gave : p.got > p.gave
      })
      facts.push({
        key: fewer ? 'trade.shape.fewer_back' : 'trade.shape.more_back',
        text: fewer
          ? `This offer gives ${name} fewer pieces than they send. They took back fewer pieces than they gave in ${x} of their ${n} trades.`
          : `This offer gives ${name} more pieces than they send. They took back more pieces than they gave in ${x} of their ${n} trades.`,
        bearsOnDeal: true,
      })
    }
  }

  // ── the manager's record, always ───────────────────────────────────────────────────────────
  facts.push({
    key: 'trade.volume',
    text:
      n === 0
        ? `${name} has no completed trades in this league's history on file.`
        : `${name} has made ${plural(n, 'trade')} in this league since ${firstSeason}; the last was ${day(lastTradeAt)}.`,
    bearsOnDeal: false,
  })
  if (withViewer !== null && n > 0) {
    facts.push({
      key: 'trade.with_you',
      text: withViewer === 0 ? 'None of them were with you.' : `${withViewer} of them ${withViewer === 1 ? 'was' : 'were'} with you.`,
      bearsOnDeal: false,
    })
  }

  return {
    manager: { name, teamExternalId: input.teamExternalId },
    coverage: {
      source: 'sleeper_trade_history',
      trades: n,
      seasons: [...input.seasonsScanned].sort(),
      gaps: input.historyGaps.filter((g) => /managers|rosters|transactions|league chain/i.test(g)),
      firstSeason,
      lastTradeAt,
      asOf: input.asOf,
      stale: input.stale,
      sufficient,
      shortfall: sufficient
        ? null
        : n === 0
          ? `No completed trades by ${name} on file, so there is nothing to read yet.`
          : `Only ${plural(n, 'completed trade')} on file — fewer than ${TRADE_FLOOR}, so no pattern is shown.`,
    },
    facts,
  }
}
