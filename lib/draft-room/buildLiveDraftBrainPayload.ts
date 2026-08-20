import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { blendCombinedAdp } from '@/lib/live-draft-brain/combined-ai-adp'
import type { LiveDraftBrainInput } from '@/lib/live-draft-brain'
import type { CombinedAdpInputs } from '@/lib/live-draft-brain/types'
import type { DraftSessionSnapshot } from '@/lib/live-draft-engine/types'
import { getUpcomingPickOwners } from '@/lib/live-draft-engine/DraftOrderService'

type PoolPlayer = {
  name: string
  position: string
  team: string | null
  adp?: number | null
  byeWeek?: number | null
  aiAdp?: number | null
  aiAdpSampleSize?: number
  aiAdpLowSample?: boolean
  isRookie?: boolean
  age?: number | null
  /** Real projected fantasy points from the pool row, when present (Draft VORP slice). */
  projectedPoints?: number | null
  /** PlayerEntry pool rows carry projections here instead (Draft VORP slice). */
  nflDraftProjectionSplits?: { projectedPoints?: number | null } | null
}

function playerKey(p: { name: string; position: string; team: string | null }): string {
  return `${(p.name || '').toLowerCase()}|${(p.position || '').toLowerCase()}|${(p.team || '').toLowerCase()}`
}

function mapDraftFormat(session: DraftSessionSnapshot): LiveDraftBrainInput['context']['draftFormat'] {
  switch (session.draftType) {
    case 'snake':
      return 'SNAKE'
    case 'linear':
      return 'LINEAR'
    case 'auction':
      return 'AUCTION'
    default:
      return 'CUSTOM'
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n))
}

function countPositions(players: PoolPlayer[], draftedNames: Set<string>): Map<string, number> {
  const m = new Map<string, number>()
  for (const p of players) {
    if (draftedNames.has(p.name)) continue
    const pos = String(p.position || '').toUpperCase()
    m.set(pos, (m.get(pos) ?? 0) + 1)
  }
  return m
}

function scarcitySurgeForPosition(
  position: string,
  posCounts: Map<string, number>,
  totalTeams: number
): number {
  const p = String(position || '').toUpperCase()
  const cnt = posCounts.get(p) ?? 0
  const threshold = Math.max(3, Math.ceil(totalTeams * 0.35))
  if (cnt <= 2) return 95
  if (cnt <= threshold) return 70
  return clamp(40 + cnt * 2, 0, 55)
}

function auctionInflationScore(session: DraftSessionSnapshot): number {
  if (session.draftType !== 'auction' || !session.auction?.budgets) return 0
  const per = session.auction.budgetPerTeam || 200
  const vals = Object.values(session.auction.budgets)
  if (!vals.length) return 0
  const avgRemaining = vals.reduce((a, b) => a + b, 0) / vals.length
  return clamp(1 - avgRemaining / per, 0, 1)
}

function siteCoverageConfidence(sampleSize: number, lowSample?: boolean, leagueDrafts?: number): number {
  if (lowSample) return 0.38
  if (sampleSize > 120) return 0.92
  if (sampleSize > 40) return 0.82
  if (sampleSize > 15) return 0.68
  if (sampleSize > 0) return 0.52
  if (typeof leagueDrafts === 'number' && leagueDrafts > 5) return 0.58
  return 0.45
}

function buildFormatSegmentKey(args: {
  sport: string
  leagueType: string
  draftFormat: string
  isSuperflex: boolean
}): string {
  const sf = args.isSuperflex ? 'sf' : '1qb'
  return `${normalizeToSupportedSport(args.sport)}_${args.leagueType}_${args.draftFormat}_${sf}`.toLowerCase()
}

/**
 * Build POST /api/draft/live-brain body from draft room snapshot (on-the-clock user).
 */
export function buildLiveDraftBrainPayload(args: {
  session: DraftSessionSnapshot
  effectiveDraftSport: string
  isDynasty: boolean
  formatType?: string
  isIdpLeague?: boolean
  isSuperflexFormat: boolean
  /** TE premium scoring — shifts combined context anchor for TE */
  isTePremium?: boolean
  /** Explicit draft phase when known (startup, rookie-only, supplemental, dispersal) */
  startupVsRookieOverride?: LiveDraftBrainInput['context']['startupVsRookie']
  scoringFormatId?: string
  /** Total completed drafts used for site ADP aggregation (coverage confidence) */
  leagueSiteDraftCount?: number
  currentUserRosterId: string | undefined
  players: PoolPlayer[]
  draftedNames: Set<string>
  effectiveRosterSlots: string[]
  aiAdpByKey?: Record<string, number>
}): LiveDraftBrainInput | null {
  const cp = args.session.currentPick
  if (!cp || !args.currentUserRosterId || cp.rosterId !== args.currentUserRosterId) return null

  const teamCount = args.session.teamCount
  const posCounts = countPositions(args.players, args.draftedNames)
  const auctionInflation = auctionInflationScore(args.session)

  let leagueType: LiveDraftBrainInput['context']['leagueType'] = 'redraft'
  if (args.session.keeper) leagueType = 'keeper'
  else if (args.isDynasty) leagueType = 'dynasty'

  let startupVsRookie: LiveDraftBrainInput['context']['startupVsRookie'] =
    args.startupVsRookieOverride ?? 'na'
  if (args.startupVsRookieOverride == null) {
    if (args.session.devy?.enabled) startupVsRookie = 'na'
  }

  const draftFormat = mapDraftFormat(args.session)
  const formatKey = buildFormatSegmentKey({
    sport: args.effectiveDraftSport,
    leagueType,
    draftFormat,
    isSuperflex: args.isSuperflexFormat,
  })

  const ctx: LiveDraftBrainInput['context'] = {
    sport: args.effectiveDraftSport,
    draftFormat,
    scoringFormatId: args.scoringFormatId,
    leagueType,
    isSuperflex: args.isSuperflexFormat,
    isTePremium: Boolean(args.isTePremium),
    isIdp: args.formatType === 'IDP' || Boolean(args.isIdpLeague),
    rosterSize: args.effectiveRosterSlots.length,
    startupVsRookie,
    round: cp.round,
    pick: cp.slot,
    totalTeams: teamCount,
    overallPick: cp.overall,
  }

  const available: LiveDraftBrainInput['available'] = []
  const combinedAdpByPlayerKey: Record<string, CombinedAdpInputs> = {}
  const blendedAdpByKey: Record<string, number> = {}

  for (const p of args.players) {
    if (args.draftedNames.has(p.name)) continue

    const ext = p.adp ?? null
    const site = p.aiAdp ?? null
    const key = playerKey(p)
    const scarcity = scarcitySurgeForPosition(p.position, posCounts, teamCount)
    const trendDelta =
      ext != null && site != null && ext > 0 && site > 0 ? site - ext : null
    const siteTrendMomentum =
      ext != null && site != null && ext > 0 ? clamp((ext - site) / 45, -1, 1) : undefined

    const sportNorm = normalizeToSupportedSport(args.effectiveDraftSport)
    const coverageConf = siteCoverageConfidence(
      p.aiAdpSampleSize ?? 0,
      p.aiAdpLowSample,
      args.leagueSiteDraftCount
    )

    const row: CombinedAdpInputs = {
      externalAdp: ext,
      siteAdp: site,
      brainContext: ctx,
      playerMeta: {
        position: p.position,
        isRookie: p.isRookie,
        age: p.age ?? null,
      },
      externalSource: {
        sport: args.effectiveDraftSport,
        formatKey,
        matchesContext: true,
      },
      siteSource: {
        sport: args.effectiveDraftSport,
        formatKey,
        matchesContext: true,
        sampleSize: p.aiAdpSampleSize ?? 0,
        coverageConfidence: coverageConf,
      },
      trendDeltaSlots: trendDelta,
      siteTrendMomentum,
      scarcitySurge: scarcity,
      auctionInflationScore: auctionInflation,
    }

    combinedAdpByPlayerKey[key] = row
    available.push({
      name: p.name,
      position: p.position,
      team: p.team,
      adp: ext,
      byeWeek: p.byeWeek ?? null,
      isRookie: p.isRookie,
      age: p.age ?? null,
      projectedPoints:
        typeof p.projectedPoints === 'number' && Number.isFinite(p.projectedPoints)
          ? p.projectedPoints
          : typeof p.nflDraftProjectionSplits?.projectedPoints === 'number' &&
              Number.isFinite(p.nflDraftProjectionSplits.projectedPoints)
            ? p.nflDraftProjectionSplits.projectedPoints
            : null,
    })

    const blended = blendCombinedAdp(row)
    blendedAdpByKey[key] = blended.combinedAdp
  }

  if (available.length === 0) return null

  const myPicks = args.session.picks?.filter((x) => x.rosterId === args.currentUserRosterId) ?? []
  const myTeam: LiveDraftBrainInput['myTeam'] = {
    teamRoster: myPicks.map((p) => ({
      position: p.position,
      team: p.team,
      byeWeek: p.byeWeek,
      playerName: p.playerName,
    })),
    rosterSlots: args.effectiveRosterSlots,
  }

  const totalPicks = args.session.rounds * args.session.teamCount
  const slotOrder = args.session.slotOrder ?? []

  let upcomingTeamOrder: string[] = []
  let auctionBudgetByTeamId: Record<string, number> | undefined

  if (args.session.draftType === 'auction' && args.session.auction?.budgets) {
    auctionBudgetByTeamId = { ...args.session.auction.budgets }
    const nom = args.session.auction.nominationOrder ?? slotOrder
    const idx = args.session.auction.auctionState?.nominationOrderIndex ?? 0
    for (let k = 0; k < Math.min(4, nom.length); k += 1) {
      const e = nom[(idx + k) % nom.length]
      if (e?.rosterId) upcomingTeamOrder.push(e.rosterId)
    }
  } else {
    const nextOverall = cp.overall + 1
    const upcoming = getUpcomingPickOwners(
      nextOverall,
      4,
      teamCount,
      args.session.draftType,
      args.session.thirdRoundReversal,
      slotOrder,
      totalPicks
    )
    upcomingTeamOrder = upcoming.map((u) => u.rosterId)
  }

  const managerHintsByTeamId: LiveDraftBrainInput['managerHintsByTeamId'] = {}
  for (const e of slotOrder) {
    managerHintsByTeamId[e.rosterId] = { managerId: e.rosterId, displayName: e.displayName }
  }

  const recentPicks = (args.session.picks ?? []).slice(-16).map((p) => ({
    playerName: p.playerName,
    position: p.position,
    teamId: p.rosterId,
    overallPick: p.overall,
  }))

  return {
    context: ctx,
    mode: 'balanced',
    available,
    myTeam,
    combinedAdpByPlayerKey,
    blendedAdpByKey: Object.keys(blendedAdpByKey).length ? blendedAdpByKey : undefined,
    aiAdpByKey: args.aiAdpByKey,
    isDynasty: args.isDynasty,
    recentPicks,
    managerHintsByTeamId,
    upcomingTeamOrder,
    auctionBudgetByTeamId,
  }
}
