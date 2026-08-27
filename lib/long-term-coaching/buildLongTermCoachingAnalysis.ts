import { findRosterForTeam } from '@/lib/leagues/rosterForTeam'
import 'server-only'

import { prisma } from '@/lib/prisma'
import { resolveNormalizedLeagueContext } from '@/lib/league-context-engine'
import { resolveAiTeamContext } from '@/lib/ai-payload/resolveAiTeamContext'
import { effectiveFantasyPoints } from '@/lib/ai-tools-start-sit/effectiveProjection'
import { resolveNormalizedPlayerSportsProfiles } from '@/lib/sports-data-normalization/resolveNormalizedPlayerSportsProfiles'
import type { NormalizedPlayerSportsProfile } from '@/lib/sports-data-normalization/types'
import type { SupportedSport } from '@/lib/sport-scope'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { parseDraftPicksFromPlayerData, sumPickCapitalScore } from '@/lib/long-term-coaching/parseRosterPicks'
import type {
  LongTermCoachingAnalysis,
  LongTermCoachingHorizonYears,
  LongTermPlayerSignal,
  LongTermPositionalStrength,
  LongTermStrategyClass,
  LongTermStrategyMode,
  LongTermStructuredPlan,
  LongTermYearOutlook,
} from '@/lib/long-term-coaching/types'

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n))
}

function bucketForRef(
  playerId: string,
  starters: Set<string>,
  bench: Set<string>,
  reserve: Set<string>,
  taxi: Set<string>,
): LongTermPlayerSignal['bucket'] {
  if (starters.has(playerId)) return 'starter'
  if (reserve.has(playerId)) return 'reserve'
  if (taxi.has(playerId)) return 'taxi'
  if (bench.has(playerId)) return 'bench'
  return 'bench'
}

function classifyStrategy(args: {
  shortIdx: number
  longIdx: number
  pipelineIdx: number
  pickIdx: number
  pfPct: number | null
  ageRisk: number
  mode: LongTermStrategyMode
}): LongTermStrategyClass {
  const { shortIdx, longIdx, pipelineIdx, pickIdx, pfPct, ageRisk, mode } = args
  if (mode === 'compete_now') return shortIdx >= 60 ? 'contender' : 'win_now_with_risk'
  if (mode === 'soft_rebuild') return 'soft_rebuild'
  if (mode === 'full_rebuild') return 'full_rebuild'

  const pf = pfPct ?? 50
  if (shortIdx >= 72 && longIdx >= 55 && pf >= 65) return 'elite_contender'
  if (shortIdx >= 62 && longIdx >= 45 && pf >= 55) return 'contender'
  if (shortIdx >= 52 && pf >= 45) return 'fringe_contender'
  if (shortIdx < 45 && pf < 40) return 'pretender'
  if (shortIdx >= 58 && longIdx < 38 && ageRisk >= 55) return 'win_now_with_risk'
  if (longIdx >= 58 && pipelineIdx >= 50 && shortIdx < 55) return 'future_core_asset_build'
  if (longIdx >= 52 && shortIdx < 50) return 'developmental_contender'
  if (shortIdx < 48 && pickIdx >= 55) return 'soft_rebuild'
  if (shortIdx < 40 && pickIdx >= 60) return 'full_rebuild'
  if (shortIdx >= 48 && shortIdx < 58) return 'competitive_retool'
  return 'long_term_rise'
}

function recommendDirection(
  c: LongTermStrategyClass,
  mode: LongTermStrategyMode,
): LongTermStructuredPlan['recommendedDirection'] {
  if (mode === 'compete_now') return 'compete_now'
  if (mode === 'soft_rebuild') return 'soft_rebuild'
  if (mode === 'full_rebuild') return 'full_rebuild'
  switch (c) {
    case 'elite_contender':
    case 'contender':
    case 'fringe_contender':
    case 'win_now_with_risk':
      return 'compete_now'
    case 'soft_rebuild':
    case 'competitive_retool':
      return 'soft_rebuild'
    case 'full_rebuild':
    case 'pretender':
      return 'full_rebuild'
    case 'future_core_asset_build':
    case 'developmental_contender':
    case 'long_term_rise':
      return 'develop_pipeline'
    default:
      return 'soft_rebuild'
  }
}

function buildStructuredPlan(args: {
  horizon: LongTermCoachingHorizonYears
  strategyClass: LongTermStrategyClass
  direction: LongTermStructuredPlan['recommendedDirection']
  flags: { isDevy: boolean; isC2C: boolean; isDynasty: boolean; isKeeper: boolean }
  positional: LongTermPositionalStrength[]
  sell: Array<{ playerId: string; name: string | null; rationale: string }>
  hold: Array<{ playerId: string; name: string | null; rationale: string }>
  build: Array<{ playerId: string; name: string | null; rationale: string }>
  needs: LongTermStructuredPlan['rosterNeedsByPosition']
  methodologyNotes: string[]
}): LongTermStructuredPlan {
  const { horizon, strategyClass, direction, flags, positional, sell, hold, build, needs, methodologyNotes } = args
  const devy = flags.isDevy ? 'Prioritize devy stash alignment with your competitive window; move college risk that does not match timeline.' : null
  const c2c = flags.isC2C ? 'Map C2C assets to expected pro arrival — avoid stacking overlapping transition years without starter coverage.' : null
  const top: string[] = []
  if (direction === 'compete_now') {
    top.push('Consolidate depth into reliable weekly starters near playoffs.')
    top.push('Monitor injury reports; keep one pivot at thin positions.')
  } else if (direction === 'soft_rebuild') {
    top.push('Gradually move depreciating veterans for picks or younger starters.')
    top.push('Stay in the points race while upgrading long-term pieces.')
  } else if (direction === 'full_rebuild') {
    top.push('Target premium picks and young contributors at scarce positions for this league scoring.')
    top.push('Avoid win-now rentals unless they flip for more capital.')
  } else {
    top.push('Protect young cores; use waivers for upside stashes that match scoring premiums.')
  }
  if (devy) top.push(devy)
  if (c2c) top.push(c2c)

  const yearFocus: LongTermStructuredPlan['yearByYearFocus'] = []
  const start = new Date().getFullYear()
  for (let i = 0; i < horizon; i++) {
    yearFocus.push({
      year: start + i,
      focus:
        direction === 'compete_now'
          ? i === 0
            ? 'Maximize current-season lineup and injury-proof starters'
            : 'Keep championship equity while aging curve evolves'
          : direction === 'full_rebuild'
            ? i === 0
              ? 'Liquidate depreciating pieces; acquire draft capital'
              : 'Convert capital into young starters at roster holes'
            : 'Balance present-week points with pipeline adds at weak positions',
    })
  }

  return {
    horizonYears: horizon,
    strategyClass,
    recommendedDirection: direction,
    currentWindowAssessment: methodologyNotes[0] ?? 'Assessment uses live projections, dynasty values when present, and pick capital parsed from synced roster data.',
    topPriorities: top.slice(0, 6),
    playersToSell: sell.slice(0, 8),
    playersToHold: hold.slice(0, 8),
    playersToBuildAround: build.slice(0, 8),
    pickStrategy: [
      flags.isDynasty || flags.isKeeper
        ? 'Weight picks using synced future selections; prefer early capital when rebuilding.'
        : 'Future pick value depends on league trade settings — confirm draft pick trading is enabled.',
    ],
    rookieDevyStrategy: [
      flags.isDevy ? 'Track devy eligibility and taxi rules from league settings before promoting.' : 'Rookie draft capital follows league rookie draft configuration.',
    ],
    rosterNeedsByPosition: needs,
    yearByYearFocus: yearFocus,
    keyRisks: [
      positional.some((p) => p.position === 'RB' && p.starterProjectionSum < 18)
        ? 'RB room may be thin vs league scoring — monitor injury and bye weeks.'
        : 'Maintain depth at flex-eligible spots tied to your scoring premiums.',
      'Multi-year indices aggregate roster decay heuristically — not player-specific fate predictions.',
    ],
    confidence: 0.55,
  }
}

export async function buildLongTermCoachingAnalysis(args: {
  userId: string
  leagueId: string
  horizonYears: LongTermCoachingHorizonYears
  strategyMode: LongTermStrategyMode
  teamExternalId?: string | null
}): Promise<LongTermCoachingAnalysis | { ok: false; code: string; message: string }> {
  const leagueRes = await resolveNormalizedLeagueContext({
    userId: args.userId,
    leagueId: args.leagueId,
    preferredTeamExternalId: args.teamExternalId ?? undefined,
  })
  if (!leagueRes.ok) {
    return { ok: false, code: leagueRes.code, message: `League context: ${leagueRes.code}` }
  }
  const lc = leagueRes.context
  const sport = normalizeToSupportedSport(lc.sport) as SupportedSport

  const team = await resolveAiTeamContext({
    userId: args.userId,
    leagueId: args.leagueId,
    sport: lc.sport,
    season: lc.matchupPeriod.season,
    currentPeriod: lc.matchupPeriod.currentPeriod,
    teamExternalId: args.teamExternalId ?? null,
  })
  if (!team) {
    return {
      ok: false,
      code: 'TEAM_NOT_FOUND',
      message: 'No team context — join or claim a team in this league.',
    }
  }

  /* ⚠ Contract-aware — see lib/leagues/rosterForTeam.ts. Keying on the team's
     raw Sleeper id resolves the signed-in user by luck and misses every other
     manager with a linked account. */
  const byTeam = team.platformUserId
    ? await findRosterForTeam(args.leagueId, team.platformUserId)
    : null
  const rosterRow = byTeam
    ? { playerData: byTeam.playerData as any }
    : await prisma.roster.findFirst({
        where: { leagueId: args.leagueId, platformUserId: args.userId },
        select: { playerData: true },
      })

  const picksRaw = parseDraftPicksFromPlayerData(rosterRow?.playerData ?? {}, lc.matchupPeriod.season)
  const pickCapitalScore = sumPickCapitalScore(picksRaw)

  const leagueTeams = await prisma.leagueTeam.findMany({
    where: { leagueId: args.leagueId },
    select: { pointsFor: true, claimedByUserId: true },
  })
  const pfVals = leagueTeams.map((t) => t.pointsFor).filter((n): n is number => n != null && Number.isFinite(n))
  const userTeam = leagueTeams.find((t) => t.claimedByUserId === args.userId)
  const userPf = userTeam?.pointsFor ?? null
  let pfPct: number | null = null
  if (userPf != null && pfVals.length > 1) {
    const sorted = [...pfVals].sort((a, b) => a - b)
    const below = sorted.filter((x) => x < userPf).length
    const eq = sorted.filter((x) => x === userPf).length
    pfPct = ((below + 0.5 * eq) / sorted.length) * 100
  }

  const allRefs = [...team.starters, ...team.bench, ...team.injuredReserve, ...team.taxi]
  const startersSet = new Set(team.starters.map((s) => s.playerId))
  const benchSet = new Set(team.bench.map((s) => s.playerId))
  const resSet = new Set(team.injuredReserve.map((s) => s.playerId))
  const taxiSet = new Set(team.taxi.map((s) => s.playerId))

  const inputs = allRefs.slice(0, 72).map((r) => ({
    name: r.name?.trim() || r.playerId,
    rosterPlayerId: r.playerId,
    sportsPlayerRow: null,
  }))

  const batch = await resolveNormalizedPlayerSportsProfiles({
    prisma,
    sport,
    players: inputs,
    leagueScoring: lc.scoring,
    includeClearSportsProjections: true,
  })

  const profByPlayerId = new Map<string, NormalizedPlayerSportsProfile>()
  for (let i = 0; i < inputs.length; i++) {
    const id = allRefs[i]?.playerId
    const prof = batch.players[i]
    if (id && prof) profByPlayerId.set(id, prof)
  }
  const ids = [...new Set(allRefs.map((r) => r.playerId))].filter(Boolean)
  const dynRows = await prisma.sportsPlayerRecord.findMany({
    where: { sport, id: { in: ids.slice(0, 80) } },
    select: { id: true, dynastyValue: true },
  })
  const dynById = new Map(dynRows.map((r) => [r.id, r.dynastyValue]))

  let starterWeeklyProjectionSum = 0
  let rosterWeeklyProjectionSum = 0
  let dynastyValueSum = 0
  let dynastyWithValue = 0
  const playerSignals: LongTermPlayerSignal[] = []
  const posMap = new Map<string, { sum: number; n: number }>()

  for (let i = 0; i < allRefs.length; i++) {
    const ref = allRefs[i]
    const prof = profByPlayerId.get(ref.playerId)
    const fp = effectiveFantasyPoints(prof)
    const dv = dynById.get(ref.playerId) ?? null
    if (dv != null) {
      dynastyValueSum += dv
      dynastyWithValue += 1
    }
    const bucket = bucketForRef(ref.playerId, startersSet, benchSet, resSet, taxiSet)
    if (fp != null) {
      rosterWeeklyProjectionSum += fp
      if (bucket === 'starter') starterWeeklyProjectionSum += fp
      const pk = (ref.position ?? prof?.player.position.code ?? 'UNK').toUpperCase()
      const cur = posMap.get(pk) ?? { sum: 0, n: 0 }
      if (bucket === 'starter') {
        cur.sum += fp
        cur.n += 1
      }
      posMap.set(pk, cur)
    }
    playerSignals.push({
      playerId: ref.playerId,
      name: ref.name,
      position: ref.position ?? prof?.player.position.code ?? null,
      bucket,
      weeklyProjection: fp,
      dynastyValue: dv,
      projectionBasis: prof?.projection.basis ?? null,
    })
  }

  const dynastyCoverage = ids.length > 0 ? dynastyWithValue / ids.length : 0

  const shortIdx = clamp((starterWeeklyProjectionSum / Math.max(1, team.starters.length * 14)) * 100, 0, 100)
  const longIdx = clamp(Math.log1p(Math.max(0, dynastyValueSum)) / Math.log1p(2500) * 100, 0, 100)
  const pipelineIdx = clamp(dynastyCoverage * 55 + (team.taxi.length > 0 ? 20 : 0), 0, 100)
  const pickIdx = pickCapitalScore

  const ageCurveRisk = clamp(100 - longIdx * 0.65 + (startersSet.size ? (100 - pipelineIdx) * 0.25 : 0), 0, 100)

  const strategyClass = classifyStrategy({
    shortIdx,
    longIdx,
    pipelineIdx,
    pickIdx,
    pfPct,
    ageRisk: ageCurveRisk,
    mode: args.strategyMode,
  })
  const direction = recommendDirection(strategyClass, args.strategyMode)

  const positionalStrength: LongTermPositionalStrength[] = [...posMap.entries()].map(([position, v]) => ({
    position,
    starterProjectionSum: v.sum,
    playerCount: v.n,
  }))

  const sortedByFp = [...playerSignals].sort((a, b) => (b.weeklyProjection ?? 0) - (a.weeklyProjection ?? 0))
  const sortedByDyn = [...playerSignals].filter((p) => p.dynastyValue != null).sort((a, b) => (b.dynastyValue ?? 0) - (a.dynastyValue ?? 0))
  const dynastyVals = playerSignals.map((p) => p.dynastyValue).filter((n): n is number => n != null).sort((a, b) => a - b)
  const dynQ33 = dynastyVals.length ? dynastyVals[Math.floor(dynastyVals.length * 0.33)] ?? 0 : 0

  const sell: LongTermStructuredPlan['playersToSell'] = []
  for (const p of sortedByFp.slice(0, 14)) {
    if (p.bucket !== 'starter') continue
    const dv = p.dynastyValue
    const fp = p.weeklyProjection ?? 0
    if (fp >= 10 && (dv == null || dv <= dynQ33)) {
      sell.push({
        playerId: p.playerId,
        name: p.name,
        rationale:
          dv == null
            ? 'Strong short-term projection but missing dynasty value in DB — verify age/contract context before selling.'
            : 'Relative lower dynasty value on roster vs current weekly projection — consider moving if rebuilding.',
      })
    }
  }

  const hold: LongTermStructuredPlan['playersToHold'] = sortedByDyn.slice(0, 6).map((p) => ({
    playerId: p.playerId,
    name: p.name,
    rationale: 'Higher dynasty value signal in database — core long-term equity if roster rules allow.',
  }))

  const buildAround = sortedByFp.slice(0, 4).map((p) => ({
    playerId: p.playerId,
    name: p.name,
    rationale: 'Current weekly projection drivers for your starting lineup.',
  }))

  const needs: LongTermStructuredPlan['rosterNeedsByPosition'] = positionalStrength.map((p) => ({
    position: p.position,
    need: p.starterProjectionSum < 15 ? 'high' : p.starterProjectionSum < 28 ? 'medium' : 'low',
    note: `Starter projection sum ≈ ${p.starterProjectionSum.toFixed(1)} pts/week (provider-normalized).`,
  }))

  const methodologyNotes = [
    `Short-term index scales weekly starter projections vs ${team.starters.length || 1} starter slots.`,
    `Long-term index uses summed database dynasty values (${dynastyWithValue}/${ids.length} players with values).`,
    'Multi-year outlook applies an auditable aggregate decay on short-term strength — not simulated player careers.',
    lc.scoring.labels.isSuperflex ? 'Superflex scoring detected — QB value is elevated in trade and build priorities.' : null,
    lc.scoring.labels.tePremiumExtra && lc.scoring.labels.tePremiumExtra > 0 ? 'TE premium detected — TE longevity/build priority increased.' : null,
    lc.scoring.labels.idpSlotsPresent ? 'IDP slots detected — roster construction should respect IDP scoring weights.' : null,
  ].filter((x): x is string => Boolean(x))

  const formatWarning =
    lc.flags.isDynasty || lc.flags.isKeeper || lc.flags.isDevy || lc.flags.isC2C
      ? null
      : 'This league is not flagged as dynasty/keeper/devy/C2C. Long-term coaching still uses live roster data; interpret cautiously in redraft-style leagues.'

  const decay = 0.085
  const futureStrengthByYear: Record<string, number> = {}
  const yearOutlooks: LongTermYearOutlook[] = []
  const startYear = new Date().getFullYear()
  for (let y = 1; y <= args.horizonYears; y++) {
    const agg =
      0.52 * shortIdx * Math.exp(-decay * (y - 1)) +
      0.33 * longIdx +
      0.15 * pickIdx * (1 - (y - 1) / Math.max(1, args.horizonYears))
    const idx = clamp(agg, 0, 100)
    futureStrengthByYear[String(startYear + y)] = idx
    yearOutlooks.push({
      labelYear: startYear + y,
      projectedTeamStrengthIndex: idx,
      contentionBand: idx >= 62 ? 'high' : idx >= 48 ? 'mid' : 'low',
      notes: [
        y === 1 ? 'Near-term driven by current starter projections.' : 'Further years weight decay of short-term index plus picks/pipeline.',
      ],
      confidence: dynastyCoverage >= 0.45 ? 'medium' : 'low',
    })
  }

  const plan = buildStructuredPlan({
    horizon: args.horizonYears,
    strategyClass,
    direction,
    flags: lc.flags,
    positional: positionalStrength,
    sell,
    hold,
    build: buildAround,
    needs,
    methodologyNotes,
  })
  plan.confidence = clamp(0.35 + dynastyCoverage * 0.35 + (batch.batchDataGaps.length === 0 ? 0.15 : 0), 0, 0.92)

  const analysis: LongTermCoachingAnalysis = {
    schemaVersion: 1,
    computedAt: new Date().toISOString(),
    modelId: 'ltc_aggregate_v1',
    methodologyNotes,
    leagueId: args.leagueId,
    sport: String(lc.sport),
    horizonYears: args.horizonYears,
    strategyMode: args.strategyMode,
    formatWarning,
    leagueContext: {
      leagueId: lc.leagueId,
      sport: lc.sport,
      leagueName: lc.leagueName,
      flags: lc.flags,
      leagueVariant: lc.leagueVariant,
      leagueType: lc.leagueType,
      scoring: lc.scoring,
      roster: lc.roster,
      trade: lc.trade,
      playoff: lc.playoff,
    },
    teamContext: team,
    pointsForPercentile: pfPct,
    leagueTeamCount: leagueTeams.length,
    signals: {
      starterWeeklyProjectionSum,
      rosterWeeklyProjectionSum,
      dynastyValueSum,
      dynastyValueCoverageRatio: dynastyCoverage,
      pickCapitalScore,
      pickSummaries: picksRaw.map((p) => ({ season: p.season, round: p.round, weightScore: p.weightScore })),
      shortTermStrengthIndex: shortIdx,
      longTermAssetIndex: longIdx,
      prospectPipelineIndex: pipelineIdx,
      ageCurveRisk: ageCurveRisk,
      strategyClass,
      titleWindowYears: direction === 'compete_now' ? 2 : direction === 'soft_rebuild' ? 3 : 4,
      peakYear: startYear + 1,
      declineRisk: ageCurveRisk >= 62 ? 'high' : ageCurveRisk >= 42 ? 'medium' : 'low',
      recommendedDirection: direction,
      confidence: plan.confidence,
      positionalStrength,
      playerSignals,
    },
    futureStrengthByYear,
    yearOutlooks,
    plan,
  }

  return analysis
}
