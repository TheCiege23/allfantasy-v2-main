import { describe, expect, it } from 'vitest'
import { AUTO_SYNC_ACCOUNT_GAP_MS, autoSyncDue, autoSyncStorageKey } from '@/lib/core-app/lineupAutoSync'

describe('autoSyncDue', () => {
  const now = 1_000_000_000
  it('runs when it never has', () => {
    expect(autoSyncDue(null, now, AUTO_SYNC_ACCOUNT_GAP_MS)).toBe(true)
    expect(autoSyncDue(Number.NaN, now, AUTO_SYNC_ACCOUNT_GAP_MS)).toBe(true)
  })
  it('waits out the gap, then runs', () => {
    expect(autoSyncDue(now - AUTO_SYNC_ACCOUNT_GAP_MS + 1, now, AUTO_SYNC_ACCOUNT_GAP_MS)).toBe(false)
    expect(autoSyncDue(now - AUTO_SYNC_ACCOUNT_GAP_MS, now, AUTO_SYNC_ACCOUNT_GAP_MS)).toBe(true)
  })
  it('a clock that moved backwards does not lock the user out', () => {
    expect(autoSyncDue(now + 60_000, now, AUTO_SYNC_ACCOUNT_GAP_MS)).toBe(true)
  })
  it('keys the account run and each league separately', () => {
    expect(autoSyncStorageKey(null)).not.toBe(autoSyncStorageKey('l1'))
  })
})
