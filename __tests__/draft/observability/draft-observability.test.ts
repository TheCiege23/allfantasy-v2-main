import { afterEach, describe, expect, it, vi } from 'vitest'

const logStructured = vi.hoisted(() => vi.fn())

vi.mock('@/lib/logging/structured', () => ({
  logStructured: (...args: unknown[]) => logStructured(...args),
  createTimer: () => ({ elapsedMs: () => 12 }),
}))

import {
  buildNormalizedDraftHealthMeta,
  emitDraftHealth,
  sanitizeDraftObservabilityMeta,
  summarizeDraftAutomationOutcomes,
  summarizeDraftCronBatch,
  summarizeLegacyRouteBlocks,
} from '@/lib/draft/observability'

describe('draft observability (Phase 5G)', () => {
  afterEach(() => {
    logStructured.mockClear()
  })

  it('sanitizeDraftObservabilityMeta strips forbidden PII-ish keys', () => {
    const cleaned = sanitizeDraftObservabilityMeta({
      leagueId: 'league-1',
      playerName: 'Secret Player',
      email: 'x@y.com',
      nested: { displayName: 'Nope', ok: 1 },
    })
    expect(cleaned).toEqual({ leagueId: 'league-1', nested: { ok: 1 } })
  })

  it('buildNormalizedDraftHealthMeta keeps stable fields and draftEvent', () => {
    const meta = buildNormalizedDraftHealthMeta('legacy_draft_route_blocked', {
      leagueId: 'L1',
      draftSessionId: 'S1',
      draftType: 'snake',
      outcome: 'blocked',
      reason: 'legacy_worker_live_blocked',
      durationMs: 4.2,
      counts: { x: 1 },
      route: '/api/draft/worker',
    })
    expect(meta.draftEvent).toBe('legacy_draft_route_blocked')
    expect(meta.leagueId).toBe('L1')
    expect(meta.durationMs).toBe(4)
    expect(meta.playerName).toBeUndefined()
  })

  it('emitDraftHealth forwards to logStructured with draft_health source', () => {
    emitDraftHealth('warn', 'legacy_draft_route_blocked', {
      outcome: 'blocked',
      reason: 'legacy_worker_live_blocked',
      route: '/api/draft/worker',
    })
    expect(logStructured).toHaveBeenCalledWith(
      'warn',
      'draft_health',
      'legacy_draft_route_blocked',
      expect.objectContaining({
        draftEvent: 'legacy_draft_route_blocked',
        outcome: 'blocked',
        reason: 'legacy_worker_live_blocked',
        route: '/api/draft/worker',
      }),
    )
  })

  it('summarizeDraftCronBatch aggregates batch events', () => {
    const rows = [
      { source: 'draft_health', event: 'draft_cron_batch_started', outcome: 'started' },
      {
        source: 'draft_health',
        event: 'draft_cron_batch_completed',
        durationMs: 99,
        counts: { scanned: 3 },
        outcome: 'completed',
      },
    ]
    expect(summarizeDraftCronBatch(rows)).toMatchObject({
      batchStarted: 1,
      batchCompleted: 1,
      errors: 0,
      lastDurationMs: 99,
      lastCounts: { scanned: 3 },
    })
  })

  it('summarizeLegacyRouteBlocks groups by reason', () => {
    const rows = [
      { source: 'draft_health', event: 'legacy_draft_route_blocked', reason: 'legacy_worker_live_blocked' },
      { source: 'draft_health', event: 'legacy_draft_route_blocked', reason: 'legacy_worker_live_blocked' },
      { source: 'draft_health', event: 'draft_autopick_fired' },
    ]
    expect(summarizeLegacyRouteBlocks(rows)).toEqual({
      total: 2,
      byReason: { legacy_worker_live_blocked: 2 },
    })
  })

  it('summarizeDraftAutomationOutcomes counts keyed events', () => {
    const rows = [
      { source: 'draft_health', event: 'draft_queue_pick_used' },
      { source: 'draft_health', event: 'draft_bpa_fallback_used' },
      { source: 'draft_lock', event: 'lock_contended', draftEvent: 'draft_lock_busy' },
      { source: 'draft_health', event: 'chimmy_legacy_draft_signal_fallback' },
    ]
    expect(summarizeDraftAutomationOutcomes(rows)).toMatchObject({
      queuePickUsed: 1,
      bpaFallbackUsed: 1,
      lockBusy: 1,
      chimmyLegacyFallback: 1,
    })
  })
})
