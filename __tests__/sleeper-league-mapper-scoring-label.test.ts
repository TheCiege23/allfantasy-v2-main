/**
 * 🛑 A HALF-PPR SLEEPER LEAGUE IS LABELLED "Half PPR", NOT "PPR".
 *
 * `SleeperLeagueMapper` built `League.scoring` from `scoring_settings.rec > 0 && 'PPR'`, so a league
 * paying 0.5 a catch was stored — and shown on the dashboards, and read by Chimmy's waiver board as a
 * full point a catch — as "PPR". The label now follows the rate: 1 → "PPR", 0.5 → "Half PPR" (the
 * spelling the free-text readers parse, e.g. `availablePlayersTool`), 0 → "Standard", and any other
 * rate names its number rather than rounding to a format it is not.
 *
 * Spanish: "Half PPR" is the label ESPN leagues already carry, and the dashboard deliberately keeps it
 * untranslated in a format label (core-dashboard3a-spanish.test.tsx), so no new copy is needed.
 */
import { describe, expect, it } from 'vitest'

import { SleeperLeagueMapper } from '@/lib/league-import/adapters/sleeper/SleeperLeagueMapper'
import type { SleeperImportPayload } from '@/lib/league-import/adapters/sleeper/types'

function scoringFor(scoring_settings: Record<string, number> | undefined, roster_positions: string[] = ['QB', 'BN']) {
  const payload = {
    league: { league_id: '1', name: 'x', sport: 'nfl', season: '2026', total_rosters: 12, roster_positions, scoring_settings, settings: {} },
    users: [],
    rosters: [],
  } as unknown as SleeperImportPayload
  return SleeperLeagueMapper.map(payload)?.scoring
}

describe('SleeperLeagueMapper — scoring label', () => {
  it('🛑 rec 0.5 is Half PPR', () => {
    expect(scoringFor({ rec: 0.5 })).toBe('Half PPR')
  })

  it('🛑 keeps the modifiers after it', () => {
    expect(scoringFor({ rec: 0.5, bonus_rec_te: 0.5 }, ['QB', 'SUPER_FLEX', 'BN'])).toBe('Half PPR Superflex TEP')
  })

  it('rec 1 is PPR, and rec 0 or absent is Standard (controls: unchanged)', () => {
    expect(scoringFor({ rec: 1 })).toBe('PPR')
    expect(scoringFor({ rec: 1, bonus_rec_te: 0.5 }, ['QB', 'SUPER_FLEX'])).toBe('PPR Superflex TEP')
    expect(scoringFor({ rec: 0 })).toBe('Standard')
    expect(scoringFor({})).toBe('Standard')
    expect(scoringFor(undefined)).toBe('Standard')
  })

  it('any other rate names its number instead of claiming a format', () => {
    expect(scoringFor({ rec: 0.25 })).toBe('0.25 PPR')
    expect(scoringFor({ rec: 1.5 })).toBe('1.5 PPR')
  })
})
