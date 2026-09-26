import 'server-only'

import type { TradeConsoleLeagueSnapshot, TradeIntelligence, TradeStrategyMode, TeamContextMode } from './types'

type DriverLike = {
  lean?: string
  verdict?: string
  riskFlags?: string[]
  acceptBullets?: string[]
}

function pickSweetenerText(s: { suggestion?: string; type?: string; target?: string }): string | null {
  if (s.suggestion?.trim()) return s.suggestion.trim()
  if (s.type && s.target) return `${s.type}: ${s.target}`
  return null
}

export function buildTradeIntelligence(args: {
  league: TradeConsoleLeagueSnapshot | null
  strategy: TradeStrategyMode
  teamContext: TeamContextMode
  fairnessLabel: string
  sideAdvantage: 'even' | 'you' | 'opponent' | 'mixed'
  percentDiff: number
  giveTotal: number
  getTotal: number
  confidenceScore: number
  degraded: boolean
  /** Shared evaluator's eligibility/pricing result; context gaps alone do not erase its verdict. */
  proposalGraded?: boolean
  dataGaps: string[]
  injuryNotes: string[]
  drivers: DriverLike
  negotiationToolkit: Record<string, unknown> | null
  opponentRosterTargets?: Array<{ name: string; marketValue: number; position: string | null }>
  rosterSummary: {
    lineupSimulation: boolean
    yourRosterPlayers: number
    theirRosterPlayers: number
  }
  leagueHistoryNote: string | null
  /** Appended sentence from warehouse / LeagueSeason / waivers when data exists */
  structuredContextExtra?: string | null
  syncedDataHighlights?: string[]
  /** Summed effective weekly projections per side (league-scored when context exists). */
  projectedImpact: {
    giveTotal: number | null
    getTotal: number | null
    net: number | null
    summary: string
  }
  /** Echo normalized scoring labels for AI (no invented rules). */
  scoringSummary?: string | null
}): TradeIntelligence {
  const proposalGraded = args.proposalGraded !== false
  const marketWho: TradeIntelligence['whoWinsNow'] =
    args.sideAdvantage === 'you' ? 'you' : args.sideAdvantage === 'opponent' ? 'opponent' : 'even'

  /** Short-term “win now”: league-scored weekly projection net when present; else market composites. */
  let whoWinsNow: TradeIntelligence['whoWinsNow'] = 'unknown'
  const pn = args.projectedImpact.net
  if (
    args.projectedImpact.giveTotal != null &&
    args.projectedImpact.getTotal != null &&
    pn != null &&
    Number.isFinite(pn)
  ) {
    whoWinsNow = Math.abs(pn) < 1 ? 'even' : pn > 0 ? 'you' : 'opponent'
  }

  /** Long-term: dynasty uses composite % delta; redraft aligns with market tilt (ROS proxy). */
  const whoWinsLongTerm: TradeIntelligence['whoWinsLongTerm'] = args.proposalGraded === false ? 'unknown' : marketWho

  const fairnessVerdict = proposalGraded
    ? `${args.fairnessLabel} · League value delta ${args.percentDiff}%. The grade uses the displayed league values, including scoring and roster-need adjustments. Asset projections describe production, not a change in starting-lineup points or win probability. Confidence ${Math.round(args.confidenceScore)}%.${args.scoringSummary ? ` ${args.scoringSummary}` : ''}`
    : 'Proposal grade unavailable. The shared evaluator withheld this grade; priced assets and roster context alone do not establish that the complete trade is fair.'

  const tradeWarnings: string[] = []
  for (const w of args.injuryNotes.slice(0, 6)) {
    if (w && !tradeWarnings.includes(w)) tradeWarnings.push(w)
  }
  for (const f of args.drivers.riskFlags ?? []) {
    if (f && !tradeWarnings.includes(f)) tradeWarnings.push(f)
  }
  for (const g of args.dataGaps.slice(0, 5)) {
    if (g && !tradeWarnings.includes(`Data gap: ${g}`)) tradeWarnings.push(`Data gap: ${g}`)
  }
  if (args.degraded) tradeWarnings.push('Some assets used fallback pricing — confidence is reduced.')

  const rebalanceSuggestions: string[] = []
  const tk = args.negotiationToolkit
  if (proposalGraded && tk && typeof tk === 'object') {
    const counters = (tk as { counters?: Array<{ description?: string }> }).counters
    if (Array.isArray(counters)) {
      for (const c of counters.slice(0, 6)) {
        if (c?.description) rebalanceSuggestions.push(c.description)
      }
    }
    const sweet = (tk as { sweeteners?: Array<Record<string, unknown>> }).sweeteners
    if (Array.isArray(sweet)) {
      for (const s of sweet.slice(0, 4)) {
        const line = pickSweetenerText(s as { suggestion?: string; type?: string; target?: string })
        if (line) rebalanceSuggestions.push(line)
      }
    }
  }

  const deficit = proposalGraded ? args.giveTotal - args.getTotal : 0
  const alt = (args.opponentRosterTargets ?? [])
    .filter((t) => Number.isFinite(t.marketValue) && t.marketValue > 0)
    .sort((a, b) => deficit > 0
      ? Math.abs(deficit - a.marketValue) - Math.abs(deficit - b.marketValue) || a.name.localeCompare(b.name)
      : b.marketValue - a.marketValue || a.name.localeCompare(b.name))
    .slice(0, 8)
  if (deficit > 0 && alt.length > 0 && !args.degraded) {
    for (const target of [...alt.slice(0, 3)].reverse()) {
      const residual = Math.abs(deficit - target.marketValue)
      if (residual >= deficit) continue
      rebalanceSuggestions.unshift(
        `Ask for ${target.name} from their roster (market value ${target.marketValue.toLocaleString('en-US')}) in addition to this offer. Your league-value shortfall is ${Math.round(deficit).toLocaleString('en-US')}; before re-pricing roster fit, that leaves about ${Math.round(residual).toLocaleString('en-US')} apart. Analyze the counter to confirm its grade and lineup fit.`,
      )
    }
  }
  const alternateTargets = alt.map((t) => ({
    name: t.name,
    marketValue: t.marketValue,
    position: t.position ?? null,
  }))
  const alternateTargetsNote =
    alt.length > 0
      ? `Available opponent roster targets${deficit > 0 ? ', closest to your value shortfall first' : ''}: ${alt.map((t) => `${t.name} (${t.marketValue})`).join(' · ')}. Re-analyze additions under this league's rules; these market prices alone do not guarantee a fair counter.`
      : 'Select a league and opponent team to surface alternate counter targets from their roster.'

  const badges = args.league?.quickModeBadges?.length
    ? args.league.quickModeBadges.join(', ')
    : 'General (no league snapshot)'

  const leagueReasoning = args.league
    ? `League ${args.league.name} (${args.league.sport}). Format signals: ${badges}. Scoring: ${args.league.scoring ?? 'see settings'}. Superflex: ${args.league.isSuperFlexHint ? 'yes' : 'no'}. TE premium: ${args.league.tePremiumHint ? 'yes' : 'no'}.${args.structuredContextExtra ?? ''}`
    : 'No league selected — valuation uses sport defaults and asset search only (no roster simulation).'

  const teamReasoning =
    args.teamContext === 'my_team'
      ? `Team lens: your roster context${args.rosterSummary.lineupSimulation ? ` — ${args.rosterSummary.yourRosterPlayers} your players priced, ${args.rosterSummary.theirRosterPlayers} opponent pieces in simulation.` : ' (enable league + opponent for full lineup fit).'}.`
      : args.teamContext === 'neutral'
        ? 'Neutral lens: raw fairness without “my team” positional need weighting.'
        : `Team lens: ${args.teamContext} — compare sides using structured drivers.`

  let contenderRecommendation =
    args.strategy === 'contender' || args.strategy === 'win_now'
      ? proposalGraded
        ? `Contender mode: prioritize win-now market value and lineup lift. Current lean: ${args.drivers.lean ?? 'see drivers'}.`
        : 'Contender mode: proposal value is unavailable. Review complete asset projections and eligibility before judging a lineup benefit.'
      : `Contender read: ${whoWinsNow === 'you' ? 'the incoming assets project for more combined points.' : whoWinsNow === 'opponent' ? 'the outgoing assets project for more combined points.' : whoWinsNow === 'unknown' ? 'weekly production is unavailable.' : 'the assets have similar combined projections.'} A combined asset projection is not a starting-lineup improvement or a win forecast.`

  if (args.league?.isDynasty === false) {
    contenderRecommendation += ' Redraft / seasonal — short horizon dominates.'
  }

  let rebuilderRecommendation =
    args.strategy === 'rebuilder' || args.strategy === 'long_term'
      ? `Rebuilder / long-term: consider picks and youth upside where data exists. Current league-value read: ${args.proposalGraded === false ? 'unavailable' : args.fairnessLabel}.`
      : `Rebuilder read (informational): ${whoWinsLongTerm === 'you' ? 'the incoming package has more league value.' : whoWinsLongTerm === 'opponent' ? 'the outgoing package has more league value.' : whoWinsLongTerm === 'unknown' ? 'league value is unavailable.' : 'League values are close — use age/pick data on cards.'}`

  if (args.strategy === 'neutral') {
    contenderRecommendation = `Neutral strategy: ${contenderRecommendation}`
    rebuilderRecommendation = `Neutral strategy: ${rebuilderRecommendation}`
  }

  const proj = args.projectedImpact
  const projSentence =
    proj.giveTotal != null && proj.getTotal != null && proj.net != null
      ? `League-scored weekly projection stack: you give up ~${proj.giveTotal.toFixed(1)} combined pts, you get ~${proj.getTotal.toFixed(1)} (${proj.net >= 0 ? '+' : ''}${proj.net.toFixed(1)} net). ${proj.summary}`
      : `Projected weekly impact: ${proj.summary}`

  const why = [
    fairnessVerdict,
    projSentence,
    teamReasoning,
    contenderRecommendation,
    rebuilderRecommendation,
    alt.length > 0 ? alternateTargetsNote : null,
  ]
    .filter(Boolean)
    .join(' ')

  return {
    fairnessVerdict,
    confidenceScore: proposalGraded ? Math.round(args.confidenceScore) : null,
    whoWinsNow,
    whoWinsLongTerm,
    contenderRecommendation,
    rebuilderRecommendation,
    tradeWarnings: tradeWarnings.slice(0, 12),
    rebalanceSuggestions: rebalanceSuggestions.slice(0, 10),
    alternateTargetsNote,
    alternateTargets,
    why,
    projectedImpact: proj,
    leagueReasoning,
    teamReasoning,
    leagueHistoryNote: args.leagueHistoryNote,
    ...(args.syncedDataHighlights?.length ? { syncedDataHighlights: args.syncedDataHighlights } : {}),
  }
}
