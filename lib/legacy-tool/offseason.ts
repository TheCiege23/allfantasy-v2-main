import type { EnrichedLegacyContext, LeagueSnapshot } from '@/lib/legacy-ai-context'

export interface DraftWarRoomInput {
  pick_number?: number
  pick_label?: string
  available_players?: string[]
  likely_taken_before_pick?: string[]
  safest_pick?: string
  upside_pick?: string
}

export interface LegacyReportSignal {
  title?: string
  window_status?: string
  insights?: {
    strengths?: string[]
    weaknesses?: string[]
    improvement_tips?: string[]
  }
  next_season_advice?: string
}

export interface LegacyOffseasonBundle {
  team_reality_check: {
    status: string
    contender_score: number
    rebuild_score: number
    strengths: string[]
    weaknesses: string[]
    age_curve_summary: string
    positional_depth_map: Record<string, number>
    short_term_ceiling: number
    long_term_stability: number
    draft_capital_strength: number
    trade_flexibility: number
    dead_roster_spots: string[]
    breakout_candidates: string[]
    decline_risk_players: string[]
    biggest_offseason_priorities: string[]
  }
  draft_war_room: {
    current_pick: string
    best_fit: string
    best_value: string
    safest_pick: string
    upside_pick: string
    likely_taken_before_pick: string[]
    probability_top_target_reaches_pick: number
    pivot_plan: string[]
    recommendation: string
  }
  team_direction_engine: {
    label:
      | 'all-in contender'
      | 'contender with 1-2 holes'
      | 'retool'
      | 'soft rebuild'
      | 'full rebuild'
    rationale: string[]
    next_actions: string[]
  }
  trade_command_center: {
    best_targets: {
      win_now_targets: string[]
      rebuild_targets: string[]
      buy_low_targets: string[]
      sell_high_candidates: string[]
      roster_fit_targets: string[]
    }
    offer_builder: {
      fair_offer: string
      aggressive_opener: string
      fallback_counter: string
      do_not_exceed_price: string
      acceptance_angle: string
    }
    trade_review: {
      recommendation: 'accept' | 'reject' | 'counter' | 'reopen_talks' | 'let_it_die'
      reason: string
    }
    renegotiation_engine: string[]
  }
  player_market_board: {
    breakout_watch: string[]
    decline_watch: string[]
    acquisition_watch: string[]
  }
  ai_gm_plan: {
    urgent_tasks: string[]
    next_two_weeks: string[]
    hold_moves: string[]
  }
  auto_answers: Array<{ question: string; answer: string; action: string }>
}

type LitePlayer = {
  name: string
  position: string | null
  age: number | null
}

function clamp0to100(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function normalizePosition(position: string | null): string {
  const p = (position || '').toUpperCase().trim()
  return p || 'UNK'
}

function getLatestRoster(enrichedContext: EnrichedLegacyContext | null) {
  if (!enrichedContext?.currentRosters?.length) return null
  return [...enrichedContext.currentRosters].sort((a, b) => b.season - a.season)[0]
}

function classifyDirection(contenderScore: number, rebuildScore: number): LegacyOffseasonBundle['team_direction_engine']['label'] {
  if (contenderScore >= 78) return 'all-in contender'
  if (contenderScore >= 64) return 'contender with 1-2 holes'
  if (contenderScore >= 50) return 'retool'
  if (rebuildScore < 60) return 'soft rebuild'
  return 'full rebuild'
}

function toLitePlayerList(roster: ReturnType<typeof getLatestRoster>): LitePlayer[] {
  if (!roster) return []
  return [...roster.starters, ...roster.bench, ...roster.taxi].map((p) => ({
    name: p.name,
    position: p.position,
    age: p.age,
  }))
}

function buildDepthMap(players: LitePlayer[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const p of players) {
    const pos = normalizePosition(p.position)
    counts[pos] = (counts[pos] || 0) + 1
  }
  return counts
}

function computeAgeSummary(players: LitePlayer[]): { avgAge: number; youngShare: number; summary: string } {
  const ages = players.map((p) => p.age).filter((a): a is number => typeof a === 'number' && Number.isFinite(a))
  if (!ages.length) {
    return { avgAge: 0, youngShare: 0, summary: 'Age profile unavailable; import full roster ages for sharper direction calls.' }
  }

  const avgAge = ages.reduce((sum, n) => sum + n, 0) / ages.length
  const youngShare = ages.filter((a) => a <= 25).length / ages.length

  const summary =
    avgAge <= 24.8
      ? `Young core (avg age ${avgAge.toFixed(1)}) with long runway.`
      : avgAge <= 27.3
        ? `Balanced age curve (avg age ${avgAge.toFixed(1)}).`
        : `Aging curve pressure (avg age ${avgAge.toFixed(1)}), prioritize insulation.`

  return { avgAge, youngShare, summary }
}

function topByAge(players: LitePlayer[], predicate: (p: LitePlayer) => boolean, max = 5): string[] {
  return players
    .filter(predicate)
    .sort((a, b) => (a.age || 0) - (b.age || 0))
    .map((p) => p.name)
    .filter(Boolean)
    .slice(0, max)
}

function fromNeedsToActions(needs: string[]): string[] {
  if (!needs.length) {
    return [
      'Keep optionality: hold premium picks until market spikes before rookie draft.',
      'Add one insulated weekly starter without paying peak price.',
    ]
  }

  return needs.slice(0, 3).map((need) => {
    const n = need.toUpperCase()
    if (n === 'RB' || n.includes('RB')) return 'Add RB insulation via tier-down trade before preseason hype.'
    if (n === 'QB' || n.includes('QB')) return 'Acquire QB2 insulation to protect weekly floor in superflex/2QB formats.'
    if (n === 'TE' || n.includes('TE')) return 'Stabilize TE room with one role-secure option and one upside stash.'
    if (n === 'WR' || n.includes('WR')) return 'Convert surplus depth into one higher-impact WR starter.'
    return `Address ${need} depth with a value trade or waiver stash.`
  })
}

function chooseBestFit(weaknesses: string[], availablePlayers: string[]): string {
  if (!availablePlayers.length) {
    return weaknesses.length ? `Best fit: target highest tier ${weaknesses[0]} available.` : 'Best fit: draft best player in current tier.'
  }
  return availablePlayers[0]
}

export function buildLegacyOffseasonBundle(args: {
  snapshot: LeagueSnapshot
  enrichedContext: EnrichedLegacyContext | null
  reportSignal?: LegacyReportSignal
  draftInput?: DraftWarRoomInput
}): LegacyOffseasonBundle {
  const roster = getLatestRoster(args.enrichedContext)
  const players = toLitePlayerList(roster)
  const depthMap = buildDepthMap(players)
  const positions = Object.entries(depthMap).sort((a, b) => b[1] - a[1])

  const strengths = positions.filter(([, count]) => count >= 4).slice(0, 3).map(([pos]) => pos)
  const weaknesses = positions.filter(([, count]) => count <= 2).slice(0, 3).map(([pos]) => pos)

  const age = computeAgeSummary(players)

  const contenderBase = args.snapshot.win_percentage * 0.42 + args.snapshot.playoff_rate * 0.32 + (args.snapshot.championships > 0 ? 12 : 0)
  const contenderScore = clamp0to100(contenderBase + (age.avgAge > 0 && age.avgAge < 27 ? 8 : age.avgAge > 28 ? -8 : 0))
  const rebuildScore = clamp0to100(100 - contenderScore + age.youngShare * 20)

  const draftPicks = roster?.draftPicks || []
  const draftCapitalStrength = clamp0to100(Math.min(100, draftPicks.length * 14 + (draftPicks.some((p) => p.round === 1) ? 20 : 0)))
  const tradeFlexibility = clamp0to100((positions.length ? 55 : 35) + draftPicks.length * 4 + (strengths.length - weaknesses.length) * 6)

  const deadRosterSpots = topByAge(players, (p) => (p.age || 0) >= 30 && normalizePosition(p.position) !== 'QB', 4)
  const breakoutCandidates = topByAge(players, (p) => (p.age || 99) <= 24 && ['WR', 'RB', 'TE', 'QB'].includes(normalizePosition(p.position)), 5)
  const declineRiskPlayers = players
    .filter((p) => {
      const pos = normalizePosition(p.position)
      if (pos === 'RB') return (p.age || 0) >= 27
      if (pos === 'WR' || pos === 'TE') return (p.age || 0) >= 29
      if (pos === 'QB') return (p.age || 0) >= 33
      return (p.age || 0) >= 30
    })
    .map((p) => p.name)
    .slice(0, 5)

  const status =
    contenderScore >= 74
      ? 'contender'
      : contenderScore >= 60
        ? 'fringe contender'
        : rebuildScore >= 65
          ? 'rebuild'
          : 'retool'

  const shortTermCeiling = clamp0to100(contenderScore + (roster?.starters.length || 0) * 1.1)
  const longTermStability = clamp0to100(age.youngShare * 70 + draftCapitalStrength * 0.3)
  const priorities = fromNeedsToActions(weaknesses)

  const label = classifyDirection(contenderScore, rebuildScore)

  const draft = args.draftInput || {}
  const likelyTaken = draft.likely_taken_before_pick || []
  const topTarget = chooseBestFit(weaknesses, draft.available_players || [])
  const probabilityTopTarget = clamp0to100(70 - likelyTaken.length * 8 + (draft.available_players?.length ? 10 : 0))

  const directionActions =
    label === 'all-in contender' || label === 'contender with 1-2 holes'
      ? [
          'Buy insulated weekly starters; avoid paying for pure long-term profile only.',
          'Package depth plus a mid pick for one difference-maker at your top weakness.',
          'Avoid trading your final premium first unless move clearly improves starting lineup.',
        ]
      : [
          'Sell aging producers before preseason value decay.',
          'Acquire future first/second capital and younger WR/QB insulation.',
          'Avoid fragile RB production bets until core is stable.',
        ]

  const tradeReviewRecommendation: LegacyOffseasonBundle['trade_command_center']['trade_review']['recommendation'] =
    label === 'all-in contender' ? 'counter' : label === 'full rebuild' ? 'reopen_talks' : 'counter'

  const fallbackWeakness = weaknesses[0] || 'RB'
  const fallbackStrength = strengths[0] || 'WR'

  const autoAnswers = [
    {
      question: 'What does my team actually look like right now?',
      answer: `${status} profile with strengths at ${strengths.join(', ') || 'N/A'} and pressure points at ${weaknesses.join(', ') || 'N/A'}.`,
      action: priorities[0] || 'Audit bottom 3 roster spots and clear dead weight for upside stashes.',
    },
    {
      question: 'Am I a contender or should I rebuild?',
      answer: `Contender score ${contenderScore}/100 vs rebuild score ${rebuildScore}/100 -> ${label}.`,
      action: directionActions[0],
    },
    {
      question: 'What positions need work most?',
      answer: weaknesses.length ? `Primary needs: ${weaknesses.join(', ')}.` : 'No severe positional hole detected from current depth map.',
      action: priorities[0] || 'Preserve flexibility and attack value pockets instead of forcing need.',
    },
    {
      question: 'Who should I draft from my current slot?',
      answer: `Best fit is ${topTarget}; safest is ${draft.safest_pick || 'highest floor player in tier'}; upside is ${draft.upside_pick || 'highest ceiling profile in tier'}.`,
      action: `Take ${topTarget}. If gone, pivot to ${draft.upside_pick || 'best value in tier'} and do not reach on thin tiers.`,
    },
    {
      question: 'Who will probably go before my pick?',
      answer: likelyTaken.length ? likelyTaken.join(', ') : 'Insufficient board telemetry; use tier-drop checkpoints 2-4 picks ahead.',
      action: 'Set a pivot list of 2 players and a trade-back trigger before your pick starts.',
    },
    {
      question: 'Who should I trade for, and what should I offer?',
      answer: `Target managers weak at ${fallbackStrength} and offer surplus ${fallbackStrength} for ${fallbackWeakness} upgrades.`,
      action: `Send fair opener: depth ${fallbackStrength} + mid pick for stable ${fallbackWeakness} starter; cap at one premium pick.`,
    },
    {
      question: 'Which old/current trades should I reopen, counter, or kill?',
      answer: label === 'full rebuild' ? 'Reopen offers that convert aging points into future picks.' : 'Counter close deals that solve immediate starting holes.',
      action: tradeReviewRecommendation === 'counter' ? 'Counter with one small value swing, do not overpay early.' : 'Reopen only value-accretive offers; kill low-leverage talks.',
    },
  ]

  return {
    team_reality_check: {
      status,
      contender_score: contenderScore,
      rebuild_score: rebuildScore,
      strengths,
      weaknesses,
      age_curve_summary: age.summary,
      positional_depth_map: depthMap,
      short_term_ceiling: shortTermCeiling,
      long_term_stability: longTermStability,
      draft_capital_strength: draftCapitalStrength,
      trade_flexibility: tradeFlexibility,
      dead_roster_spots: deadRosterSpots,
      breakout_candidates: breakoutCandidates,
      decline_risk_players: declineRiskPlayers,
      biggest_offseason_priorities: priorities,
    },
    draft_war_room: {
      current_pick: draft.pick_label || (typeof draft.pick_number === 'number' ? `Pick ${draft.pick_number}` : 'Pick not provided'),
      best_fit: topTarget,
      best_value: (draft.available_players || [])[1] || topTarget,
      safest_pick: draft.safest_pick || topTarget,
      upside_pick: draft.upside_pick || (draft.available_players || [])[2] || topTarget,
      likely_taken_before_pick: likelyTaken,
      probability_top_target_reaches_pick: probabilityTopTarget,
      pivot_plan: [
        `If ${topTarget} is gone, pivot to ${(draft.available_players || [])[1] || 'next highest value tier player'}.`,
        'If tier drop starts 2+ picks early, trade back 3-5 spots for extra draft capital.',
      ],
      recommendation:
        probabilityTopTarget >= 55
          ? `Hold and draft ${topTarget} unless an unexpected tier break happens before your pick.`
          : `Prepare trade-back path and select best remaining tier value at ${fallbackWeakness}/${fallbackStrength}.`,
    },
    team_direction_engine: {
      label,
      rationale: [
        `Projected competitiveness anchored to ${args.snapshot.win_percentage.toFixed(1)}% win rate and ${args.snapshot.playoff_rate}% playoff rate.`,
        `Age curve signal: ${age.summary}`,
        `Draft capital strength: ${draftCapitalStrength}/100.`,
      ],
      next_actions: directionActions,
    },
    trade_command_center: {
      best_targets: {
        win_now_targets: label.includes('contender') ? [`Stable ${fallbackWeakness} starter`, 'High-floor flex producer'] : [],
        rebuild_targets: label.includes('rebuild') ? ['Young WR insulation profile', 'Future first-round pick value'] : [],
        buy_low_targets: ['Player with temporary role dip but stable talent profile', 'Injury-discounted upside starter'],
        sell_high_candidates: declineRiskPlayers.slice(0, 2),
        roster_fit_targets: weaknesses.map((w) => `${w} upgrade target`).slice(0, 3),
      },
      offer_builder: {
        fair_offer: `Depth ${fallbackStrength} + mid pick for stable ${fallbackWeakness} starter.`,
        aggressive_opener: `Depth ${fallbackStrength} + two seconds for difference-maker ${fallbackWeakness}.`,
        fallback_counter: `Swap second for younger depth asset and keep premium future first.`,
        do_not_exceed_price: 'Do not include your next premium first unless it closes a clear title equity gap.',
        acceptance_angle: 'Offer solves opponent depth hole while preserving their top-end lineup.',
      },
      trade_review: {
        recommendation: tradeReviewRecommendation,
        reason:
          label === 'full rebuild'
            ? 'Current roster direction benefits more from value conversion than short-term points.'
            : 'Current roster profile supports selective counters that patch starting lineup weaknesses.',
      },
      renegotiation_engine: [
        'Reopen talks when opponent suffers fresh depth loss at your surplus position.',
        'Do not reopen if market moved against your core outgoing asset by more than one tier.',
        'Counter by replacing aging throw-in with younger depth profile when negotiating future picks.',
      ],
    },
    player_market_board: {
      breakout_watch: breakoutCandidates,
      decline_watch: declineRiskPlayers,
      acquisition_watch: [
        'Waiver stash with rising role trend and low acquisition cost',
        'Cheap trade target from non-contending team with temporary production dip',
        'Throw-in asset aligned with your weakest positional room',
      ],
    },
    ai_gm_plan: {
      urgent_tasks: priorities,
      next_two_weeks: [
        'Set do-not-exceed prices for top 3 trade targets before rookie-draft volatility spikes.',
        'Convert one dead roster spot into a high-upside stash or handcuff.',
        'Run pre-draft scenario tree for top pick and two pivots.',
      ],
      hold_moves: [
        'Hold premium pick flexibility until board pressure is visible.',
        'Hold one veteran producer if market discount is below fair value.',
      ],
    },
    auto_answers: autoAnswers,
  }
}
