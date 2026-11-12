import 'server-only'

import { buildDynastyWarRoomContext } from '@/lib/dynasty-war-room/dynastyWarRoomContext'
import { evaluateUserDynastyDirection } from '@/lib/dynasty-war-room/dynastyTeamDirectionEngine'
import { buildKeeperWarRoomContext } from '@/lib/keeper-war-room/keeperWarRoomContext'
import { recommendKeepers } from '@/lib/keeper-war-room/keeperRecommendationEngine'
import { buildKeeperDraftPlan } from '@/lib/keeper-war-room/keeperDraftPlanEngine'
import { extractScoringSettings } from '@/lib/projections/leagueScoring'
import { getSeasonOutlook, type LeagueInput } from './seasonOutlook'
import { BRANCH_ITERATIONS } from './seasonOutlookFocus'
import { pctOf, simulateSeason } from './outlookSim'
import { playoffStartWeek, tradeDeadlineWeek } from './seasonTimeline'
import { buildWarFront, horizonOf, postureOf, type WarFrontCard } from './warRoomFront'
import { buildWarTrades, type OddsRunner, type WarTradesView } from './warRoomTrades'
import { buildFormatBrief, type FormatBrief } from './warRoomFormat'
import { buildWarCampaign, type WarCampaign } from './warRoomCampaign'
import { dynastyView, keeperView, nextSeasonEngineFor, type NextSeasonView } from './warRoomNextSeason'

/**
 * The War Room's per-league strategy, for the league on screen: the format brief (phase 3), trades
 * that move your odds (phase 2) and the next-season plan (phase 3).
 *
 * ⚠ ONE OUTLOOK CALL FEEDS TWO SECTIONS. `getSeasonOutlook` with this league as the focus — the read
 * Season Outlook's league page and Your Week make — returns the stored seeded simulation plus the
 * roster model. The format brief measures scarcity from that model and the trade ideas price swaps
 * against it, so the two cannot be measuring different rosters. Nothing here fetches a provider.
 *
 * ⚠ THE PAYWALL GATES THE TRADES, NOT THE READ. The brief and the next-season plan are free; the
 * trade ideas are `trade_depth` (AF Pro), and a locked viewer's ideas are never computed — `trades`
 * is null and the screen draws the lock from the access alone.
 *
 * ⚠ EACH SECTION FAILS ALONE. A failed next-season engine costs that section; a failed outlook costs
 * the brief and the trades. Neither takes the other down.
 *
 * ⚠ THE BRANCH RUNS ARE THE OUTLOOK'S. Same `BRANCH_ITERATIONS`, same seed, one baseline — exactly how
 * Season Outlook prices its waiver moves (seasonOutlookFocus.ts).
 */

export type { WarTradesView }

export type WarLeagueStrategy = {
  leagueId: string
  /**
   * This league's card from The Front (warRoomFront.ts), built from the same outlook read — so the
   * league view's war plan (phase 4) carries the posture and odds the home showed. Null when the
   * outlook could not be read.
   */
  card: WarFrontCard | null
  /** Null when the outlook could not be read. */
  format: FormatBrief | null
  /** Null when locked (never computed) or when the outlook could not be read. */
  trades: WarTradesView | null
  /** Null when the engine threw; `kind: 'none'` when nothing carries over. */
  nextSeason: NextSeasonView | null
  /**
   * The road ahead (phase 5, free): each remaining game of yours priced both ways, and the tiebreak
   * picture. Null when the outlook or its roster model could not be read, or the pricing threw.
   */
  campaign: WarCampaign | null
}

async function loadNextSeason(args: { userId: string; leagueId: string; format: string | null }): Promise<NextSeasonView> {
  const engine = nextSeasonEngineFor(args.format)
  if (engine === 'none') return { kind: 'none', why: 'one_season', reason: null }
  if (engine === 'not_built') return { kind: 'none', why: 'unavailable', reason: null }
  if (engine === 'dynasty') {
    const r = await buildDynastyWarRoomContext({ leagueId: args.leagueId, userId: args.userId })
    if (!r.ok) return { kind: 'none', why: 'unavailable', reason: r.error }
    const d = evaluateUserDynastyDirection(r.context)
    return d ? dynastyView(d) : { kind: 'none', why: 'no_team', reason: null }
  }
  const r = await buildKeeperWarRoomContext({ leagueId: args.leagueId, userId: args.userId })
  if (!r.ok) return { kind: 'none', why: 'unavailable', reason: r.error }
  const rosterId = r.context.userRosterId
  if (!rosterId) return { kind: 'none', why: 'no_team', reason: null }
  return keeperView(
    recommendKeepers(r.context, rosterId),
    r.context.featureAvailability.draftPlan ? buildKeeperDraftPlan(r.context, rosterId) : null,
  )
}

export async function loadWarLeagueStrategy(args: {
  userId: string
  league: LeagueInput & { currentWeek?: number | null }
  /** Every played league, for the outlook's identity checks (as Your Week passes them). */
  allLeagues: LeagueInput[]
  /** `resolveLeagueCardTypeKey` for this league. */
  format: string | null
  /** `trade_depth` unlocked for this viewer. False: the trade ideas are not computed at all. */
  tradesUnlocked: boolean
  now: Date
}): Promise<WarLeagueStrategy> {
  const { userId, league } = args
  const tradeCenterHref = `/core/trades?league=${encodeURIComponent(league.id)}`

  const [outlook, nextSeason] = await Promise.all([
    getSeasonOutlook(userId, [league], league.id, args.now, args.allLeagues).catch((error: unknown) => {
      console.error('[core/war-room] league outlook failed', error)
      return null
    }),
    loadNextSeason({ userId, leagueId: league.id, format: args.format }).catch((error: unknown) => {
      console.error('[core/war-room] next-season plan failed', error)
      return null
    }),
  ])

  const row = outlook?.leagues.find((l) => l.leagueId === league.id) ?? null
  const model = row?.focus?.scenario ?? null
  const deadline = tradeDeadlineWeek(league.settings)

  const format: FormatBrief | null = outlook
    ? buildFormatBrief({
        model,
        scoringSettings: extractScoringSettings(league.settings) as Record<string, unknown> | null,
        playoffTeams: row?.playoffTeams ?? null,
        byeTeams: row?.byeTeams ?? null,
        playoffStartWeek: playoffStartWeek(league.settings),
        tradeDeadlineWeek: deadline,
        weeksRemaining: row?.weeksRemaining ?? null,
      })
    : null

  let trades: WarTradesView | null = null
  if (args.tradesUnlocked && outlook) {
    const posture = postureOf(row)
    if (!row || !model) {
      trades = {
        leagueId: league.id,
        posture,
        trades: { mode: 'none', why: posture === 'unplaced' ? 'unplaced' : 'not_priced', reason: null },
        tradeCenterHref,
      }
    } else {
      const week =
        typeof row.period === 'number' && row.period > 0
          ? row.period
          : typeof league.currentWeek === 'number' && league.currentWeek > 0
            ? league.currentWeek
            : null
      const you = model.youRosterId
      const odds: OddsRunner = (adjustments) => {
        if (!you) return null
        const t = simulateSeason(model.sim, { iterations: BRANCH_ITERATIONS, seed: model.seed, adjustments })
        const c = t.counts[you]
        return c ? { playoff: pctOf(c.playoff, t.iterations), title: pctOf(c.title, t.iterations) } : null
      }
      trades = {
        leagueId: league.id,
        posture,
        tradeCenterHref,
        trades: buildWarTrades({
          model,
          posture,
          horizon: horizonOf(args.format),
          sport: league.sport ?? null,
          deadlineOpen: deadline == null || week == null ? null : week <= deadline,
          deadlineWeek: deadline,
          teamPlayoffPct: new Map(row.teams.filter((t) => t.modelled && !t.isYou).map((t) => [t.rosterId, t.playoffPct])),
          odds,
        }),
      }
    }
  }

  const card: WarFrontCard | null = outlook
    ? (buildWarFront({
        outlook,
        leagues: [
          {
            id: league.id,
            name: String(league.name ?? 'League'),
            format: args.format,
            tradeDeadlineWeek: deadline,
            currentWeek: league.currentWeek ?? null,
          },
        ],
      }).cards[0] ?? null)
    : null

  /* Phase 5 fails alone, like every section here: a throw costs the road ahead and nothing else. */
  let campaign: WarCampaign | null = null
  if (row && model) {
    try {
      campaign = buildWarCampaign({ row, sim: model.sim, seed: model.seed, iterations: BRANCH_ITERATIONS })
    } catch (error) {
      console.error('[core/war-room] road ahead failed', error)
    }
  }

  return { leagueId: league.id, card, format, trades, nextSeason, campaign }
}
