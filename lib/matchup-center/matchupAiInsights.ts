/**
 * Deterministic "AI insights" layer for the Matchup Command Center.
 * Produces advisory copy from scoring + projections only — safe to call without external LLM.
 */

import type { MatchupInsightsBlock, MatchupSidePayload } from '@/lib/matchup-center/types'

function swingPlayersFromSides(left: MatchupSidePayload, right: MatchupSidePayload): string[] {
  const all = [...left.starters, ...right.starters]
  const scored = all.map((s) => ({
    id: s.playerId,
    name: s.name,
    delta: Math.abs(s.projectedPoints - s.currentPoints),
    ceiling: s.projectedPoints,
  }))
  scored.sort((a, b) => b.delta - a.delta)
  const top = scored.slice(0, 3).filter((x) => x.delta > 0.5 || x.ceiling >= 12)
  return top.map((x) => `${x.name} — projection variance vs actuals is watchable this week.`)
}

function riskLevelFromStarters(left: MatchupSidePayload, right: MatchupSidePayload): MatchupInsightsBlock['riskLevel'] {
  const starters = [...left.starters, ...right.starters]
  let highVar = 0
  for (const s of starters) {
    const spread = Math.abs(s.projectedPoints - s.currentPoints)
    if (spread > 8) highVar++
  }
  if (highVar >= 4) return 'high'
  if (highVar >= 2) return 'medium'
  return 'low'
}

function floorCeilingCopy(left: MatchupSidePayload, right: MatchupSidePayload, sport: string): string {
  const gap = left.projectedTotal - right.projectedTotal
  const s = String(sport).toUpperCase()
  const outdoor = s === 'NFL' || s === 'NCAAF'
  const base = outdoor
    ? 'Outdoor sports: wind and game script can collapse ceilings for pass-catchers; secure floor with volume roles.'
    : 'Indoor / court sports: pace and minutes drive floor; watch back-to-backs and rest reports.'
  // Ahead/behind claims come from projected totals — off-limits when either total includes
  // the flat per-position fallback (the gap would be part-fabricated).
  if (left.projectedTotalIncludesFallback || right.projectedTotalIncludesFallback) return base
  if (Math.abs(gap) < 2) return `${base} Projections are tight — prioritize safe floors if protecting a slim lead.`
  if (gap > 0) return `${base} You're ahead on paper — balance safe floors with one ceiling chase if you need insurance.`
  return `${base} You're trailing on paper — consider one volatile upside spot if the rest of the lineup is stable.`
}

export function buildMatchupInsightsBlock(params: {
  left: MatchupSidePayload
  right: MatchupSidePayload
  sport: string
}): MatchupInsightsBlock {
  const { left, right, sport } = params
  const gap = left.projectedTotal - right.projectedTotal
  const matchupEdge =
    left.projectedTotalIncludesFallback || right.projectedTotalIncludesFallback
      ? 'Projected edge unavailable — real projections are missing for some starters, so no lead is claimed either way.'
      : Math.abs(gap) < 0.5
        ? 'Projections are tight — one big game could swing this matchup.'
        : gap > 0
          ? `${left.teamName} projects ahead by ~${gap.toFixed(1)} — lean on floor plays to protect the lead.`
          : `${right.teamName} projects ahead by ~${Math.abs(gap).toFixed(1)} — chase ceiling if you need points.`

  const startSit = `Start/sit is advisory only — use ${sport} lineup locks and official injury designations as the source of truth.`

  const weather =
    String(sport).toUpperCase() === 'NFL' || String(sport).toUpperCase() === 'NCAAF'
      ? 'Outdoor games may shift passing volume — check wind and precipitation before locking kickers and deep shots.'
      : 'Weather is less impactful for indoor/court sports — focus on injury and minutes reports.'

  const injuryNews = 'Monitor gameday inactives; late scratches can change projections quickly.'

  let swingPlayers = swingPlayersFromSides(left, right)
  if (swingPlayers.length === 0) {
    swingPlayers = ['No extreme swing candidates detected — lineups look stable vs projections.']
  }

  return {
    matchupEdge,
    startSit,
    weather,
    injuryNews,
    swingPlayers,
    riskLevel: riskLevelFromStarters(left, right),
    floorVsCeiling: floorCeilingCopy(left, right, sport),
  }
}
