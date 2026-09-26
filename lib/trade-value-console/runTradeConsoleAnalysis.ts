import 'server-only'

import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { getPlayer } from '@/lib/data/players'
import { evaluateCounterOffers } from './counterOffers'
import { prepareProposalCap, proposalCapNote } from './proposalCap'
import { compositeScore } from '@/lib/hybrid-valuation'
import { computeValueFairness } from '@/lib/lineup-optimizer'
import { computeTradeDrivers } from '@/lib/trade-engine/trade-engine'
import { buildInstantNegotiationToolkit, buildNegotiationToolkit } from '@/lib/trade-engine/negotiation-builder'
import {
  buildGptInputContract,
  buildGptUserPrompt,
  validateGptNarrativeOutput,
  shouldSkipGpt,
  GPT_NARRATIVE_SYSTEM_PROMPT,
} from '@/lib/trade-engine/gpt-input-contract'
import type { Asset } from '@/lib/trade-engine/types'
import { getCalibratedWeights } from '@/lib/trade-engine/accept-calibration'
import { logTradeOfferEvent } from '@/lib/trade-engine/trade-event-logger'
import { logNarrativeValidation } from '@/lib/trade-engine/narrative-validation-logger'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { prisma } from '@/lib/prisma'
import type { PhaseTimer } from '@/lib/logging/phaseTimer'
import { leagueWantsLongHorizon, resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import type { NormalizedLeagueContext } from '@/lib/league-context-engine/types'
import {
  attachSportsNormalizationToChimmyPayload,
  resolveNormalizedPlayerSportsProfiles,
} from '@/lib/sports-data-normalization'
import { loadLeagueForTrade } from './league-loader'
import { snapshotFromLoaded } from './quick-badges'
import { pricedAssetToEngineAsset } from './priced-asset-to-asset'
import { buildTradeIntelligence } from './build-trade-intelligence'
import { presentTradeConsoleVerdict } from './verdictPresentation'
import { enrichTradeConsolePlayerLines, sumEffectiveProjections } from './tradeProjectionEnrichment'
import {
  formatStructuredContextForReasoning,
  highlightsFromStructuredNotes,
  loadLeagueStructuredContextNotes,
} from './load-league-structured-context'
import { attachIntelligenceToChimmyPayload, buildAiToolPayload } from '@/lib/intelligence'
import { clamp } from './sports-db-valuation'
import { applyChartTePremium, resolveAssets, resolveLeagueTradeChart } from './leagueTradePricing'
import { gradePricedSides } from '@/lib/decision-os/trade/leagueTradeGrader'
import { tradeGradeLabel } from '@/lib/decision-os/trade/tradeGrade'
import {
  benchAssetsNotInGive,
  inferThinPositionsFromRoster,
  loadTradeEngineRosterContext,
  type TradeEngineRosterContext,
} from './roster-context-loader'
import { assertLeagueMemberWithCode } from '@/lib/league/league-access'
import { leagueTypeBasis } from '@/lib/league/leagueTypeGrading'
import { leagueToolAccessUserMessage } from '@/lib/ai-tools/league-tool-access-messages'
import type { AiToolPayloadEnvelope } from '@/lib/intelligence/buildAiToolPayload'
import type {
  TradeAssetInput,
  TradeConsoleAnalyzeInput,
  TradeConsoleAnalyzeOutput,
  TradeConsoleAnalyzeResult,
  TradeConsoleOpponentRosterTarget,
  TradeConsolePlayerLine,
  TradeConsoleRosterSummary,
  TradeConsoleSourceFlags,
  TradeConsoleValidation,
} from './types'

/** Moved to `./leagueTradePricing` with the rest of the pricer; re-exported for its existing test. */
export { lineFromPriced } from './leagueTradePricing'

async function loadLeagueTradeHistoryNote(leagueId: string | null | undefined): Promise<string | null> {
  if (!leagueId) return null
  try {
    const league = await prisma.league.findFirst({
      where: { id: leagueId },
      select: { platformLeagueId: true },
    })
    if (!league?.platformLeagueId) {
      return 'Platform league id missing — import/connect this league to enable trade-archive context.'
    }
    const tradeCount = await prisma.leagueTrade.count({
      where: { history: { sleeperLeagueId: league.platformLeagueId } },
    })
    const agg = await prisma.leagueTradeHistory.aggregate({
      where: { sleeperLeagueId: league.platformLeagueId },
      _sum: { tradesLoaded: true },
    })
    if (tradeCount === 0 && (agg._sum.tradesLoaded ?? 0) === 0) {
      return 'No imported league trades on file for this platform league yet.'
    }
    return `${tradeCount} stored trades in archive; sync aggregate ${agg._sum.tradesLoaded ?? 0} rows loaded.`
  } catch {
    return null
  }
}

function isMultisportLeague(settings: Record<string, unknown> | null | undefined): boolean {
  if (!settings) return false
  const m = settings.multisport ?? settings.multiSport ?? settings.isMultisport
  if (m === true) return true
  const sports = settings.sports
  if (Array.isArray(sports) && sports.length > 1) return true
  return false
}

function buildTradeConsoleValidation(args: {
  leagueNormCtx: NormalizedLeagueContext | null
  giveLines: TradeConsolePlayerLine[]
  getLines: TradeConsolePlayerLine[]
  rosterLineup: boolean
}): TradeConsoleValidation {
  const lines = [...args.giveLines, ...args.getLines]
  const projectionLayerReady = lines.some(
    (l) => l.effectiveProjection != null && Number.isFinite(l.effectiveProjection),
  )
  const injuryNewsLayerReady = lines.some((l) => !!(l.injuryNewsSummary?.trim() || l.injuryStatus?.trim()))
  return {
    leagueContextResolved: args.leagueNormCtx != null,
    scoringAppliedToProjections: args.leagueNormCtx != null && projectionLayerReady,
    rosterContextAvailable: args.rosterLineup,
    projectionLayerReady,
    injuryNewsLayerReady,
  }
}

export async function runTradeConsoleAnalysis(
  input: TradeConsoleAnalyzeInput,
  /*
   * Optional phase attribution. A SECOND ARGUMENT rather than a field on the input, because
   * `TradeConsoleAnalyzeInput` is the parsed request body — putting a live object on it would make
   * the request shape and the call shape disagree, and the zod schema could never describe it.
   * Omit it and every existing caller is byte-identical.
   */
  opts?: { timer?: PhaseTimer },
): Promise<TradeConsoleAnalyzeOutput> {
  const mark = (name: string): void => opts?.timer?.mark(name)
  const give = input.sideGive ?? []
  const get = input.sideGet ?? []
  if (give.length === 0 || get.length === 0) {
    return { ok: false, error: 'Add at least one asset on each side.', code: 'EMPTY' }
  }

  if (input.leagueId?.trim()) {
    if (!input.userId) {
      return {
        ok: false,
        error: 'Sign in required to analyze trades with a league context.',
        code: 'MISSING_USER_CONTEXT',
        userMessage: leagueToolAccessUserMessage('MISSING_USER_CONTEXT'),
      }
    }
    const mem = await assertLeagueMemberWithCode(input.leagueId.trim(), input.userId)
    mark('league_member')
    if (!mem.ok) {
      const um = leagueToolAccessUserMessage(mem.code)
      return { ok: false, error: um, code: mem.code, userMessage: um }
    }
  }

  let leagueRow = null as Awaited<ReturnType<typeof loadLeagueForTrade>> | null
  if (input.leagueId && input.userId) {
    leagueRow = await loadLeagueForTrade({
      leagueId: input.leagueId.trim(),
      userId: input.userId,
      membershipPreverified: true,
    })
  }

  const leagueSnapshot = leagueRow ? snapshotFromLoaded(leagueRow) : null

  let leagueNormCtx: NormalizedLeagueContext | null = null
  if (input.leagueId?.trim() && input.userId) {
    const lc = await resolveNormalizedLeagueContext({
      userId: input.userId,
      leagueId: input.leagueId.trim(),
    })
    if (lc.ok) leagueNormCtx = lc.context
  }

  let effectiveSport: SupportedSport | 'MIXED' = 'NFL'
  if (input.sportFilter === 'ALL') {
    const hinted = [...give, ...get]
      .filter((x): x is Extract<TradeAssetInput, { kind: 'player' }> => x.kind === 'player')
      .map((x) => x.sportHint)
      .filter(Boolean)
    if (hinted[0]) {
      effectiveSport = normalizeToSupportedSport(hinted[0])
    } else if (leagueSnapshot) {
      effectiveSport = leagueSnapshot.sport
    } else {
      effectiveSport = 'NFL'
    }
  } else {
    effectiveSport = normalizeToSupportedSport(input.sportFilter)
  }

  const sportSet = new Set<SupportedSport>()
  const collectSports = async () => {
    for (const side of [...give, ...get]) {
      if (side.kind !== 'player') continue
      if (side.playerId) {
        // The league's sport reads a bare roster id (a Sleeper id) — see `getPlayer`.
        const r = await getPlayer(side.playerId.trim(), { sport: side.sportHint ?? leagueSnapshot?.sport ?? null })
        if (r?.sport) sportSet.add(normalizeToSupportedSport(r.sport))
      } else if (side.sportHint) {
        sportSet.add(normalizeToSupportedSport(side.sportHint))
      }
    }
  }
  await collectSports()
  mark('collect_sports')

  if (sportSet.size > 1) {
    const allow =
      input.allowMultisportFairness ||
      (leagueSnapshot && isMultisportLeague(leagueSnapshot.settings))
    if (!allow) {
      return {
        ok: false,
        error:
          'These assets map to multiple sports. Pick one sport, one league, or enable a multisport league to trade across sports.',
        code: 'CROSS_SPORT',
      }
    }
    effectiveSport = 'MIXED'
  } else if (sportSet.size === 1) {
    effectiveSport = [...sportSet][0]!
  }

  if (effectiveSport === 'MIXED') {
    return {
      ok: false,
      error: 'Mixed-sport fairness is not enabled for this context.',
      code: 'CROSS_SPORT',
    }
  }

  const dataGaps: string[] = []

  if (!leagueSnapshot) {
    dataGaps.push(
      'Global mode: no opponent roster, so rebalance suggestions and alternate targets are omitted. Select a league for negotiation-grade output.',
    )
  }
  const chart = await resolveLeagueTradeChart({
    leagueRow,
    leagueSnapshot,
    leagueNormCtx,
    overrides: {
      leagueSize: input.leagueSize,
      tePremium: input.tePremium,
      isSuperFlex: input.isSuperFlex,
      waiverBudget: input.waiverBudget,
    },
    mark,
  })
  // The chart and its request settings now live in `leagueTradePricing.ts`, shared with every grade.
  const { marketCtx, tePremium, isSuperFlex, waiverBudget, fcPlayers, nflCtx } = chart

  let { priced: givePriced, lines: giveLines, unresolved: giveUnresolved } = await resolveAssets(give, {
    effectiveSport,
    nflCtx,
    waiverBudget,
    dataGaps,
    fcPlayers,
  })
  mark('assets_give')
  let { priced: getPriced, lines: getLines, unresolved: getUnresolved } = await resolveAssets(get, {
    effectiveSport,
    nflCtx,
    waiverBudget,
    dataGaps,
    fcPlayers,
  })

  const unresolved = [...giveUnresolved, ...getUnresolved]
  if (unresolved.length > 0) {
    const list = unresolved.slice(0, 6).join(', ')
    const msg = `Could not resolve ${unresolved.length} player${unresolved.length === 1 ? '' : 's'} in the ${effectiveSport} database: ${list}${unresolved.length > 6 ? '…' : ''}. Fix spelling or use the player search before analyzing.`
    return {
      ok: false,
      error: msg,
      code: 'PLAYER_NOT_FOUND',
      userMessage: msg,
      unresolvedAssets: unresolved,
    }
  }

  mark('assets_get')
  const [giveEnriched, getEnriched] = await Promise.all([
    enrichTradeConsolePlayerLines({
      prisma,
      sport: effectiveSport,
      leagueScoring: leagueNormCtx?.scoring,
      lines: giveLines,
    }),
    enrichTradeConsolePlayerLines({
      prisma,
      sport: effectiveSport,
      leagueScoring: leagueNormCtx?.scoring,
      lines: getLines,
    }),
  ])
  mark('enrich')
  giveLines = giveEnriched
  getLines = getEnriched

  if (givePriced.length === 0 || getPriced.length === 0) {
    return { ok: false, error: 'Could not price assets on both sides.', code: 'VALIDATION' }
  }

  const gP = applyChartTePremium(chart, givePriced)
  const tP = applyChartTePremium(chart, getPriced)

  const giveMarket = gP.reduce((s, a) => s + a.assetValue.marketValue, 0)
  const getMarket = tP.reduce((s, a) => s + a.assetValue.marketValue, 0)

  /*
   * ── THE VERDICT IS GRADED ON LEAGUE VALUE (Guap, 2026-09-24) ─────────────────────────────────
   *
   * 🛑 IT WAS GRADED ON A NUMBER NOBODY COULD SEE. `percentDiff` came from `compositeTotal` —
   * `impactValue + vorpValue − risk`, where `impactValue` is the player's REDRAFT value — while every
   * line on screen showed his dynasty MARKET value. A dynasty trade was shown in one currency and
   * graded in another, and a manager checking the arithmetic could never make it add up.
   *
   * Now each line starts from its market value on THIS league's chart, is moved by this league's
   * scoring and the viewer's roster need (each factor carried with its reason, see
   * `lib/trade-value/leagueTradeValue.ts`), and the grade is the difference of those totals. The
   * composite survives only where it always belonged: the driver model below (accept probability,
   * lineup simulation), which is secondary and labelled as such.
   */
  const graded = await gradePricedSides({
    chart,
    giveLines,
    getLines,
    givePriced: gP,
    getPriced: tP,
    need:
      marketCtx && leagueRow && input.leagueId && input.userId
        ? { leagueId: input.leagueId.trim(), userId: input.userId, sport: String(effectiveSport), starters: leagueRow.starters }
        : null,
    mark,
  })
  const leagueGrade = graded.leagueGrade
  /**
   * THE grade — the same object every other trade surface shows for this deal — with the league type
   * it was priced under and how we know it, as `createLeagueTradeGrader` attaches it. Global mode (no
   * league) has no league type to name.
   */
  const grade = leagueRow
    ? {
        ...graded.grade,
        leagueType: leagueTypeBasis({
          settings: leagueRow.settings,
          leagueType: leagueRow.leagueType,
          platform: leagueRow.platform ?? null,
        }),
      }
    : graded.grade
  giveLines = leagueGrade.giveLines
  getLines = leagueGrade.getLines
  const giveTotal = leagueGrade.totals.giveLeague
  const getTotal = leagueGrade.totals.getLeague
  const fairnessScore = computeValueFairness(getTotal, giveTotal)
  const percentDiff = leagueGrade.totals.percentDiff
  const valueBasis = leagueGrade.valueBasis

  const giveAssets: Asset[] = gP.map((pa) => pricedAssetToEngineAsset(pa))
  const receiveAssets: Asset[] = tP.map((pa) => pricedAssetToEngineAsset(pa))

  let rosterCtxForDrivers: TradeEngineRosterContext | undefined
  let userFaabRemaining: number | null = null
  let availablePicksNegotiation: Array<{
    id: string
    displayName?: string
    round?: number
    season?: number
    value?: number
  }> = []

  const rosterSummary: TradeConsoleRosterSummary = {
    lineupSimulation: false,
    yourRosterPlayers: 0,
    theirRosterPlayers: 0,
    opponentTeams: [],
  }

  if (input.leagueId && input.userId) {
    const rc = await loadTradeEngineRosterContext({
      leagueId: input.leagueId,
      userId: input.userId,
      opponentTeamExternalId: input.opponentTeamExternalId ?? null,
      effectiveSport,
      nflCtx,
      dataGaps,
    })
    rosterCtxForDrivers = rc.rosterCtx ?? undefined
    userFaabRemaining = rc.userFaabRemaining
    availablePicksNegotiation = rc.availablePicks
    rosterSummary.lineupSimulation = !!rc.rosterCtx
    rosterSummary.yourRosterPlayers = rc.yourAssetCount
    rosterSummary.theirRosterPlayers = rc.theirAssetCount
    rosterSummary.opponentTeams = rc.opponentTeams
  }

  mark('roster_context')

  const calWeights = await getCalibratedWeights()
  mark('calibrated_weights')
  let drivers
  try {
    drivers = computeTradeDrivers(
      giveAssets,
      receiveAssets,
      null,
      null,
      isSuperFlex,
      tePremium,
      rosterCtxForDrivers,
      undefined,
      undefined,
      undefined,
      undefined,
      calWeights,
    )
  } catch (e) {
    console.warn('[trade-value-console] computeTradeDrivers failed', e)
    return { ok: false, error: 'Unable to evaluate trade drivers.', code: 'VALIDATION' }
  }

  const rawConfidence = drivers.confidenceRating as 'HIGH' | 'MEDIUM' | 'LOW' | 'LEARNING'
  const confidence: 'MEDIUM' | 'LOW' =
    rawConfidence === 'HIGH' ? 'MEDIUM' : rawConfidence === 'LOW' ? 'LOW' : 'MEDIUM'
  // Confidence cap scales with data quality — degraded signals lower the ceiling,
  // so a user never sees "90% confident" on a trade priced with gaps.
  const rawConfScore = drivers.confidenceScore ?? 50
  const isLeagueMode = Boolean(input.leagueId?.trim())
  const leagueCtxMissing = isLeagueMode && !leagueNormCtx
  const confCap =
    dataGaps.length >= 3 || leagueCtxMissing
      ? 55
      : dataGaps.length > 0
        ? 72
        : 88
  const confidenceScore = Math.max(10, Math.min(rawConfScore, confCap))

  /*
   * ⚠ THE LABEL READS OFF THE GRADE'S OWN BANDS (2026-09-24). It used to measure the gap against the
   * SUM of both sides at 4%/12% while the letter measured it against the LARGER side at 10%/25%, so
   * an 8% edge read "Slightly favors you" beside a C. One number decides both now — see
   * `lib/decision-os/trade/tradeGrade.ts`.
   */
  const { label: fairnessLabel, sideAdvantage: gradedAdvantage } = tradeGradeLabel(percentDiff)
  const sideAdvantage: 'even' | 'you' | 'opponent' | 'mixed' = gradedAdvantage

  const degraded =
    dataGaps.length > 0 ||
    [...giveLines, ...getLines].some((l) => l.dataSource === 'placeholder')

  const giveProjSum = sumEffectiveProjections(giveLines)
  const getProjSum = sumEffectiveProjections(getLines)
  const netProj =
    giveProjSum != null && getProjSum != null
      ? Math.round((getProjSum - giveProjSum) * 10) / 10
      : null

  const projectedImpactBlock = {
    giveTotal: giveProjSum,
    getTotal: getProjSum,
    net: netProj,
    summary:
      giveProjSum != null && getProjSum != null
        ? 'Net = sum(get) − sum(give) of league-scored weekly projections (injury → weather → scoring stack) for players with DB rows — short-term add/drop signal, not dynasty market value.'
        : 'Add league + player rows with projections to unlock scoring-adjusted weekly impact alongside market composites.',
  }

  const scoringSummaryLine = leagueNormCtx
    ? `Normalized scoring: ${leagueNormCtx.scoring.scoringModel} · receptions ${leagueNormCtx.scoring.labels.receptionFormat} · superflex ${leagueNormCtx.scoring.labels.isSuperflex ? 'on' : 'off'}.`
    : leagueSnapshot?.scoring
      ? `League scoring label: ${leagueSnapshot.scoring}.`
      : null

  const injuryImpactNote = (() => {
    const bits: string[] = []
    for (const l of giveLines.concat(getLines)) {
      if (l.injuryStatus) bits.push(`${l.name}: ${l.injuryStatus}`)
      if (l.injuryNewsSummary) bits.push(`${l.name} (news): ${l.injuryNewsSummary}`)
      if (l.trendHint) bits.push(`${l.name} (usage/trend): ${l.trendHint}`)
    }
    return bits.slice(0, 8).join(' · ') || 'No structured injury, news, or trend flags on these assets.'
  })()

  const secondary = {
    rawValue: {
      give: Math.round(giveTotal),
      get: Math.round(getTotal),
      deltaPct: percentDiff,
    },
    teamFit: {
      grade: drivers.labels[0] ?? 'Fit',
      note:
        rosterSummary.lineupSimulation && drivers.lineupDelta?.hasLineupData
          ? `Lineup PPG: you ${drivers.lineupDelta.deltaYou >= 0 ? '+' : ''}${drivers.lineupDelta.deltaYou}, them ${drivers.lineupDelta.deltaThem >= 0 ? '+' : ''}${drivers.lineupDelta.deltaThem}. ${drivers.driverNarrative || ''}`.trim()
          : drivers.driverNarrative || 'Fit driven by market and VORP deltas.',
    },
    risk: {
      grade: drivers.labels[1] ?? 'Risk',
      note: drivers.riskFlags[0] ?? 'Volatility differs by asset; see player injury states.',
    },
    scheduleImpact: {
      note: 'Review the schedule and bye-week notes below. A schedule-strength adjustment is not included in the league-value grade.',
    },
    injuryImpact: {
      note: injuryImpactNote,
    },
    scoringContext: {
      note: scoringSummaryLine ?? 'No league context engine — using sport defaults and trade-league hints only.',
    },
    projectionImpact: projectedImpactBlock,
    shortTermOutlook: {
      note: `Market delta ~${percentDiff}%. Lean: ${drivers.lean}.${netProj != null ? ` Projection net (weekly stack): ${netProj >= 0 ? '+' : ''}${netProj}.` : ''}`,
    },
    longTermOutlook: {
      note: leagueSnapshot?.isDynasty
        ? 'Dynasty context — long-term weight uses dynasty/API values where available.'
        : 'Redraft-weighted outlook from rest-of-season signals.',
    },
    positionalScarcity: {
      note: Object.keys(drivers.positionScarcity || {}).length
        ? JSON.stringify(drivers.positionScarcity)
        : 'Positional scarcity blended into trade drivers.',
    },
    leagueImpact: {
      note: leagueSnapshot
        ? `League: ${leagueSnapshot.name} (${leagueSnapshot.sport})${
            rosterSummary.lineupSimulation
              ? ` · Lineup context: ${rosterSummary.yourRosterPlayers} roster players priced for you, ${rosterSummary.theirRosterPlayers} for selected opponent`
              : ''
          }`
        : 'General analysis — not tied to a specific league roster.',
    },
    contenderScore: clamp(55 + (drivers.marketScore ?? 0) * 20 - (degraded ? 10 : 0), 0, 100),
    rebuilderScore: clamp(50 + (drivers.vorpScore ?? 0) * 18 - (degraded ? 8 : 0), 0, 100),
  }

  const driverPayload = {
    scoringMode: drivers.scoringMode,
    dominantDriver: drivers.dominantDriver,
    scores: {
      lineupImpact: Math.round(drivers.lineupImpactScore * 100) / 100,
      vorp: Math.round(drivers.vorpScore * 100) / 100,
      market: Math.round(drivers.marketScore * 100) / 100,
      behavior: Math.round(drivers.behaviorScore * 100) / 100,
    },
    derived: {
      totalScore: drivers.totalScore,
      fairnessDelta: drivers.fairnessDelta,
      acceptProbability: drivers.acceptProbability,
      confidenceScore,
      confidenceRating: confidence,
    },
    verdict: drivers.verdict,
    lean: drivers.lean,
    labels: drivers.labels,
    riskFlags: drivers.riskFlags,
    driverNarrative: drivers.driverNarrative,
    confidenceDrivers: drivers.confidenceDrivers,
  }

  const gptContract = buildGptInputContract('INSTANT', drivers)
  const sfContext = isSuperFlex
    ? `\n\nLeague Format: Superflex — QBs carry extra trade weight.`
    : ''
  /*
   * The narrative is told what the grade is actually priced in. The old line claimed a flat "~15%
   * TE boost", which in a league is no longer true — the premium is the league's own reception rule,
   * per position, and it is listed per asset below.
   */
  const leagueAdjustmentLines = [...giveLines, ...getLines]
    .filter((l) => (l.valueAdjustments ?? []).length > 0)
    .slice(0, 8)
    .map((l) => `${l.name}: ${(l.valueAdjustments ?? []).map((a) => `${a.factor > 1 ? '+' : '−'}${Math.abs(Math.round((a.factor - 1) * 100))}% (${a.reason})`).join('; ')}`)
  const tepContext = marketCtx
    ? `\n\nValues graded on: ${valueBasis.label}.${leagueAdjustmentLines.length > 0 ? ` League adjustments — ${leagueAdjustmentLines.join(' | ')}.` : ''}`
    : tePremium
      ? `\n\nLeague Format: Tight End Premium (~15% TE boost).`
      : ''
  const scoringCtx = scoringSummaryLine ? `\n\n${scoringSummaryLine}` : ''
  const projContext =
    projectedImpactBlock.giveTotal != null && projectedImpactBlock.getTotal != null
      ? `\n\nLeague-scored weekly projection stack (real DB projections, short-term): give sum ${projectedImpactBlock.giveTotal.toFixed(1)}, get sum ${projectedImpactBlock.getTotal.toFixed(1)}, net ${projectedImpactBlock.net ?? 'n/a'}.`
      : ''

  let aiNarrative: { bullets: Array<{ text: string; driverId: string }>; sensitivity: { text: string; driverId: string } } | null =
    null

  if (!input.skipAi) {
    const skipCheck = shouldSkipGpt(gptContract)
    if (skipCheck === 'ok') {
      try {
        const aiResult = await openaiChatJson({
          messages: [
            {
              role: 'system',
              content:
                GPT_NARRATIVE_SYSTEM_PROMPT +
                `\n\nDo not invent injuries or news. Only explain using the structured driver data and named assets.`,
            },
            {
              role: 'user',
              content: buildGptUserPrompt(gptContract) + sfContext + tepContext + scoringCtx + projContext,
            },
          ],
          temperature: 0.2,
          maxTokens: 450,
        })
        if (aiResult.ok) {
          const parsed = parseJsonContentFromChatCompletion(aiResult.json)
          if (parsed) {
            const validation = validateGptNarrativeOutput(parsed, gptContract)
            logNarrativeValidation({
              mode: 'TRADE_CONSOLE',
              contractType: 'narrative',
              valid: validation.valid,
              violations: validation.violations,
            }).catch(() => {})
            if (validation.valid && validation.cleaned) {
              aiNarrative = validation.cleaned
            }
          }
        }
      } catch {
        /* deterministic fallback */
      }
    }
  }
  /*
   * ⚠ MARKED OUTSIDE THE `skipAi` BRANCH ON PURPOSE. When the call is skipped this charges ~0ms,
   * which is itself the answer — a near-zero `ai` phase says the LLM is NOT where the seconds go,
   * and that is only visible if the mark still fires.
   */
  mark('ai')

  const evaluation = aiNarrative
    ? { bullets: aiNarrative.bullets.map((b) => b.text), sensitivity: aiNarrative.sensitivity.text }
    : { bullets: drivers.acceptBullets, sensitivity: drivers.sensitivitySentence }

  let opponentRosterTargets: TradeConsoleOpponentRosterTarget[] | undefined
  if (rosterCtxForDrivers?.theirRoster?.length) {
    const receiveIds = new Set(receiveAssets.map((a) => a.id))
    opponentRosterTargets = rosterCtxForDrivers.theirRoster
      .filter((a) => a.type === 'PLAYER' && !receiveIds.has(a.id))
      .map((a) => ({
        id: a.rosterPlayerId ?? a.id,
        name: a.name ?? a.id,
        position: a.pos ?? null,
        marketValue: Math.round(a.marketValue ?? a.value ?? 0),
      }))
      .sort((a, b) => b.marketValue - a.marketValue)
  }

  const evaluateCap = input.leagueId && input.userId
    ? await prepareProposalCap({ leagueId: input.leagueId.trim(), userId: input.userId,
        opponentTeamExternalId: input.opponentTeamExternalId,
        requiresCap: leagueSnapshot?.quickModeBadges.includes('Salary Cap') })
    : async () => ({ status: 'not_applicable' as const })
  const salaryCap = await evaluateCap(input.sideGive, input.sideGet)
  const capNote = proposalCapNote(salaryCap)
  if (capNote) evaluation.bullets.unshift(capNote)
  const counterOffers = await evaluateCounterOffers({
    canRecommend: salaryCap.status === 'not_applicable' ? undefined : async (give, get) => {
      const cap = await evaluateCap(give, get)
      return cap.status === 'evaluated' && cap.legal
    },
    grade: input.opponentTeamExternalId && rosterCtxForDrivers?.theirRoster?.length
      ? grade : { graded: false, reason: 'Select a counterparty with a resolved roster.', basis: null },
    give: input.sideGive,
    get: input.sideGet,
    theirTargets: opponentRosterTargets ?? [],
    yourTargets: (rosterCtxForDrivers?.yourRoster ?? [])
      .filter(a => a.type === 'PLAYER')
      .map(a => ({ id: a.rosterPlayerId ?? a.id, name: a.name ?? a.id, position: a.pos ?? null, marketValue: a.marketValue ?? a.value ?? 0 })),
    evaluate: async (counterGive, counterGet) => {
      const opts = { effectiveSport, nflCtx: chart.nflCtx, waiverBudget: chart.waiverBudget,
        dataGaps: [] as string[], fcPlayers: chart.fcPlayers, resolveEnrichmentIds: false }
      const [g, t] = await Promise.all([resolveAssets(counterGive, opts), resolveAssets(counterGet, opts)])
      if (g.unresolved.length || t.unresolved.length) return { graded: false, reason: 'Counter assets could not be resolved.', basis: null }
      return (await gradePricedSides({
        chart, giveLines: g.lines, getLines: t.lines,
        givePriced: applyChartTePremium(chart, g.priced), getPriced: applyChartTePremium(chart, t.priced),
        need: marketCtx && leagueRow && input.leagueId && input.userId
          ? { leagueId: input.leagueId.trim(), userId: input.userId, sport: String(effectiveSport), starters: leagueRow.starters }
          : null,
      })).grade
    },
  })
  mark('counter_offers')

  let negotiationToolkit: Record<string, unknown> | null = null
  try {
    const hasLeagueNegotiation = !!(input.leagueId && input.userId)
    if (hasLeagueNegotiation) {
      const availableBenchAssets = rosterCtxForDrivers?.yourRoster?.length
        ? benchAssetsNotInGive(rosterCtxForDrivers.yourRoster, giveAssets)
        : []
      const partnerNeeds = rosterCtxForDrivers?.theirRoster?.length
        ? inferThinPositionsFromRoster(rosterCtxForDrivers.theirRoster, effectiveSport)
        : []
      const userNeeds = rosterCtxForDrivers?.yourRoster?.length
        ? inferThinPositionsFromRoster(rosterCtxForDrivers.yourRoster, effectiveSport)
        : []

      negotiationToolkit = buildNegotiationToolkit({
        drivers,
        give: giveAssets,
        receive: receiveAssets,
        availableBenchAssets: availableBenchAssets.length ? availableBenchAssets : undefined,
        availablePicks: availablePicksNegotiation.length ? availablePicksNegotiation : undefined,
        userFaabRemaining: userFaabRemaining ?? undefined,
        partnerNeeds: partnerNeeds.length ? partnerNeeds : undefined,
        userNeeds: userNeeds.length ? userNeeds : undefined,
      }) as unknown as Record<string, unknown>
    } else {
      negotiationToolkit = buildInstantNegotiationToolkit(drivers, giveAssets, receiveAssets) as unknown as Record<
        string,
        unknown
      >
    }
  } catch {
    try {
      negotiationToolkit = buildInstantNegotiationToolkit(drivers, giveAssets, receiveAssets) as unknown as Record<
        string,
        unknown
      >
    } catch {
      negotiationToolkit = null
    }
  }

  logTradeOfferEvent({
    assetsGiven: gP.map((a) => ({ name: a.name, value: compositeScore(a.assetValue), type: a.source })),
    assetsReceived: tP.map((a) => ({ name: a.name, value: compositeScore(a.assetValue), type: a.source })),
    features: {
      lineupImpact: drivers.lineupImpactScore,
      vorp: drivers.vorpScore,
      market: drivers.marketScore,
      behavior: drivers.behaviorScore,
      weights: [0.4, 0.25, 0.2, 0.15],
    },
    acceptProb: drivers.acceptProbability,
    verdict: drivers.verdict,
    confidenceScore: drivers.confidenceScore,
    driverSet: drivers.acceptDrivers.map((d) => ({
      id: d.id,
      evidence: typeof d.evidence === 'string' ? d.evidence : JSON.stringify(d.evidence),
    })),
    mode: 'TRADE_CONSOLE',
  }).catch(() => {})

  const rosterSummaryOut: TradeConsoleRosterSummary = {
    lineupSimulation: rosterSummary.lineupSimulation,
    yourRosterPlayers: rosterSummary.yourRosterPlayers,
    theirRosterPlayers: rosterSummary.theirRosterPlayers,
    opponentTeams: rosterSummary.opponentTeams,
  }

  const [leagueHistoryNote, structuredNotes] = await Promise.all([
    loadLeagueTradeHistoryNote(input.leagueId),
    input.leagueId ? loadLeagueStructuredContextNotes(input.leagueId) : Promise.resolve(null),
  ])
  const structuredExtra = formatStructuredContextForReasoning(structuredNotes)
  const syncedHighlights = highlightsFromStructuredNotes(structuredNotes)

  const injuryNotes = [...giveLines, ...getLines].flatMap((l) => {
    const parts: string[] = []
    if (l.injuryStatus && !['ACT', 'ACTIVE', 'HEALTHY', 'NORMAL'].includes(l.injuryStatus.trim().toUpperCase())) parts.push(`${l.name}: ${l.injuryStatus}`)
    if (l.injuryNewsSummary) parts.push(`${l.name} (aggregated news): ${l.injuryNewsSummary}`)
    return parts
  })

  const tradeIntelligence = buildTradeIntelligence({
    proposalGraded: grade.graded,
    league: leagueSnapshot,
    strategy: input.strategy,
    teamContext: input.teamContext,
    fairnessLabel,
    sideAdvantage,
    percentDiff,
    giveTotal,
    getTotal,
    confidenceScore,
    degraded,
    dataGaps,
    injuryNotes: capNote ? [capNote, ...injuryNotes] : injuryNotes,
    drivers: driverPayload,
    negotiationToolkit,
    opponentRosterTargets: opponentRosterTargets?.map((t) => ({
      name: t.name,
      marketValue: t.marketValue,
      position: t.position,
    })),
    rosterSummary: {
      lineupSimulation: rosterSummaryOut.lineupSimulation,
      yourRosterPlayers: rosterSummaryOut.yourRosterPlayers,
      theirRosterPlayers: rosterSummaryOut.theirRosterPlayers,
    },
    leagueHistoryNote,
    structuredContextExtra: structuredExtra || null,
    syncedDataHighlights: syncedHighlights,
    projectedImpact: projectedImpactBlock,
    scoringSummary: scoringSummaryLine,
  })

  if (input.leagueId && input.opponentTeamExternalId) {
    tradeIntelligence.rebalanceSuggestions = counterOffers.map(counter =>
      `${counter.addTo === 'get' ? 'Ask for' : 'Offer'} ${counter.name}. Re-evaluating the full package gives you ${counter.grade.letter} and your partner ${counter.grade.partnerLetter}: ${Math.abs(counter.grade.percentDiff)}% apart, with ${counter.remainingGap.toLocaleString('en-US')} league value remaining. ${counter.balanced ? 'Within the even-value band.' : 'Closer in value, but still outside the even-value band.'} Re-analyze after editing the proposal.`,
    )
  }

  const validation = buildTradeConsoleValidation({
    leagueNormCtx,
    giveLines,
    getLines,
    rosterLineup: rosterSummaryOut.lineupSimulation,
  })

  const allLines = [...giveLines, ...getLines]
  const sourceFlags: TradeConsoleSourceFlags = {
    fantasyCalcReady: effectiveSport === 'NFL' && fcPlayers.length > 0,
    sportsDataReady: allLines.length > 0 && allLines.every((l) => Boolean(l.playerId)),
    projectionLayerReady: validation.projectionLayerReady,
    injuryNewsLayerReady: validation.injuryNewsLayerReady,
    leagueScoringApplied: validation.scoringAppliedToProjections,
    aiEnvelopeReady: false,
  }

  const shortLbl =
    tradeIntelligence.whoWinsNow === 'you'
      ? 'you'
      : tradeIntelligence.whoWinsNow === 'opponent'
        ? 'opponent'
        : tradeIntelligence.whoWinsNow === 'unknown' ? 'unavailable' : 'even'
  const longLbl =
    tradeIntelligence.whoWinsLongTerm === 'you'
      ? 'you'
      : tradeIntelligence.whoWinsLongTerm === 'opponent'
        ? 'opponent'
        : tradeIntelligence.whoWinsLongTerm === 'unknown' ? 'unavailable' : 'even'

  const presentation = presentTradeConsoleVerdict({ graded: grade.graded, fairnessScore, confidenceScore,
    fairnessLabel, sideAdvantage, confidenceLabel: confidence })
  const summaryLine = grade.graded
    ? `Fairness ${Math.round(fairnessScore)}/100 · asset production ${shortLbl} · league value ${longLbl}${degraded ? ' · degraded inputs' : ''}`
    : `Proposal grade unavailable · ${grade.reason} · asset production ${shortLbl}`

  const dataQuality: 'full' | 'partial' | 'degraded' = degraded
    ? 'degraded'
    : dataGaps.length > 0 || (Boolean(input.leagueId?.trim()) && !leagueNormCtx)
      ? 'partial'
      : 'full'

  let tradeWindow: TradeConsoleAnalyzeResult['tradeWindow'] = null
  if (leagueNormCtx) {
    const cur = leagueNormCtx.matchupPeriod.currentPeriod
    const deadline = leagueNormCtx.trade.tradeDeadlineWeek
    const reviewHours = leagueNormCtx.trade.tradeReviewHours
    const pickTrading = leagueNormCtx.trade.draftPickTrading
    const weeksUntil =
      typeof cur === 'number' && typeof deadline === 'number' ? deadline - cur : null
    const pastDeadline = weeksUntil != null && weeksUntil < 0
    const deadlinePart =
      deadline == null
        ? 'No trade deadline configured for this league.'
        : pastDeadline
          ? `Trade deadline (week ${deadline}) has passed.`
          : weeksUntil === 0
            ? `Trade deadline is THIS week (week ${deadline}).`
            : weeksUntil != null
              ? `Trade deadline in ${weeksUntil} week${weeksUntil === 1 ? '' : 's'} (week ${deadline}).`
              : `Trade deadline: week ${deadline}.`
    const reviewPart =
      reviewHours != null && reviewHours > 0
        ? ` Trade review: ${reviewHours}h.`
        : reviewHours === 0
          ? ' No trade review period — accepted trades process immediately.'
          : ''
    const pickPart =
      pickTrading === true
        ? ' Draft pick trading allowed.'
        : pickTrading === false
          ? ' Draft pick trading disabled — do not include picks.'
          : ''
    tradeWindow = {
      currentPeriod: cur,
      tradeDeadlineWeek: deadline,
      weeksUntilDeadline: weeksUntil,
      pastDeadline,
      tradeReviewHours: reviewHours,
      draftPickTrading: pickTrading,
      note: `${deadlinePart}${reviewPart}${pickPart}`.trim(),
    }
  }

  let chimmyPayload: Record<string, unknown> = {
    tool: 'trade_value_console',
    sport: effectiveSport,
    league: leagueSnapshot,
    leagueContextEngine: leagueNormCtx,
    tradeWindow,
    strategy: input.strategy,
    teamContext: input.teamContext,
    analysisTab: input.analysisTab,
    fairnessScore: presentation.fairnessScore,
    confidenceScore: presentation.confidenceScore,
    grade,
    percentDiff,
    totals: { give: giveTotal, get: getTotal, giveMarket, getMarket },
    assets: { give: giveLines, get: getLines },
    drivers: driverPayload,
    dataGaps,
    degraded,
    rosterSummary: rosterSummaryOut,
    opponentRosterTargets: opponentRosterTargets ?? [],
    tradeIntelligence,
    salaryCap,
    structuredLeagueContext: structuredNotes,
    validation,
    sourceFlags,
    summaryLine,
    dataQuality,
  }

  if (leagueNormCtx && input.userId) {
    try {
      const tradePlayerNames = [
        ...new Set(
          [...giveLines, ...getLines]
            .filter((l) => l.pricedSource !== 'pick' && l.pricedSource !== 'faab')
            .map((l) => l.name)
            .filter(Boolean),
        ),
      ].slice(0, 28)
      if (tradePlayerNames.length > 0) {
        const batch = await resolveNormalizedPlayerSportsProfiles({
          prisma,
          sport: effectiveSport,
          players: tradePlayerNames.map((name) => ({ name })),
          leagueScoring: leagueNormCtx.scoring,
          includeClearSportsProjections: tradePlayerNames.length <= 20,
        })
        chimmyPayload = attachSportsNormalizationToChimmyPayload(chimmyPayload, batch)
      }
    } catch {
      /* non-fatal: trade tool still returns valuation */
    }
  }

  let aiEnvelope: AiToolPayloadEnvelope | null = null
  if (input.userId) {
    try {
      aiEnvelope = await buildAiToolPayload({
        userId: input.userId,
        tool: 'trade_value_console',
        mode: input.leagueId ? 'league' : 'global',
        league: leagueSnapshot
          ? {
              leagueId: leagueSnapshot.id,
              leagueName: leagueSnapshot.name,
              sport: String(leagueSnapshot.sport),
            }
          : null,
        data: {
          tradeIntelligence,
          projectedImpact: projectedImpactBlock,
          scoringSummary: scoringSummaryLine,
          partnerContext: {
            opponentTeamExternalId: input.opponentTeamExternalId ?? null,
            rosterSimulation: rosterSummaryOut.lineupSimulation,
          },
          validation,
          summaryLine,
        },
        enrichTimeFromLeagueId: input.leagueId ?? null,
        includeTeamContext: true,
        preferredTeamExternalId: input.opponentTeamExternalId ?? null,
        /**
         * User's strategic outlook — computed with `teamExternalId: null`, not the trade partner.
         * Gated on dynasty/keeper/devy/C2C so redraft trades don't pay for a 3-year analysis
         * that won't change the weekly valuation.
         */
        includeStrategicCoaching: Boolean(input.leagueId) && leagueWantsLongHorizon(leagueNormCtx),
      })
      chimmyPayload = attachIntelligenceToChimmyPayload(chimmyPayload, aiEnvelope)
      sourceFlags.aiEnvelopeReady = true
    } catch {
      /* non-fatal */
    }
  }

  return {
    ok: true,
    analysisMode: leagueSnapshot ? 'league' : 'global',
    effectiveSport,
    analysisScope: leagueSnapshot ? 'league' : 'general',
    league: leagueSnapshot,
    ...presentation,
    percentDiff,
    giveTotal,
    getTotal,
    giveMarket,
    getMarket,
    valueBasis,
    grade,
    degraded,
    dataGaps,
    dataSources: [effectiveSport === 'NFL' ? 'FantasyCalc' : 'sports_players', 'hybrid-valuation', 'trade-engine'],
    lastUpdated: new Date().toISOString(),
    players: { give: giveLines, get: getLines },
    rosterSummary: rosterSummaryOut,
    secondary,
    drivers: driverPayload,
    evaluation,
    negotiationToolkit,
    opponentRosterTargets,
    counterOffers,
    salaryCap,
    tradeIntelligence,
    chimmyPayload,
    timeContext: aiEnvelope?.time ?? null,
    validation,
    sourceFlags,
    summaryLine,
    dataQuality,
    tradeWindow,
  }
}
