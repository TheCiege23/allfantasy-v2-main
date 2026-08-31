import 'server-only'

import { loadWaiverWorldFacts, loadWaiverLeagueFacts } from '../waiver/loader'
import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { HOURS, MINUTES } from '../domain-os/types'
import type { WaiverWorldFacts, WaiverLeagueFacts } from '../waiver/loader'

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

/** Args for the league-level source. No user, deliberately — see below. */
export type WaiverLeagueOsArgs = { leagueId: string }

/**
 * League RULES: slow-moving, shared by every manager in the league.
 *
 * 🛑 THIS USED TO SHARE `deriveWorldFacts` WITH THE USER SOURCE, WHICH MADE ITS OWN `level:
 * 'league'` UNDELIVERABLE. That derive takes a `userId` and returns that manager's FAAB and
 * priority alongside the settings, so warming this entry from a scheduler meant inventing a user
 * and storing one manager's private resources under a league-scoped key. Nothing read the league
 * entry, so it never lied — it just could not be populated, which is why `/api/cron/
 * domain-os-refresh` shipped able to refresh exactly one source across four domains.
 *
 * `loadWaiverLeagueFacts` derives the league half from three deps and no user, so this source is
 * now genuinely league-shaped and genuinely schedulable. It also stopped being underivable for a
 * non-member: the old path returned null when the caller had no roster in the league.
 */
export const waiverSettingsSource: OsFactSource<WaiverLeagueOsArgs, WaiverLeagueFacts> = {
  kind: 'settings',
  level: 'league',
  ttlMs: 6 * HOURS,
  scopeKey: (a) => a.leagueId,
  sport: () => 'NFL',
  derive: (a) => loadWaiverLeagueFacts(a.leagueId).catch(() => null),
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

/**
 * Shaped for `WaiverShadowDeps.loadWorldFacts`, so the feed can be adopted without touching
 * the decision path.
 *
 * ⚠ READS THROUGH THE **USER** SOURCE, NOT THE LEAGUE ONE, AND THE CHOICE IS THE CARE POINT.
 * Both sources share one `derive` and return the same whole `WaiverWorldFacts`, so whichever
 * one the read goes through decides how stale the WHOLE object may be. The league entry lives
 * 6h; the user entry lives 5min because FAAB and priority change on every claim.
 *
 * Reading through the league entry would serve a six-hour-old FAAB balance — exactly what this
 * module warns about: it would let the system tell someone they can afford a bid they cannot.
 * The header names the user entry as "the entry most likely to be derived live"; this is it.
 *
 * The 6h league entry is not dead — it is a `refresh()` target for a scheduler that does not
 * exist yet (see `OsFeed.refresh`: "the gathering half; it needs a scheduler").
 */
export function createWaiverOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createWaiverOs(deps)
  return {
    loadWorldFacts: (userId: string, leagueId: string) =>
      feed.get(waiverResourceSource, { userId, leagueId }),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const waiverOsSources = [waiverSettingsSource, waiverResourceSource] as const
