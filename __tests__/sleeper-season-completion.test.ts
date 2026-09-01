/**
 * Past and present must be distinguishable, and the old gate could not tell them apart.
 *
 * ── 🛑 THE SHIPPED BUG ──────────────────────────────────────────────────────────────────────
 * Two historical sync services gated on `if (!args.force)` and then on whether ROWS EXIST for the
 * season. Their comments claimed a "completed historical season". Those are different conditions:
 *
 *   - `getSleeperHistoricalLeagueChain` starts at the CURRENT league and walks back via
 *     `previous_league_id`, so the chain's first element is the season being played.
 *   - `SEASON_END_ROSTER_SNAPSHOT_PERIOD = 0` is written with no completed-season guard.
 *   - So a mid-season import wrote "season end" rows for a season that had not ended, and every
 *     later run skipped it — while incrementing a counter named `seasonsSkippedAlreadyComplete`.
 *
 * A user's live roster and draft froze at the instant they imported.
 *
 * ⚠ WHY THIS IS A PRODUCT TEST, NOT A CACHING ONE. Past seasons are reference material — they
 * price trades, value players, feed storylines — and must never be re-fetched, because they
 * cannot change. The present season must never be stale. A gate that cannot separate the two
 * shows someone last season's team and calls it today's.
 */
import { describe, expect, it } from 'vitest'

import {
  isSleeperSeasonComplete,
  shouldSkipImportedSeason,
} from '@/lib/league-import/sleeper/seasonCompletion'

/** Sleeper reports exactly these four. */
const IN_PROGRESS = ['pre_draft', 'drafting', 'in_season'] as const

describe('a season is skippable only when it is actually over', () => {
  it('🛑 an in-progress season is NEVER skipped — the bug, pinned', () => {
    for (const status of IN_PROGRESS) {
      expect(
        shouldSkipImportedSeason({ force: false, league: { status } }),
        `status=${status} must refresh`,
      ).toBe(false)
    }
  })

  it('a completed season IS skipped, so history is still fetched once and never again', () => {
    // The other half. A fix that refreshed everything would remove the bug and replace it with
    // re-fetching seasons that cannot change — the vendor load this gate exists to avoid.
    expect(shouldSkipImportedSeason({ force: false, league: { status: 'complete' } })).toBe(true)
  })

  it('⚠ force overrides completion, because that is what the admin escape hatch is for', () => {
    expect(shouldSkipImportedSeason({ force: true, league: { status: 'complete' } })).toBe(false)
  })

  it('⚠ an absent or unrecognised status refreshes rather than skips', () => {
    // The two failures are not symmetric: refreshing a finished season wastes one provider call;
    // skipping a live one shows stale data, which is the failure being removed.
    for (const league of [null, undefined, { status: '' }, { status: 'weird_new_value' }]) {
      expect(shouldSkipImportedSeason({ force: false, league }), JSON.stringify(league)).toBe(false)
    }
  })
})

describe('the predicate itself', () => {
  it('recognises only Sleeper’s completed status', () => {
    expect(isSleeperSeasonComplete({ status: 'complete' })).toBe(true)
    for (const status of IN_PROGRESS) {
      expect(isSleeperSeasonComplete({ status }), status).toBe(false)
    }
  })

  it('the control: it can return both answers, so a false above is a real negative', () => {
    // Without this, every `toBe(false)` would pass on a predicate hard-wired to false.
    const answers = new Set(
      ['complete', 'in_season'].map((status) => isSleeperSeasonComplete({ status })),
    )
    expect(answers).toEqual(new Set([true, false]))
  })
})
