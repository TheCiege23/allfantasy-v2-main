/**
 * Fantasy OS Suite — Phase V8.5: Demo Truth Model.
 *
 * The three load-bearing truth invariants + freshness/staleness formatting + conservative entry-state
 * resolution. Pure; no rendering.
 */
import { describe, expect, it } from 'vitest'
import {
  DEMO_STATE_DESCRIPTORS,
  describeDemoState,
  isStale,
  formatFreshness,
  resolveEntryDemoState,
} from '@/lib/fantasy-os/demoTruthModel'

describe('demo truth invariants', () => {
  it('only live-connected is ever labeled live', () => {
    expect(describeDemoState('live-connected').isLive).toBe(true)
    for (const s of ['presentation-preview', 'engineering-smoke', 'partial-evidence', 'stale-evidence', 'unavailable-evidence', 'empty-healthy', 'sync-failure'] as const) {
      expect(describeDemoState(s).isLive, s).toBe(false)
    }
  })

  it('unavailable evidence has its own state — it is not zero / not empty-healthy', () => {
    expect(describeDemoState('unavailable-evidence').label).toBe('Data unavailable')
    expect(describeDemoState('empty-healthy').label).toBe('No action required')
    expect(describeDemoState('unavailable-evidence').label).not.toBe(describeDemoState('empty-healthy').label)
  })

  it('engineering smoke is explicitly marked internal (never a user portfolio)', () => {
    expect(describeDemoState('engineering-smoke').label.toLowerCase()).toContain('internal')
    expect(describeDemoState('engineering-smoke').isLive).toBe(false)
  })

  it('every state has a single canonical label + description', () => {
    const labels = Object.values(DEMO_STATE_DESCRIPTORS).map((d) => d.label)
    expect(new Set(labels).size).toBe(labels.length) // no duplicate terms for different states
    for (const d of Object.values(DEMO_STATE_DESCRIPTORS)) expect(d.description.length).toBeGreaterThan(0)
  })
})

describe('freshness + staleness (truthful; never invented)', () => {
  const now = new Date('2025-01-02T00:00:00.000Z')
  it('formats real timestamps and returns null when there is none', () => {
    expect(formatFreshness(null, now)).toBeNull()
    expect(formatFreshness('not-a-date', now)).toBeNull()
    expect(formatFreshness('2025-01-01T23:30:00.000Z', now)).toBe('Updated 30 min ago')
    expect(formatFreshness('2025-01-01T00:00:00.000Z', now)).toMatch(/1 day ago/)
  })
  it('detects stale data past the threshold', () => {
    expect(isStale('2025-01-01T23:00:00.000Z', now)).toBe(false) // 1h old
    expect(isStale('2024-12-30T00:00:00.000Z', now)).toBe(true) // 3d old
    expect(isStale(null, now)).toBe(false)
  })
})

describe('resolveEntryDemoState — conservative', () => {
  const now = new Date('2025-01-02T00:00:00.000Z')
  it('is never live without auth + connected leagues', () => {
    expect(resolveEntryDemoState({ isAuthenticated: false, hasConnectedLeagues: false })).toBe('presentation-preview')
    expect(resolveEntryDemoState({ isAuthenticated: true, hasConnectedLeagues: false })).toBe('presentation-preview')
  })
  it('is live for a connected, fresh account; stale when the snapshot is old; failure overrides', () => {
    expect(resolveEntryDemoState({ isAuthenticated: true, hasConnectedLeagues: true, snapshotGeneratedAt: '2025-01-02T00:00:00.000Z', now })).toBe('live-connected')
    expect(resolveEntryDemoState({ isAuthenticated: true, hasConnectedLeagues: true, snapshotGeneratedAt: '2024-12-01T00:00:00.000Z', now })).toBe('stale-evidence')
    expect(resolveEntryDemoState({ isAuthenticated: true, hasConnectedLeagues: true, syncFailed: true })).toBe('sync-failure')
  })
})
