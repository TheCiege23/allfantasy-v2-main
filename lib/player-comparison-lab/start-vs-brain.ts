/**
 * Start A vs B — deterministic-first enrichment on top of TwoPlayerComparisonEngineResult.
 * Supports all sports via ResolvedPlayerStats (no football-only branching).
 */

import { getPositionWeatherFactors, isWeatherSensitiveSport } from '@/lib/weather/outdoorSportMetadata'
import type {
  ResolvedPlayerStats,
  TwoPlayerComparisonDeterministicOutput,
  TwoPlayerComparisonEngineResult,
} from './types'

export type StartVsStrategyMode =
  | 'safest_floor'
  | 'balanced'
  | 'highest_upside'
  | 'underdog_mode'
  | 'protect_lead'

export const START_VS_STRATEGY_MODES: readonly StartVsStrategyMode[] = [
  'safest_floor',
  'balanced',
  'highest_upside',
  'underdog_mode',
  'protect_lead',
] as const

export interface StartVsFactorRow {
  factor: string
  player_a_score: number | null
  player_b_score: number | null
  winner: 'playerA' | 'playerB' | 'tie' | 'none'
  notes?: string
}

export interface StartVsDeterministicDeltas {
  projection_delta: number | null
  floor_delta: number | null
  ceiling_proxy_delta: number | null
  matchup_delta: number | null
  volatility_delta: number | null
  usage_trend_delta: number | null
  injury_news_delta: number | null
}

/** Who wins this lens — fantasy-coach style snapshot (deterministic). */
export type StartVsCoachSide = 'playerA' | 'playerB' | 'tie'

export interface StartVsCoachPick {
  side: StartVsCoachSide
  player_name: string | null
  /** Median tie broken by client preference only */
  resolved_by_user_preference?: boolean
}

/**
 * Specialized “sharp coach” mode: fast start/sit answers from projections,
 * matchup, usage/trend, health, volatility; user preference only as tie-break.
 */
export interface StartVsCoachLens {
  median_play: StartVsCoachPick
  safer_play: StartVsCoachPick
  higher_ceiling_play: StartVsCoachPick
  /** Lean when you’re ahead / need reliability (game-script safe) */
  better_if_favored: StartVsCoachPick
  /** Lean when you’re chasing / need spike (game-script aggressive) */
  better_if_underdog: StartVsCoachPick
  confidence_pct: number
  /** Tight coach voice — 2–4 sentences */
  concise_explanation: string
  /** Signals actually used in this run (transparency) */
  dimensions_used: string[]
  /** Outdoor / wind-sensitive reminder when relevant */
  weather_note: string | null
  tiebreak_applied: 'none' | 'user_preference'
}

export interface StartVsApiResponse {
  ok: true
  winner: 'playerA' | 'playerB' | 'tie'
  confidence_pct: number
  floor_pick: 'playerA' | 'playerB' | 'tie'
  upside_pick: 'playerA' | 'playerB' | 'tie'
  short_verdict: string
  full_reasoning: string
  factor_comparison: StartVsFactorRow[]
  deterministic_deltas: StartVsDeterministicDeltas
  if_need_upside: string
  if_need_floor: string
  risk_flags: string[]
  news_flags: string[]
  actions: {
    set_lineup: { href: string; label: string }
    compare_again: { href: string; label: string }
    ask_chimmy: { href: string; label: string }
  }
  deterministic: TwoPlayerComparisonDeterministicOutput
  playerA: ResolvedPlayerStats
  playerB: ResolvedPlayerStats
  sport: string
  strategy_mode: StartVsStrategyMode
  lineup_slot?: string | null
  week_or_period?: string | null
  missing_data: string[]
  explanation_source: 'deterministic' | 'ai'
  /** Sharp start/sit lens — always populated */
  coach_lens: StartVsCoachLens
  /** Populated by API route when headshots resolve */
  display?: {
    playerA: { headshotUrl: string | null; teamLogoUrl: string | null }
    playerB: { headshotUrl: string | null; teamLogoUrl: string | null }
  }
}

function n(x: unknown): number | null {
  if (typeof x !== 'number' || !Number.isFinite(x)) return null
  return x
}

/** Proxy "floor" = stability: low volatility, low injury risk, decent projection. */
function floorScore(p: ResolvedPlayerStats): number | null {
  const vol = n(p.projection?.volatility)
  const inj = n(p.injury?.riskScore)
  const proj = projectionMedianPoints(p)
  if (proj == null && vol == null && inj == null) return null
  const volPenalty = vol != null ? -Math.min(vol, 50) * 0.4 : 0
  const injPenalty = inj != null ? -inj * 0.6 : 0
  const projBoost = proj != null ? Math.min(proj, 80) * 0.35 : 0
  return projBoost + volPenalty + injPenalty
}

/** Proxy "upside" = trend + projection ceiling proxy (value + inverse rank). */
function upsideScore(p: ResolvedPlayerStats): number | null {
  const trend = n(p.projection?.trend30Day)
  const proj = projectionMedianPoints(p)
  const vol = n(p.projection?.volatility)
  if (proj == null && trend == null) return null
  const trendBoost = trend != null ? trend * 0.45 : 0
  const projBoost = proj != null ? Math.min(proj, 100) * 0.4 : 0
  const volBonus = vol != null ? Math.min(vol, 40) * 0.15 : 0
  return trendBoost + projBoost + volBonus
}

function sideFromScores(a: number | null, b: number | null): 'playerA' | 'playerB' | 'tie' {
  if (a == null && b == null) return 'tie'
  if (a != null && b == null) return 'playerA'
  if (a == null && b != null) return 'playerB'
  if (a === b) return 'tie'
  return (a as number) > (b as number) ? 'playerA' : 'playerB'
}

function applyStrategyToWinner(
  base: TwoPlayerComparisonDeterministicOutput['recommendedSide'],
  mode: StartVsStrategyMode,
  floor: 'playerA' | 'playerB' | 'tie',
  upside: 'playerA' | 'playerB' | 'tie',
  conf: number
): { winner: 'playerA' | 'playerB' | 'tie'; confidence_pct: number; note: string } {
  let winner: 'playerA' | 'playerB' | 'tie' = base
  let confidence_pct = conf
  let note = 'Balanced recommendation follows weighted stat comparison.'

  if (mode === 'safest_floor') {
    winner = floor
    note = 'Strategy: safest floor — prioritizing stability and injury profile.'
    confidence_pct = Math.max(48, conf - 5)
  } else if (mode === 'highest_upside' || mode === 'underdog_mode') {
    winner = upside
    note =
      mode === 'underdog_mode'
        ? 'Strategy: underdog — leaning into momentum and ceiling proxies.'
        : 'Strategy: highest upside — leaning into trend and ceiling proxies.'
    confidence_pct = Math.max(48, conf - 6)
  } else if (mode === 'protect_lead') {
    winner = floor
    note = 'Strategy: protect lead — favoring safer floor over volatility.'
    confidence_pct = Math.max(48, conf - 4)
  }

  if (winner === 'tie' && base !== 'tie') {
    note += ' (Close call — tie declared for this strategy; see factors.)'
  }

  return { winner, confidence_pct: Math.min(96, Math.round(confidence_pct)), note }
}

function buildDeltas(a: ResolvedPlayerStats, b: ResolvedPlayerStats): StartVsDeterministicDeltas {
  const pa = projectionMedianPoints(a)
  const pb = projectionMedianPoints(b)
  const fa = floorScore(a)
  const fb = floorScore(b)
  const ua = upsideScore(a)
  const ub = upsideScore(b)
  return {
    projection_delta: pa != null && pb != null ? pa - pb : null,
    floor_delta: fa != null && fb != null ? fa - fb : null,
    ceiling_proxy_delta: ua != null && ub != null ? ua - ub : null,
    matchup_delta:
      a.scheduleDifficultyScore != null && b.scheduleDifficultyScore != null
        ? (b.scheduleDifficultyScore ?? 0) - (a.scheduleDifficultyScore ?? 0)
        : null,
    volatility_delta:
      n(a.projection?.volatility) != null && n(b.projection?.volatility) != null
        ? (n(b.projection?.volatility) as number) - (n(a.projection?.volatility) as number)
        : null,
    usage_trend_delta:
      n(a.projection?.trend30Day) != null && n(b.projection?.trend30Day) != null
        ? (n(a.projection?.trend30Day) as number) - (n(b.projection?.trend30Day) as number)
        : null,
    injury_news_delta:
      n(a.injury?.riskScore) != null && n(b.injury?.riskScore) != null
        ? (n(b.injury?.riskScore) as number) - (n(a.injury?.riskScore) as number)
        : null,
  }
}

function collectMissing(a: ResolvedPlayerStats, b: ResolvedPlayerStats): string[] {
  const m: string[] = []
  if (projectionMedianPoints(a) == null) m.push('Player A: limited projection data')
  if (projectionMedianPoints(b) == null) m.push('Player B: limited projection data')
  if (a.injury?.source === 'none' && !a.injury?.note) m.push('Player A: injury feed sparse')
  if (b.injury?.source === 'none' && !b.injury?.note) m.push('Player B: injury feed sparse')
  return m
}

function riskFlags(a: ResolvedPlayerStats, b: ResolvedPlayerStats): string[] {
  const out: string[] = []
  if ((a.injury?.riskScore ?? 0) > 55) out.push(`${a.name}: elevated injury risk signal`)
  if ((b.injury?.riskScore ?? 0) > 55) out.push(`${b.name}: elevated injury risk signal`)
  if ((a.projection?.volatility ?? 0) > 35) out.push(`${a.name}: high volatility projection`)
  if ((b.projection?.volatility ?? 0) > 35) out.push(`${b.name}: high volatility projection`)
  return out
}

function newsFlags(a: ResolvedPlayerStats, b: ResolvedPlayerStats): string[] {
  const out: string[] = []
  if (a.injury?.note) out.push(`${a.name}: ${a.injury.note}`)
  if (b.injury?.note) out.push(`${b.name}: ${b.injury.note}`)
  return out.slice(0, 6)
}

function projectionMedianPoints(p: ResolvedPlayerStats): number | null {
  return p.leagueWeeklyProjection !== undefined
    ? n(p.leagueWeeklyProjection)
    : n(p.internalProjectionPoints) ?? n(p.projection?.value)
}

/** Higher = easier upcoming opponent context (inverse of schedule difficulty). */
function matchupEaseScore(p: ResolvedPlayerStats): number | null {
  const s = n(p.scheduleDifficultyScore)
  if (s == null) return null
  return Math.max(0, Math.min(100, 100 - s))
}

/** Lean safe when you’re “playing from ahead” — floor + softer opponent schedule proxy. */
function favoredComposite(p: ResolvedPlayerStats): number | null {
  const f = floorScore(p)
  const ease = matchupEaseScore(p)
  if (f == null && ease == null) return null
  return (f ?? 0) * 0.62 + (ease ?? 50) * 0.38
}

/** Lean spike when you’re chasing — upside, volatility, tougher matchup chase bonus. */
function underdogComposite(p: ResolvedPlayerStats): number | null {
  const u = upsideScore(p)
  const vol = n(p.projection?.volatility)
  const sched = n(p.scheduleDifficultyScore)
  if (u == null && vol == null && sched == null) return null
  const schedChase = sched != null ? Math.max(0, sched - 48) * 0.12 : 0
  return (u ?? 0) * 0.68 + (vol ?? 0) * 0.22 + schedChase
}

function coachPick(
  side: 'playerA' | 'playerB' | 'tie',
  a: ResolvedPlayerStats,
  b: ResolvedPlayerStats,
  opts?: { userBrokeTie?: boolean }
): StartVsCoachPick {
  const player_name = side === 'tie' ? null : side === 'playerA' ? a.name : b.name
  return {
    side,
    player_name,
    ...(opts?.userBrokeTie ? { resolved_by_user_preference: true } : {}),
  }
}

function buildWeatherNote(sport: string, a: ResolvedPlayerStats, b: ResolvedPlayerStats): string | null {
  if (!isWeatherSensitiveSport(sport)) return null
  const pa = (a.position ?? 'QB').trim()
  const pb = (b.position ?? 'QB').trim()
  const fa = getPositionWeatherFactors(sport, pa)
  const fb = getPositionWeatherFactors(sport, pb)
  if (fa.length === 0 && fb.length === 0) return null
  return 'Outdoor weather can shift passing and kicking—if wind or heavy precip shows up, lean the steadier profile.'
}

function buildCoachDimensionsList(): string[] {
  return [
    'projection',
    'matchup',
    'usage_trend',
    'health',
    'volatility',
    'team_context',
    'opponent_strength',
    'weather_where_relevant',
  ]
}

function buildConciseCoachExplanation(args: {
  median: StartVsCoachPick
  safer: StartVsCoachPick
  ceiling: StartVsCoachPick
  favored: StartVsCoachPick
  underdog: StartVsCoachPick
  confidence: number
  weather_note: string | null
}): string {
  const label = (p: StartVsCoachPick) => (p.side === 'tie' ? 'Toss-up' : p.player_name ?? '—')
  let s = ''
  s += `Median play: ${label(args.median)}. Safer: ${label(args.safer)}. Ceiling: ${label(args.ceiling)}. `
  s += `If you’re favored / need a solid score: ${label(args.favored)}. If you’re chasing / need a spike: ${label(args.underdog)}. `
  s += `Confidence ${args.confidence}%.`
  if (args.weather_note) s += ` ${args.weather_note}`
  if (args.median.resolved_by_user_preference) s += ' Median tie broken by your preference.'
  return s.trim()
}

function buildCoachLens(args: {
  sport: string
  a: ResolvedPlayerStats
  b: ResolvedPlayerStats
  confidencePct: number
  userPreference?: 'playerA' | 'playerB' | null
}): StartVsCoachLens {
  const { sport, a, b, confidencePct, userPreference } = args

  const pa = projectionMedianPoints(a)
  const pb = projectionMedianPoints(b)
  let medianSide = sideFromScores(pa, pb)
  let tiebreak: 'none' | 'user_preference' = 'none'
  if (medianSide === 'tie' && userPreference) {
    medianSide = userPreference
    tiebreak = 'user_preference'
  }

  const floorS = sideFromScores(floorScore(a), floorScore(b))
  const ceilS = sideFromScores(upsideScore(a), upsideScore(b))
  const favS = sideFromScores(favoredComposite(a), favoredComposite(b))
  const dogS = sideFromScores(underdogComposite(a), underdogComposite(b))

  const weather_note = buildWeatherNote(sport, a, b)
  const medianPick = coachPick(medianSide, a, b, { userBrokeTie: tiebreak === 'user_preference' })

  const concise = buildConciseCoachExplanation({
    median: medianPick,
    safer: coachPick(floorS, a, b),
    ceiling: coachPick(ceilS, a, b),
    favored: coachPick(favS, a, b),
    underdog: coachPick(dogS, a, b),
    confidence: confidencePct,
    weather_note,
  })

  return {
    median_play: medianPick,
    safer_play: coachPick(floorS, a, b),
    higher_ceiling_play: coachPick(ceilS, a, b),
    better_if_favored: coachPick(favS, a, b),
    better_if_underdog: coachPick(dogS, a, b),
    confidence_pct: confidencePct,
    concise_explanation: concise,
    dimensions_used: buildCoachDimensionsList(),
    weather_note,
    tiebreak_applied: tiebreak,
  }
}

/**
 * Build UI + API-ready payload. Does not call LLMs — use engine's explanation text for full_reasoning when AI enabled upstream.
 */
export function buildStartVsResponse(
  engine: TwoPlayerComparisonEngineResult,
  args: {
    strategyMode: StartVsStrategyMode
    leagueId: string
    teamId?: string | null
    lineupSlot?: string | null
    weekOrPeriod?: string | null
    /** Tie-break median projection only — never overrides deterministic facts */
    userPreference?: 'playerA' | 'playerB' | null
  }
): StartVsApiResponse {
  const { comparison, deterministic, explanation } = engine
  const a = comparison.playerA
  const b = comparison.playerB

  const fa = floorScore(a)
  const fb = floorScore(b)
  const ua = upsideScore(a)
  const ub = upsideScore(b)
  const floor_pick = sideFromScores(fa, fb)
  const upside_pick = sideFromScores(ua, ub)

  const strat = applyStrategyToWinner(
    deterministic.recommendedSide,
    args.strategyMode,
    floor_pick,
    upside_pick,
    deterministic.confidencePct
  )

  const deltas = buildDeltas(a, b)
  const missing = collectMissing(a, b)

  const factor_comparison: StartVsFactorRow[] = deterministic.statComparisons.slice(0, 12).map((row) => ({
    factor: row.label,
    player_a_score: row.playerAValue,
    player_b_score: row.playerBValue,
    winner: row.winner,
  }))
  factor_comparison.push({
    factor: 'Floor proxy (stability)',
    player_a_score: fa,
    player_b_score: fb,
    winner: floor_pick,
  })
  factor_comparison.push({
    factor: 'Upside proxy (trend + ceiling)',
    player_a_score: ua,
    player_b_score: ub,
    winner: upside_pick,
  })

  const periodLabel = (args.weekOrPeriod ?? '').trim() || 'this scoring period'
  const short_verdict =
    strat.winner === 'tie'
      ? `Close matchup between ${a.name} and ${b.name}. Either start is defensible — see floor vs upside picks.`
      : `Lean ${strat.winner === 'playerA' ? a.name : b.name} for ${periodLabel} with ~${strat.confidence_pct}% confidence (${args.strategyMode.replace(/_/g, ' ')}).`

  const full_reasoning = [deterministic.summary, explanation.text, strat.note].filter(Boolean).join(' ')

  const coach_lens = buildCoachLens({
    sport: engine.sport,
    a,
    b,
    confidencePct: strat.confidence_pct,
    userPreference: args.userPreference ?? null,
  })

  const if_need_upside =
    upside_pick === 'tie'
      ? 'Upside is a toss-up — use game script and recent usage as tiebreakers.'
      : upside_pick === 'playerA'
        ? `If you need ceiling, ${a.name} has stronger upside signals in this model.`
        : `If you need ceiling, ${b.name} has stronger upside signals in this model.`

  const if_need_floor =
    floor_pick === 'tie'
      ? 'Floor is similar — favor the safer game environment if available.'
      : floor_pick === 'playerA'
        ? `If you need stability, ${a.name} profiles as the safer floor.`
        : `If you need stability, ${b.name} profiles as the safer floor.`

  const compareQ = new URLSearchParams({
    playerA: a.name,
    playerB: b.name,
    sport: engine.sport,
  })
  const chimmyQ = new URLSearchParams({
    prompt: `Start vs sit: ${a.name} or ${b.name}? Explain using my league scoring and this week's context.`,
    leagueId: args.leagueId,
    sport: engine.sport,
  })
  if (args.teamId) chimmyQ.set('teamId', args.teamId)
  if (args.weekOrPeriod) {
    const digits = args.weekOrPeriod.replace(/\D/g, '')
    const wn = digits ? parseInt(digits, 10) : NaN
    if (Number.isFinite(wn)) chimmyQ.set('week', String(wn))
  }

  const rosterPath = args.teamId
    ? `/app/league/${encodeURIComponent(args.leagueId)}/roster/${encodeURIComponent(args.teamId)}`
    : `/app/league/${encodeURIComponent(args.leagueId)}`

  return {
    ok: true,
    winner: strat.winner,
    confidence_pct: strat.confidence_pct,
    floor_pick,
    upside_pick,
    short_verdict,
    full_reasoning,
    factor_comparison,
    deterministic_deltas: deltas,
    if_need_upside,
    if_need_floor,
    risk_flags: riskFlags(a, b),
    news_flags: newsFlags(a, b),
    actions: {
      set_lineup: {
        href: rosterPath,
        label: 'Set lineup',
      },
      compare_again: {
        href: `/player-comparison-lab?${compareQ.toString()}`,
        label: 'Compare again',
      },
      ask_chimmy: {
        href: `/chimmy/chat?${chimmyQ.toString()}`,
        label: 'Ask Chimmy',
      },
    },
    deterministic,
    playerA: a,
    playerB: b,
    sport: engine.sport,
    strategy_mode: args.strategyMode,
    lineup_slot: args.lineupSlot ?? null,
    week_or_period: args.weekOrPeriod ?? null,
    missing_data: missing,
    explanation_source: explanation.source,
    coach_lens,
  }
}
