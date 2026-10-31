import { describe, expect, it } from 'vitest'
import { readBackfillOutcome } from '@/lib/league-import/backfillOutcome'

describe('Fantrax historical backfill outcome', () => {
  it('records imported seasons from the flat Fantrax summary', () => {
    expect(readBackfillOutcome({ attempted: true, skipped: false,
      seasonsDiscovered: 1, seasonsImported: 1, rosterSnapshotsPersisted: 160,
    })).toEqual({ status: 'complete', seasonsDiscovered: 1, seasonsImported: 1,
      seasonsSkipped: 0, failureMessage: null })
  })

  it('records a Fantrax warehouse failure instead of unknown', () => {
    expect(readBackfillOutcome({ attempted: true, skipped: false,
      error: 'warehouse unavailable',
    })).toMatchObject({ status: 'failed', failureMessage: 'warehouse unavailable' })
  })
})
