import 'server-only'

import { loadWaiverWorldFacts } from '../waiver/loader'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { HOURS, MINUTES } from '../domain-os/types'
import type { WaiverWorldFacts } from '../waiver/loader'

/**
 * Waiver OS — maintained fact state for `manager.waiver.claim`.
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-os/*` points the other way.
 *
 * WHAT IT GATHERS, AND AT WHICH LEVEL
 * `loadWaiverWorldFacts` currently derives everything on every request, but the facts inside it
 * move at completely different speeds, and collapsing them into one cache entry would force the
 * slow ones to expire as fast as the fast ones:
 *
 *   LEAGUE  waiver type, FAAB budget, claim limits, lock type
 *           League RULES. They change a few times a season, if that.
 *
 *   USER    FAAB remaining, waiver priority, resource pressure
 *           Changes every time this manager submits a claim, so it is held briefly and is the
 *           entry most likely to be derived live.
 *
 * The app level is deliberately unused here for now: waiver norms across leagues of a type are a
 * genuine app-level fact, but nothing computes them yet, and an empty level is more honest than a
 * placeholder that reads as populated.
 */

export type WaiverOsArgs = { userId: string; leagueId: string }

/** One derive per pass, shared by both sources, so a single read cannot cost two loads. */
async function deriveWorldFacts(args: WaiverOsArgs): Promise<WaiverWorldFacts | null> {
  return loadWaiverWorldFacts(args.userId, args.leagueId).catch(() => null)
}

/** League RULES: slow-moving, shared by every manager in the league. */
export const waiverSettingsSource: OsFactSource<WaiverOsArgs, WaiverWorldFacts> = {
  kind: 'settings',
  level: 'league',
  ttlMs: 6 * HOURS,
  scopeKey: (a) => a.leagueId,
  sport: () => 'NFL',
  derive: deriveWorldFacts,
}

/**
 * This manager's RESOURCES: budget left, priority, pressure.
 *
 * Short TTL on purpose. Serving a stale FAAB balance would let the system tell someone they can
 * afford a bid they cannot — a wrong answer that looks authoritative, which is precisely the
 * failure mode maintained state introduces if it is allowed to go stale.
 */
export const waiverResourceSource: OsFactSource<WaiverOsArgs, WaiverWorldFacts> = {
  kind: 'resource',
  level: 'user',
  ttlMs: 5 * MINUTES,
  scopeKey: (a) => `${a.userId}:${a.leagueId}`,
  sport: () => 'NFL',
  derive: deriveWorldFacts,
}

export function createWaiverOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('waiver', deps)
}

export const waiverOsSources = [waiverSettingsSource, waiverResourceSource] as const
