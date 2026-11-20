import 'server-only'

import { getCommissionerHubHealthForUser, type CommissionerLeagueHealthSnapshot } from '@/lib/commissioner-hub/commissionerHubHealth'
import type { UserLeague } from '@/app/dashboard/types'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { MINUTES } from '../domain-os/types'

/**
 * Commissioner OS — maintained fact state for `commissioner.league.health` (2026-11-20 re-score push).
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-ui/*` points the other way.
 *
 * Every other decision domain reads its world through the domain-OS kernel (`../domain-os/feed.ts`): a stored fact
 * when it is fresh, a live derivation when it is not, the same rules for all of them. League health was the exception:
 * the Chimmy slice (`loadCommissionerHealthDecisionSlice`) rebuilt the whole snapshot — rosters, seven days of
 * activity counts, the owner-action clock, dynasty reads — on every question. This is the domain that makes it
 * ordinary.
 *
 * WHAT IT GATHERS, AND AT WHICH LEVEL
 *
 *   USER   the league-health snapshot, as `getCommissionerHubHealthForUser` builds it for the hub
 *
 * 🛑 USER, NOT LEAGUE, AND IT IS NOT A STYLE CHOICE. With dynasty signals on, the snapshot's taxi rows carry
 * `isViewer` — which team is the asker's (`dynastyHealthReads.ts`). Stored at league level, a co-commissioner would
 * be told another commissioner's team is theirs. The scope key is the (user, league) pair.
 *
 * ⚠ ACCESS IS NOT CACHED HERE. The caller proves commissioner access on every request (`assertLeagueCommissioner`)
 * before reading; a stored snapshot never stands in for that check.
 *
 * ⚠ SHORT TTL, because the snapshot counts live things — pending trades, waiver claims, missed lineups. Five minutes
 * keeps a burst of questions from rebuilding it each time without letting a cleared alert linger.
 */

type CommissionerOsArgs = { userId: string; leagueId: string }

export const COMMISSIONER_HEALTH_TTL_MS = 5 * MINUTES

/** The snapshot the hub builds for this commissioner and league, or null. Never throws (the derive contract). */
export async function deriveCommissionerHealthSnapshot(args: CommissionerOsArgs): Promise<CommissionerLeagueHealthSnapshot | null> {
  try {
    // Access is the caller's to prove; the loader filters on this flag, exactly as the Chimmy slice always did.
    const minimal = [{ id: args.leagueId, isCommissioner: true } as unknown as UserLeague]
    const snapshots = await getCommissionerHubHealthForUser(args.userId, minimal, { dynastySignals: true })
    return snapshots.find((s) => s?.leagueId === args.leagueId) ?? null
  } catch {
    return null
  }
}

export const commissionerHealthSource: OsFactSource<CommissionerOsArgs, CommissionerLeagueHealthSnapshot> = {
  kind: 'health',
  level: 'user',
  ttlMs: COMMISSIONER_HEALTH_TTL_MS,
  scopeKey: (a) => `${a.userId}:${a.leagueId}`,
  // Every sport has a health snapshot; the partition is for pruning and audit only.
  sport: () => 'ALL',
  derive: deriveCommissionerHealthSnapshot,
  measure: (s) => ({ confidence: s.dataConfidence === 'high' ? 0.9 : s.dataConfidence === 'medium' ? 0.6 : 0.3, sampleSize: s.teamCount }),
}

function createCommissionerOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('commissioner', deps)
}

export function createCommissionerOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createCommissionerOs(deps)
  return {
    loadHealthSnapshot: (args: CommissionerOsArgs) => feed.get(commissionerHealthSource, args),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const commissionerOsSources = [commissionerHealthSource] as const
