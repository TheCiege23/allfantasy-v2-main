// @vitest-environment node
/**
 * Import Certification Phase A — historical-backfill state honesty.
 *
 * The failure being guarded against: `League.settings.historicalBackfillStatus` was stamped
 * `'pending'` for EVERY provider and the backfill was dispatched with a bare `void`. A
 * provider with no backfill service claimed work it never started, and a dispatch lost to a
 * reclaimed serverless instance left the league `'pending'` forever — indistinguishable from
 * genuinely in-progress work.
 */
import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  HISTORICAL_BACKFILL_PROVIDERS,
  HISTORICAL_BACKFILL_STALE_AFTER_MS,
  buildHistoricalBackfillDispatchStamp,
  buildHistoricalBackfillFailureStamp,
  providerSupportsHistoricalBackfill,
  resolveHistoricalBackfillState,
} from '@/lib/league-import/historicalBackfillState'
import { IMPORT_PROVIDERS } from '@/lib/league-import/types'

const NOW = new Date('2026-07-23T12:00:00.000Z')

describe('provider backfill support', () => {
  it('does not claim backfill support for fleaflicker, which has no backfill service', () => {
    expect(providerSupportsHistoricalBackfill('fleaflicker')).toBe(false)
  })

  it('lists only providers that have a real backfill service module on disk', () => {
    // Behavioral guard against the list drifting ahead of the implementation: every provider
    // claimed here must have a `*HistoricalBackfillService.ts` that `runHistoricalBackfill`
    // can import.
    const repoRoot = process.cwd()
    for (const provider of HISTORICAL_BACKFILL_PROVIDERS) {
      const name = provider.charAt(0).toUpperCase() + provider.slice(1)
      const path = join(
        repoRoot,
        'lib',
        'league-import',
        provider,
        `${name}HistoricalBackfillService.ts`,
      )
      expect(existsSync(path), `missing backfill service for ${provider}: ${path}`).toBe(true)
    }
  })

  it('classifies every known import provider explicitly', () => {
    for (const provider of IMPORT_PROVIDERS) {
      expect(typeof providerSupportsHistoricalBackfill(provider)).toBe('boolean')
    }
  })
})

describe('dispatch stamp', () => {
  it('records unsupported — never pending — for a provider with no backfill service', () => {
    const stamp = buildHistoricalBackfillDispatchStamp({ provider: 'fleaflicker', now: NOW })

    expect(stamp.historicalBackfillStatus).toBe('unsupported')
    expect(stamp.historicalBackfillStartedAt).toBeNull()
    expect(stamp.historicalBackfillStaleAfter).toBeNull()
  })

  it('marks a supported provider as pending but explicitly NOT durable', () => {
    const stamp = buildHistoricalBackfillDispatchStamp({ provider: 'sleeper', now: NOW })

    expect(stamp.historicalBackfillStatus).toBe('pending')
    // The point of the field: nothing in Phase A durably accepted this work.
    expect(stamp.historicalBackfillDurable).toBe(false)
    expect(stamp.historicalBackfillStaleAfter).toBe(
      new Date(NOW.getTime() + HISTORICAL_BACKFILL_STALE_AFTER_MS).toISOString(),
    )
  })
})

describe('resolveHistoricalBackfillState', () => {
  it('reports a lost in-process dispatch as stale once its deadline passes', () => {
    const settings = { ...buildHistoricalBackfillDispatchStamp({ provider: 'sleeper', now: NOW }) }
    const afterDeadline = new Date(NOW.getTime() + HISTORICAL_BACKFILL_STALE_AFTER_MS + 1_000)

    // This is the exact scenario that previously read as "still running" indefinitely.
    expect(resolveHistoricalBackfillState(settings, afterDeadline)).toBe('stale')
  })

  it('still reports pending while the dispatch is inside its window', () => {
    const settings = { ...buildHistoricalBackfillDispatchStamp({ provider: 'sleeper', now: NOW }) }
    const stillRunning = new Date(NOW.getTime() + 60_000)

    expect(resolveHistoricalBackfillState(settings, stillRunning)).toBe('pending')
  })

  it('treats a legacy pending row with no deadline as stale once it outlives the window', () => {
    // Rows written before this module existed have startedAt but no staleAfter.
    const legacy = {
      historicalBackfillStatus: 'pending',
      historicalBackfillStartedAt: NOW.toISOString(),
    }
    const later = new Date(NOW.getTime() + HISTORICAL_BACKFILL_STALE_AFTER_MS + 1_000)

    expect(resolveHistoricalBackfillState(legacy, later)).toBe('stale')
    expect(resolveHistoricalBackfillState(legacy, new Date(NOW.getTime() + 1_000))).toBe('pending')
  })

  it('treats pending with no timestamps at all as stale, not in-progress', () => {
    expect(resolveHistoricalBackfillState({ historicalBackfillStatus: 'pending' }, NOW)).toBe('stale')
  })

  it('never re-derives a completed backfill as stale', () => {
    const completed = {
      historicalBackfillStatus: 'complete',
      historicalBackfillStaleAfter: null,
      historicalBackfillCompletedAt: NOW.toISOString(),
    }
    const muchLater = new Date(NOW.getTime() + 100 * HISTORICAL_BACKFILL_STALE_AFTER_MS)

    expect(resolveHistoricalBackfillState(completed, muchLater)).toBe('complete')
  })

  it('preserves failed and unsupported states verbatim', () => {
    expect(
      resolveHistoricalBackfillState({ historicalBackfillStatus: 'failed' }, NOW),
    ).toBe('failed')
    expect(
      resolveHistoricalBackfillState({ historicalBackfillStatus: 'unsupported' }, NOW),
    ).toBe('unsupported')
  })

  it('reports unknown for settings with no backfill record', () => {
    expect(resolveHistoricalBackfillState({}, NOW)).toBe('unknown')
    expect(resolveHistoricalBackfillState(null, NOW)).toBe('unknown')
  })
})

describe('failure stamp', () => {
  it('records a real error message and clears the staleness deadline', () => {
    const stamp = buildHistoricalBackfillFailureStamp({ error: new Error('import() failed') })

    expect(stamp.historicalBackfillStatus).toBe('failed')
    expect(stamp.historicalBackfillError).toBe('import() failed')
    expect(stamp.historicalBackfillStaleAfter).toBeNull()
  })

  it('never records a fabricated message for a non-Error throw', () => {
    expect(buildHistoricalBackfillFailureStamp({ error: 'boom' }).historicalBackfillError).toBe('boom')
    expect(buildHistoricalBackfillFailureStamp({ error: null }).historicalBackfillError).toBe('unknown')
  })
})
