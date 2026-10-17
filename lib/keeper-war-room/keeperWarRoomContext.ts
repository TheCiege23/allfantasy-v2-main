/**
 * KEEPER AF WAR ROOM — canonical context builder.
 *
 * The ONLY file in the keeper War Room that performs DB I/O. It assembles a
 * deterministic, serializable `KeeperWarRoomContext` from:
 *  - the redraft-season roster layer (RedraftSeason/RedraftRoster/RedraftRosterPlayer/
 *    RedraftMatchup) — keeper leagues reuse this layer (`isKept` marks keepers),
 *  - real keeper COST/eligibility (`KeeperEligibility` → fallback `KeeperRecord`),
 *  - keeper settings from `League` columns,
 *  - redraft ADP for value (ADP-implied round = ceil(adp / teamCount)),
 *  - best-effort providers (projections/scores/injuries/free agents) reused from redraft.
 *
 * It NEVER calls OpenAI and NEVER fabricates keeper costs, rounds, values, or stats.
 * When a source is empty it sets the matching `availability` flag and records a
 * `missingDataFlags` entry so engines and the AI layer degrade safely.
 *
 * Keeper VALUE SURPLUS (the core signal) = keeperCostRound − adpRound (positive = you
 * keep a higher-value player for a later/cheaper pick). See lib/keeper-war-room/types.ts.
 */

import { prisma } from '@/lib/prisma'
import { resolveLeagueAccess } from '@/lib/league-access'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'
import {
  fetchAdpByPlayerKey,
  fetchRedraftFreeAgentPool,
  rosteredPlayerKeys,
} from '@/lib/redraft-war-room/redraftFreeAgentPool'
import { currentInjuryDesignation, fetchRedraftInjuryNews } from '@/lib/redraft-war-room/redraftInjuryNews'
import type {
  DataState,
  KeeperCostSystem,
  KeeperDataAvailability,
  KeeperPlayerFact,
  KeeperPolicy,
  KeeperRosterSettings,
  KeeperScoringSettings,
  KeeperTeamSummary,
  KeeperWarRoomContext,
} from './types'

const SUPERFLEX_RE = /^SUPER[_\s]?FLEX$|^SUPERFLEX$|^SFLEX$/i
const FLEX_RE = /FLEX|^UTIL$|^SUPER_UTIL$/i

function isStarterSlotType(slotType: string | null | undefined): boolean {
  const s = String(slotType ?? '').toLowerCase()
  return s !== 'bench' && s !== 'taxi' && s !== 'devy' && s !== 'ir' && s !== 'reserve'
}

function adpImpliedRound(adp: number | null, teamCount: number): number | null {
  if (adp == null || !Number.isFinite(adp) || teamCount <= 0) return null
  return Math.max(1, Math.ceil(adp / teamCount))
}

function resolveScoring(sport: string, settings: Record<string, unknown> | null | undefined): KeeperScoringSettings {
  const sc = (settings?.sportConfig as Record<string, unknown> | undefined) ?? {}
  const scoring = (settings?.scoringSettings as Record<string, unknown> | undefined) ?? {}
  const preset = String(sc.scoringPreset ?? scoring.preset ?? scoring.scoringFormat ?? 'PPR').toUpperCase()
  let ppr: number | null =
    typeof scoring.ppr === 'number'
      ? scoring.ppr
      : preset.includes('HALF')
        ? 0.5
        : preset.includes('PPR')
          ? 1
          : preset.includes('STANDARD')
            ? 0
            : null
  if (ppr != null && !Number.isFinite(ppr)) ppr = null
  return {
    sport,
    scoringPreset: preset,
    pointsPerReception: ppr,
    superflex: sc.enableSuperflex === true || scoring.superflex === true,
    tePremium: sc.enableTEPremium === true || scoring.tePremium === true,
  }
}

function resolveKeeperPolicy(
  league: {
    keeperCount: number | null
    keeperCostSystem: string | null
    keeperRoundPenalty: number | null
    keeperAuctionPctIncrease: number | null
    keeperMaxYears: number | null
    keeperWaiverAllowed: boolean | null
    keeperSelectionDeadline: Date | null
    keeperPhaseActive: boolean | null
  },
  settings: Record<string, unknown> | null | undefined,
  draftRounds: number,
): KeeperPolicy {
  const policy = (settings?.keeperPolicy as Record<string, unknown> | undefined) ?? {}
  const rawSystem = String(league.keeperCostSystem ?? policy.costSystem ?? 'round_based').toLowerCase()
  const costSystem: KeeperCostSystem =
    rawSystem === 'auction_value' || rawSystem === 'auction'
      ? 'auction_value'
      : rawSystem === 'inflation'
        ? 'inflation'
        : rawSystem === 'free'
          ? 'free'
          : rawSystem === 'round_based'
            ? 'round_based'
            : 'unknown'
  return {
    maxKeepers: Number(league.keeperCount ?? policy.maxKeepers ?? 3) || 0,
    maxYears: Number(league.keeperMaxYears ?? policy.maxYears ?? 0) || 0,
    costSystem,
    roundPenalty: Number(league.keeperRoundPenalty ?? policy.roundPenalty ?? 1) || 0,
    auctionPctIncrease: Number(league.keeperAuctionPctIncrease ?? policy.auctionPctIncrease ?? 0.2) || 0,
    waiverAllowed: league.keeperWaiverAllowed !== false,
    selectionDeadline: league.keeperSelectionDeadline ? league.keeperSelectionDeadline.toISOString() : null,
    keeperPhaseActive: league.keeperPhaseActive === true,
    draftRounds,
  }
}

export interface BuildKeeperWarRoomContextInput {
  leagueId: string
  userId: string | null | undefined
  seasonId?: string
}

export type BuildKeeperWarRoomContextResult =
  | { ok: true; context: KeeperWarRoomContext }
  | { ok: false; status: 401 | 403 | 404; error: string }

export async function buildKeeperWarRoomContext(
  input: BuildKeeperWarRoomContextInput,
): Promise<BuildKeeperWarRoomContextResult> {
  const { leagueId, userId } = input
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }

  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return { ok: false, status: 403, error: 'Forbidden' }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      settings: true,
      sport: true,
      leagueSize: true,
      leagueType: true,
      keeperCount: true,
      keeperCostSystem: true,
      keeperRoundPenalty: true,
      keeperAuctionPctIncrease: true,
      keeperMaxYears: true,
      keeperWaiverAllowed: true,
      keeperSelectionDeadline: true,
      keeperPhaseActive: true,
    },
  })
  if (!league) return { ok: false, status: 404, error: 'League not found' }

  const settings = (league.settings as Record<string, unknown> | null) ?? null
  const isKeeper =
    String(league.leagueType ?? '').toLowerCase() === 'keeper' || settings?.isKeeper === true
  if (!isKeeper) return { ok: false, status: 404, error: 'Not a keeper league' }

  type RosterPlayerRow = {
    playerId: string
    playerName: string
    position: string
    team: string | null
    slotType: string
    injuryStatus: string | null
    isKept: boolean
  }
  type RosterRow = {
    id: string
    ownerId: string
    ownerName: string
    teamName: string | null
    wins: number
    losses: number
    ties: number
    pointsFor: number
    pointsAgainst: number
    playoffSeed: number | null
    isEliminated: boolean
    players: RosterPlayerRow[]
  }
  type SeasonWithRelations = {
    id: string
    sport: string
    season: number
    status: string
    currentWeek: number
    totalWeeks: number
    rosters: RosterRow[]
    schedule: { id: string }[]
  }

  const season = (await prisma.redraftSeason.findFirst({
    where: { leagueId, ...(input.seasonId ? { id: input.seasonId } : {}) },
    orderBy: { createdAt: 'desc' },
    include: {
      rosters: { include: { players: { where: { droppedAt: null } } } },
      schedule: true,
    },
  })) as SeasonWithRelations | null
  if (!season) return { ok: false, status: 404, error: 'No keeper season for this league' }

  const sport = season.sport
  const teamCount = league.leagueSize ?? season.rosters.length ?? 12
  const scoring = resolveScoring(sport, settings)

  // Roster template → starter slots / required by position (mirrors redraft).
  const requiredByPosition: Record<string, number> = {}
  let totalStarterSlots = 0
  let benchSlots = 0
  let irSlots = 0
  let flexCount = 0
  let superflexCount = 0
  let draftRounds = 0
  let rosterRulesState: DataState = 'available'
  try {
    const tmpl = await getEffectiveLeagueRosterTemplate(leagueId)
    for (const s of tmpl.template.slots) {
      const name = String(s.slotName ?? '')
      const isSuper = SUPERFLEX_RE.test(name)
      const isFlex = !isSuper && (s.isFlexibleSlot || FLEX_RE.test(name))
      const starter = s.starterCount ?? 0
      if (starter > 0) {
        totalStarterSlots += starter
        if (isSuper) superflexCount += starter
        else if (isFlex) flexCount += starter
        else {
          const pos = (s.allowedPositions?.length ?? 0) === 1 ? s.allowedPositions[0].toUpperCase() : name.toUpperCase()
          requiredByPosition[pos] = (requiredByPosition[pos] ?? 0) + starter
        }
      }
      benchSlots += s.benchCount ?? 0
      irSlots += s.reserveCount ?? 0
    }
    draftRounds = totalStarterSlots + benchSlots
  } catch {
    rosterRulesState = 'missing'
  }
  if (flexCount > 0) {
    requiredByPosition.RB = (requiredByPosition.RB ?? 0) + Math.ceil(flexCount * 0.4)
    requiredByPosition.WR = (requiredByPosition.WR ?? 0) + Math.ceil(flexCount * 0.4)
    requiredByPosition.TE = (requiredByPosition.TE ?? 0) + Math.ceil(flexCount * 0.2)
  }
  if (superflexCount > 0) requiredByPosition.QB = (requiredByPosition.QB ?? 0) + superflexCount

  const roster: KeeperRosterSettings = { totalStarterSlots, benchSlots, irSlots, requiredByPosition }
  const keeperPolicy = resolveKeeperPolicy(league, settings, draftRounds || 16)

  // --- keeper eligibility + cost (real; never fabricated) ---
  type EligRow = {
    rosterId: string
    playerId: string
    isEligible: boolean
    ineligibleReason: string | null
    yearsKept: number
    projectedCost: string | null
    projectedCostRound: number | null
    projectedCostAuction: number | null
  }
  const eligRows = (await prisma.keeperEligibility
    .findMany({
      where: { leagueId, seasonId: season.id },
      select: {
        rosterId: true,
        playerId: true,
        isEligible: true,
        ineligibleReason: true,
        yearsKept: true,
        projectedCost: true,
        projectedCostRound: true,
        projectedCostAuction: true,
      },
    })
    .catch(() => [] as EligRow[])) as EligRow[]
  const eligByKey = new Map<string, EligRow>()
  for (const e of eligRows) eligByKey.set(`${e.rosterId}|${e.playerId}`, e)

  type RecordRow = {
    rosterId: string
    playerId: string
    costRound: number | null
    costAuctionValue: number | null
    costLabel: string | null
    yearsKept: number
  }
  const recordRows = (await prisma.keeperRecord
    .findMany({
      where: { leagueId, seasonId: season.id },
      select: { rosterId: true, playerId: true, costRound: true, costAuctionValue: true, costLabel: true, yearsKept: true },
    })
    .catch(() => [] as RecordRow[])) as RecordRow[]
  const recordByKey = new Map<string, RecordRow>()
  for (const r of recordRows) recordByKey.set(`${r.rosterId}|${r.playerId}`, r)

  // --- providers (best-effort, flagged when empty) ---
  const adpByKey = await fetchAdpByPlayerKey(sport, season.season)
  const injuryNews = await fetchRedraftInjuryNews(sport)
  const week = season.currentWeek > 0 ? season.currentWeek : 1
  const seasonActive = String(season.status).toLowerCase() === 'active' && season.schedule.length > 0

  const allPlayerIds = season.rosters.flatMap((r) => r.players.map((p) => p.playerId))
  type ProjRow = { playerId: string; projectedPoints: number; fetchedAt: Date }
  const projRows: ProjRow[] = allPlayerIds.length
    ? ((await prisma.fantasyProjection
        .findMany({
          where: { sport, season: String(season.season), week, playerId: { in: allPlayerIds } },
          select: { playerId: true, projectedPoints: true, fetchedAt: true },
        })
        .catch(() => [])) as ProjRow[])
    : []
  const projByPlayer = new Map(projRows.map((p) => [p.playerId, p.projectedPoints]))
  const projectionsAsOf = projRows.reduce<Date | null>((max, r) => (!max || r.fetchedAt > max ? r.fetchedAt : max), null)

  type ScoreRow = { playerId: string; fantasyPts: number; updatedAt: Date }
  const scoreRows: ScoreRow[] = allPlayerIds.length
    ? ((await prisma.playerWeeklyScore
        .findMany({
          where: { sport, season: season.season, isFinalized: true, playerId: { in: allPlayerIds } },
          select: { playerId: true, fantasyPts: true, updatedAt: true },
        })
        .catch(() => [])) as ScoreRow[])
    : []
  const actualAgg = new Map<string, { sum: number; n: number }>()
  let statsAsOf: Date | null = null
  for (const row of scoreRows) {
    const cur = actualAgg.get(row.playerId) ?? { sum: 0, n: 0 }
    cur.sum += row.fantasyPts
    cur.n += 1
    actualAgg.set(row.playerId, cur)
    if (!statsAsOf || row.updatedAt > statsAsOf) statsAsOf = row.updatedAt
  }

  const isAuction = keeperPolicy.costSystem === 'auction_value'

  function toPlayerFact(p: RosterPlayerRow, rosterId: string): KeeperPlayerFact {
    const adp = adpByKey.get(buildPlayerKey(p.playerName, p.position)) ?? null
    const adpRound = adpImpliedRound(adp, teamCount)
    const elig = eligByKey.get(`${rosterId}|${p.playerId}`) ?? null
    const rec = recordByKey.get(`${rosterId}|${p.playerId}`) ?? null

    const keeperCostRound = elig?.projectedCostRound ?? rec?.costRound ?? null
    const keeperCostAuction = elig?.projectedCostAuction ?? rec?.costAuctionValue ?? null
    const keeperCostLabel =
      elig?.projectedCost ??
      rec?.costLabel ??
      (keeperCostRound != null ? `Round ${keeperCostRound}` : keeperCostAuction != null ? `$${keeperCostAuction}` : null)

    const surplusRounds =
      !isAuction && adpRound != null && keeperCostRound != null ? keeperCostRound - adpRound : null
    // Auction surplus needs a market auction value we do not fabricate → null.
    const surplusAuction = null

    const proj = projByPlayer.get(p.playerId)
    const agg = actualAgg.get(p.playerId)
    return {
      playerId: p.playerId,
      playerName: p.playerName,
      position: (p.position || 'UNK').toUpperCase(),
      team: p.team,
      slotType: p.slotType,
      isStarterSlot: isStarterSlotType(p.slotType),
      isKept: p.isKept === true,
      // The live feed's current designation only — never the stored `p.injuryStatus` snapshot.
      injuryStatus: currentInjuryDesignation(injuryNews.injuryByName, p.playerName),
      adp,
      adpRound,
      isEligible: elig ? elig.isEligible : null,
      ineligibleReason: elig?.ineligibleReason ?? null,
      yearsKept: elig?.yearsKept ?? rec?.yearsKept ?? null,
      keeperCostRound,
      keeperCostAuction,
      keeperCostLabel,
      surplusRounds,
      surplusAuction,
      weekProjection: typeof proj === 'number' ? Math.round(proj * 100) / 100 : null,
      seasonAvgActual: agg && agg.n > 0 ? Math.round((agg.sum / agg.n) * 100) / 100 : null,
    }
  }

  const teams: KeeperTeamSummary[] = season.rosters.map((r) => ({
    rosterId: r.id,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    teamName: r.teamName,
    wins: r.wins,
    losses: r.losses,
    ties: r.ties,
    pointsFor: r.pointsFor,
    pointsAgainst: r.pointsAgainst,
    playoffSeed: r.playoffSeed ?? null,
    isEliminated: r.isEliminated,
    isUserTeam: r.ownerId === userId,
    players: r.players.map((p) => toPlayerFact(p, r.id)),
  }))

  const userRosterId = teams.find((t) => t.isUserTeam)?.rosterId ?? null

  // --- free-agent pool (redraft ADP minus rostered) ---
  const allRosterPlayers = teams.flatMap((t) => t.players)
  const rosteredKeys = rosteredPlayerKeys(
    allRosterPlayers.map((p) => ({ playerName: p.playerName, position: p.position })),
  )
  const freeAgentRows = await fetchRedraftFreeAgentPool({
    sport,
    season: season.season,
    rosteredKeys,
    scoringFormat: scoring.scoringPreset.toLowerCase(),
    limit: 60,
  })
  const freeAgents: KeeperPlayerFact[] = freeAgentRows.map((fa) => ({
    playerId: fa.playerKey,
    playerName: fa.playerName,
    position: fa.position,
    team: fa.team,
    slotType: 'free_agent',
    isStarterSlot: false,
    isKept: false,
    injuryStatus: currentInjuryDesignation(injuryNews.injuryByName, fa.playerName),
    adp: fa.adp,
    adpRound: adpImpliedRound(fa.adp, teamCount),
    isEligible: null,
    ineligibleReason: null,
    yearsKept: null,
    keeperCostRound: null,
    keeperCostAuction: null,
    keeperCostLabel: null,
    surplusRounds: null,
    surplusAuction: null,
    weekProjection: null,
    seasonAvgActual: null,
  }))

  // --- availability contract ---
  const adpAvailable = adpByKey.size > 0
  const costRowCount = eligRows.filter((e) => e.projectedCostRound != null || e.projectedCostAuction != null).length + recordRows.length
  const availability: KeeperDataAvailability = {
    scoringRules: 'available',
    rosterRules: rosterRulesState,
    standings: 'available',
    schedule: season.schedule.length > 0 ? 'available' : 'missing',
    rosters: season.rosters.length > 0 ? 'available' : 'missing',
    playerValues: adpAvailable ? 'available' : 'missing',
    keeperRules: 'available',
    keeperCosts: costRowCount > 0 ? 'available' : 'missing',
    eligibility: eligRows.length > 0 ? 'available' : 'missing',
    projections: projByPlayer.size > 0 ? 'available' : 'missing',
    injuries: injuryNews.injuryByName.size > 0 || allRosterPlayers.some((p) => p.injuryStatus) ? 'available' : 'missing',
    news: injuryNews.newsCount > 0 ? 'available' : 'missing',
    freeAgentPool: freeAgents.length > 0 ? 'available' : 'missing',
  }

  const missingDataFlags: string[] = []
  if (availability.rosterRules === 'missing') missingDataFlags.push('Roster template could not be resolved.')
  if (availability.keeperCosts === 'missing')
    missingDataFlags.push(
      'No keeper cost data (eligibility/records) for this season — value-surplus and keep/cut recommendations are limited until keeper costs are computed or declared.',
    )
  if (availability.playerValues === 'missing')
    missingDataFlags.push('No ADP/ranking values for this sport/season — keeper value cannot be ranked.')
  if (availability.eligibility === 'missing')
    missingDataFlags.push('Keeper eligibility has not been computed for this season.')
  if (availability.projections === 'missing' && seasonActive)
    missingDataFlags.push('No weekly projections — start/sit uses season actuals/ADP where present.')
  if (availability.freeAgentPool === 'missing')
    missingDataFlags.push('Free-agent pool unavailable for this sport/season.')
  if (availability.injuries === 'missing') missingDataFlags.push('No injury data available.')

  const canValueSurplus = adpAvailable && availability.keeperCosts === 'available'

  const context: KeeperWarRoomContext = {
    leagueId,
    leagueType: 'keeper',
    sport,
    season: season.season,
    teamCount,
    currentWeek: season.currentWeek,
    totalWeeks: season.totalWeeks,
    seasonStatus: season.status,
    seasonActive,
    scoring,
    roster,
    keeper: keeperPolicy,
    userRosterId,
    isCommissioner: access.isCommissioner,
    teams,
    freeAgents,
    availability,
    freshness: {
      generatedAt: new Date().toISOString(),
      statsAsOf: statsAsOf ? statsAsOf.toISOString() : null,
      projectionsAsOf: projectionsAsOf ? projectionsAsOf.toISOString() : null,
      injuriesAsOf: injuryNews.injuriesAsOf ? injuryNews.injuriesAsOf.toISOString() : null,
    },
    missingDataFlags,
    featureAvailability: {
      keeperRecommendations: canValueSurplus,
      cutList: adpAvailable && availability.rosters === 'available',
      rosterNeeds: availability.rosterRules === 'available' && availability.rosters === 'available',
      draftPlan: availability.rosterRules === 'available',
      tradeAnalyze: availability.rosters === 'available',
      tradeFind: adpAvailable && availability.rosters === 'available',
      waivers: seasonActive && availability.freeAgentPool === 'available',
      lineup: seasonActive && availability.rosterRules === 'available',
    },
  }

  return { ok: true, context }
}
