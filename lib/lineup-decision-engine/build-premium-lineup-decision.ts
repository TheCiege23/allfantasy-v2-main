import { optimizeLineupDeterministic } from '@/lib/lineup-optimizer-engine/LineupOptimizerEngine'
import type { LineupOptimizerResult, OptimizerPlayerInput } from '@/lib/lineup-optimizer-engine/types'
import { findBestInjuryReplacement, isZeroParticipationWithSignals } from './auto-sub-engine'
import { displaySportLabel, resolveExtendedLineupSport, type ExtendedLineupSport } from './lineup-sport'
import { getSportSignalHints } from './sport-adapters'
import type { EnrichedPlayer, LineupDecisionMode, PremiumLineupDecisionInput, TeamContextInput } from './types'
import { enrichPremiumPlayer } from './enrich-player'
import { normalizePreferenceProfile } from './preference-learning'
import { PremiumLineupDecisionJsonSchema } from './schema'

function roundToTenth(value: number): number {
  return Math.round(value * 10) / 10
}

const DEFAULT_MODE: LineupDecisionMode = 'Best Lineup'

function strategyFromContext(team?: TeamContextInput, winProb?: number): string {
  const w = winProb ?? team?.projectedWinProbability
  const dir = team?.teamDirection
  if (dir === 'favorite' || (w != null && w >= 0.62)) {
    return 'Lean safer profiles and stable roles; protect projected margin.'
  }
  if (dir === 'underdog' || (w != null && w <= 0.42)) {
    return 'Lean ceiling and swing spots where legal; accept some volatility for win equity.'
  }
  if (dir === 'bubble' || team?.isPlayoffWeek) {
    return 'Balance floor on locked roles with selective upside where tie-breakers matter.'
  }
  return 'Default: maximize median expected value with matchup and health context.'
}

export interface PremiumLineupDecisionJson {
  lineupMode: LineupDecisionMode
  teamContext: {
    record: string
    rank: number
    projectedWinProbability: number
    teamDirection: NonNullable<TeamContextInput['teamDirection']>
    strategyRecommendation: string
  }
  optimizedLineup: Array<{
    slot: string
    playerName: string
    position: string
    team: string
    weeklyStartScore: number
    startConfidence: number
    ceilingScore: number
    floorScore: number
    volatilityScore: number
    reason: string[]
    usedPreferenceTieBreaker: boolean
  }>
  benchDecisions: Array<{
    playerName: string
    position: string
    benchReason: string[]
    swapPriority: number
  }>
  startSitCalls: Array<{
    slot: string
    startPlayer: string
    sitPlayer: string
    edgeType: 'floor' | 'ceiling' | 'matchup' | 'health' | 'usage' | 'preference' | 'legality'
    confidence: number
    explanation: string
  }>
  autoSubRules: {
    enabled: boolean
    injuryOnly: true
    eligibleStatuses: string[]
    notes: string[]
  }
  autoSubPreview: Array<{
    ifStarterStatus: string
    starterToReplace: string
    replacementPlayer: string
    replacementReason: string
    usedPreferenceTieBreaker: boolean
    slotCode: string
    confidence: number
    samePositionReplacement: boolean
  }>
  /** Inactive starter but no legal bench replacement */
  autoSubBlocked: Array<{
    starterName: string
    slotCode: string
    status: string
    reason: string
  }>
  preferenceProfileSummary: {
    activeTraits: string[]
    preferenceConfidence: number
    notes: string[]
  }
  alerts: string[]
}

function toLegacyResult(
  deterministic: LineupOptimizerResult,
  enriched: EnrichedPlayer[],
  sport: ExtendedLineupSport
): LineupOptimizerResult {
  const byId = new Map(enriched.map((e) => [e.id, e]))
  const starters = deterministic.starters.map((row) => {
    const pl = byId.get(row.playerId)
    const pts = pl?.projectedPoints ?? row.projectedPoints
    return { ...row, projectedPoints: roundToTenth(pts) }
  })
  const bench = deterministic.bench.map((row) => {
    const pl = byId.get(row.playerId)
    const pts = pl?.projectedPoints ?? row.projectedPoints
    return { ...row, projectedPoints: roundToTenth(pts) }
  })
  const totalProjectedPoints = roundToTenth(starters.reduce((sum, s) => sum + s.projectedPoints, 0))
  const notes: string[] = []
  notes.push(`Deterministic optimizer maximized ${sport} mode-weighted objective; totals shown use raw projections.`)
  if (deterministic.unfilledSlots.length > 0) {
    notes.push(`Unfilled required slots: ${deterministic.unfilledSlots.map((slot) => slot.slotCode).join(', ')}.`)
  } else {
    notes.push('All required lineup slots were filled with eligible players.')
  }
  if (bench.length > 0) {
    notes.push(`Top bench projection: ${bench[0].playerName} (${bench[0].projectedPoints.toFixed(1)}).`)
  }
  return {
    sport: sport as LineupOptimizerResult['sport'],
    totalProjectedPoints,
    starters,
    bench,
    unfilledSlots: deterministic.unfilledSlots,
    deterministicNotes: notes,
  }
}

export function buildPremiumLineupDecision(input: PremiumLineupDecisionInput): {
  json: PremiumLineupDecisionJson
  sportKey: string
  legacyResult: LineupOptimizerResult
} {
  const mode = input.lineupMode ?? DEFAULT_MODE
  const team = input.teamContext
  const league = input.leagueContext
  const preference = normalizePreferenceProfile(input.preferenceProfile)

  const ctx = { lineupMode: mode, team, league, preference }

  const enriched: EnrichedPlayer[] = input.players.map((p) => enrichPremiumPlayer(p, mode, ctx))
  const byId = new Map(enriched.map((e) => [e.id, e]))

  const optimPlayers: OptimizerPlayerInput[] = enriched.map((e) => ({
    id: e.id,
    name: e.name,
    team: e.team,
    positions: e.positions,
    projectedPoints: e.breakdown.effectiveObjectiveScore,
  }))

  const sportResolved = resolveExtendedLineupSport(input.sport)
  const sportKey = String(sportResolved)

  const deterministic = optimizeLineupDeterministic({
    sport: sportKey,
    players: optimPlayers,
    slots: input.slots,
  })

  const starterIds = new Set(deterministic.starters.map((s) => s.playerId))
  const benchEnriched = enriched.filter((e) => !starterIds.has(e.id)).sort(
    (a, b) => b.breakdown.weeklyStartScore - a.breakdown.weeklyStartScore
  )

  const optimizedLineup = deterministic.starters.map((row) => {
    const pl = byId.get(row.playerId)
    const hints = getSportSignalHints(sportKey)
    const reasons: string[] = [
      `Weekly Start Score ${pl ? pl.breakdown.weeklyStartScore.toFixed(1) : '—'} (${mode}) using deterministic weights before AI narration.`,
      pl
        ? `Volatility ${pl.breakdown.volatilityScore.toFixed(1)} vs floor ${pl.breakdown.floorScore.toFixed(1)} / ceiling ${pl.breakdown.ceilingScore.toFixed(1)}.`
        : 'Scores unavailable for this player row.',
      `Sport context (${displaySportLabel(sportKey)}): ${hints.primary.slice(0, 3).join(', ')}.`,
    ]
    if (team?.projectedWinProbability != null) {
      reasons.push(`Team win probability context: ${(team.projectedWinProbability * 100).toFixed(0)}%.`)
    }
    return {
      slot: row.slotCode,
      playerName: row.playerName,
      position: row.selectedPosition,
      team: row.playerTeam ?? '',
      weeklyStartScore: pl?.breakdown.weeklyStartScore ?? 0,
      startConfidence: pl?.breakdown.startConfidence ?? 0,
      ceilingScore: pl?.breakdown.ceilingScore ?? 0,
      floorScore: pl?.breakdown.floorScore ?? 0,
      volatilityScore: pl?.breakdown.volatilityScore ?? 0,
      reason: reasons,
      usedPreferenceTieBreaker: false,
    }
  })

  const benchDecisions = benchEnriched.map((b) => ({
    playerName: b.name,
    position: b.positions[0] ?? '—',
    benchReason: [
      `Below ${mode} objective vs current starters (swap priority ${b.breakdown.swapPriority.toFixed(1)}).`,
      `Bench cost / opportunity: ${b.breakdown.benchCost.toFixed(1)}.`,
    ],
    swapPriority: Math.round(b.breakdown.swapPriority),
  }))

  const startSitCalls: PremiumLineupDecisionJson['startSitCalls'] = []
  for (const bench of benchEnriched.slice(0, 8)) {
    const starter = optimizedLineup.find(
      (s) => s.position === bench.positions[0] || bench.positions.includes(s.position)
    )
    if (!starter) continue
    const edge =
      bench.breakdown.ceilingScore - starter.ceilingScore > 8
        ? ('ceiling' as const)
        : bench.breakdown.floorScore > starter.floorScore + 5
          ? ('floor' as const)
          : ('matchup' as const)
    startSitCalls.push({
      slot: starter.slot,
      startPlayer: starter.playerName,
      sitPlayer: bench.name,
      edgeType: edge,
      confidence: Math.min(95, Math.abs(starter.weeklyStartScore - bench.breakdown.weeklyStartScore)),
      explanation: `Start ${starter.playerName} over ${bench.name}: higher ${mode} objective and confidence ${starter.startConfidence.toFixed(
        0
      )} vs bench priority ${bench.breakdown.swapPriority.toFixed(0)}.`,
    })
  }

  const winProb = team?.projectedWinProbability ?? 0.5
  const favored = winProb >= 0.5

  const autoSubPreview: PremiumLineupDecisionJson['autoSubPreview'] = []
  const autoSubBlocked: PremiumLineupDecisionJson['autoSubBlocked'] = []
  if (input.autoSubEnabled !== false) {
    for (const st of deterministic.starters) {
      const pl = byId.get(st.playerId)
      if (!pl) continue
      if (!isZeroParticipationWithSignals(pl.signals.injuryStatus, pl.signals)) continue
      const rep = findBestInjuryReplacement({
        ineligibleStarter: pl,
        benchPool: benchEnriched,
        favored,
        preferLowerVolatilityWhenFavored: true,
      })
      const starterPos = new Set(pl.positions)
      if (rep) {
        const samePos = rep.replacement.positions.some((p) => starterPos.has(p))
        autoSubPreview.push({
          ifStarterStatus: String(pl.signals.injuryStatus ?? 'Out'),
          starterToReplace: pl.name,
          replacementPlayer: rep.replacement.name,
          replacementReason: rep.replacementReason,
          usedPreferenceTieBreaker: rep.usedPreferenceTieBreaker,
          slotCode: st.slotCode,
          confidence: Math.round(rep.confidence),
          samePositionReplacement: samePos,
        })
      } else {
        autoSubBlocked.push({
          starterName: pl.name,
          slotCode: st.slotCode,
          status: String(pl.signals.injuryStatus ?? 'Out'),
          reason: 'No legal replacement',
        })
      }
    }
  }

  const alerts: string[] = []
  if (league?.bestBallNoManualLineup) {
    alerts.push(
      'Best ball (no manual lineup): start/sit is informational only; scoring uses automatic optimal scoring per league rules.'
    )
  }
  if (league?.c2cOrDevy) {
    alerts.push('C2C/Devy: ensure college vs pro eligibility matches your league layer before locking.')
  }
  if (deterministic.unfilledSlots.length > 0) {
    alerts.push(`Unfilled slots: ${deterministic.unfilledSlots.map((u) => u.slotCode).join(', ')} — add legal players or adjust positions.`)
  }

  const activeTraits: string[] = []
  if (preference?.prefersHighCeiling && preference.prefersHighCeiling > 0.4) activeTraits.push('prefers_high_ceiling')
  if (preference?.prefersStableVeterans && preference.prefersStableVeterans > 0.4) activeTraits.push('prefers_stable_veterans')
  if (preference?.prefersRookies && preference.prefersRookies > 0.4) activeTraits.push('prefers_rookies')
  if (preference?.prefersConsistency && preference.prefersConsistency > 0.4) activeTraits.push('prefers_consistency')

  const jsonRaw: PremiumLineupDecisionJson = {
    lineupMode: mode,
    teamContext: {
      record: team?.record ?? '—',
      rank: team?.rank ?? 0,
      projectedWinProbability: team?.projectedWinProbability ?? 0,
      teamDirection: team?.teamDirection ?? 'neutral',
      strategyRecommendation: strategyFromContext(team, team?.projectedWinProbability),
    },
    optimizedLineup,
    benchDecisions,
    startSitCalls,
    autoSubRules: {
      enabled: input.autoSubEnabled !== false,
      injuryOnly: true,
      eligibleStatuses: [
        'Out',
        'IR',
        'Injured Reserve',
        'Suspended',
        'Inactive',
        'Ruled Out',
        'Did Not Travel',
        'Not In Squad',
        'Not Active',
        'Scratched',
      ],
      notes: [
        'Only replace starters when they are officially unable to score',
        'Do not auto-swap healthy starters for optimization reasons',
      ],
    },
    autoSubPreview,
    autoSubBlocked,
    preferenceProfileSummary: {
      activeTraits,
      preferenceConfidence: preference?.preferenceWeight != null ? Math.round(preference.preferenceWeight * 100) : 0,
      notes:
        activeTraits.length > 0
          ? ['Preferences applied as light tie-breakers on close calls; strong objective edges still win.']
          : ['No strong preference profile supplied; using neutral tie-breaks.'],
    },
    alerts,
  }

  const json = PremiumLineupDecisionJsonSchema.parse(jsonRaw)
  const legacyResult = toLegacyResult(deterministic, enriched, sportResolved)
  return { json, sportKey, legacyResult }
}
