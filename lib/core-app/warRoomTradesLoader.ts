import 'server-only'

import { getSeasonOutlook, type LeagueInput } from './seasonOutlook'
import { BRANCH_ITERATIONS } from './seasonOutlookFocus'
import { pctOf, simulateSeason } from './outlookSim'
import { tradeDeadlineWeek } from './seasonTimeline'
import { horizonOf, postureOf } from './warRoomFront'
import { buildWarTrades, type OddsRunner, type WarTradesView } from './warRoomTrades'

/**
 * Trade ideas for the league on screen in the War Room (warRoomTrades.ts holds the rules).
 *
 * ⚠ ONE OUTLOOK CALL, THE ONE SEASON OUTLOOK'S LEAGUE PAGE MAKES. `getSeasonOutlook` with this league
 * as the focus returns the stored seeded simulation plus the roster model (`focus.scenario`) — the
 * same read `/core/season-outlook?league=` and Your Week make, so its odds and the Front's agree.
 * Nothing here fetches a provider: the roster model is DB-backed (`loadScenarioModel`).
 *
 * ⚠ THE BRANCH RUNS ARE THE OUTLOOK'S. Same `BRANCH_ITERATIONS`, same seed, one baseline, one input
 * changed per idea — exactly how Season Outlook prices its waiver moves (seasonOutlookFocus.ts), so a
 * "+4.1 playoff odds" here and there are the same kind of number.
 *
 * Returns null when the outlook read fails; the screen then shows nothing rather than a false "no ideas".
 */

export type { WarTradesView }

export async function loadWarTrades(args: {
  userId: string
  league: LeagueInput & { currentWeek?: number | null }
  /** Every played league, for the outlook's identity checks (as Your Week passes them). */
  allLeagues: LeagueInput[]
  /** `resolveLeagueCardTypeKey` for this league. */
  format: string | null
  now: Date
}): Promise<WarTradesView | null> {
  const { userId, league } = args
  const outlook = await getSeasonOutlook(userId, [league], league.id, args.now, args.allLeagues)
  const row = outlook.leagues.find((l) => l.leagueId === league.id) ?? null
  const posture = postureOf(row)
  const model = row?.focus?.scenario ?? null
  const tradeCenterHref = `/core/trades?league=${encodeURIComponent(league.id)}`
  if (!row || !model) {
    return { leagueId: league.id, posture, trades: { mode: 'none', why: posture === 'unplaced' ? 'unplaced' : 'not_priced', reason: null }, tradeCenterHref }
  }

  const deadline = tradeDeadlineWeek(league.settings)
  const week =
    typeof row.period === 'number' && row.period > 0
      ? row.period
      : typeof league.currentWeek === 'number' && league.currentWeek > 0
        ? league.currentWeek
        : null
  const deadlineOpen = deadline == null || week == null ? null : week <= deadline

  const you = model.youRosterId
  const odds: OddsRunner = (adjustments) => {
    if (!you) return null
    const t = simulateSeason(model.sim, { iterations: BRANCH_ITERATIONS, seed: model.seed, adjustments })
    const c = t.counts[you]
    return c ? { playoff: pctOf(c.playoff, t.iterations), title: pctOf(c.title, t.iterations) } : null
  }

  const trades = buildWarTrades({
    model,
    posture,
    horizon: horizonOf(args.format),
    sport: league.sport ?? null,
    deadlineOpen,
    deadlineWeek: deadline,
    teamPlayoffPct: new Map(row.teams.filter((t) => t.modelled && !t.isYou).map((t) => [t.rosterId, t.playoffPct])),
    odds,
  })
  return { leagueId: league.id, posture, trades, tradeCenterHref }
}
