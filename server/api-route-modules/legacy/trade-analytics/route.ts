import { withApiUsage } from "@/lib/telemetry/usage"
import { NextRequest, NextResponse } from 'next/server'
import { isUserParty } from '@/lib/user-matching'
import { logUserEventByUsername } from '@/lib/user-events'
import { requireLegacySleeperIdentity } from '@/lib/legacy/requireLegacySleeperIdentity'
import { legacySessionUserId } from '@/lib/legacy/legacyOneGrade'
import { gradeLegacyCompletedTrades, type LegacyCompletedTrade } from '@/lib/legacy/legacyCompletedTradeGrades'
import type { TradeGradeLine, TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import type { GradeLetter } from '@/lib/trade-intel/gradeScale'

/*
 * 🛑 THE AF LEGACY TRADE REPORT GRADES EVERY TRADE THROUGH THE ONE TRADE GRADE (2026-11-26).
 *
 * Until then every number this report printed came from a second engine: `computeDualModeTradeDelta`
 * (`lib/hybrid-valuation.ts`) priced each trade "at the time" and "with hindsight", a trade was a win
 * when that delta passed +300, the overall grade averaged the letters the CLIENT sent (another model's,
 * on another scale), the "trading journey" was `(gradeValue − 60) × 100`, and
 * `lib/trade-engine/report-card-engine.ts` turned the same deltas into a three-lens report card on its
 * own 13-step letter scale. The /core Trades history graded the same Sleeper trades with a different
 * letter.
 *
 * Now each trade is graded by `oneGradeForCompletedTrade` on the viewer's own AF league row
 * (`lib/legacy/legacyCompletedTradeGrades.ts`), from the viewer's side:
 *   - `atTimeGrade` / `atTimeDelta` are the trade's ORIGINAL grade (priced at the time of the trade when
 *     a market capture covers it), `hindsightGrade` / `hindsightDelta` today's re-grade beside it;
 *   - a WIN is a B or better, a LOSS a D or worse, EVEN a C — the grade's own bands, not a value cutoff;
 *   - every value is the league value the letter was taken on (received − sent);
 *   - the overall grade card, partners, best/worst trade and awards are aggregates of THOSE numbers.
 * A trade the grade withholds says why (`gradeWithheld`) and counts in no total. Nothing is filled in
 * from another model: no PPG proxy (`lineupImpact` and the Starter Builder award are null), no
 * confidence, and no report card — the report card's letters were the second engine's, and there is
 * no honest version of them to print.
 */

interface TradeAnalyticsRequest {
  league_id: string
  sleeper_username: string
  sleeper_user_id?: string
  mode?: 'atTime' | 'hindsight'
  trades: Array<LegacyCompletedTrade & { grade?: string; verdict?: string }>
  managers?: Record<string, string>
  league?: { qb_format?: string }
}

type Outcome = 'win' | 'loss' | 'even'

/** The grade's own reading of a letter: B or better wins, D or worse loses. */
export function outcomeOf(letter: GradeLetter): Outcome {
  return letter === 'A' || letter === 'B' ? 'win' : letter === 'D' || letter === 'F' ? 'loss' : 'even'
}

const LETTER_POINTS: Record<GradeLetter, number> = { A: 4, B: 3, C: 2, D: 1, F: 0 }
const LETTERS: GradeLetter[] = ['F', 'D', 'C', 'B', 'A']

/** The mean of several one-grade letters, on the same A–F scale. Null when there are none. */
export function meanLetter(letters: readonly GradeLetter[]): { letter: GradeLetter; score: number } | null {
  if (letters.length === 0) return null
  const avg = letters.reduce((s, l) => s + LETTER_POINTS[l], 0) / letters.length
  return { letter: LETTERS[Math.round(avg)]!, score: Math.round((avg / 4) * 100) }
}

const TRADER_LABEL: Record<GradeLetter, string> = {
  A: 'Elite Trader',
  B: 'Above Average Trader',
  C: 'Average Trader',
  D: 'Below Average Trader',
  F: 'Struggling Trader',
}

type Moment = { letter: GradeLetter; net: number; received: number; gave: number }

/** The original ("at the time") and today's ("now") readings of one graded view. */
export function momentsOf(view: TradeGradeView): { atTime: Moment; now: Moment } | null {
  if (!view.graded) return null
  const atTime: Moment = { letter: view.letter, net: view.getValue - view.giveValue, received: view.getValue, gave: view.giveValue }
  const c = view.current
  const now: Moment = c ? { letter: c.letter, net: c.getValue - c.giveValue, received: c.getValue, gave: c.giveValue } : atTime
  return { atTime, now }
}

const round = (n: number) => Math.round(n)

const withheldReason = (view: TradeGradeView): string | null => (view.graded ? null : view.reason)
const firstWithheldReason = (views: readonly TradeGradeView[]): string | null =>
  views.map(withheldReason).find((r): r is string => r != null) ?? null

export const POST = withApiUsage({ endpoint: "/api/legacy/trade-analytics", tool: "LegacyTradeAnalytics" })(async (req: NextRequest) => {
  try {
    const body: TradeAnalyticsRequest = await req.json()
    const { league_id, sleeper_user_id, trades, managers } = body

    const gate = await requireLegacySleeperIdentity(req, {
      requestedUsername: String(body.sleeper_username || '').trim() || null,
      rateLimit: { action: 'trade_analytics', maxRequests: 15, windowMs: 60_000 },
    })
    if (!gate.ok) return gate.response
    const sleeper_username = gate.identity.sleeperUsername

    if (!league_id || !trades || trades.length === 0) {
      return NextResponse.json({ error: 'league_id and trades are required' }, { status: 400 })
    }

    if (sleeper_username) {
      logUserEventByUsername(sleeper_username, 'trade_analysis_started', { league_id, trade_count: trades.length })
    }

    const isMe = (p: { userId?: string; teamName?: string; displayName?: string }) => isUserParty(p, sleeper_username, sleeper_user_id)
    const userTrades = trades.filter(t => t.parties?.some(isMe))
    const mode = body.mode === 'hindsight' ? 'hindsight' : 'atTime'

    // THE grade of every trade, from your side. One league load, frozen originals read once.
    const views = await gradeLegacyCompletedTrades({
      suppliedLeagueId: league_id,
      userId: await legacySessionUserId(),
      trades: userTrades,
      isViewer: isMe,
    })

    const scored = userTrades.map((trade, i) => {
      const view = views[i]!
      const moments = momentsOf(view)
      const primary = moments ? (mode === 'hindsight' ? moments.now : moments.atTime) : null
      return { trade, view, moments, primary }
    })
    const graded = scored.filter((s): s is typeof s & { moments: NonNullable<typeof s.moments>; primary: Moment } => s.primary != null)

    const partnerOf = (t: LegacyCompletedTrade) => t.parties?.find(p => !isMe(p))
    const meOf = (t: LegacyCompletedTrade) => t.parties?.find(isMe)
    const nameOf = (p: ReturnType<typeof partnerOf>) =>
      p?.teamName || p?.displayName || managers?.[p?.userId || ''] || p?.userId || 'Unknown'

    // ── Headline stats, on the grade's own outcome ─────────────────────────────────────────────
    const tally = (pick: (m: NonNullable<(typeof scored)[number]['moments']>) => Moment) => {
      const s = { wins: 0, losses: 0, even: 0, netValue: 0, avgPerTrade: 0, winRate: 0 }
      for (const g of graded) {
        const m = pick(g.moments)
        s[outcomeOf(m.letter) === 'win' ? 'wins' : outcomeOf(m.letter) === 'loss' ? 'losses' : 'even']++
        s.netValue += round(m.net)
      }
      s.avgPerTrade = graded.length > 0 ? Math.round((s.netValue / graded.length) * 10) / 10 : 0
      s.winRate = graded.length > 0 ? Math.round((s.wins / graded.length) * 100) : 0
      return s
    }
    const atTimeStats = tally((m) => m.atTime)
    const hindsightStats = tally((m) => m.now)
    const primaryStats = mode === 'hindsight' ? hindsightStats : atTimeStats
    const totalValueGained = graded.reduce((s, g) => s + round(g.primary.net), 0)
    const valueReceived = graded.reduce((s, g) => s + round(g.primary.received), 0)
    const valueGiven = graded.reduce((s, g) => s + round(g.primary.gave), 0)

    const overall = meanLetter(graded.map((g) => g.primary.letter))
    const withheldCount = scored.length - graded.length

    // ── Partners ───────────────────────────────────────────────────────────────────────────────
    type PartnerStats = {
      name: string; trades: number; netValue: number; letters: GradeLetter[]; wins: number; losses: number
      positionsReceived: Record<string, number>; positionsGiven: Record<string, number>
      picksReceived: number; picksGiven: number; tradeShapes: string[]
    }
    const partnerStats: Record<string, PartnerStats> = {}
    for (const g of graded) {
      const partner = partnerOf(g.trade)
      if (!partner) continue
      const id = partner.userId || partner.teamName || 'Unknown'
      const ps = (partnerStats[id] ??= {
        name: nameOf(partner), trades: 0, netValue: 0, letters: [], wins: 0, losses: 0,
        positionsReceived: {}, positionsGiven: {}, picksReceived: 0, picksGiven: 0, tradeShapes: [],
      })
      ps.trades++
      ps.netValue += round(g.primary.net)
      ps.letters.push(g.primary.letter)
      const o = outcomeOf(g.primary.letter)
      if (o === 'win') ps.wins++
      if (o === 'loss') ps.losses++
      const me = meOf(g.trade)
      for (const pl of me?.playersReceived ?? []) ps.positionsReceived[pl.position || 'Unknown'] = (ps.positionsReceived[pl.position || 'Unknown'] || 0) + 1
      for (const pl of partner.playersReceived ?? []) ps.positionsGiven[pl.position || 'Unknown'] = (ps.positionsGiven[pl.position || 'Unknown'] || 0) + 1
      ps.picksReceived += me?.picksReceived?.length || 0
      ps.picksGiven += partner.picksReceived?.length || 0
      const mine = (me?.playersReceived?.length || 0) + (me?.picksReceived?.length || 0)
      const theirs = (partner.playersReceived?.length || 0) + (partner.picksReceived?.length || 0)
      ps.tradeShapes.push(mine < theirs ? 'consolidation' : mine > theirs ? 'dispersion' : 'swap')
    }

    // Descriptive: what this partner trades and how. The win/lose line reads the one grade's outcomes.
    function styleMatch(ps: PartnerStats) {
      const insights: string[] = []
      const drivers: string[] = []
      const topGiven = Object.entries(ps.positionsGiven).sort(([, a], [, b]) => b - a)
      const topReceived = Object.entries(ps.positionsReceived).sort(([, a], [, b]) => b - a)
      const totalGiven = topGiven.reduce((s, [, v]) => s + v, 0)
      const totalReceived = topReceived.reduce((s, [, v]) => s + v, 0)
      if (topGiven[0] && totalGiven > 0 && topGiven[0][1] / totalGiven >= 0.4) {
        insights.push(`They give away ${topGiven[0][0]}s frequently (${Math.round((topGiven[0][1] / totalGiven) * 100)}% of assets sent to you)`)
        drivers.push(`${topGiven[0][0]} seller`)
      }
      if (topReceived[0] && totalReceived > 0 && topReceived[0][1] / totalReceived >= 0.4) {
        insights.push(`They acquire ${topReceived[0][0]}s heavily (${Math.round((topReceived[0][1] / totalReceived) * 100)}% of what you send them)`)
        drivers.push(`${topReceived[0][0]} buyer`)
      }
      if (ps.picksGiven > ps.picksReceived + 1) { insights.push('Willing to include picks to sweeten deals'); drivers.push('Pick seller') }
      else if (ps.picksReceived > ps.picksGiven + 1) { insights.push('Prefers acquiring picks — likely rebuilding'); drivers.push('Pick hoarder') }
      if (ps.wins > ps.losses && ps.wins >= ps.trades / 2) { insights.push('You usually get the better grade against this partner'); drivers.push('Overpays in your deals') }
      else if (ps.losses > ps.wins && ps.losses >= ps.trades / 2) { insights.push('This partner usually gets the better grade'); drivers.push('Hard negotiator') }
      else { insights.push('Trades with this partner tend to grade even'); drivers.push('Fair trader') }
      const shareOf = (shape: string) => ps.tradeShapes.filter(s => s === shape).length / (ps.trades || 1)
      const dealShapes: string[] = []
      if (shareOf('consolidation') >= 0.5) dealShapes.push('Package 2-3 pieces for their stud — they prefer consolidation trades')
      if (shareOf('dispersion') >= 0.5) dealShapes.push('Offer a star for multiple assets — they like spreading value')
      if (topGiven[0] && topGiven[0][1] >= 2) dealShapes.push(`Target their ${topGiven[0][0]}s — they are willing to move that position`)
      if (ps.picksGiven > ps.picksReceived) dealShapes.push('Ask for pick sweeteners — they have included picks before')
      if (dealShapes.length === 0) dealShapes.push('Start with a fair 1-for-1 swap at a position of need', 'Consider including a mid-round pick to close value gaps')
      const styleScore = Math.round((Math.min(insights.length, 4) / 4) * 100 * Math.min(1, ps.trades / 5))
      return {
        score: Math.min(100, Math.max(10, styleScore)),
        label: styleScore >= 70 ? 'Strong Read' : styleScore >= 40 ? 'Partial Read' : 'Limited Data',
        insights,
        drivers,
        dealShapes: dealShapes.slice(0, 2),
      }
    }

    const partners = Object.values(partnerStats)
      .map(p => {
        const topShape = Object.entries(
          p.tradeShapes.reduce<Record<string, number>>((acc, s) => ((acc[s] = (acc[s] || 0) + 1), acc), {}),
        ).sort(([, a], [, b]) => b - a)[0]?.[0] || 'swap'
        return {
          name: p.name,
          trades: p.trades,
          netValue: p.netValue,
          avgGrade: meanLetter(p.letters)?.letter ?? null,
          avgPerTrade: p.trades > 0 ? Math.round(p.netValue / p.trades) : 0,
          weightedScore: p.netValue * Math.min(1, p.trades / 5),
          styleMatch: styleMatch(p),
          topShape,
        }
      })
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .map((p, idx) => ({ ...p, rank: idx + 1 }))
    const bestMark = partners[0]
    const nemesis = partners[partners.length - 1]

    // ── League-wide counts (who trades with whom). Counts only, no grade. ──────────────────────
    const managerTradeCount: Record<string, number> = {}
    const pairTradeCount: Record<string, { team1: string; team2: string; count: number }> = {}
    trades.forEach(trade => {
      trade.parties?.forEach(p => {
        const name = p.teamName || managers?.[p.userId] || p.userId || 'Unknown'
        managerTradeCount[name] = (managerTradeCount[name] || 0) + 1
      })
      if (trade.parties?.length === 2) {
        const t1 = trade.parties[0].teamName || managers?.[trade.parties[0].userId] || 'Team1'
        const t2 = trade.parties[1].teamName || managers?.[trade.parties[1].userId] || 'Team2'
        const key = [t1, t2].sort().join('|')
        ;(pairTradeCount[key] ??= { team1: t1, team2: t2, count: 0 }).count++
      }
    })
    const sortedManagers = Object.entries(managerTradeCount).sort(([, a], [, b]) => b - a)
    const theAddict = sortedManagers[0]
    const areTheyAlive = sortedManagers[sortedManagers.length - 1]
    const colluders = Object.values(pairTradeCount).sort((a, b) => b.count - a.count)[0]
    const allManagers = Object.keys(managerTradeCount)
    const tradedPairs = new Set(Object.keys(pairTradeCount))
    let frenemies: string[] | null = null
    for (let i = 0; i < allManagers.length && !frenemies; i++) {
      for (let j = i + 1; j < allManagers.length; j++) {
        const key = [allManagers[i], allManagers[j]].sort().join('|')
        if (!tradedPairs.has(key)) { frenemies = key.split('|'); break }
      }
    }

    // ── Awards, from the graded trades' own values and letters ─────────────────────────────────
    const metrics = graded.map(g => ({
      value: g.primary.net,
      marketShift: g.moments.now.net - g.moments.atTime.net,
      letter: g.primary.letter,
      isWin: outcomeOf(g.primary.letter) === 'win',
      opponentName: nameOf(partnerOf(g.trade)),
    }))
    const n = metrics.length
    const bestNegotiator = n >= 2 ? (() => {
      const byOpp: Record<string, { name: string; trades: number; wins: number; total: number }> = {}
      for (const m of metrics) {
        const o = (byOpp[m.opponentName] ??= { name: m.opponentName, trades: 0, wins: 0, total: 0 })
        o.trades++; o.total += m.value; if (m.isWin) o.wins++
      }
      const rows = Object.values(byOpp).filter(o => o.trades >= 2)
      const score = (trades: number, wins: number, total: number) => {
        const winRate = wins / trades
        const avgOverpay = Math.max(0, -(total / trades))
        return { winRate: Math.round(winRate * 100), avgOverpay: Math.round(avgOverpay), score: Math.round(winRate * (1 / (1 + avgOverpay / 500)) * 100) }
      }
      if (rows.length === 0) {
        return { name: sleeper_username, trades: n, ...score(n, metrics.filter(m => m.isWin).length, metrics.reduce((s, m) => s + m.value, 0)) }
      }
      return rows.map(o => ({ name: o.name, trades: o.trades, ...score(o.trades, o.wins, o.total) })).sort((a, b) => b.score - a.score)[0]!
    })() : null
    const marketSniper = n >= 2 ? (() => {
      const best = metrics.reduce((b, m) => (m.marketShift > b.marketShift ? m : b), metrics[0]!)
      return {
        name: sleeper_username, trades: n,
        avgShift: Math.round(metrics.reduce((s, m) => s + m.marketShift, 0) / n),
        bestShift: Math.round(best.marketShift), bestShiftOpponent: best.opponentName,
      }
    })() : null
    const riskKing = (() => {
      if (n < 2) return null
      const total = metrics.reduce((s, m) => s + m.value, 0)
      if (total <= 0) return null
      const mean = total / n
      const sd = Math.sqrt(metrics.reduce((s, m) => s + (m.value - mean) ** 2, 0) / n)
      return sd < 100 ? null : { name: sleeper_username, trades: n, volatility: Math.round(sd), netProfit: Math.round(total) }
    })()
    // "High confidence" read as the grade's strong band: an A or an F.
    const strong = metrics.filter(m => m.letter === 'A' || m.letter === 'F')
    const theFleecer = strong.length >= 2
      ? { name: sleeper_username, trades: n, avgFairnessDelta: Math.round(strong.reduce((s, m) => s + m.value, 0) / strong.length), highConfCount: strong.length }
      : null

    // ── Journey: cumulative league value received − sent, graded trades only ───────────────────
    const tradingJourney = [...graded]
      .sort((a, b) => a.trade.timestamp - b.trade.timestamp)
      .reduce((acc: Array<{ date: string; value: number; grade: string }>, g) => {
        const prev = acc[acc.length - 1]?.value ?? 0
        acc.push({
          date: new Date(g.trade.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
          value: prev + round(g.primary.net),
          grade: g.primary.letter,
        })
        return acc
      }, [])

    const tradeSummary = (g: (typeof graded)[number], value: number) => ({
      value,
      opponent: nameOf(partnerOf(g.trade)),
      date: new Date(g.trade.timestamp).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      gave: partnerOf(g.trade)?.playersReceived?.map(pl => pl.name) || [],
      received: meOf(g.trade)?.playersReceived?.map(pl => pl.name) || [],
    })
    const byNet = [...graded].sort((a, b) => b.primary.net - a.primary.net)
    const best = byNet[0]
    const worst = byNet[byNet.length - 1]

    const driverRows = (lines: readonly TradeGradeLine[], side: 'give' | 'get') =>
      lines.filter(l => l.side === side).map(l => ({
        name: l.name,
        type: l.assetKind ?? null,
        position: null,
        value: l.leagueValue,
        market: l.marketValue,
        // The league value is the impact the letter was taken on. No VORP or volatility exists on it.
        impact: l.leagueValue,
        vorp: null,
        volatility: null,
        source: l.valueSource ?? l.source ?? null,
      }))

    const allTrades = scored.map(({ trade, view, moments, primary }) => {
      const op = partnerOf(trade)
      const me = meOf(trade)
      const picks = (pks: LegacyCompletedTrade['parties'][number]['picksReceived'] | undefined) =>
        (pks ?? []).map(pk => ({ round: pk.round, season: pk.season, label: `${pk.season} Round ${pk.round}${pk.slot ? ` (${pk.slot})` : ''}` }))
      const players = (ps: LegacyCompletedTrade['parties'][number]['playersReceived'] | undefined) =>
        (ps ?? []).map(p => ({ id: p.id ?? null, name: p.name, position: p.position || null }))
      const receivedPlayers = players(me?.playersReceived)
      const gavePlayers = players(op?.playersReceived)
      const receivedPicks = picks(me?.picksReceived)
      const gavePicks = picks(op?.picksReceived)
      const marketShift = moments ? round(moments.now.net - moments.atTime.net) : null
      return {
        id: trade.transactionId,
        /** THE grade (the original, or today's in hindsight mode) — 'N/A' when withheld, as a failed grade always read. */
        grade: primary?.letter ?? 'N/A',
        result: primary ? outcomeOf(primary.letter) : 'withheld',
        gradeWithheld: view.graded ? null : view.reason,
        opponent: nameOf(op),
        date: new Date(trade.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }),
        timestamp: trade.timestamp,
        playersOut: gavePlayers.length + gavePicks.length,
        playersIn: receivedPlayers.length + receivedPicks.length,
        receivedPlayers,
        gavePlayers,
        receivedPicks,
        gavePicks,
        netValue: primary ? round(primary.net) : null,
        verdict: view.graded ? view.recommendation : `Not graded: ${view.reason}`,
        marketShift,
        controversyScore: marketShift != null ? Math.abs(marketShift) : 0,
        atTimeDelta: moments ? round(moments.atTime.net) : null,
        hindsightDelta: moments ? round(moments.now.net) : null,
        atTimeGrade: moments?.atTime.letter ?? 'N/A',
        hindsightGrade: moments?.now.letter ?? 'N/A',
        confidence: null,
        comparison: moments
          ? moments.now.letter === moments.atTime.letter
            ? `Graded ${moments.atTime.letter} originally and ${moments.now.letter} on today's values.`
            : `Graded ${moments.atTime.letter} originally; ${moments.now.letter} on today's values.`
          : `Not graded: ${withheldReason(view)}`,
        drivers: view.graded
          ? {
              received: driverRows(view.lines, 'get'),
              gave: driverRows(view.lines, 'give'),
              receivedTotal: round(view.getValue),
              gaveTotal: round(view.giveValue),
            }
          : { received: [], gave: [], receivedTotal: null, gaveTotal: null },
      }
    }).sort((a, b) => b.timestamp - a.timestamp)

    const response = {
      leagueId: league_id,
      username: sleeper_username,
      updatedAt: new Date().toISOString(),
      gradeSource: 'one_trade_engine' as const,
      gradedTrades: graded.length,
      withheldTrades: withheldCount,
      gradeCard: overall
        ? { grade: overall.letter, score: overall.score, label: TRADER_LABEL[overall.letter], gradeWithheld: null }
        : {
            grade: null,
            score: null,
            label: 'Not graded',
            gradeWithheld: firstWithheldReason(scored.map((s) => s.view)) ?? 'No trades of yours to grade in this league.',
          },
      tradingStats: {
        netValueGained: totalValueGained,
        wins: primaryStats.wins,
        losses: primaryStats.losses,
        even: primaryStats.even,
        winRate: primaryStats.winRate,
        avgPerTrade: graded.length > 0 ? Math.round(totalValueGained / graded.length) : 0,
        valueGiven,
        valueReceived,
        multiDimensional: {
          atTime: atTimeStats,
          hindsight: hindsightStats,
          // No lineup measurement exists for a completed trade on the one grade. Not a value/250 proxy.
          lineupImpact: null,
        },
      },
      tradingJourney,
      tradingPartners: {
        bestMark: bestMark ?? null,
        nemesis: nemesis ?? null,
        all: partners,
      },
      bestTrade: best ? tradeSummary(best, round(best.primary.net)) : null,
      worstTrade: worst && worst.primary.net < 0 ? tradeSummary(worst, Math.abs(round(worst.primary.net))) : null,
      leagueAwards: {
        theAddict: theAddict ? { name: theAddict[0], trades: theAddict[1] } : null,
        areTheyAlive: areTheyAlive ? { name: areTheyAlive[0], trades: areTheyAlive[1] } : null,
        colluders: colluders ? { team1: colluders.team1, team2: colluders.team2, trades: colluders.count } : null,
        frenemies: frenemies ? { team1: frenemies[0], team2: frenemies[1] } : null,
        bestNegotiator: bestNegotiator ? { ...bestNegotiator, method: 'AllFantasy grade win rate × efficiency (1/(1 + avgOverpay/500))' } : null,
        marketSniper: marketSniper ? { ...marketSniper, method: 'Avg (today’s league value gap − original gap) per graded trade' } : null,
        starterBuilder: null,
        riskKing: riskKing ? { ...riskKing, method: 'Highest spread of graded league-value gaps with a net positive total' } : null,
        theFleecer: theFleecer ? { ...theFleecer, method: 'Avg league-value gap on trades graded A or F' } : null,
      },
      allTrades,
    }

    if (sleeper_username) {
      logUserEventByUsername(sleeper_username, 'trade_analysis_completed', {
        leagueId: league_id,
        totalTrades: trades.length,
        userTrades: userTrades.length,
      })
    }

    // `reportCard` stays on the shape, null: its three lenses were the second engine's letters.
    return NextResponse.json({ ...response, reportCard: null })
  } catch (error) {
    console.error('Trade analytics error:', error)
    return NextResponse.json({ error: 'Failed to generate trade analytics' }, { status: 500 })
  }
})
