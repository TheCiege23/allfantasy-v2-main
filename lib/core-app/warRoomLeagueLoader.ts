import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveRostersForTeams } from '@/lib/leagues/rosterTeamIdentity'
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
import { buildFormatBrief, measureScarcity, type FormatBrief } from './warRoomFormat'
import { buildTradeMap } from './warRoomTradeMap'
import { buildWarChest, type WarChest, type WarChestRow } from './warRoomWarChest'
import { buildPlayoffReady, type PlayoffReady } from './warRoomPlayoffReady'
import { myRosterCandidates } from './myRoster'
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
  /** The war chest (phase 6, free): FAAB left, yours against every team's. Null when it could not be read. */
  warChest: WarChest | null
  /** Playoff readiness (phase 7, free): byes, injuries and depth for your playoff weeks. Null when it could not be built. */
  playoffReady: PlayoffReady | null
}

type FaabRead = { waiverType: string | null; budget: number | null; byTeam: Map<string, number | null> }

/**
 * Each team's stored FAAB balance, keyed by the outlook's roster id. The roster ↔ team match is the
 * shared identity rule (`resolveRostersForTeams`, the one Season Outlook's roster model uses), so a
 * team is matched here exactly when its players are matched there.
 */
async function readFaab(leagueId: string): Promise<FaabRead> {
  const [settings, teams, rosters] = await Promise.all([
    prisma.leagueWaiverSettings.findUnique({ where: { leagueId }, select: { waiverType: true, faabBudget: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { externalId: true, platformUserId: true, claimedByUserId: true },
    }),
    prisma.roster.findMany({
      where: { leagueId },
      select: { id: true, platformUserId: true, playerData: true, faabRemaining: true },
    }),
  ])
  const byTeam = new Map<string, number | null>()
  if (String(settings?.waiverType ?? '').toLowerCase() === 'faab') {
    const matched = resolveRostersForTeams(teams, rosters, (team) => myRosterCandidates(team, team.claimedByUserId ?? ''))
    for (const [rosterId, row] of matched) byTeam.set(rosterId, typeof row.faabRemaining === 'number' ? row.faabRemaining : null)
  }
  return { waiverType: settings?.waiverType ?? null, budget: settings?.faabBudget ?? null, byTeam }
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

  const [outlook, nextSeason, faab] = await Promise.all([
    getSeasonOutlook(userId, [league], league.id, args.now, args.allLeagues).catch((error: unknown) => {
      console.error('[core/war-room] league outlook failed', error)
      return null
    }),
    loadNextSeason({ userId, leagueId: league.id, format: args.format }).catch((error: unknown) => {
      console.error('[core/war-room] next-season plan failed', error)
      return null
    }),
    readFaab(league.id).catch((error: unknown) => {
      console.error('[core/war-room] war chest read failed', error)
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

  /* Phase 6: the trade map rides with the ideas — computed only when they are, so a locked viewer gets neither. */
  if (trades && model) {
    try {
      trades = { ...trades, map: buildTradeMap(model, format?.scarcity ?? measureScarcity(model)) }
    } catch (error) {
      console.error('[core/war-room] trade map failed', error)
    }
  }

  /* Phase 6: the war chest — one row per team on the board, its stored balance or unknown. */
  let warChest: WarChest | null = null
  if (faab && row) {
    const teams: WarChestRow[] = row.teams.map((t) => ({
      rosterId: t.rosterId,
      name: t.name,
      isYou: t.isYou,
      remaining: faab.byTeam.get(t.rosterId) ?? null,
    }))
    warChest = buildWarChest({
      waiverType: faab.waiverType,
      budget: faab.budget,
      teams,
      weeksRemaining: row.weeksRemaining,
      horizon: horizonOf(args.format),
      posture: postureOf(row),
    })
  }

  /* Phase 7, failing alone like the rest. */
  let playoffReady: PlayoffReady | null = null
  if (outlook) {
    try {
      playoffReady = buildPlayoffReady({
        model,
        row,
        posture: postureOf(row),
        playoffStartWeek: playoffStartWeek(league.settings),
        playoffTeams: row?.playoffTeams ?? null,
      })
    } catch (error) {
      console.error('[core/war-room] playoff readiness failed', error)
    }
  }

  return { leagueId: league.id, card, format, trades, nextSeason, campaign, warChest, playoffReady }
}
