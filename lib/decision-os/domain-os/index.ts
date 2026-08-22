/**
 * Domain OS kernel — shared by the per-domain feeds that supply Decision OS.
 *
 * ⚠ These FEED Decision OS. `lib/commissioner-os/*` consumes it. Same suffix, opposite arrow.
 */
export * from './types'
export { createOsStore, safeRead, safeWrite, type OsStore } from './store'
export { createOsFeed, type OsFeed, type OsFactSource, type OsFeedOutcome } from './feed'
