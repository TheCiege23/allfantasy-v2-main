/**
 * The body `/api/rankings/dynasty-roadmap` takes, built from one team's `/api/rankings/league-v2` row.
 *
 * Both rankings screens send it from the browser, under the viewer's own session: the endpoint is
 * session- and plan-gated (`ai_planning_3_5_year`) and rate-limited per user, so a server-side caller
 * with no session cannot reach it. That is why the old power-rankings BullMQ job never could.
 *
 * Pure: no fetch, no React. The roster is summarised by position group, not by player — the league-v2
 * row carries per-position totals, which is all the roadmap prompt reads.
 */

export type DynastyRoadmapTeamInput = {
  composite: number
  totalRosterValue?: number | null
  positionValues?: Record<string, { total?: number | null } | undefined> | null
  rosterExposure?: Record<string, number | undefined> | null
  portfolioProjection?: { year1: number; year3: number; year5: number } | null
}

export type DynastyRoadmapLeagueInput = {
  sport?: string | null
  isDynasty?: boolean | null
  isSuperFlex?: boolean | null
  leagueName?: string | null
}

export type DynastyRoadmapRequestBody = {
  sport?: string
  leagueType: 'Dynasty' | 'Redraft'
  isSF: boolean
  goal: 'compete' | 'rebuild'
  rosterSignals: Array<{
    position: string
    playerName: string
    age: null
    marketValue: number
    impactScore: number
    trend30Day: number
  }>
  avgAge: number
  totalValue: number
  positionStrengths: Record<string, number>
  weakPositions: string[]
  topAssets: string[]
  leagueName?: string
}

/** A position group scoring under this share of the team's strongest group is called weak. */
const WEAK_POSITION_BELOW = 40
/** A composite at or above this asks for a "compete" plan; below it, "rebuild". */
const COMPETE_AT_COMPOSITE = 60

export function buildDynastyRoadmapRequest(
  team: DynastyRoadmapTeamInput,
  league: DynastyRoadmapLeagueInput,
): DynastyRoadmapRequestBody {
  const positionValues = team.positionValues ?? {}
  const exposure = team.rosterExposure ?? {}
  const positions = Object.keys(positionValues)
  const totalOf = (position: string) => positionValues[position]?.total ?? 0
  const maxTotal = Math.max(1, ...positions.map(totalOf))

  const positionStrengths: Record<string, number> = {}
  const weakPositions: string[] = []
  for (const position of positions) {
    const score = Math.round((totalOf(position) / maxTotal) * 100)
    positionStrengths[position] = score
    if (score < WEAK_POSITION_BELOW) weakPositions.push(position)
  }

  const topAssets = [...positions]
    .sort((a, b) => totalOf(b) - totalOf(a))
    .slice(0, 3)
    .map((position) => `${position} group (${(exposure[position] ?? 0).toFixed(0)}% exposure)`)

  const rosterSignals = positions.map((position) => ({
    position,
    playerName: `${position} group`,
    age: null,
    marketValue: totalOf(position),
    impactScore: positionStrengths[position] ?? 50,
    trend30Day: 0,
  }))

  // The roster's age is not on the row; the projection's slope stands in for it — a portfolio that
  // holds value five years out reads young, one that falls off reads old.
  const projection = team.portfolioProjection ?? { year1: 50, year3: 45, year5: 40 }
  const avgAge = projection.year5 >= projection.year1 ? 23 : projection.year5 < 30 ? 28 : 30

  return {
    ...(league.sport ? { sport: league.sport } : {}),
    leagueType: league.isDynasty ? 'Dynasty' : 'Redraft',
    isSF: league.isSuperFlex ?? false,
    goal: team.composite >= COMPETE_AT_COMPOSITE ? 'compete' : 'rebuild',
    rosterSignals,
    avgAge,
    totalValue: team.totalRosterValue ?? 0,
    positionStrengths,
    weakPositions,
    topAssets,
    ...(league.leagueName ? { leagueName: league.leagueName } : {}),
  }
}
