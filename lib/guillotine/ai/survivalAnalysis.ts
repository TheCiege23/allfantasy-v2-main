/**
 * A team's survival analysis for the week being played: the numbers behind POST /api/guillotine/ai/survival.
 *
 * It used to return a fixed 72% for every team (lib/guillotine/ai/survivalAssistant.ts said so: "pending live
 * projection feed"). Every number here now comes from what the Chop page shows: the chop preview's scores and
 * chop line (./chopPreview.ts), each team's outlook for the games it has left (./survivalOutlook.ts), and the
 * same odds function. A number that cannot be worked out is null, never a stand-in.
 *
 * What it no longer pretends to know: a "biggest threat" player, a FAAB verdict and an urgency level. Nothing
 * computed them; they were constants. They are left out rather than kept as constants.
 *
 * Pure.
 */
import type { ChopPreview } from '../chopPreview'
import { survivalOdds, type TeamOutlook } from '../survivalOutlook'

export type SurvivalRiskTier = 'SAFE' | 'MODERATE' | 'DANGER' | 'CRITICAL'

export type SurvivalAnalysis = {
  rosterId: string
  week: number
  /** Chance of NOT being chopped this week, 0–100. Null without a projection for every team still playing. */
  survivalProbability: number | null
  riskTier: SurvivalRiskTier | null
  /** Points so far this week. */
  currentScore: number
  /** Points so far plus the projection for games still to play. Null when the projection is missing. */
  projectedScore: number | null
  /** Starters with a game still to play. */
  playersLeft: number | null
  /** The chop line as the week stands now, and this team's points above it (0 or less: in the chop zone). */
  currentChopLine: number | null
  marginAboveLine: number | null
  /**
   * The projected finish this team has to beat to stay out of the chop zone: the lowest projected finishes of
   * the OTHER teams, as many as the week chops. Null when any of them has no projection.
   */
  projectedChopLine: number | null
  /** `projectedChopLine` plus the league's danger margin: a score that is not even close. */
  safeScoreTarget: number | null
  immune: boolean
  narrative: string
}

/** The tiers, from the chance to survive. */
export function riskTier(pct: number): SurvivalRiskTier {
  if (pct >= 80) return 'SAFE'
  if (pct >= 50) return 'MODERATE'
  if (pct >= 20) return 'DANGER'
  return 'CRITICAL'
}

const fmt = (n: number) => (Math.round(n * 10) / 10).toFixed(1)

export function buildSurvivalAnalysis(input: {
  rosterId: string
  preview: ChopPreview
  outlook: Record<string, TeamOutlook> | null
  dangerMarginPoints: number
}): SurvivalAnalysis | null {
  const { preview, outlook, rosterId } = input
  const row = preview.rows.find((r) => r.rosterId === rosterId)
  if (!row) return null
  const immune = row.status === 'immune'
  const mine = outlook?.[rosterId] ?? null
  const remaining = mine?.remainingProjection ?? null
  const projectedScore = remaining == null ? null : row.points + remaining
  const allProjected = outlook != null && preview.rows.every((r) => outlook[r.rosterId]?.remainingProjection != null)
  const odds = allProjected
    ? survivalOdds(
        preview.rows.map((r) => ({ rosterId: r.rosterId, current: r.points, remainingProjection: outlook![r.rosterId]!.remainingProjection, immune: r.status === 'immune' })),
        preview.chopCount,
      )
    : null
  const pct = odds?.get(rosterId) ?? null

  // The finish to beat: among the others who can be chopped, the chopCount-th lowest projected finish.
  const others = allProjected
    ? preview.rows
        .filter((r) => r.rosterId !== rosterId && r.status !== 'immune')
        .map((r) => r.points + (outlook![r.rosterId]!.remainingProjection ?? 0))
        .sort((a, b) => a - b)
    : []
  const projectedChopLine = allProjected && preview.chopCount > 0 && others.length >= preview.chopCount ? others[preview.chopCount - 1]! : null
  const safeScoreTarget = projectedChopLine == null ? null : projectedChopLine + Math.max(0, input.dangerMarginPoints)

  const narrative = (() => {
    if (preview.chopCount === 0) return `There is no chop in week ${preview.week}.`
    if (immune) return `You are immune in week ${preview.week}: the chop cannot take you.`
    if (pct == null) {
      return row.margin != null
        ? `You are ${fmt(row.points)} so far, ${row.margin > 0 ? `${fmt(row.margin)} above` : row.margin === 0 ? 'on' : `${fmt(-row.margin)} below`} the chop line. Odds need a projection for every team still playing.`
        : `No odds yet for week ${preview.week}: they need a projection for every team still playing.`
    }
    const left = mine == null ? '' : mine.playersLeft === 0 ? ' None of your starters has a game left.' : ` ${mine.playersLeft} of your starters ${mine.playersLeft === 1 ? 'still has' : 'still have'} a game to play.`
    const target = projectedChopLine == null ? '' : ` The projected finish to beat is ${fmt(projectedChopLine)}; you are projected for ${fmt(projectedScore ?? row.points)}.`
    return `${pct}% to survive week ${preview.week}.${target}${left}`
  })()

  return {
    rosterId,
    week: preview.week,
    survivalProbability: pct,
    riskTier: immune ? 'SAFE' : pct == null ? null : riskTier(pct),
    currentScore: row.points,
    projectedScore,
    playersLeft: mine?.playersLeft ?? null,
    currentChopLine: preview.chopLine,
    marginAboveLine: row.margin,
    projectedChopLine,
    safeScoreTarget,
    immune,
    narrative,
  }
}
