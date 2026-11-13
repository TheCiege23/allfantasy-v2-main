import 'server-only'

import type { GradeInputs } from '@/lib/decision-os/trade/tradeGradeInputs'
import type { TradeGradeView } from '@/lib/decision-os/trade/tradeGrade'
import { leagueWeekFromSettings, playoffSpots, regularSeasonWeeks } from '@/lib/core-app/seasonTimeline'
import { assessContention, type ContentionState } from './contention'
import { suggestionGradeInputs } from './partnerSuggestionGrades'
import { buildRebuildPlan, type RebuildPlan, type RebuildRoster, type RebuildTrigger } from './rebuildAdvisor'
import { loadFutureLeans, type FutureLean } from './trajectory'

/**
 * The rebuild plan for the Trade Center (lib/trade-intel/rebuildAdvisor.ts), from what the rosters
 * route already holds: every roster priced, every record, the league's settings and the viewer's saved
 * strategy. The one read of its own is the dynasty/redraft spread for the players it judges.
 *
 * WHEN IT APPLIES. Dynasty and keeper leagues only — rebuilding means building for a next year, and a
 * redraft league has none (owner decision 2026-11-06). Then either the viewer is mathematically out of
 * the race (`assessContention` → `selling`, the one posture that is a fact rather than a judgement), or
 * they saved "rebuild" as their trade strategy. Otherwise null: nobody is told to rebuild uninvited.
 */

type RouteRoster = {
  rosterId: string
  ownerName: string | null
  wins: number
  losses: number
  ties: number
  players: Array<{ id: string; name: string; position: string | null; value: number | null }>
  picks: Array<{ pickId: string; label: string; value: number | null; season?: number | null; round?: number | null; fromTeam?: string | null }>
}

type RebuildPlanContext = {
  viewerRosterId: string
  rosters: readonly RouteRoster[]
  /** `dynasty` / `keeper` — anything else gets no plan. */
  leagueMode: string
  settings: unknown
  starterSlots: unknown
  /** The viewer's saved trade strategy, when they saved one. */
  savedStrategy: 'win-now' | 'balanced' | 'rebuild' | null
  qbFormat: 'ONE_QB' | 'SUPERFLEX'
}

type RebuildPlanDeps = {
  leans: (sleeperIds: string[], qbFormat: 'ONE_QB' | 'SUPERFLEX') => Promise<Map<string, FutureLean>>
}

const defaultDeps: RebuildPlanDeps = {
  leans: (sleeperIds, qbFormat) => loadFutureLeans({ sleeperIds, qbFormat }),
}

export async function loadRebuildPlan(ctx: RebuildPlanContext, deps: Partial<RebuildPlanDeps> = {}): Promise<RebuildPlan | null> {
  if (ctx.leagueMode !== 'dynasty' && ctx.leagueMode !== 'keeper') return null
  const d = { ...defaultDeps, ...deps }

  const standings = [...ctx.rosters]
    .sort((a, b) => b.wins + b.ties / 2 - (a.wins + a.ties / 2) || a.losses - b.losses)
    .map((r) => ({ teamId: r.rosterId, wins: r.wins, losses: r.losses, ties: r.ties }))
  const spots = playoffSpots(ctx.settings)
  const seasonWeeks = regularSeasonWeeks(ctx.settings)
  const currentWeek = leagueWeekFromSettings(ctx.settings)
  const posture = new Map<string, ContentionState | null>(
    ctx.rosters.map((r) => [r.rosterId, assessContention({ standings, teamId: r.rosterId, playoffSpots: spots, seasonWeeks, currentWeek })]),
  )

  const mine = posture.get(ctx.viewerRosterId) ?? null
  let trigger: RebuildTrigger
  let basis: string
  if (mine?.posture === 'selling') {
    trigger = 'eliminated'
    const where =
      mine.weeksRemaining != null && mine.weeksRemaining <= 0
        ? 'The regular season is over and you missed the playoffs'
        : mine.gamesBackOfLine != null && mine.weeksRemaining != null
          ? `You are ${mine.gamesBackOfLine} ${mine.gamesBackOfLine === 1 ? 'win' : 'wins'} back of the last playoff spot with ${mine.weeksRemaining} ${mine.weeksRemaining === 1 ? 'week' : 'weeks'} to play, so you cannot get there`
          : 'You are out of the playoff race'
    basis = `${where}. Trading for next year beats playing out the string.`
  } else if (ctx.savedStrategy === 'rebuild') {
    trigger = 'strategy'
    basis = 'You set your trade strategy to rebuild.'
  } else {
    return null
  }

  const ids = [...new Set(ctx.rosters.flatMap((r) => r.players.map((p) => p.id)))]
  const leans = await d.leans(ids, ctx.qbFormat).catch(() => new Map<string, FutureLean>())

  const rosters: RebuildRoster[] = ctx.rosters.map((r) => ({
    rosterId: r.rosterId,
    ownerName: r.ownerName,
    posture: posture.get(r.rosterId)?.posture ?? null,
    players: r.players.map((p) => {
      const lean = leans.get(p.id)
      return { id: p.id, name: p.name, position: p.position, value: p.value, lean: lean?.direction ?? null, leanRatio: lean?.ratio ?? null }
    }),
    // A pick with a `fromTeam` came from someone else; its standing, not this team's, decides where it lands.
    picks: r.picks.map((p) => ({ pickId: p.pickId, label: p.label, value: p.value, originalRosterId: p.fromTeam ? `from:${p.fromTeam}` : r.rosterId })),
  }))

  return buildRebuildPlan({ viewerRosterId: ctx.viewerRosterId, rosters, starterSlots: ctx.starterSlots, trigger, basis })
}

/**
 * Grade each package with the league's trade grader, the same one the partner suggestions and the
 * builder use, so a package and the same deal loaded into the builder cannot disagree. Failure-contained:
 * an ungraded package keeps its value band, which is already inside the fair range.
 */
export async function gradeRebuildPackages(
  plan: RebuildPlan,
  picks: ReadonlyMap<string, { season: number | null; round: number | null; label: string }>,
  grade: (give: GradeInputs, get: GradeInputs) => Promise<TradeGradeView>,
): Promise<void> {
  await Promise.all(
    plan.packages.map(async (pkg) => {
      try {
        const g = await grade(suggestionGradeInputs(pkg.give, picks), suggestionGradeInputs(pkg.get, picks))
        pkg.grade = g.graded
          ? { graded: true, letter: g.letter, partnerLetter: g.partnerLetter, label: g.label, giveValue: g.giveValue, getValue: g.getValue }
          : { graded: false, reason: g.reason }
      } catch {
        pkg.grade = null
      }
    }),
  )
}
