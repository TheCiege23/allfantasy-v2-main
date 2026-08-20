import 'server-only'

import type { SportsPlayerRecord } from '@prisma/client'
import { openaiChatJson, parseJsonContentFromChatCompletion } from '@/lib/openai-client'
import { getPlayer, searchPlayers } from '@/lib/data/players'
import { fetchFantasyCalcValues, findPlayerByName, type FantasyCalcPlayer } from '@/lib/fantasycalc'
import {
  pricePlayer,
  pricePick,
  compositeScore,
  compositeTotal,
  type ValuationContext,
  type PricedAsset,
} from '@/lib/hybrid-valuation'
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
import { getPlayerValuesContext } from '@/lib/player-values/playerValuesLoader'
import { normalizeToSupportedSport, type SupportedSport } from '@/lib/sport-scope'
import { prisma } from '@/lib/prisma'
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
import { enrichTradeConsolePlayerLines, sumEffectiveProjections } from './tradeProjectionEnrichment'
import {
  formatStructuredContextForReasoning,
  highlightsFromStructuredNotes,
  loadLeagueStructuredContextNotes,
} from './load-league-structured-context'
import { attachIntelligenceToChimmyPayload, buildAiToolPayload } from '@/lib/intelligence'
import { clamp, sportsRecordToPricedAsset } from './sports-db-valuation'
import {
  benchAssetsNotInGive,
  inferThinPositionsFromRoster,
  loadTradeEngineRosterContext,
  type TradeEngineRosterContext,
} from './roster-context-loader'
import { assertLeagueMemberWithCode } from '@/lib/league/league-access'
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

function priceFaabAsset(amount: number, budget: number): PricedAsset {
  const b = budget > 0 ? budget : 100
  const ratio = clamp(amount / b, 0, 1)
  const mv = Math.round(ratio * 2800)
  return {
    name: `FAAB $${amount}`,
    type: 'player',
    value: mv,
    assetValue: {
      marketValue: mv,
      impactValue: Math.round(mv * 0.55),
      vorpValue: Math.round(mv * 0.2),
      volatility: 0.12,
    },
    source: 'unknown',
    position: 'FAAB',
  }
}

function lineFromPriced(pa: PricedAsset, meta: Partial<TradeConsolePlayerLine>): TradeConsolePlayerLine {
  return {
    name: pa.name,
    playerId: meta.playerId ?? null,
    sport: meta.sport ?? 'NFL',
    position: pa.position ?? meta.position ?? '—',
    team: meta.team ?? '—',
    headshotUrl: meta.headshotUrl ?? null,
    logoUrl: meta.logoUrl ?? null,
    injuryStatus: meta.injuryStatus ?? null,
    dataSource: meta.dataSource ?? 'deterministic',
    composite: compositeScore(pa.assetValue),
    marketValue: pa.assetValue.marketValue,
    pricedSource: meta.pricedSource ?? 'unknown',
  }
}

async function resolveAssets(
  items: TradeAssetInput[],
  args: {
    effectiveSport: SupportedSport
    nflCtx: ValuationContext
    waiverBudget: number
    dataGaps: string[]
    fcPlayers: FantasyCalcPlayer[]
  },
): Promise<{ priced: PricedAsset[]; lines: TradeConsolePlayerLine[]; unresolved: string[] }> {
  const priced: PricedAsset[] = []
  const lines: TradeConsolePlayerLine[] = []
  const unresolved: string[] = []

  for (const raw of items) {
    if (raw.kind === 'pick') {
      const p = await pricePick(
        { year: raw.year, round: raw.round, tier: raw.tier ?? null },
        args.nflCtx,
      )
      priced.push(p)
      lines.push(
        lineFromPriced(p, {
          sport: args.effectiveSport,
          position: 'PICK',
          team: `${raw.year}`,
          pricedSource: 'pick',
          playerId: null,
          dataSource: 'historical_pick_curve',
        }),
      )
      continue
    }

    if (raw.kind === 'faab') {
      const p = priceFaabAsset(raw.amount, args.waiverBudget)
      priced.push(p)
      lines.push(
        lineFromPriced(p, {
          sport: args.effectiveSport,
          position: 'FAAB',
          team: '—',
          pricedSource: 'faab',
          playerId: null,
          dataSource: 'league_waiver_budget',
        }),
      )
      continue
    }

    let row: SportsPlayerRecord | null = null
    let displayName = raw.name?.trim() ?? ''

    if (raw.playerId?.trim()) {
      row = (await getPlayer(raw.playerId.trim())) as SportsPlayerRecord | null
      if (row) displayName = row.name
    }

    if (args.effectiveSport === 'NFL') {
      if (!displayName && row) displayName = row.name
      if (!displayName) {
        args.dataGaps.push('Unnamed NFL player — skipped')
        continue
      }
      const matched = findPlayerByName(args.fcPlayers, displayName)
      if (!matched && row) {
        args.dataGaps.push(`FantasyCalc match for "${displayName}" — using API sports record fallback`)
      }
      const pa = await pricePlayer(displayName, args.nflCtx)
      priced.push(pa)
      const headshot = row?.headshotUrl ?? row?.headshotUrlLg ?? row?.headshotUrlSm ?? null
      const src: TradeConsolePlayerLine['pricedSource'] =
        pa.source === 'fantasycalc' || pa.source === 'excel' ? 'fantasycalc' : 'unknown'
      lines.push(
        lineFromPriced(pa, {
          playerId: row?.id ?? raw.playerId ?? null,
          sport: 'NFL',
          team: row?.team ?? matched?.player.maybeTeam ?? '—',
          headshotUrl: headshot,
          logoUrl: row?.logoUrl ?? null,
          injuryStatus: row?.injuryStatus ?? null,
          pricedSource: src,
          dataSource: row?.dataSource ?? 'fantasycalc+rolling',
          position: pa.position ?? row?.position ?? '—',
        }),
      )
      continue
    }

    if (!row && displayName.length >= 2) {
      const found = await searchPlayers(displayName, args.effectiveSport)
      row = (found[0] ?? null) as SportsPlayerRecord | null
    }
    if (!row && raw.playerId) {
      row = (await getPlayer(raw.playerId.trim())) as SportsPlayerRecord | null
    }
    if (!row) {
      unresolved.push(displayName || raw.playerId || 'unknown')
      continue
    }

    const pa = sportsRecordToPricedAsset(row)
    if (!pa) {
      // Pricing can now REFUSE (slice 11: no market value and no projection ->
      // null rather than a fabricated number). An unpriceable asset belongs in
      // `unresolved` so the grader sees a short side and reports insufficient
      // data, instead of being handed a zero that reads as "worthless".
      unresolved.push(displayName || raw.playerId || row.id)
      continue
    }
    priced.push(pa)
    lines.push(
      lineFromPriced(pa, {
        playerId: row.id,
        sport: row.sport,
        team: row.team,
        headshotUrl: row.headshotUrl ?? row.headshotUrlLg ?? row.headshotUrlSm,
        logoUrl: row.logoUrl,
        injuryStatus: row.injuryStatus,
        pricedSource: 'sports_db',
        dataSource: row.dataSource,
        position: row.position,
      }),
    )
  }

  return { priced, lines, unresolved }
}

function pprForNflFromLeagueContext(
  norm: NormalizedLeagueContext | null,
  leagueRow: Awaited<ReturnType<typeof loadLeagueForTrade>> | null,
): 0 | 0.5 | 1 {
  const fmt = norm?.scoring?.labels?.receptionFormat
  if (fmt === 'ppr') return 1
  if (fmt === 'half_ppr') return 0.5
  if (fmt === 'standard') return 0
  const s = (leagueRow?.scoring ?? '').toLowerCase()
  if (s.includes('half') || s.includes('0.5')) return 0.5
  if (s.includes('standard') && !s.includes('half')) return 0
  if (s.includes('ppr') || s.includes('full')) return 1
  return 1
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

export async function runTradeConsoleAnalysis(input: TradeConsoleAnalyzeInput): Promise<TradeConsoleAnalyzeOutput> {
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
        const r = await getPlayer(side.playerId.trim())
        if (r?.sport) sportSet.add(normalizeToSupportedSport(r.sport))
      } else if (side.sportHint) {
        sportSet.add(normalizeToSupportedSport(side.sportHint))
      }
    }
  }
  await collectSports()

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
  const leagueSize =
    input.leagueSize ??
    leagueSnapshot?.leagueSize ??
    12
  const tePremium =
    input.tePremium ??
    leagueSnapshot?.tePremiumHint ??
    (typeof leagueNormCtx?.scoring?.labels?.tePremiumExtra === 'number' &&
      leagueNormCtx.scoring.labels.tePremiumExtra > 0)
  const isSuperFlex =
    input.isSuperFlex ??
    leagueNormCtx?.scoring?.labels?.isSuperflex ??
    leagueSnapshot?.isSuperFlexHint ??
    false
  const waiverBudget =
    input.waiverBudget ??
    leagueSnapshot?.waiverBudget ??
    100

  const pprNfl = pprForNflFromLeagueContext(leagueNormCtx, leagueRow)
  const asOf = new Date().toISOString().slice(0, 10)
  const fcPlayers = await fetchFantasyCalcValues({
    isDynasty: true,
    numQbs: isSuperFlex ? 2 : 1,
    numTeams: leagueSize,
    ppr: pprNfl,
  })

  const nflCtx: ValuationContext = {
    asOfDate: asOf,
    isSuperFlex,
    fantasyCalcPlayers: fcPlayers,
    numTeams: leagueSize,
  }

  let { priced: givePriced, lines: giveLines, unresolved: giveUnresolved } = await resolveAssets(give, {
    effectiveSport,
    nflCtx,
    waiverBudget,
    dataGaps,
    fcPlayers,
  })
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
  giveLines = giveEnriched
  getLines = getEnriched

  if (givePriced.length === 0 || getPriced.length === 0) {
    return { ok: false, error: 'Could not price assets on both sides.', code: 'VALIDATION' }
  }

  const applyTep = (assets: PricedAsset[]) => {
    if (!tePremium) return assets
    const mult = 1.15
    return assets.map((a) => {
      if (a.position?.toUpperCase() === 'TE') {
        const boosted = Math.round(a.value * mult)
        return {
          ...a,
          value: boosted,
          assetValue: {
            ...a.assetValue,
            marketValue: Math.round(a.assetValue.marketValue * mult),
            impactValue: Math.round(a.assetValue.impactValue * mult),
            vorpValue: Math.round(a.assetValue.vorpValue * mult),
            volatility: a.assetValue.volatility,
          },
        }
      }
      return a
    })
  }

  const gP = applyTep(givePriced)
  const tP = applyTep(getPriced)

  const giveTotal = compositeTotal(gP)
  const getTotal = compositeTotal(tP)
  const giveMarket = gP.reduce((s, a) => s + a.assetValue.marketValue, 0)
  const getMarket = tP.reduce((s, a) => s + a.assetValue.marketValue, 0)

  const fairnessScore = computeValueFairness(getTotal, giveTotal)
  const percentDiff =
    giveTotal > 0 ? Math.round(((getTotal - giveTotal) / Math.max(giveTotal, getTotal, 1)) * 100) : 0

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

  const calWeights = await getCalibratedWeights()
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

  const delta = getTotal - giveTotal
  let fairnessLabel = 'Even trade'
  let sideAdvantage: 'even' | 'you' | 'opponent' | 'mixed' = 'even'
  if (Math.abs(delta) < Math.max(50, (giveTotal + getTotal) * 0.04)) {
    fairnessLabel = 'Even'
    sideAdvantage = 'even'
  } else if (delta > 0) {
    fairnessLabel = delta > (giveTotal + getTotal) * 0.12 ? 'Major win (you)' : 'Slightly favors you'
    sideAdvantage = 'you'
  } else {
    fairnessLabel = -delta > (giveTotal + getTotal) * 0.12 ? 'Major overpay' : 'Slightly favors opponent'
    sideAdvantage = 'opponent'
  }

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
      note: 'Schedule strength is blended from available data feeds (see sport data freshness).',
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
  const tepContext = tePremium ? `\n\nLeague Format: Tight End Premium (~15% TE boost).` : ''
  const scoringCtx = scoringSummaryLine ? `\n\n${scoringSummaryLine}` : ''
  const projContext =
    projectedImpactBlock.giveTotal != null && projectedImpactBlock.getTotal != null
      ? `\n\nLeague-scored weekly projection stack (real DB projections, short-term): give sum ${projectedImpactBlock.giveTotal.toFixed(1)}, get sum ${projectedImpactBlock.getTotal.toFixed(1)}, net ${projectedImpactBlock.net ?? 'n/a'}.`
      : ''

  let aiNarrative: { bullets: Array<{ text: string; driverId: string }>; sensitivity: { text: string; driverId: string } } | null =
    null

  if (!input.skipAi) {
    const skipCheck = shouldSkipGpt(gptContract)
    const playerValuesCtx = getPlayerValuesContext({ sport: effectiveSport })
    if (skipCheck === 'ok') {
      try {
        const aiResult = await openaiChatJson({
          messages: [
            {
              role: 'system',
              content:
                GPT_NARRATIVE_SYSTEM_PROMPT +
                (playerValuesCtx ? `\n\n${playerValuesCtx}` : '') +
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

  const evaluation = aiNarrative
    ? { bullets: aiNarrative.bullets.map((b) => b.text), sensitivity: aiNarrative.sensitivity.text }
    : { bullets: drivers.acceptBullets, sensitivity: drivers.sensitivitySentence }

  let opponentRosterTargets: TradeConsoleOpponentRosterTarget[] | undefined
  if (rosterCtxForDrivers?.theirRoster?.length) {
    const receiveIds = new Set(receiveAssets.map((a) => a.id))
    opponentRosterTargets = rosterCtxForDrivers.theirRoster
      .filter((a) => a.type === 'PLAYER' && !receiveIds.has(a.id))
      .map((a) => ({
        id: a.id,
        name: a.name ?? a.id,
        position: a.pos ?? null,
        marketValue: Math.round(a.marketValue ?? a.value ?? 0),
      }))
      .sort((a, b) => b.marketValue - a.marketValue)
      .slice(0, 12)
  }

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
    if (l.injuryStatus) parts.push(`${l.name}: ${l.injuryStatus}`)
    if (l.injuryNewsSummary) parts.push(`${l.name} (aggregated news): ${l.injuryNewsSummary}`)
    return parts
  })

  const tradeIntelligence = buildTradeIntelligence({
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
    injuryNotes,
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
        : 'even'
  const longLbl =
    tradeIntelligence.whoWinsLongTerm === 'you'
      ? 'you'
      : tradeIntelligence.whoWinsLongTerm === 'opponent'
        ? 'opponent'
        : 'even'

  const summaryLine = `Fairness ${Math.round(fairnessScore)}/100 · short-term ${shortLbl} · long-term ${longLbl}${degraded ? ' · degraded inputs' : ''}`

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
    fairnessScore,
    confidenceScore,
    percentDiff,
    totals: { give: giveTotal, get: getTotal, giveMarket, getMarket },
    assets: { give: giveLines, get: getLines },
    drivers: driverPayload,
    dataGaps,
    degraded,
    rosterSummary: rosterSummaryOut,
    opponentRosterTargets: opponentRosterTargets ?? [],
    tradeIntelligence,
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
    labels: {
      fairnessLabel,
      sideAdvantage,
      confidenceLabel: confidence,
    },
    fairnessScore,
    confidenceScore,
    percentDiff,
    giveTotal,
    getTotal,
    giveMarket,
    getMarket,
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
