import { describe, expect, it } from 'vitest'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'
import { resolvePlayerExperience } from '@/lib/player-data/playerExperience'

function nflEntry(partial: Partial<NormalizedDraftEntry> & { yearsExp?: number | null }): NormalizedDraftEntry {
  return {
    name: 'A',
    position: 'WR',
    team: 'KC',
    yearsExp: partial.yearsExp ?? undefined,
    ...partial,
    display: {
      playerId: 'p',
      displayName: 'A B',
      sport: 'NFL',
      assets: { headshotUrl: null, teamLogoUrl: null },
      stats: {},
      metadata: {
        position: 'WR',
        teamAbbreviation: 'KC',
        byeWeek: null,
        injuryStatus: null,
        sport: 'NFL',
        classYearLabel: null,
      },
    },
  } as unknown as NormalizedDraftEntry
}

function proEntry(
  sport: 'NBA' | 'MLB' | 'NHL',
  partial: Partial<NormalizedDraftEntry> = {},
): NormalizedDraftEntry {
  return {
    name: 'A',
    position: 'G',
    team: 'BOS',
    ...partial,
    display: {
      playerId: 'p',
      displayName: 'A B',
      sport,
      assets: { headshotUrl: null, teamLogoUrl: null },
      stats: {},
      metadata: {
        position: 'G',
        teamAbbreviation: 'BOS',
        byeWeek: null,
        injuryStatus: null,
        sport,
        classYearLabel: null,
      },
    },
  } as unknown as NormalizedDraftEntry
}

describe('resolvePlayerExperience priority', () => {
  it('NFL uses explicit imported rookie flag before Sleeper years_exp when present', () => {
    const r = resolvePlayerExperience({
      sport: 'NFL',
      entry: nflEntry({ yearsExp: 4 }),
      statsJson: { isRookie: true },
      dataSource: 'thesportsdb',
      currentSeasonYear: 2026,
    })
    expect(r.rookie).toBe(true)
    expect(r.source).toBe('thesportsdb')
  })

  it('NFL falls back to Sleeper years_exp when provider JSON lacks experience fields', () => {
    const r = resolvePlayerExperience({
      sport: 'NFL',
      entry: nflEntry({ yearsExp: 2 }),
      statsJson: {},
      dataSource: 'rolling_insights',
      currentSeasonYear: 2026,
    })
    expect(r.status).toBe('veteran')
    expect(r.proYears).toBe(2)
    expect(r.source).toBe('sleeper_years_exp')
  })

  it('NFL: ClearSports stats-only JSON still falls back to Sleeper yearsExp', () => {
    const r = resolvePlayerExperience({
      sport: 'NFL',
      entry: nflEntry({ yearsExp: 1 }),
      statsJson: { passingYards: 280, rushAttempts: 4 },
      dataSource: 'clearsports',
      currentSeasonYear: 2026,
    })
    expect(r.proYears).toBe(1)
    expect(r.source).toBe('sleeper_years_exp')
  })

  it('NFL: ClearSports explicit rookie flag wins before Sleeper yearsExp', () => {
    const r = resolvePlayerExperience({
      sport: 'NFL',
      entry: nflEntry({ yearsExp: 6 }),
      statsJson: { isRookie: true },
      dataSource: 'clearsports',
      currentSeasonYear: 2026,
    })
    expect(r.rookie).toBe(true)
    expect(r.source).toBe('clearsports')
  })

  it('NFL: TheSportsDB stats-only JSON falls back to Sleeper when no experience keys', () => {
    const r = resolvePlayerExperience({
      sport: 'NFL',
      entry: nflEntry({ yearsExp: 0 }),
      statsJson: { strPosition: 'WR', idPlayer: '1' },
      dataSource: 'thesportsdb',
      currentSeasonYear: 2026,
    })
    expect(r.proYears).toBe(0)
    expect(r.source).toBe('sleeper_years_exp')
  })

  it('NBA derives proYears from draft year when present', () => {
    const r = resolvePlayerExperience({
      sport: 'NBA',
      entry: proEntry('NBA'),
      statsJson: { nbaDraftYear: 2026 },
      currentSeasonYear: 2026,
    })
    expect(r.proYears).toBe(0)
    expect(r.status).toBe('rookie')
    expect(r.source).toBe('derived_from_draft_year')
  })

  it('MLB derives from debut year when present', () => {
    const r = resolvePlayerExperience({
      sport: 'MLB',
      entry: proEntry('MLB'),
      statsJson: { mlbDebut: '2026-05-01' },
      currentSeasonYear: 2026,
    })
    expect(r.proYears).toBe(0)
    expect(r.source).toBe('derived_from_debut_year')
  })

  it('NHL older draft year resolves as veteran', () => {
    const r = resolvePlayerExperience({
      sport: 'NHL',
      entry: proEntry('NHL'),
      statsJson: { nhlDraftYear: 2018 },
      currentSeasonYear: 2026,
    })
    expect(r.proYears).toBe(8)
    expect(r.status).toBe('veteran')
  })

  it('returns unknown when no provider has usable signal', () => {
    const r = resolvePlayerExperience({
      sport: 'NBA',
      entry: proEntry('NBA'),
      statsJson: {},
      currentSeasonYear: 2026,
    })
    expect(r.status).toBe('unknown')
    expect(r.reason).toContain('no_usable_experience_fields')
  })

  it('identifies source/reason for resolved experience', () => {
    const r = resolvePlayerExperience({
      sport: 'NBA',
      entry: proEntry('NBA'),
      statsJson: { draftYear: 2024 },
      currentSeasonYear: 2026,
    })
    expect(r.source).toBe('derived_from_draft_year')
    expect(r.reason.length).toBeGreaterThan(0)
  })

  it('NCAAF does not use Sleeper years_exp — uses college class path', () => {
    const entry = {
      name: 'C',
      position: 'QB',
      team: 'OSU',
      yearsExp: 99,
      display: {
        playerId: 'p',
        displayName: 'C D',
        sport: 'NCAAF',
        assets: { headshotUrl: null, teamLogoUrl: null },
        stats: {},
        metadata: {
          position: 'QB',
          teamAbbreviation: 'OSU',
          byeWeek: null,
          injuryStatus: null,
          sport: 'NCAAF',
          classYearLabel: 'Jr',
        },
      },
    } as unknown as NormalizedDraftEntry

    const r = resolvePlayerExperience({
      sport: 'NCAAF',
      entry,
      statsJson: { years_exp: 99 },
      currentSeasonYear: 2026,
    })
    expect(r.status).toBe('college')
    expect(r.proYears).toBeNull()
  })
})
