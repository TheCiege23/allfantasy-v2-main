import 'server-only'

import { prisma } from '@/lib/prisma'
import { getAiAdpForLeague } from '@/lib/ai-adp-engine'
import { resolveAiAdpFormatKeyFromSettings } from '@/lib/ai-adp-engine/segment-resolver'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import type { LeagueSport } from '@prisma/client'
import { blendOne, normalizeBlendWeights } from '@/lib/adp/blendPolicy'

export type ADPSource = 'api' | 'global_app' | 'ai' | 'blended' | 'custom'

export type ADPWeights = {
  api: number
  app: number
  ai: number
  custom?: number
}

export type ADPRanking = {
  playerId: string
  playerName: string
  position: string
  team: string | null
  adp: number
  source: ADPSource
  sources?: Partial<Record<ADPSource, number>>
  sampleSize?: number
  /*
   * Drafts behind OUR OWN contribution to this number, and whether that is thin. Carried so a
   * surface can say "blended, 4 of our drafts" instead of presenting a two-sample figure with
   * the same authority as a two-thousand-sample one. Null means we contributed no drafts at all,
   * which is not the same as contributing zero.
   */
  ownSampleSize?: number | null
  lowOwnSample?: boolean
  /** Weight each source actually contributed after confidence scaling, summing to 1. */
  contributions?: Partial<Record<ADPSource, number>>
  locked?: boolean
}

type DraftSegment = {
  leagueId: string
  /*
   * `LeagueSport`, not `string`. `resolveDraftSegment` already narrows through
   * `normalizeToSupportedSport`, whose return type IS the enum; declaring it as `string` here
   * threw that away and made a Prisma enum filter (`league: { sport }`) a type error.
   */
  sport: LeagueSport
  format: string
  scoring: string
  settings: Record<string, unknown>
  isDynasty: boolean
}

type RankingAccumulator = {
  playerId: string
  playerName: string
  position: string
  team: string | null
  values: number[]
}

function currentSeason() {
  return new Date().getFullYear()
}

function currentWeek() {
  const now = new Date()
  const start = new Date(Date.UTC(now.getUTCFullYear(), 0, 1))
  const diffDays = Math.floor((now.getTime() - start.getTime()) / 86_400_000)
  return Math.max(1, Math.ceil((diffDays + start.getUTCDay() + 1) / 7))
}

function playerKey(playerId: string, name: string, position: string, team: string | null) {
  return `${playerId}|${name.toLowerCase()}|${position.toUpperCase()}|${String(team ?? '').toUpperCase()}`
}

function sortRankings(rankings: ADPRanking[]) {
  return [...rankings].sort((a, b) => {
    if (a.locked && !b.locked) return -1
    if (b.locked && !a.locked) return 1
    if (a.adp !== b.adp) return a.adp - b.adp
    return a.playerName.localeCompare(b.playerName)
  })
}

async function resolveDraftSegment(leagueId: string): Promise<DraftSegment> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      id: true,
      sport: true,
      isDynasty: true,
      settings: true,
    },
  })

  if (!league?.id) {
    throw new Error('League not found')
  }

  const settings = (league.settings ?? {}) as Record<string, unknown>
  return {
    leagueId,
    sport: normalizeToSupportedSport(String(league.sport ?? 'NFL')),
    format: Boolean(league.isDynasty) ? 'dynasty' : 'redraft',
    scoring: resolveAiAdpFormatKeyFromSettings(settings),
    settings,
    isDynasty: Boolean(league.isDynasty),
  }
}

/*
 * Delegates to lib/adp/blendPolicy.ts. The old local copy returned UNNORMALISED values
 * (40/35/25) on the zero-total path while returning fractions on every other path, so a league
 * that had explicitly zeroed its weights got numbers on a different scale from every other league.
 */
function normalizeWeights(weights?: ADPWeights): Required<ADPWeights> {
  return normalizeBlendWeights(weights) as Required<ADPWeights>
}

async function loadApiAdp(segment: DraftSegment): Promise<ADPRanking[]> {
  const rows = await prisma.adpDataRecord.findMany({
    where: {
      sport: segment.sport,
      format: segment.format,
      scoring: segment.scoring,
      season: currentSeason(),
      week: { lte: currentWeek() },
      source: { notIn: ['ai_adp', 'allfantasy_app', 'custom', 'consensus'] },
    },
    orderBy: [{ week: 'desc' }, { createdAt: 'desc' }],
    take: 4000,
  })

  const byPlayer = new Map<string, RankingAccumulator>()
  const seenProviderRows = new Set<string>()

  for (const row of rows) {
    const providerKey = `${row.playerId}:${row.source}`
    if (seenProviderRows.has(providerKey)) continue
    seenProviderRows.add(providerKey)

    const key = playerKey(row.playerId, row.playerName, row.position, row.team)
    const current = byPlayer.get(key) ?? {
      playerId: row.playerId,
      playerName: row.playerName,
      position: row.position,
      team: row.team,
      values: [],
    }
    current.values.push(Number(row.adp))
    byPlayer.set(key, current)
  }

  return sortRankings(
    [...byPlayer.values()].map((entry) => ({
      playerId: entry.playerId,
      playerName: entry.playerName,
      position: entry.position,
      team: entry.team,
      adp: Number((entry.values.reduce((sum, value) => sum + value, 0) / entry.values.length).toFixed(2)),
      source: 'api' as const,
      sampleSize: entry.values.length,
    }))
  )
}

async function loadGlobalAppAdp(segment: DraftSegment): Promise<ADPRanking[]> {
  /*
   * 🛑 SPORT COMES FROM THE LEAGUE, NOT `DraftSession.sportType`.
   * This is the same defect the daily recompute carried: `sportType` is nullable and
   * `lib/draft/sleeperSync.ts` never writes it, so `sportType: 'NFL'` matched no
   * Sleeper-mirrored session at all - and mirrored sessions are where live external drafts
   * live. Prisma equality never matches NULL. The `global_app` component of the blend, a
   * default 35% of the number, was therefore built from whichever sessions happened to have
   * the column set. `League.sport` is a non-nullable enum on a required relation.
   */
  const sessions = await prisma.draftSession.findMany({
    where: {
      league: { sport: segment.sport },
      status: { in: ['in_progress', 'completed'] },
    },
    select: {
      id: true,
      league: {
        select: {
          isDynasty: true,
          settings: true,
        },
      },
    },
    take: 250,
  })

  const matchingSessionIds = sessions
    .filter((session) => {
      const settings = (session.league?.settings ?? {}) as Record<string, unknown>
      const scoring = resolveAiAdpFormatKeyFromSettings(settings)
      return Boolean(session.league?.isDynasty) === segment.isDynasty && scoring === segment.scoring
    })
    .map((session) => session.id)

  if (matchingSessionIds.length === 0) {
    return []
  }

  const picks = await prisma.draftPick.findMany({
    where: {
      sessionId: { in: matchingSessionIds },
      position: { notIn: ['SKIP'] },
    },
    select: {
      playerId: true,
      playerName: true,
      position: true,
      team: true,
      overall: true,
    },
    take: 15000,
  })

  const byPlayer = new Map<string, RankingAccumulator>()
  for (const pick of picks) {
    const id = pick.playerId ?? `${pick.playerName}:${pick.position}:${pick.team ?? 'FA'}`
    const key = playerKey(id, pick.playerName, pick.position, pick.team)
    const current = byPlayer.get(key) ?? {
      playerId: id,
      playerName: pick.playerName,
      position: pick.position,
      team: pick.team ?? null,
      values: [],
    }
    current.values.push(Number(pick.overall))
    byPlayer.set(key, current)
  }

  return sortRankings(
    [...byPlayer.values()].map((entry) => ({
      playerId: entry.playerId,
      playerName: entry.playerName,
      position: entry.position,
      team: entry.team,
      adp: Number((entry.values.reduce((sum, value) => sum + value, 0) / entry.values.length).toFixed(2)),
      source: 'global_app' as const,
      sampleSize: entry.values.length,
    }))
  )
}

async function loadAiAdp(segment: DraftSegment): Promise<ADPRanking[]> {
  const ai = await getAiAdpForLeague(segment.sport, segment.isDynasty, segment.scoring)
  if (!ai?.entries?.length) {
    return []
  }

  return sortRankings(
    ai.entries.map((entry) => ({
      playerId:
        `${segment.sport}:${entry.playerName}:${entry.position}:${entry.team ?? 'FA'}`
          .toLowerCase()
          .replace(/\s+/g, '-'),
      playerName: entry.playerName,
      position: entry.position,
      team: entry.team ?? null,
      adp: Number(entry.adp),
      source: 'ai' as const,
      sampleSize: Number(entry.sampleSize ?? 0),
    }))
  )
}

export async function getCustomAdpRankings(leagueId: string): Promise<ADPRanking[]> {
  const segment = await resolveDraftSegment(leagueId)
  const custom = Array.isArray(segment.settings.draft_custom_adp)
    ? (segment.settings.draft_custom_adp as ADPRanking[])
    : []

  return sortRankings(
    custom.map((entry, index) => ({
      playerId: String(entry.playerId ?? `${entry.playerName}:${entry.position}:${entry.team ?? 'FA'}`),
      playerName: String(entry.playerName ?? ''),
      position: String(entry.position ?? ''),
      team: entry.team ?? null,
      adp: Number(entry.adp ?? index + 1),
      source: 'custom' as const,
      locked: Boolean(entry.locked),
    }))
  )
}

export async function setCustomAdpRankings(leagueId: string, rankings: ADPRanking[]): Promise<void> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  if (!league) {
    throw new Error('League not found')
  }

  const settings = ((league.settings ?? {}) as Record<string, unknown>)
  const nextSettings = {
    ...settings,
    draft_custom_adp: rankings.map((entry, index) => ({
      playerId: entry.playerId,
      playerName: entry.playerName,
      position: entry.position,
      team: entry.team ?? null,
      adp: Number(entry.adp ?? index + 1),
      locked: Boolean(entry.locked),
    })),
  }

  await prisma.league.update({
    where: { id: leagueId },
    data: {
      settings: nextSettings as any,
    },
  })
}

export async function getAdpRankings(
  leagueId: string,
  source: ADPSource
): Promise<ADPRanking[]> {
  const segment = await resolveDraftSegment(leagueId)

  if (source === 'custom') return getCustomAdpRankings(leagueId)
  if (source === 'api') return loadApiAdp(segment)
  if (source === 'global_app') return loadGlobalAppAdp(segment)
  if (source === 'ai') return loadAiAdp(segment)

  const weights = normalizeWeights((segment.settings.draft_adp_weights ?? undefined) as ADPWeights | undefined)
  return blendAdpRankings(leagueId, weights)
}

export async function blendAdpRankings(
  leagueId: string,
  weights?: ADPWeights
): Promise<ADPRanking[]> {
  const normalizedWeights = normalizeWeights(weights)
  const [api, app, ai, custom] = await Promise.all([
    getAdpRankings(leagueId, 'api'),
    getAdpRankings(leagueId, 'global_app'),
    getAdpRankings(leagueId, 'ai'),
    getCustomAdpRankings(leagueId),
  ])

  const apiMap = new Map(api.map((entry) => [playerKey(entry.playerId, entry.playerName, entry.position, entry.team), entry]))
  const appMap = new Map(app.map((entry) => [playerKey(entry.playerId, entry.playerName, entry.position, entry.team), entry]))
  const aiMap = new Map(ai.map((entry) => [playerKey(entry.playerId, entry.playerName, entry.position, entry.team), entry]))
  const customMap = new Map(custom.map((entry) => [playerKey(entry.playerId, entry.playerName, entry.position, entry.team), entry]))
  const allKeys = new Set<string>([
    ...apiMap.keys(),
    ...appMap.keys(),
    ...aiMap.keys(),
    ...customMap.keys(),
  ])

  const blended: ADPRanking[] = []
  for (const key of allKeys) {
    const apiEntry = apiMap.get(key)
    const appEntry = appMap.get(key)
    const aiEntry = aiMap.get(key)
    const customEntry = customMap.get(key)
    const base = customEntry ?? apiEntry ?? appEntry ?? aiEntry
    if (!base) continue

    /*
     * The weighting lives in lib/adp/blendPolicy.ts, not here. Our own sources are scaled by how
     * many drafts stand behind them, so a two-draft sample cannot move the board the way a
     * two-thousand-draft one does; the market side is not scaled, because its "sample size" is a
     * count of providers and is a different scale entirely.
     */
    const result = blendOne(
      {
        api: apiEntry ? { adp: apiEntry.adp, sampleSize: apiEntry.sampleSize } : null,
        app: appEntry ? { adp: appEntry.adp, sampleSize: appEntry.sampleSize } : null,
        ai: aiEntry ? { adp: aiEntry.adp, sampleSize: aiEntry.sampleSize } : null,
        custom: customEntry
          ? { adp: customEntry.adp, locked: Boolean(customEntry.locked) }
          : null,
      },
      normalizedWeights,
    )
    if (!result) continue

    blended.push({
      playerId: base.playerId,
      playerName: base.playerName,
      position: base.position,
      team: base.team,
      adp: result.adp,
      source: 'blended',
      sources: {
        api: apiEntry?.adp,
        global_app: appEntry?.adp,
        ai: aiEntry?.adp,
        custom: customEntry?.adp,
      },
      contributions: {
        api: result.contributions.api,
        global_app: result.contributions.app,
        ai: result.contributions.ai,
        custom: result.contributions.custom,
      },
      ownSampleSize: result.ownSampleSize,
      lowOwnSample: result.lowOwnSample,
      locked: Boolean(customEntry?.locked),
    })
  }

  return sortRankings(blended)
}
