import 'server-only'

import type { LeagueManagerRecords } from '@/lib/competitive-edge/managerRecordLoader'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { MINUTES } from '../domain-os/types'

/**
 * Manager Psychology OS (facts only) — maintained fact state for a league's manager records (2026-11-20 re-score).
 *
 * The domain was declared (`'psychology'` in `OsDomain`) and nothing used it: every manager question rebuilt the
 * whole league's trades, waiver claims, FAAB and drafts from scratch. This holds that build — facts only, the same
 * `LeagueManagerRecords` the tool and the packet render — for five minutes.
 *
 * ⚠ USER LEVEL, NOT LEAGUE. The view is the VIEWER's: it leaves the viewer out, and the viewer's own FAAB is found
 * through their roster (`waiverEdgeLoader.ts`). One viewer's entry must never answer another's question.
 * ⚠ MEMBERSHIP IS NOT CHECKED HERE. `loadLeagueManagerRecords` proves it on every call before reading this, and the
 * plan gate (Competitive Edge) stays in `managerRecordGrounding.ts`. The derive builds without the check, so this
 * module must never be read from anywhere else.
 * ⚠ Five minutes because a trade or a processed claim should show up quickly; no scheduled warm (a short, viewer-scoped
 * entry is warm exactly when its viewer is asking, as Commissioner OS's is).
 * ⚠ This is NOT the retired `psychology-os` (labels and scores, deleted 2026-11-17). It stores no label, score or
 * prediction — only what the record already states.
 */

type ManagerRecordsArgs = {
  userId: string
  leagueId: string
  /**
   * The commissioner's directory: every manager INCLUDING the viewer (2026-11-21 re-score, Kernel ⚠ → ✅). Its own
   * entry, because the default view leaves the viewer out — one must never answer for the other.
   */
  includeViewer?: boolean
}

export const MANAGER_RECORDS_TTL_MS = 5 * MINUTES

export const managerRecordsSource: OsFactSource<ManagerRecordsArgs, LeagueManagerRecords> = {
  kind: 'records',
  level: 'user',
  ttlMs: MANAGER_RECORDS_TTL_MS,
  // The default view keeps the key it always had; the directory adds `:all`.
  scopeKey: (a) => `${a.userId}:${a.leagueId}${a.includeViewer ? ':all' : ''}`,
  sport: () => 'ALL',
  derive: async (a) => {
    // Lazily imported: the loader reads THROUGH this module, so a static import would be a cycle.
    const { buildLeagueManagerRecords } = await import('@/lib/competitive-edge/managerRecordLoader')
    const built = await buildLeagueManagerRecords({ leagueId: a.leagueId, userId: a.userId, includeViewer: a.includeViewer === true }).catch(() => null)
    // An unavailable result is never cached: it is a fact about the read, not about the league.
    return built?.available ? built.data : null
  },
}

export function createManagerRecordsOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('psychology', deps)
}

export function createManagerRecordsOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createManagerRecordsOs(deps)
  return {
    loadRecords: (args: ManagerRecordsArgs) => feed.get(managerRecordsSource, args),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

const shared = createManagerRecordsOsLoaders()

/** The viewer's league records through the feed. Only `loadLeagueManagerRecords` may call this — see the header. */
export function loadViewerManagerRecords(args: ManagerRecordsArgs): Promise<LeagueManagerRecords | null> {
  return shared.loadRecords(args)
}

export const managerRecordsOsSources = [managerRecordsSource] as const
