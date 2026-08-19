/**
 * Universal League Hub — sync freshness derivation (Part 7).
 *
 * Reuses `League.syncStatus` / `League.syncError` / `League.lastSyncedAt`
 * as-is (and the legacy Sleeper-table equivalents, same field names) —
 * confirmed by source read these already exist and are populated by the
 * real provider fetch/resync services. Nothing here invents a timestamp.
 *
 * Real `syncStatus` values found in this codebase today: `'success'`,
 * `'synced'`, `'error'`, `'pending'` (set at initial commit, before the
 * first resync), and `'manual'` (native/manually-created leagues — no
 * external source to sync from at all). `'syncing'` is accommodated in the
 * type for a future in-flight-resync signal but is never actually written
 * anywhere today — confirmed by grep — so it will not appear in real data
 * yet; this is disclosed, not fabricated.
 *
 * No background resync cron exists for any provider (see
 * `providerCapabilities.ts` header) — "stale" only ever clears when the
 * user (or a future OS module) explicitly re-imports.
 */
import type { LeagueHubProvider, SyncFreshness, SyncFreshnessState } from './types'

const STALE_AFTER_MS = 24 * 60 * 60 * 1000

export interface DeriveSyncFreshnessInput {
  provider: LeagueHubProvider
  syncStatus: string | null | undefined
  lastSyncedAt: Date | string | null | undefined
  now?: Date
}

export function deriveSyncFreshness(input: DeriveSyncFreshnessInput): SyncFreshness {
  const lastSyncedAtIso = input.lastSyncedAt
    ? new Date(input.lastSyncedAt).toISOString()
    : null

  if (input.provider === 'allfantasy' || input.syncStatus === 'manual') {
    return { state: 'not_applicable', lastSyncedAt: lastSyncedAtIso }
  }

  if (input.syncStatus === 'error') {
    return { state: 'failed', lastSyncedAt: lastSyncedAtIso }
  }

  if (input.syncStatus === 'syncing') {
    return { state: 'syncing', lastSyncedAt: lastSyncedAtIso }
  }

  if (!lastSyncedAtIso) {
    return { state: 'never_synced', lastSyncedAt: null }
  }

  const now = input.now ?? new Date()
  const ageMs = now.getTime() - new Date(lastSyncedAtIso).getTime()
  const state: SyncFreshnessState = ageMs <= STALE_AFTER_MS ? 'fresh' : 'stale'
  return { state, lastSyncedAt: lastSyncedAtIso }
}
