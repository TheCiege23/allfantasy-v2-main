import { z } from 'zod'
import 'server-only'
import { prisma } from '@/lib/prisma'
import { readOpeningManifest } from './seasonNativeContract'
import { seasonContractHash } from './seasonCalendarVerification'
import { seasonResourceId } from '@/lib/domain/seasonTournamentLeague'
import { seasonRosterPickError, type SeasonDraftPlayer } from './seasonDraftPolicy'
import { rankNbaDraftPoolFromPriorSeason } from './seasonNbaDraftRanking'
import { riFetchRows } from '@/lib/workers/providers/rollingInsightsRest'

const priorNbaCache = new Map<number, { expiresAt: number; rows: unknown[] }>()
const priorNbaInflight = new Map<number, Promise<unknown[]>>()
async function priorNbaStats(season: number): Promise<unknown[]> {
  const cached = priorNbaCache.get(season)
  if (cached && cached.expiresAt > Date.now()) return cached.rows
  const pending = priorNbaInflight.get(season)
  if (pending) return pending
  const request = (async () => {
    const response = await riFetchRows('player_stats', { sport: 'NBA', season, timeoutMs: 12_000 })
    if (response.error || response.notModified || response.unsupported || response.rows.length < 100) return []
    priorNbaCache.set(season, { expiresAt: Date.now() + 24 * 60 * 60_000, rows: response.rows })
    return response.rows
  })().catch(() => []).finally(() => priorNbaInflight.delete(season))
  priorNbaInflight.set(season, request)
  return request
}

export async function loadSeasonDraftContext(leagueId: string, db: Pick<typeof prisma, 'league' | 'tournamentAuditLog'> = prisma) {
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true, sport: true } })
  const settings = league?.settings as Record<string, unknown> | null
  if (!settings || !('seasonTournament' in settings)) return null
  const marker = settings.seasonTournament as { tournamentId?: string; freezeId?: string; key?: string; manifestHash?: string } | null
  if (!marker?.tournamentId || !marker.freezeId || !marker.key) throw new Error('The tournament draft binding is incomplete.')
  const event = await db.tournamentAuditLog.findFirst({ where: { id: marker.freezeId, tournamentId: marker.tournamentId, action: 'season_opening_field_frozen' } })
  if (!event) throw new Error('The frozen tournament assignment is unavailable.')
  const raw = event.data as Record<string, unknown>, { manifestHash, ...payload } = raw
  if (seasonContractHash(payload) !== manifestHash || marker.manifestHash !== manifestHash) throw new Error('The tournament draft checksum does not match.')
  const manifest = readOpeningManifest(raw), pool = manifest.leagues.find(l => l.key === marker.key)
  if (!pool || league?.sport !== manifest.config.sport || leagueId !== seasonResourceId(marker.freezeId, pool.key)) throw new Error('The tournament draft league does not match its frozen assignment.')
  return { freezeId: marker.freezeId, tournamentId: marker.tournamentId, manifestHash: manifest.manifestHash, rulesHash: manifest.rulesHash, config: manifest.config, pool, rosterIds: pool.members.map(m => seasonResourceId(marker.freezeId!, pool.key + ':roster:' + m.id)) }
}
export async function fetchSeasonDraftPlayers(leagueId: string, sport: 'NFL' | 'NBA', seasonYear?: number) {
  const { getResolvedDraftPoolForLeague } = await import('@/lib/draft-room/getResolvedDraftPoolForLeague')
  const [resolved, previous] = await Promise.all([
    getResolvedDraftPoolForLeague(leagueId, { limit: 1000 }),
    sport === 'NBA' && Number.isInteger(seasonYear) ? priorNbaStats(seasonYear! - 1) : Promise.resolve([]),
  ])
  if (resolved.rosterConfigurationIncomplete || resolved.sport !== sport) throw new Error('A complete sport-specific draft pool is unavailable.')
  const players = resolved.entries.map(e => ({ playerId: String(e.display?.playerId ?? e.playerId ?? '').trim(), playerName: e.name, position: e.position, team: e.team, adp: [e.adp, e.aiAdp, e.display?.stats?.adp].find(value => value != null && Number.isFinite(value) && value > 0) ?? null, draftIdProvenance: e.draftIdProvenance ?? { namespace: 'unknown' as const, sourceRecordId: null } })) satisfies SeasonDraftPlayer[]
  return sport === 'NBA' ? rankNbaDraftPoolFromPriorSeason(players, previous).players : players
}
/** DB-only snapshot reader; safe inside a draft mutation lock. */
export async function readSeasonDraftSnapshot(leagueId: string, manifestHash: string, db: Pick<typeof prisma, 'league' | 'tournamentAuditLog'> = prisma) {
  const context = await loadSeasonDraftContext(leagueId, db)
  if (!context || context.manifestHash !== manifestHash) return null
  const event = await db.tournamentAuditLog.findFirst({ where: { tournamentId: context.tournamentId, action: 'season_draft_pool_checked', targetId: leagueId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const parsed = z.object({ version: z.literal(1), manifestHash: z.string(), expiresAt: z.string().datetime({ offset: true }), ready: z.literal(true), players: z.array(z.object({ playerId: z.string().min(1), playerName: z.string().min(1), position: z.string().min(1), team: z.string().nullable().optional(), adp: z.number().finite().nullable().optional(), rank: z.number().finite().nullable().optional(), projectedPoints: z.number().finite().nullable().optional(), draftIdProvenance: z.object({ namespace: z.enum(['sleeper','rolling_insights','unknown']), sourceRecordId: z.string().min(1).nullable() }).optional() })) }).safeParse(event?.data)
  const data = parsed.success ? parsed.data : null
  if (!data || data.manifestHash !== context.manifestHash || new Set(data.players.map(p => p.playerId)).size !== data.players.length) return null
  return data
}
/** Refresh is performed before acquiring draft locks; validation never calls providers. */
export async function loadSeasonDraftPlayers(leagueId: string, sport: 'NFL' | 'NBA') {
  const context = await loadSeasonDraftContext(leagueId)
  if (!context || context.config.sport !== sport) throw new Error('The frozen draft context is unavailable.')
  const data = await readSeasonDraftSnapshot(leagueId, context.manifestHash)
  if (!data || Date.parse(data.expiresAt) <= Date.now()) throw new Error('Refresh the tournament draft-pool readiness check before drafting.')
  return data.players
}
export async function validateSeasonDraftPlayer(leagueId: string, rosterId: string | null, picks: Array<{ rosterId: string; playerId?: string | null; playerName: string; position: string }>, candidate: { playerId?: string | null; playerName: string; position: string; team?: string | null }) {
  const context = await loadSeasonDraftContext(leagueId)
  if (!context) return null
  if (rosterId && !context.rosterIds.includes(rosterId)) return 'This roster is not in the frozen tournament draft.'
  const pool = await loadSeasonDraftPlayers(leagueId, context.config.sport)
  const matches = pool.filter(p => p.playerId === candidate.playerId)
  if (!candidate.playerId || matches.length !== 1) return 'Select a uniquely identified player from this sport’s verified draft pool.'
  const player = matches[0]!
  if (player.playerName.trim().toLowerCase() !== candidate.playerName.trim().toLowerCase() || player.position !== candidate.position || (player.team ?? '') !== (candidate.team ?? '')) return 'Player details do not match the verified draft pool.'
  const filled = picks.filter(p => p.playerName.trim() && p.position.trim())
  if (filled.some(p => p.playerId === player.playerId || p.playerName.trim().toLowerCase() === player.playerName.trim().toLowerCase())) return 'This player is already drafted.'
  if (!rosterId) return null // Nomination may be legal for another team even when nominator cannot roster it.
  return seasonRosterPickError(context.config, filled.filter(p => p.rosterId === rosterId), player)
}
