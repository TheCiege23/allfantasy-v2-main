import 'server-only'

import type { NormalizedScoringRules } from '@/lib/league-context-engine/types'
import { effectiveFantasyPoints } from '@/lib/ai-tools-start-sit/effectiveProjection'
import { annotatePlayerIdentityFromProfile } from '@/lib/identity/annotatePlayerIdentity'
import { prisma } from '@/lib/prisma'
import type { NormalizedPlayerSportsProfile } from '@/lib/sports-data-normalization/types'
import { mergeNormalizedSportsBatches } from '@/lib/sports-data-normalization/mergeBatches'
import { resolveNormalizedPlayerSportsProfiles } from '@/lib/sports-data-normalization/resolveNormalizedPlayerSportsProfiles'
import type { SupportedSport } from '@/lib/sport-scope'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import type {
  ContextModeId,
  TrendActionRecommendation,
  TrendLeagueRelevance,
  TrendPlayerCard,
  TrendTypeId,
} from './types'
import { parseTrendPlayerId } from '@/lib/trending-players/parseTrendPlayerId'

function normId(raw: string): string {
  return String(raw).trim()
}

async function resolveLeagueRosterSets(
  leagueId: string,
  userId: string | null,
): Promise<{ allIds: Set<string>; yourIds: Set<string> }> {
  const allIds = new Set<string>()
  const yourIds = new Set<string>()

  const rosters = await prisma.roster.findMany({
    where: { leagueId },
    select: { platformUserId: true, playerData: true },
  })
  const byOwner = new Map<string, (typeof rosters)[0]>()
  for (const r of rosters) {
    if (r.platformUserId?.trim()) byOwner.set(r.platformUserId.trim(), r)
  }

  const teams = await prisma.leagueTeam.findMany({
    where: { leagueId },
    select: { platformUserId: true, claimedByUserId: true },
  })

  let yourPlatform: string | null = null
  if (userId) {
    const mine = teams.find((t) => t.claimedByUserId === userId)
    yourPlatform = mine?.platformUserId?.trim() ?? null
  }

  for (const t of teams) {
    const pid = t.platformUserId?.trim()
    if (!pid) continue
    const r = byOwner.get(pid)
    if (!r?.playerData) continue
    for (const id of getRosterPlayerIds(r.playerData)) {
      const x = normId(String(id))
      if (x) allIds.add(x)
    }
    if (yourPlatform && pid === yourPlatform) {
      for (const id of getRosterPlayerIds(r.playerData)) {
        const x = normId(String(id))
        if (x) yourIds.add(x)
      }
    }
  }

  return { allIds, yourIds }
}

function relevanceForPlayer(
  platformId: string,
  sets: { allIds: Set<string>; yourIds: Set<string> } | null,
): TrendLeagueRelevance {
  if (!sets) return 'unknown'
  const p = normId(platformId)
  if (sets.yourIds.has(p)) return 'on_your_roster'
  if (sets.allIds.has(p)) return 'rostered_elsewhere'
  return 'likely_available'
}

function inferActionRecommendation(args: {
  direction: 'up' | 'down'
  leagueRelevance: TrendLeagueRelevance
  trendType: TrendTypeId
  contextMode: ContextModeId
  injuryStatus: string | null
}): TrendActionRecommendation {
  const inj = (args.injuryStatus ?? '').toLowerCase()
  const hurt = /out|ir|doubt|questionable|doubtful/.test(inj)

  if (args.leagueRelevance === 'on_your_roster') {
    if (args.direction === 'down' && hurt) return 'monitor'
    if (args.direction === 'down' && (args.contextMode === 'trade_market' || args.trendType === 'trade')) return 'sell'
    if (args.direction === 'up') return 'hold'
    return 'monitor'
  }

  if (args.leagueRelevance === 'rostered_elsewhere') {
    return args.trendType === 'trade' || args.contextMode === 'trade_market' ? 'watch' : 'monitor'
  }

  if (args.leagueRelevance === 'likely_available' || args.leagueRelevance === 'unknown') {
    if (args.direction === 'up' && (args.trendType === 'add' || args.contextMode === 'waiver_watch')) return 'add'
    if (args.direction === 'up') return 'watch'
    if (args.direction === 'down') return 'monitor'
  }

  return 'watch'
}

function integrationHints(args: {
  action: TrendActionRecommendation
  leagueRelevance: TrendLeagueRelevance
  injuryStatus: string | null
}): { waiverWire: boolean; tradeValue: boolean; injuryImpact: boolean } {
  const inj = Boolean(args.injuryStatus?.trim())
  return {
    waiverWire:
      args.action === 'add' ||
      (args.leagueRelevance === 'likely_available' && args.action === 'watch'),
    tradeValue: args.action === 'sell' || args.action === 'hold',
    injuryImpact: inj,
  }
}

function profileByName(
  players: NormalizedPlayerSportsProfile[],
  name: string,
): NormalizedPlayerSportsProfile | undefined {
  const n = name.toLowerCase()
  return players.find((p) => p.player.name.toLowerCase() === n)
}

/**
 * Structured lines for UI + downstream tools — only facts from sources already on the card.
 */
function buildStructuredWhy(
  card: TrendPlayerCard,
  profile: NormalizedPlayerSportsProfile | undefined,
  proj: number | null,
): string[] {
  const lines: string[] = []
  if (card.sources.some((s) => s.includes('FantasyCalc'))) {
    lines.push(`Value trend (30d component): ${card.trendDelta > 0 ? '+' : ''}${card.trendDelta} vs prior window.`)
  }
  if (card.sources.some((s) => s.includes('trending_players'))) {
    lines.push(`Platform add/drop signal — ${card.snippet.split('·')[0]?.trim() ?? 'crowd movement'}.`)
  }
  if (card.sources.some((s) => s.includes('player_meta_trends'))) {
    lines.push(`Aggregated meta trend score ${card.trendScore} (directional sort).`)
  }
  if (proj != null && Number.isFinite(proj)) {
    lines.push(`League-scored projection snapshot: ~${proj.toFixed(1)} pts (normalized layer).`)
  }
  if (card.injuryStatus?.trim()) {
    lines.push(`Injury/news designation: ${card.injuryStatus}.`)
  }
  if (profile?.injuryNewsLayer?.playerNewsSummary) {
    lines.push(`News layer: ${profile.injuryNewsLayer.playerNewsSummary.slice(0, 160)}`)
  }
  if (lines.length === 0) lines.push(card.snippet)
  return lines.slice(0, 6)
}

export async function attachTrendCardProjectionAndLeagueContext(args: {
  risers: TrendPlayerCard[]
  fallers: TrendPlayerCard[]
  leagueId: string | null
  userId: string | null
  leagueScoring: NormalizedScoringRules | null
  trendType: TrendTypeId
  contextMode: ContextModeId
}): Promise<{
  risers: TrendPlayerCard[]
  fallers: TrendPlayerCard[]
  projectionLayerReady: boolean
  dataGaps: string[]
}> {
  const dataGaps: string[] = []
  let rosterSets: { allIds: Set<string>; yourIds: Set<string> } | null = null
  if (args.leagueId && args.userId) {
    rosterSets = await resolveLeagueRosterSets(args.leagueId, args.userId)
  }

  const combined = [...args.risers, ...args.fallers]
  const bySport = new Map<SupportedSport, Set<string>>()
  for (const c of combined) {
    const sp = normalizeToSupportedSport(String(c.sport ?? 'NFL'))
    const set = bySport.get(sp) ?? new Set()
    set.add(c.name.trim())
    bySport.set(sp, set)
  }

  const batches = []
  let projectionFailures = 0
  for (const [sport, names] of bySport) {
    const list = [...names].slice(0, 28)
    if (list.length === 0) continue
    try {
      const batch = await resolveNormalizedPlayerSportsProfiles({
        prisma,
        sport,
        players: list.map((name) => ({ name })),
        leagueScoring: args.leagueScoring ?? null,
        includeClearSportsProjections: list.length <= 20,
      })
      batches.push(batch)
    } catch (e) {
      projectionFailures += 1
      console.warn(`[trending] projection batch failed for ${sport}`, e)
      dataGaps.push(`Projection batch failed for ${sport} — trend cards will show without league-scored projections.`)
    }
  }
  const merged = mergeNormalizedSportsBatches(batches)
  const profiles = merged?.players ?? []

  const enrichOne = (card: TrendPlayerCard, direction: 'up' | 'down'): TrendPlayerCard => {
    const sp = normalizeToSupportedSport(String(card.sport ?? 'NFL'))
    const prof = profileByName(profiles, card.name)
    const proj = prof ? effectiveFantasyPoints(prof) : null
    const idAnn = annotatePlayerIdentityFromProfile(prof)
    const { platformId } = parseTrendPlayerId(card.playerId)
    const leagueRelevance = relevanceForPlayer(platformId, rosterSets)
    const actionRecommendation = inferActionRecommendation({
      direction,
      leagueRelevance,
      trendType: args.trendType,
      contextMode: args.contextMode,
      injuryStatus: card.injuryStatus,
    })
    const hints = integrationHints({
      action: actionRecommendation,
      leagueRelevance,
      injuryStatus: card.injuryStatus,
    })
    const structuredWhy = buildStructuredWhy(card, prof, proj ?? null)
    return {
      ...card,
      projectedFantasyPoints: proj != null && Number.isFinite(proj) ? Math.round(proj * 10) / 10 : null,
      identityConfidence: idAnn.confidence,
      identityNotes: idAnn.notes.slice(0, 4),
      structuredWhy,
      leagueRelevance,
      actionRecommendation,
      integrationHints: hints,
    }
  }

  const projectionLayerReady = profiles.some(
    (p) => effectiveFantasyPoints(p) != null,
  )
  return {
    risers: args.risers.map((c) => enrichOne(c, 'up')),
    fallers: args.fallers.map((c) => enrichOne(c, 'down')),
    projectionLayerReady,
    dataGaps,
  }
}
