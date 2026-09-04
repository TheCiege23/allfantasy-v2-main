import 'server-only'

import { createOsFeed, type OsFactSource, type OsFeed } from '../domain-os/feed'
import { MINUTES } from '../domain-os/types'
import { loadImportAssertions, type ImportAssertions } from '../import/assertions'

/**
 * Import OS — maintained fact state for the four import assertions (2.5).
 *
 * ⚠ FEEDS Decision OS. `lib/commissioner-ui/*` points the other way.
 *
 * ── 🛑 FIVE MINUTES, AND THE SHORT TTL IS THE POINT RATHER THAN TIMIDITY ────────────────────
 * Every other source in this kernel trades staleness for cost. This one cannot, because THE FACT
 * IS ITSELF A STALENESS CLAIM.
 *
 * A six-hour entry would let Decision OS report "last synced 20 minutes ago" six hours after that
 * stopped being true — a freshness answer that is itself stale, which is worse than having none.
 * It is the same shape as `waiver-os`'s FAAB warning ("tell someone they can afford a bid they
 * cannot") reached through the one fact whose entire job is to say how current everything else is.
 *
 * ⚠ AND THE CONSEQUENCE PROPAGATES. `isConclusive` reads these assertions to decide whether a
 * lineup call may be answered at all. A stale freshness fact would let it certify a claim on data
 * it believes is two hours old and is actually two days old — the refusal machinery would be
 * intact and pointed at the wrong world.
 *
 * Five minutes is short enough that the answer is honest and long enough to absorb a burst: the
 * derive is two indexed queries (`LeagueSyncState` by unique run key, plus this league's rosters),
 * so it is cheap by construction and there is little to save.
 *
 * ⚠ NOT A `refresh()` TARGET, for the same reason League OS is not. `/api/cron/domain-os-refresh`
 * fires every 30 minutes and a 5-minute entry is long expired before the next one, so scheduling
 * it would spend the derive and warm nothing while reporting healthy work. Read-through by nature.
 */

export type ImportOsArgs = { leagueId: string }

export const importAssertionSource: OsFactSource<ImportOsArgs, ImportAssertions> = {
  kind: 'assertions',
  level: 'league',
  ttlMs: 5 * MINUTES,
  scopeKey: (a) => a.leagueId,
  /*
   * ⚠ Hardcoded, and it is a known limitation rather than a choice. The assertions themselves
   * carry no sport — they are about a league's SYNC, not its game — but the store partitions on
   * this field, so a value is required. 'NFL' matches every currently-synced league. D17 follow-up:
   * plumb the league's real sport through so a non-NFL league is not filed under the wrong
   * partition, which would make its assertions unreachable rather than wrong.
   */
  sport: () => 'NFL',
  derive: (a) => loadImportAssertions(a.leagueId),
}

export function createImportOs(deps: Parameters<typeof createOsFeed>[1] = {}): OsFeed {
  return createOsFeed('import', deps)
}

/**
 * Read-through loader.
 *
 * Returns null when the league does not exist. A league with no sync state is NOT null — it comes
 * back with `parity: 'unchecked'` and null freshness, which `isConclusive` correctly treats as
 * conclusive rather than as unverified, because a native AF league has no sync to be stale.
 */
export function createImportOsLoaders(deps: Parameters<typeof createOsFeed>[1] = {}) {
  const feed = createImportOs(deps)
  return {
    loadAssertions: (leagueId: string) => feed.get(importAssertionSource, { leagueId }),
    drainOutcomes: () => feed.drainOutcomes(),
  }
}

export const importOsSources = [importAssertionSource] as const
