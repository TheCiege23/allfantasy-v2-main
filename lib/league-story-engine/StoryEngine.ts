/**
 * League Story Engine — select story type from context and build narrative.
 */

import type { LeagueStoryContext, LeagueStoryPayload, LeagueStoryType } from './types'
import { STORY_TITLES, STORY_TEMPLATES, fillTemplate } from './templates'

function selectStoryType(ctx: LeagueStoryContext): LeagueStoryType {
  const { standings = [], matchups = [] } = ctx

  if (matchups.length > 0) {
    const closest = matchups.reduce(
      (best, m) => {
        const margin = m.projectedMargin ?? (m.score1 != null && m.score2 != null ? Math.abs(m.score1 - m.score2) : null)
        if (margin == null) return best
        if (best.margin == null || margin < best.margin) return { margin, matchup: m }
        return best
      },
      { margin: null as number | null, matchup: null as (typeof matchups)[0] | null }
    )
    if (closest.margin != null && closest.margin < 8) return 'closest_matchup'

    const sorted = [...standings].sort((a, b) => (b.pointsFor ?? 0) - (a.pointsFor ?? 0))
    const top = sorted[0]
    const underdogMatch = matchups.find((m) => {
      const topInMatch = top && (m.team1 === top.name || m.team2 === top.name)
      return topInMatch
    })
    if (underdogMatch && top) {
      const other = underdogMatch.team1 === top.name ? underdogMatch.team2 : underdogMatch.team1
      const otherStanding = standings.find((s) => s.name === other)
      if (otherStanding && (otherStanding.rank ?? otherStanding.wins) > (top.rank ?? 0) + 2) return 'underdog_story'
    }
  }

  if (standings.length >= 2) {
    const byWins = [...standings].sort((a, b) => b.wins - a.wins)
    const first = byWins[0]
    const second = byWins[1]
    if (first && second && first.wins - second.wins >= 3) return 'dominant_team'

    const byPF = [...standings].sort((a, b) => (b.pointsFor ?? 0) - (a.pointsFor ?? 0))
    if (byPF[0] && byPF[1] && (byPF[0].pointsFor ?? 0) - (byPF[1].pointsFor ?? 0) > 100) return 'dominant_team'
  }

  if (matchups.length > 0) {
    const m = matchups[0]
    if (m) return 'rivalry_spotlight'
  }

  if (standings.length >= 1) {
    const mid = standings.filter((s) => s.wins >= 2 && s.wins <= (standings.length > 6 ? 4 : 3))
    if (mid.length > 0) return 'comeback_trajectory'
  }

  return 'league_spotlight'
}

export function buildStoryPayload(
  ctx: LeagueStoryContext,
  options?: { storyType?: LeagueStoryType; customTitle?: string; customNarrative?: string }
): LeagueStoryPayload {
  const storyType = options?.storyType ?? selectStoryType(ctx)
  const title = options?.customTitle ?? STORY_TITLES[storyType]
  const template = STORY_TEMPLATES[storyType]

  const vars: Record<string, string | number | undefined> = {
    leagueName: ctx.leagueName,
    week: ctx.week,
    team1: '',
    team2: '',
    teamName: '',
    highlight: '',
  }

  if (ctx.matchups?.length) {
    const m = ctx.matchups[0]
    if (m) {
      vars.team1 = m.team1
      vars.team2 = m.team2
      vars.highlight = `${m.team1} vs ${m.team2}`
    }
  }
  if (ctx.standings?.length) {
    const first = [...ctx.standings].sort((a, b) => b.wins - a.wins)[0]
    if (first) vars.teamName = first.name
  }

  const narrative =
    options?.customNarrative ?? fillTemplate(template, vars)

  return {
    storyType,
    title,
    narrative,
    leagueId: ctx.leagueId,
    leagueName: ctx.leagueName,
    week: ctx.week,
    season: ctx.season,
    sport: ctx.sport,
    highlight: vars.highlight ? String(vars.highlight) : undefined,
  }
}
