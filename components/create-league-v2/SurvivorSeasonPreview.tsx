'use client'

import type { CreateLeagueV2State } from '@/lib/create-league-v2/state'
import { getEffectiveLeagueType } from '@/lib/create-league-v2/state'
import { resolveLeagueCreationSeason } from '@/lib/season-week/leagueCreationSeason'
import { buildSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { toUtc } from '@/lib/timezone'

/** The same calendar calculation that validates and persists POST /api/leagues. */
export function SurvivorSeasonPreview({ state }: { state: CreateLeagueV2State }) {
  if (getEffectiveLeagueType(state) !== 'survivor' || state.sport !== 'NBA') return null
  try {
    const draftAt = state.draftDate && state.draftTime ? toUtc(state.draftDate, state.draftTime, state.timezone || 'America/New_York') : undefined
    const plan = buildSurvivorFullSeasonPlan({ sport: state.sport, season: resolveLeagueCreationSeason(state.sport), castSize: state.teamCount, draftAt, exileEnabled: true })
    return <section className="rounded-xl border border-cyan-400/20 bg-cyan-400/5 p-4" aria-label="Survivor season calendar">
      <h3 className="text-sm font-semibold text-cyan-200">Planned NBA Survivor season</h3>
      <p className="mt-2 text-sm text-white/75">{plan.sport} {plan.season}–{String(plan.season + 1).slice(-2)} · Weeks {plan.startWeek}–{plan.endWeek} · {plan.castSize} managers.</p>
      <p className="mt-2 text-sm text-white/65">Week {plan.openingWeek} opens with readiness and practice. {plan.eliminationWeeks.length} elimination periods are spaced across the season, with the Final 3 finale in week {plan.finaleWeek}. Daily games use the sport’s scoring calendar.</p>
      <p className="mt-2 text-sm text-white/65">Exile is enabled by default. One highest-qualifying token holder can return in week {plan.exileReturnWeek}.</p>
      <p className="mt-2 text-sm text-white/65">Weekly tribe and individual slate challenges use finalized fantasy scores. If a council has no valid votes or the top vote is tied, the lowest-scoring eligible manager is eliminated; an exact score tie uses a reproducible draw. Chimmy reveals the result at the Torch Ceremony.</p>
      <p className="mt-2 text-xs text-amber-200">Native beta: unattended season play remains in release testing, including Exile nonappearance scoring and the complete jury/finale replay.</p>
    </section>
  } catch (error) {
    return <p role="alert" className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-4 text-sm text-amber-200">{error instanceof Error ? error.message : 'Review the Survivor season calendar before creating this league.'}</p>
  }
}
