/**
 * Regression lock for the "Roster tab opens at Wk 1 instead of the league's
 * real current week" bug found during the local rehearsal.
 *
 * Both fix sites (`app/api/league/roster/route.ts`'s `leagueWeek` response
 * field, which drives `TeamTab.tsx`'s Roster week default, and
 * `LeagueShell.tsx`'s `selectedLeague.currentWeek`, which drives
 * `MatchupTabContainer.tsx`'s Matchups week default) delegate the actual
 * precedence decision to this shared, pure function. Locking the contract
 * here locks correctness at both call sites.
 */
import { describe, expect, it } from 'vitest'
import { resolveRedraftCurrentWeek } from '@/lib/redraft/resolveRedraftCurrentWeek'

describe('resolveRedraftCurrentWeek', () => {
  it('an in-season redraft league with RedraftSeason.currentWeek=6 resolves to week 6, not week 1', () => {
    expect(
      resolveRedraftCurrentWeek({ redraftSeasonCurrentWeek: 6, legacySettingsWeek: 1 }),
    ).toBe(6)
  })

  it('RedraftSeason.currentWeek wins even when legacy League.settings disagrees', () => {
    expect(
      resolveRedraftCurrentWeek({ redraftSeasonCurrentWeek: 6, legacySettingsWeek: 3 }),
    ).toBe(6)
  })

  it('pre-draft leagues (no RedraftSeason row yet) fall back to the legacy settings week, not broken/undefined', () => {
    expect(
      resolveRedraftCurrentWeek({ redraftSeasonCurrentWeek: null, legacySettingsWeek: 1 }),
    ).toBe(1)
    expect(
      resolveRedraftCurrentWeek({ redraftSeasonCurrentWeek: undefined, legacySettingsWeek: 1 }),
    ).toBe(1)
  })

  it('falls back to week 1 when neither source has a value', () => {
    expect(
      resolveRedraftCurrentWeek({ redraftSeasonCurrentWeek: null, legacySettingsWeek: null }),
    ).toBe(1)
  })

  it('clamps to a minimum of week 1 (never returns 0 or negative)', () => {
    expect(
      resolveRedraftCurrentWeek({ redraftSeasonCurrentWeek: 0, legacySettingsWeek: null }),
    ).toBe(1)
  })
})
