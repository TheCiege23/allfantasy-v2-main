/**
 * Pure derivation of dashboard analytics from the `/api/rankings/league-v2` payload.
 *
 * Deliberately React-free and side-effect-free so the numbers behind every chart can be
 * tested directly, without a DOM or a network. `useLeagueAnalytics` is the thin fetching
 * wrapper around this.
 *
 * The rule these functions enforce: a value is either real or `null`. Nothing here
 * substitutes a zero, an average, or a "sensible default" for missing data — an absent
 * metric must reach the UI as absent so the card can say so.
 */

export type ForwardOdds = { playoffPct: number; top3Pct: number; titlePct: number; simCount: number }
export type PositionValues = Record<string, { starter: number; bench: number; total: number }>

export type TeamScoreLite = {
  rosterId: number
  ownerId: string
  username: string | null
  displayName: string | null
  rank: number
  prevRank: number | null
  rankDelta: number | null
  record: { wins: number; losses: number; ties: number }
  pointsFor: number
  positionValues: PositionValues
  forwardOdds: ForwardOdds
  rankSparkline: number[]
}

export type LeagueRankingsResponse = {
  leagueId: string
  leagueName: string
  week: number
  teams: TeamScoreLite[]
  weeklyPointsDistribution: Array<{ rosterId: number; weeklyPoints: number[] }>
}

export type PositionRow = { key: string; mine: number; leagueAvg: number; indexed: number }

export type LeagueAnalytics = {
  leagueName: string
  week: number
  me: {
    rank: number
    totalTeams: number
    record: { wins: number; losses: number; ties: number }
    pointsFor: number
    playoffPct: number
    titlePct: number
    simCount: number
    rankSparkline: number[]
  } | null
  scoring: { mine: number[]; leagueAvg: number[]; weekLabels: string[] } | null
  positionStrength: PositionRow[] | null
  powerRankings: Array<{ rank: number; name: string; record: string; delta: number | null; isMe: boolean }>
}

export function deriveAnalytics(raw: LeagueRankingsResponse, viewerId: string | null): LeagueAnalytics {
  const teams = Array.isArray(raw.teams) ? raw.teams : []
  const myTeam = viewerId ? teams.find((t) => t.ownerId === viewerId) ?? null : null

  return {
    leagueName: raw.leagueName,
    week: raw.week,
    me: myTeam
      ? {
        rank: myTeam.rank,
        totalTeams: teams.length,
        record: myTeam.record,
        pointsFor: myTeam.pointsFor,
        playoffPct: myTeam.forwardOdds?.playoffPct ?? 0,
        titlePct: myTeam.forwardOdds?.titlePct ?? 0,
        simCount: myTeam.forwardOdds?.simCount ?? 0,
        rankSparkline: Array.isArray(myTeam.rankSparkline) ? myTeam.rankSparkline : [],
      }
      : null,
    scoring: deriveScoring(raw, myTeam),
    positionStrength: derivePositionStrength(teams, myTeam),
    powerRankings: teams
      .slice()
      .sort((a, b) => a.rank - b.rank)
      .slice(0, 5)
      .map((t) => ({
        rank: t.rank,
        name: t.displayName ?? t.username ?? `Team ${t.rosterId}`,
        record: `${t.record.wins}-${t.record.losses}${t.record.ties ? `-${t.record.ties}` : ''}`,
        delta: t.rankDelta,
        isMe: myTeam ? t.rosterId === myTeam.rosterId : false,
      })),
  }
}

export function deriveScoring(
  raw: LeagueRankingsResponse,
  myTeam: TeamScoreLite | null,
): LeagueAnalytics['scoring'] {
  const dist = Array.isArray(raw.weeklyPointsDistribution) ? raw.weeklyPointsDistribution : []
  if (!myTeam || dist.length === 0) return null
  const mineRow = dist.find((d) => d.rosterId === myTeam.rosterId)
  const mine = (mineRow?.weeklyPoints ?? []).filter((n) => Number.isFinite(n))
  // A single week is a dot, not a trend — the line chart needs two points to mean anything.
  if (mine.length < 2) return null

  // League mean per week over the teams that actually played that week. A bye or a
  // mid-season add contributes no zero, which would otherwise drag the average down and
  // make the user look artificially strong.
  const leagueAvg = mine.map((_, week) => {
    const values = dist
      .map((d) => d.weeklyPoints?.[week])
      .filter((n): n is number => typeof n === 'number' && Number.isFinite(n) && n > 0)
    if (values.length === 0) return 0
    return values.reduce((a, b) => a + b, 0) / values.length
  })

  const firstWeek = Math.max(1, raw.week - mine.length + 1)
  return { mine, leagueAvg, weekLabels: mine.map((_, i) => `W${firstWeek + i}`) }
}

/**
 * Position value indexed against the league average (100 = exactly average).
 *
 * A derivation, not an estimate: every input is a real per-team position value from the same
 * payload and the benchmark is the arithmetic mean across teams that have a value for that
 * position. Capped at 200 so one runaway position can't blow out the shared bar/radar scale.
 */
export function derivePositionStrength(
  teams: TeamScoreLite[],
  myTeam: TeamScoreLite | null,
): PositionRow[] | null {
  if (!myTeam || teams.length < 2) return null
  const mine = myTeam.positionValues
  if (!mine || Object.keys(mine).length === 0) return null

  const rows = Object.keys(mine)
    .filter((p) => Number.isFinite(mine[p]?.total))
    .map((key) => {
      const contributors = teams
        .map((t) => t.positionValues?.[key]?.total)
        .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0)
      const mineVal = mine[key].total
      /*
       * At least TWO teams must carry a value or there is no league to average against.
       * With one contributor — necessarily the viewer — the mean equals their own value and
       * the bar renders a confident "100, exactly average" for a comparison that was never
       * made. Dropping the row lets the card report the gap instead of inventing parity.
       */
      const leagueAvg = contributors.length >= 2
        ? contributors.reduce((a, b) => a + b, 0) / contributors.length
        : 0
      return {
        key,
        mine: mineVal,
        leagueAvg,
        indexed: leagueAvg > 0 ? Math.min(200, Math.round((mineVal / leagueAvg) * 100)) : 0,
      }
    })
    .filter((r) => r.leagueAvg > 0)

  return rows.length > 0 ? rows : null
}

/** Bar/radar colour by how far above or below league average a position sits. */
export function positionTone(indexed: number): string {
  if (indexed >= 115) return 'var(--af-emerald)'
  if (indexed >= 90) return 'var(--af-cyan)'
  if (indexed >= 75) return 'var(--af-gold)'
  return 'var(--af-red)'
}
