import { describe, expect, it } from 'vitest'

import {
  DRAFT_SNAPSHOT_STALE_WARN_ON_CLOCK_MS,
  DRAFT_SNAPSHOT_STALE_WARN_VIEWER_MS,
  friendlyPickAuthorityMessage,
  shouldWarnStaleSnapshot,
  snapshotAgeMs,
} from '@/lib/draft-room/draftTrustUi'

describe('draftTrustUi — stale snapshot thresholds', () => {
  const baseIso = '2026-05-11T12:00:00.000Z'
  const t0 = Date.parse(baseIso)

  it('does not warn when status is not in_progress', () => {
    expect(
      shouldWarnStaleSnapshot({
        status: 'paused',
        updatedAtIso: baseIso,
        nowMs: t0 + 999_000,
        isOnClock: true,
      }),
    ).toBe(false)
  })

  it('does not warn without updatedAt', () => {
    expect(
      shouldWarnStaleSnapshot({
        status: 'in_progress',
        updatedAtIso: null,
        nowMs: t0 + 60_000,
        isOnClock: true,
      }),
    ).toBe(false)
  })

  it('does not warn when updatedAt is invalid', () => {
    expect(
      shouldWarnStaleSnapshot({
        status: 'in_progress',
        updatedAtIso: 'not-a-date',
        nowMs: t0,
        isOnClock: true,
      }),
    ).toBe(false)
    expect(snapshotAgeMs('not-a-date', t0)).toBeNull()
  })

  it('on-clock: warns at exactly threshold age', () => {
    expect(
      shouldWarnStaleSnapshot({
        status: 'in_progress',
        updatedAtIso: baseIso,
        nowMs: t0 + DRAFT_SNAPSHOT_STALE_WARN_ON_CLOCK_MS,
        isOnClock: true,
      }),
    ).toBe(true)
  })

  it('on-clock: no warn just below threshold', () => {
    expect(
      shouldWarnStaleSnapshot({
        status: 'in_progress',
        updatedAtIso: baseIso,
        nowMs: t0 + DRAFT_SNAPSHOT_STALE_WARN_ON_CLOCK_MS - 1,
        isOnClock: true,
      }),
    ).toBe(false)
  })

  it('viewer: uses longer threshold', () => {
    expect(
      shouldWarnStaleSnapshot({
        status: 'in_progress',
        updatedAtIso: baseIso,
        nowMs: t0 + DRAFT_SNAPSHOT_STALE_WARN_ON_CLOCK_MS + 5000,
        isOnClock: false,
      }),
    ).toBe(false)
    expect(
      shouldWarnStaleSnapshot({
        status: 'in_progress',
        updatedAtIso: baseIso,
        nowMs: t0 + DRAFT_SNAPSHOT_STALE_WARN_VIEWER_MS,
        isOnClock: false,
      }),
    ).toBe(true)
  })
})

describe('draftTrustUi — snapshotAgeMs', () => {
  it('returns non-negative age in ms', () => {
    const iso = '2026-05-11T12:00:00.000Z'
    const t = Date.parse(iso)
    expect(snapshotAgeMs(iso, t + 10_000)).toBe(10_000)
  })

  it('returns null for missing iso', () => {
    expect(snapshotAgeMs(undefined, Date.now())).toBeNull()
  })
})

describe('draftTrustUi — friendlyPickAuthorityMessage', () => {
  it('maps stale overall', () => {
    const m = friendlyPickAuthorityMessage('DRAFT_PICK_STALE_OVERALL', 'raw')
    expect(m).toContain('refreshed')
    expect(m).not.toBe('raw')
  })

  it('maps race retry', () => {
    expect(friendlyPickAuthorityMessage('DRAFT_PICK_RACE_RETRY', null)).toContain('same moment')
  })

  it('maps not on clock', () => {
    expect(friendlyPickAuthorityMessage('DRAFT_PICK_NOT_ON_CLOCK', null)).toContain('on the clock')
  })

  it('falls back to server error when code unknown', () => {
    expect(friendlyPickAuthorityMessage('OTHER', 'Server says no')).toBe('Server says no')
  })

  it('generic fallback when no code and no error', () => {
    expect(friendlyPickAuthorityMessage(null, null)).toContain('Resync')
  })
})
