import { describe, expect, it } from 'vitest'
import { buildImportedLeaguePreview } from '@/lib/league-import/ImportedLeaguePreviewBuilder'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import { summarizeImportCoverage } from '@/lib/league-import/importCoverageSummary'

function buildBaseNormalized(overrides?: Partial<NormalizedImportResult>): NormalizedImportResult {
  return {
    source: {
      source_provider: 'sleeper',
      source_league_id: 'src-lg-1',
      imported_at: new Date('2026-03-21T00:00:00Z').toISOString(),
    },
    league: {
      name: 'Imported League',
      sport: 'NFL',
      season: 2026,
      leagueSize: 12,
      rosterSize: 20,
      scoring: 'ppr',
      isDynasty: true,
      playoff_team_count: 6,
    },
    rosters: [
      {
        source_team_id: 'r1',
        source_manager_id: 'm1',
        owner_name: 'Manager One',
        team_name: 'KC',
        avatar_url: null,
        wins: 8,
        losses: 5,
        ties: 0,
        points_for: 1234.56,
        player_ids: ['p1'],
        starter_ids: ['p1'],
        reserve_ids: [],
        taxi_ids: [],
      },
    ],
    scoring: { scoring_format: 'ppr', rules: [] },
    schedule: [],
    draft_picks: [],
    transactions: [],
    standings: [],
    player_map: {},
    coverage: {
      leagueSettings: { state: 'full', count: 1 },
      currentRosters: { state: 'full', count: 1 },
      historicalRosterSnapshots: { state: 'partial', count: 0 },
      scoringSettings: { state: 'full', count: 1 },
      playoffSettings: { state: 'full', count: 1 },
      currentStandings: { state: 'partial', count: 0 },
      currentSchedule: { state: 'partial', count: 0 },
      draftHistory: { state: 'missing', count: 0 },
      tradeHistory: { state: 'missing', count: 0 },
      previousSeasons: { state: 'missing', count: 0 },
      playerIdentityMap: { state: 'partial', count: 0 },
    },
    ...overrides,
  }
}

describe('buildImportedLeaguePreview manager/team identity', () => {
  it('derives team logo fallback for valid sport abbreviation when provider logo is missing', () => {
    const normalized = buildBaseNormalized()
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.managers).toHaveLength(1)
    expect(preview.managers[0]).toEqual(
      expect.objectContaining({
        teamName: 'KC',
        teamAbbreviation: 'KC',
        teamLogo: expect.stringContaining('/nfl/500/kc.png'),
        managerAvatar: null,
      })
    )
  })

  it('uses provider team logo when avatar/logo is provided', () => {
    const normalized = buildBaseNormalized({
      league: {
        name: 'Imported League',
        sport: 'NBA',
        season: 2026,
        leagueSize: 10,
        rosterSize: 15,
        scoring: 'points',
        isDynasty: false,
      },
      rosters: [
        {
          source_team_id: 'r1',
          source_manager_id: 'm1',
          owner_name: 'Manager One',
          team_name: 'LAL',
          avatar_url: 'https://cdn.example/team-lal.png',
          wins: 12,
          losses: 3,
          ties: 0,
          points_for: 987.65,
          player_ids: ['p1'],
          starter_ids: ['p1'],
          reserve_ids: [],
          taxi_ids: [],
        },
      ],
    })
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.managers[0]).toEqual(
      expect.objectContaining({
        teamName: 'LAL',
        teamAbbreviation: 'LAL',
        teamLogo: 'https://cdn.example/team-lal.png',
        managerAvatar: 'https://cdn.example/team-lal.png',
      })
    )
  })
})

/**
 * 🛑 THE PREVIEW MUST NOT COMPUTE ITS OWN ANSWER ABOUT COVERAGE.
 *
 * The import screen renders `coverageNarrative` before the commit button; the league banner
 * renders `summarizeImportCoverage` after the import. If those are two derivations, a user can
 * be told "you'll get trade history", import on that basis, and then be told trade history is
 * missing. Asserting IDENTITY with the shared function — not merely that the field looks
 * plausible — is what makes that impossible rather than merely unlikely.
 */
describe('buildImportedLeaguePreview coverage narrative', () => {
  it('is byte-identical to the shared summarizer over the same coverage and provider', () => {
    /*
     * ⚠ NOT THE DEFAULT FIXTURE, AND THAT IS THE WHOLE VALUE OF THIS CASE. `buildBaseNormalized`
     * is `sleeper`, so with it this assertion passed against a builder that ignored the payload
     * and hardcoded `'sleeper'` — measured, not guessed. A control that cannot distinguish the
     * bug from the fix is not a control, so the fixture is moved off the default here.
     */
    const base = buildBaseNormalized()
    const normalized = buildBaseNormalized({
      source: { ...base.source, source_provider: 'mfl' },
      coverage: { ...base.coverage, tradeHistory: { state: 'missing', count: 0, note: null } },
    })
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.dataQuality.coverageNarrative).toEqual(
      summarizeImportCoverage(normalized.coverage, normalized.source.source_provider),
    )
    // And it is not merely equal to *some* summary — it must not be the default provider's.
    expect(preview.dataQuality.coverageNarrative).not.toEqual(
      summarizeImportCoverage(normalized.coverage, 'sleeper'),
    )
  })

  it('names the provider the payload actually came from', () => {
    /*
     * The sentence blames the PLATFORM ("Fleaflicker doesn't publish trade history"). Deriving it
     * from anything but this payload's own provider would put that limitation on someone else's
     * product.
     */
    const normalized = buildBaseNormalized({
      source: { ...buildBaseNormalized().source, source_provider: 'fleaflicker' },
      coverage: {
        ...buildBaseNormalized().coverage,
        tradeHistory: { state: 'missing', count: 0, note: null },
      },
    })
    const preview = buildImportedLeaguePreview(normalized)

    expect(preview.dataQuality.coverageNarrative.missing).toContain('tradeHistory')
    expect(preview.dataQuality.coverageNarrative.sentence ?? '').toMatch(/Fleaflicker/i)
  })
})
