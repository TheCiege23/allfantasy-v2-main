/**
 * Domain OS kernel — shared by the per-domain feeds that supply Decision OS.
 *
 * ⚠ These FEED Decision OS. `lib/commissioner-ui/*` consumes it. Same suffix, opposite arrow.
 */
export * from './types'
export { createOsStore, safeRead, safeWrite, type OsStore } from './store'
export {
  createOsFeed,
  type OsFeed,
  type OsFactSource,
} from './feed'
