/**
 * Domain OS kernel — shared by the per-domain feeds that supply Decision OS.
 *
 * ⚠ These FEED Decision OS. `lib/commissioner-os/*` consumes it. Same suffix, opposite arrow.
 */
export * from './types'
export { createOsStore, safeRead, safeWrite, type OsStore } from './store'
export {
  createOsFeed,
  type OsFeed,
  type OsFactSource,
  type OsFeedOutcome,
  // Exported so a scheduler types against the union rather than re-declaring it — a second copy
  // is how `write_failed` would quietly get dropped back into `unavailable` by a later caller.
  type OsRefreshOutcome,
} from './feed'
