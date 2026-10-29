import 'server-only'

import { prisma } from '@/lib/prisma'
import { loadOutlookInputs, type LeagueInput } from '@/lib/core-app/seasonOutlook'
import { readDraftOrderRule } from '@/lib/core-app/standingsDraftOrder'
import { buildEligibleTeamsWithOdds, selectEligibleTeams, type StandingsRow } from '@/lib/draft-lottery/standingsForLottery'
import { getGuillotineConfig, isGuillotineLeague } from '@/lib/guillotine/GuillotineLeagueConfig'
import { findViewerRosterId, resolveGuillotineCurrentWeek } from '@/lib/guillotine/guillotineCurrentWeek'
import { resolveRosterDisplayNames } from '@/lib/guillotine/rosterDisplayNames'
import { seedFromString } from '@/lib/core-app/outlookSim'
import { chopProfile, firstPickOdds, simulateChop, type PickRuleKind, type RunRow } from './odds'

/**
 * Scenario explainer — reads. Odds in ./odds.
 *
 * DB-first and model-first: the #1 pick re-plays Season Outlook's own simulation input
 * (`loadOutlookInputs`, the same rows, schedule, fitted team scoring and seed), so it can never
 * disagree with the playoff odds on the same screen. The guillotine reads `guillotine_period_scores`,
 * the scores the chop itself is decided on.
 */

const PICK_ITERATIONS = 4000
const CHOP_ITERATIONS = 5000

export type FirstPickExplainer =
  | { supported: false; reason: 'no_order_rule' | 'no_model' | 'not_found' }
  | {
      supported: true
      rule: PickRuleKind
      ruleText: string
      you: { name: string; firstPickPct: number; worstPct: number; missPlayoffsPct: number } | null
      leaders: Array<{ name: string; isYou: boolean; firstPickPct: number }>
      basis: string
    }

export type ChopExplainer =
  | { supported: false; reason: 'no_scores' | 'season_over' | 'not_found' }
  | {
      supported: true
      week: number
      teamsPerChop: number
      chopWeeks: number
      you: { name: string; surviveWeekPct: number; surviveAllPct: number; expectedChopsSurvived: number; safeScore: { p50: number; p80: number; p95: number } | null; chopped: boolean } | null
      table: Array<{ name: string; isYou: boolean; surviveWeekPct: number; surviveAllPct: number }>
      basis: string
    }

export type ScenarioExplainer = { kind: 'h2h'; firstPick: FirstPickExplainer } | { kind: 'guillotine'; chop: ChopExplainer }

const RULE_TEXT: Record<PickRuleKind, string> = {
  lottery: 'A weighted lottery decides the top of the draft, among the teams outside the playoffs.',
  reverse_standings: 'The worst record outside the playoffs picks first — the league’s rule.',
  lowest_points: 'The fewest points for outside the playoffs picks first — the league’s rule.',
}

export async function readScenarios(leagueId: string, userId: string): Promise<ScenarioExplainer | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, name: true, platform: true, platformLeagueId: true, settings: true, sport: true, leagueType: true },
  })
  if (!league) return null
  if (await isGuillotineLeague(leagueId)) return { kind: 'guillotine', chop: await readChop(leagueId, userId) }
  return { kind: 'h2h', firstPick: await readFirstPick(league, userId) }
}

async function readFirstPick(
  league: { id: string; name: string | null; platform: string | null; platformLeagueId: string | null; settings: unknown; sport: unknown; leagueType: string | null },
  userId: string,
): Promise<FirstPickExplainer> {
  const rule = await readDraftOrderRule(league)
  if (!rule) return { supported: false, reason: 'no_order_rule' }

  const input: LeagueInput = {
    id: league.id,
    name: league.name,
    platform: String(league.platform ?? ''),
    platformLeagueId: league.platformLeagueId,
    settings: league.settings,
    sport: league.sport ? String(league.sport) : null,
    leagueType: league.leagueType,
  }
  const inputs = await loadOutlookInputs(userId, [input])
  const p = inputs?.prepared.find((x) => x.league.id === league.id)
  if (!inputs || !p) return { supported: false, reason: 'no_model' }

  const lottery =
    rule.kind === 'lottery'
      ? (rows: RunRow[], playoffTeams: number) => {
          const standings: StandingsRow[] = rows.map((r, i) => ({ ...r, displayName: r.rosterId, teamIndex: i, maxPf: r.pointsFor }))
          const eligible = selectEligibleTeams(standings, rule.config.eligibilityMode, rule.config.lotteryTeamCount, playoffTeams)
          return new Map(buildEligibleTeamsWithOdds(eligible, rule.config.weightingMode).map((e) => [e.rosterId, e.oddsPercent / 100]))
        }
      : undefined
  const odds = firstPickOdds(p.sim, rule.kind, { iterations: PICK_ITERATIONS, seed: p.seed, lottery })

  const nameOf = (rosterId: string) => inputs.nameByRoster.get(`${p.pid}:${rosterId}`) ?? `Team ${rosterId}`
  const isYou = (rosterId: string) => inputs.myRosters.has(`${p.pid}:${rosterId}`)
  const mine = [...odds.keys()].find(isYou)
  const leaders = [...odds.entries()]
    .filter(([, o]) => o.firstPickPct > 0)
    .sort((a, b) => b[1].firstPickPct - a[1].firstPickPct)
    .slice(0, 5)
    .map(([id, o]) => ({ name: nameOf(id), isYou: isYou(id), firstPickPct: o.firstPickPct }))
  return {
    supported: true,
    rule: rule.kind,
    ruleText: RULE_TEXT[rule.kind],
    you: mine ? { name: nameOf(mine), ...odds.get(mine)! } : null,
    leaders,
    basis: `${PICK_ITERATIONS.toLocaleString()} simulated seasons — the same remaining schedule, team scoring and playoff field Season Outlook uses — with this league's draft-order rule applied to each final table.`,
  }
}

async function readChop(leagueId: string, userId: string): Promise<ChopExplainer> {
  const config = await getGuillotineConfig(leagueId)
  if (!config) return { supported: false, reason: 'not_found' }
  const [week, myRosterId, chopped, rosters, scores] = await Promise.all([
    resolveGuillotineCurrentWeek(leagueId, config),
    findViewerRosterId(leagueId, userId).catch(() => null),
    prisma.guillotineRosterState.findMany({ where: { leagueId, choppedAt: { not: null } }, select: { rosterId: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true } }),
    prisma.guillotinePeriodScore.findMany({ where: { leagueId }, select: { rosterId: true, weekOrPeriod: true, periodPoints: true } }),
  ])
  const choppedSet = new Set(chopped.map((c) => c.rosterId))
  const finished = scores.filter((s) => s.weekOrPeriod < week)
  if (finished.length === 0) return { supported: false, reason: 'no_scores' }

  const all = finished.map((s) => s.periodPoints)
  const leagueMu = all.reduce((a, b) => a + b, 0) / all.length
  const leagueSigma = Math.max(1, Math.sqrt(all.reduce((a, b) => a + (b - leagueMu) ** 2, 0) / Math.max(1, all.length - 1)))
  const byRoster = new Map<string, number[]>()
  for (const s of finished) byRoster.set(s.rosterId, [...(byRoster.get(s.rosterId) ?? []), s.periodPoints])

  const alive = rosters.map((r) => r.id).filter((id) => !choppedSet.has(id))
  if (alive.length <= config.teamsPerChop) return { supported: false, reason: 'season_over' }
  const lastChopWeek = config.eliminationEndWeek ?? week + Math.ceil(alive.length / Math.max(1, config.teamsPerChop))
  const chopWeeks = Math.max(0, lastChopWeek - Math.max(week, config.eliminationStartWeek) + 1)
  if (chopWeeks === 0) return { supported: false, reason: 'season_over' }

  const teams = alive.map((id) => ({ rosterId: id, ...chopProfile(byRoster.get(id) ?? [], { mu: leagueMu, sigma: leagueSigma }) }))
  const sim = simulateChop(teams, { chopWeeks, teamsPerChop: config.teamsPerChop, iterations: CHOP_ITERATIONS, seed: seedFromString(`${leagueId}:${week}`) })
  const names = await resolveRosterDisplayNames(leagueId, alive)
  const nameOf = (id: string) => names.get(id) ?? 'A team'

  const youAlive = myRosterId != null && alive.includes(myRosterId)
  const you = myRosterId
    ? youAlive
      ? { name: nameOf(myRosterId), ...sim.odds.get(myRosterId)!, safeScore: sim.safeScore.get(myRosterId) ?? null, chopped: false }
      : { name: names.get(myRosterId) ?? 'Your team', surviveWeekPct: 0, surviveAllPct: 0, expectedChopsSurvived: 0, safeScore: null, chopped: true }
    : null
  return {
    supported: true,
    week,
    teamsPerChop: config.teamsPerChop,
    chopWeeks: sim.chopWeeks,
    you,
    table: alive
      .map((id) => ({ name: nameOf(id), isYou: id === myRosterId, surviveWeekPct: sim.odds.get(id)!.surviveWeekPct, surviveAllPct: sim.odds.get(id)!.surviveAllPct }))
      .sort((a, b) => a.surviveWeekPct - b.surviveWeekPct),
    basis: `${CHOP_ITERATIONS.toLocaleString()} simulated runs of the remaining chops. Each team scores around its own weekly average from this season's chop scores (blended toward the league average while it has few weeks), and the lowest ${config.teamsPerChop === 1 ? 'score is' : `${config.teamsPerChop} scores are`} cut each week. Lineup changes, injuries and byes are not modelled.`,
  }
}
