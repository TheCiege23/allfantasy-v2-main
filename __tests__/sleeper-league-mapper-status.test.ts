/**
 * Fantasy OS Suite — Phase OS-C5: Sleeper Import Visibility Hardening.
 *
 * `SleeperLeagueMapper` fetched Sleeper's real `league.status` field (`SleeperLeagueRaw.status`,
 * confirmed present in the raw type) but never copied it into the normalized shape. `League.status`
 * has no DB default (`prisma/schema.prisma`), so every real Sleeper import left it `null`, which
 * `lib/leagues/leagueListFilter.ts`'s "no status" heuristic then silently hid from Dashboard/
 * Commissioner Hub/Manager Hub. See `docs/os/SLEEPER_IMPORT_VISIBILITY_AUDIT.md` for the full trace.
 */
import { describe, expect, it } from 'vitest'
import { SleeperLeagueMapper } from '@/lib/league-import/adapters/sleeper/SleeperLeagueMapper'
import type { SleeperImportPayload, SleeperLeagueRaw } from '@/lib/league-import/adapters/sleeper/types'

function rawLeague(overrides: Partial<SleeperLeagueRaw> = {}): SleeperLeagueRaw {
  return {
    league_id: 'league-1',
    name: 'Test League',
    sport: 'nfl',
    season: '2026',
    total_rosters: 12,
    ...overrides,
  }
}

function payload(overrides: Partial<SleeperImportPayload> = {}): SleeperImportPayload {
  return { league: rawLeague(), ...overrides } as SleeperImportPayload
}

describe('SleeperLeagueMapper — status field (Phase OS-C5)', () => {
  it('maps Sleeper\'s real "complete" status through, never dropping it', () => {
    const result = SleeperLeagueMapper.map(payload({ league: rawLeague({ status: 'complete' }) }))
    expect(result?.status).toBe('complete')
  })

  it('maps every real Sleeper status value Sleeper\'s API actually returns', () => {
    for (const status of ['pre_draft', 'drafting', 'in_season', 'complete']) {
      const result = SleeperLeagueMapper.map(payload({ league: rawLeague({ status }) }))
      expect(result?.status).toBe(status)
    }
  })

  it('honestly maps to null when Sleeper genuinely reports no status — never a fabricated default', () => {
    const result = SleeperLeagueMapper.map(payload({ league: rawLeague({ status: undefined }) }))
    expect(result?.status).toBeNull()
  })
})
