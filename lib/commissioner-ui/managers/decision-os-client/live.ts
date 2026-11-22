import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { resolveActiveLeagueId } from '../../resolveActiveLeagueId'
import type { CommissionerErrorContract } from '../../contracts'
import type { ManagerIntelligenceClient } from './types'

/**
 * The commissioner's Managers screen, live: every manager's Competitive Edge record for the active
 * league (2026-11-16, re-score item 11). It replaces the retired Manager DNA directory, whose route
 * returns 410 since the Milestone 32 privacy pass and must not be revived.
 *
 * In-process, not over HTTP: `loadLeagueManagerRecords` checks league membership itself (the league
 * owner counts as commissioner), and the page has already checked the commissioner plan
 * (`resolveCommissionerOsDepth`). DB-first: no provider call.
 */
function unavailable(message: string, retryable: boolean): CommissionerErrorContract {
  return { category: 'upstream_unavailable', message, moduleId: 'managers', retryable, timestamp: new Date().toISOString() }
}

export const liveManagerIntelligenceClient: ManagerIntelligenceClient = {
  async getManagerDirectory() {
    const timestamp = new Date().toISOString()
    const session = (await getServerSession(authOptions as never).catch(() => null)) as { user?: { id?: string } } | null
    const userId = session?.user?.id
    const leagueId = userId ? await resolveActiveLeagueId().catch(() => null) : null
    if (!userId || !leagueId) {
      return { data: null, error: unavailable('No active league could be resolved for this session.', false), source: 'live', timestamp }
    }
    const { loadLeagueManagerRecords } = await import('@/lib/competitive-edge/managerRecordLoader')
    const read = await loadLeagueManagerRecords({ leagueId, userId, includeViewer: true }).catch(() => null)
    if (!read) return { data: null, error: unavailable('Manager records could not be read right now.', true), source: 'live', timestamp }
    if (!read.available) return { data: null, error: unavailable(read.reason, false), source: 'live', timestamp }
    return {
      data: read.data.records.map((record) => ({ id: record.manager.teamExternalId, managerName: record.manager.name, record })),
      error: null,
      source: 'live',
      timestamp,
    }
  },
}
