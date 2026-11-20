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

const sharedFeed = createCommissionerOs()

/**
 * THE HUB SCREEN'S SNAPSHOT IS CHIMMY'S SNAPSHOT (2026-11-20). The commissioner hub builds this exact snapshot live
 * for its own page (`lib/core-app/commissionerHub.ts`); Chimmy read a cached one derived separately, up to five
 * minutes apart, so a commissioner could look at the hub and ask Chimmy and get two different counts. The screen now
 * hands what it built to this fact, and Chimmy's next read inside five minutes serves exactly that — the same numbers
 * the commissioner is looking at. It is also the warm: the entry is filled the moment a commissioner opens the hub,
 * which is when it is about to be asked about, so no scheduled job is needed for a five-minute entry.
 *
 * ⚠ ONLY A SNAPSHOT THE DERIVATION WOULD HAVE PRODUCED IS STORED:
 *   - built from the database (`source: 'database'`), never the dashboard fallback, which is assembled from the
 *     caller's league metadata and so differs by caller;
 *   - with dynasty signals whenever the league uses them — the derivation always asks for them, and they are read
 *     for exactly the leagues `usesDynastyBackground` accepts, which is the same test the hub uses to ask;
 *   - for the league it is keyed on.
 * Anything else is skipped, and Chimmy derives as before. Never throws: a failed write is an accelerator problem.
 */
export async function primeCommissionerHealthSnapshot(
  args: CommissionerOsArgs,
  snapshot: CommissionerLeagueHealthSnapshot | null | undefined,
  built: { dynastySignals: boolean; dynastyLeague: boolean },
): Promise<boolean> {
  if (!snapshot || snapshot.leagueId !== args.leagueId || snapshot.source !== 'database') return false
  if (built.dynastyLeague && !built.dynastySignals) return false
  return sharedFeed.prime(commissionerHealthSource, args, snapshot).catch(() => false)
}

export const commissionerOsSources = [commissionerHealthSource] as const
