// @vitest-environment node
/**
 * `readBackfillOutcome` decides what a league's History tab is told about its history import.
 * It used to read only Sleeper's summary, so every finished ESPN, Yahoo, MFL and Fantrax run was
 * recorded as `unknown` with no season counts.
 */
import { describe, expect, it } from 'vitest'
import { backfillSettingsPatch, readBackfillOutcome } from '@/lib/league-import/backfillOutcome'

describe('the flat summary ESPN, Yahoo, MFL and Fantrax return', () => {
  it('records a finished run as complete, with its season counts', () => {
    // The summary the ESPN service returned for a real league on staging.
    const outcome = readBackfillOutcome({
      attempted: true,
      skipped: false,
      seasonsDiscovered: 1,
      seasonsImported: 1,
      standingsPersisted: 0,
      rosterSnapshotsPersisted: 10,
      matchupFactsPersisted: 70,
      transactionFactsPersisted: 0,
      draftFactsPersisted: 160,
      graph: { refreshed: true },
      hallOfFame: { refreshed: true, count: 0 },
    })
    expect(outcome).toEqual({
      status: 'complete',
      seasonsDiscovered: 1,
      seasonsImported: 1,
      seasonsSkipped: null,
      failureMessage: null,
    })
    expect(backfillSettingsPatch(outcome, '2026-11-19T00:00:00.000Z')).toMatchObject({
      historicalBackfillStatus: 'complete',
      historicalBackfillSeasonsImported: 1,
      historicalBackfillError: null,
    })
  })

  it('records a run that threw as failed, with the reason', () => {
    expect(
      readBackfillOutcome({
        attempted: true,
        skipped: false,
        error: 'ESPN is not responding',
        graph: { refreshed: false },
        hallOfFame: { refreshed: false },
      }),
    ).toMatchObject({ status: 'failed', seasonsImported: null, failureMessage: 'ESPN is not responding' })
  })

  it('still reports a declined run as skipped', () => {
    expect(readBackfillOutcome({ attempted: false, skipped: true, reason: 'League not found.' })).toMatchObject({
      status: 'skipped',
      failureMessage: 'League not found.',
    })
  })

  it('stays unknown when there is neither an error nor a count', () => {
    expect(readBackfillOutcome({ attempted: true, skipped: false }).status).toBe('unknown')
    expect(readBackfillOutcome({ seasonsImported: 3 }).status).toBe('unknown')
    expect(readBackfillOutcome(null).status).toBe('unknown')
  })
})

describe("Sleeper's summary is read as before", () => {
  it('reads success and failure from the nested backfill object', () => {
    expect(
      readBackfillOutcome({ backfill: { success: true, seasonsDiscovered: 3, seasonsImported: 2, seasonsSkipped: 1 } }),
    ).toEqual({ status: 'complete', seasonsDiscovered: 3, seasonsImported: 2, seasonsSkipped: 1, failureMessage: null })
    expect(
      readBackfillOutcome({ attempted: true, backfill: { success: false, failureMessage: 'no chain' } }),
    ).toMatchObject({ status: 'failed', failureMessage: 'no chain' })
  })

  it('does not fall back to the flat shape when the nested object is unreadable', () => {
    expect(readBackfillOutcome({ attempted: true, seasonsImported: 4, backfill: { success: 'yes' } }).status).toBe('unknown')
  })
})
