import 'server-only'
import { randomUUID } from 'crypto'
import { prisma } from '@/lib/prisma'
import { acquireAutomationLock, releaseAutomationLock } from '@/lib/automation/locks'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { assessSeasonDraftPool, type SeasonDraftPlayer } from './seasonDraftPolicy'
import { fetchSeasonDraftPlayers, loadSeasonDraftContext, readSeasonDraftSnapshot } from './seasonDraftRuntime'

const FRESH_MS = 5 * 60_000, REFRESH_EARLY_MS = 60_000, RETRY_MS = 30_000, TIMEOUT_MS = 15_000
export type SeasonDraftRefreshReport = { ready: boolean; refreshed: boolean; players: number; blockers: string[]; expiresAt?: string; retryAt?: string }

async function boundedCatalog(leagueId: string, sport: 'NFL' | 'NBA', seasonYear: number) {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    // The underlying resolver cannot be cancelled. Late results have no persistence callback.
    return await Promise.race([fetchSeasonDraftPlayers(leagueId, sport, seasonYear), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('catalog timeout')), TIMEOUT_MS) })])
  } finally { clearTimeout(timer) }
}
function sameIdentities(before: SeasonDraftPlayer[], after: SeasonDraftPlayer[]) {
  const byId = new Map(after.map(p => [p.playerId, p]))
  return before.length === after.length && before.every(p => {
    const next = byId.get(p.playerId)
    return next && p.playerName === next.playerName && p.position === next.position && (p.team ?? '') === (next.team ?? '') && JSON.stringify(p.draftIdProvenance ?? null) === JSON.stringify(next.draftIdProvenance ?? null)
  })
}

/** Dedicated refresh lease, never a pick/auction/control lock or a DB transaction. */
export async function refreshSeasonDraftPool(leagueId: string, actorId?: string): Promise<SeasonDraftRefreshReport | null> {
  const context = await loadSeasonDraftContext(leagueId)
  if (!context) return null
  const previous = await readSeasonDraftSnapshot(leagueId, context.manifestHash)
  const usable = () => Boolean(previous && Date.parse(previous.expiresAt) > Date.now())
  const fallback = (blockers: string[], retryAt?: string): SeasonDraftRefreshReport => ({ ready: usable(), refreshed: false, players: previous?.players.length ?? 0, expiresAt: previous?.expiresAt, blockers, retryAt })
  if (previous && Date.parse(previous.expiresAt) - Date.now() > REFRESH_EARLY_MS) return fallback([])
  const failure = await prisma.tournamentAuditLog.findFirst({ where: { tournamentId: context.tournamentId, action: 'season_draft_pool_refresh_failed', targetId: leagueId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] })
  const failed = failure?.data as { manifestHash?: string; retryAt?: string } | undefined
  if (failed?.manifestHash === context.manifestHash && failed.retryAt && Date.parse(failed.retryAt) > Date.now()) return fallback(['Catalog refresh is waiting before retrying.'], failed.retryAt)
  const key = 'season-draft-pool:' + leagueId, owner = randomUUID()
  const lock = await acquireAutomationLock(key, { owner, ttlMs: 45_000 })
  if (!lock.ok) return fallback(['Catalog refresh is busy or temporarily unavailable. Retry shortly.'])
  try {
    // Another invocation may have completed between the first read and lease acquisition.
    const current = await readSeasonDraftSnapshot(leagueId, context.manifestHash)
    if (current && Date.parse(current.expiresAt) - Date.now() > REFRESH_EARLY_MS) return { ready: true, refreshed: false, players: current.players.length, expiresAt: current.expiresAt, blockers: [] }
    let players: SeasonDraftPlayer[] = [], blockers: string[] = []
    try { players = await boundedCatalog(leagueId, context.config.sport, new Date(context.config.rules!.calendar.regularSeasonStartsAt).getUTCFullYear()) } catch { blockers.push('The player catalog is unavailable or timed out. Retry shortly.') }
    if (current && sameIdentities(current.players, players)) {
      const priorRank = new Map(current.players.map(player => [player.playerId, player.rank]))
      players = players.map(player => ({ ...player, rank: player.rank ?? priorRank.get(player.playerId) ?? null }))
    }
    const assessment = assessSeasonDraftPool(context.config, players, context.pool.slots)
    blockers.push(...assessment.blockers)
    // Pin the catalog's identity universe after its first successful check, including before launch.
    // Rankings may change; existing picks and active nominations retain canonical identity fields.
    if (current && !sameIdentities(current.players, players)) blockers.push('Player identities changed since the verified pool. Commissioner review is required; the existing pool has not been replaced.')
    const checkedAt = new Date(Date.now()).toISOString()
    if (blockers.length) {
      const retryAt = new Date(Date.now() + RETRY_MS).toISOString()
      await prisma.tournamentAuditLog.create({ data: { tournamentId: context.tournamentId, actorId: actorId ?? null, actorType: actorId ? 'user' : 'system', action: 'season_draft_pool_refresh_failed', targetType: 'league', targetId: leagueId, data: { version: 1, manifestHash: context.manifestHash, checkedAt, retryAt, blockers, launchReady: false } } })
      return fallback(blockers, retryAt)
    }
    const expiresAt = new Date(Date.now() + FRESH_MS).toISOString()
    await prisma.tournamentAuditLog.create({ data: { tournamentId: context.tournamentId, actorId: actorId ?? null, actorType: actorId ? 'user' : 'system', action: 'season_draft_pool_checked', targetType: 'league', targetId: leagueId, data: { version: 1, manifestHash: context.manifestHash, ready: true, checkedAt, expiresAt, players, required: assessment.required, matched: assessment.matched, blockers: [], source: 'native_resolved_catalog', rankingFallback: context.config.sport === 'NBA' ? 'measured_prior_season_nba_points_per_game_not_adp' : null, launchReady: false } } })
    return { ready: true, refreshed: true, players: assessment.players, blockers: [], expiresAt }
  } finally { await releaseAutomationLock(key, owner).catch(() => {}) }
}

/** Internal engine preflight. Providers run only for active native tournament sessions. */
export async function prepareSeasonDraftPool(leagueId: string): Promise<string | null> {
  const context = await loadSeasonDraftContext(leagueId)
  if (!context) return null
  const session = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { status: true } })
  if (session?.status !== 'in_progress') return null
  const report = await refreshSeasonDraftPool(leagueId)
  return report?.ready ? null : report?.blockers.join(' ') || 'Refresh the tournament draft player pool in the commissioner hub.'
}
