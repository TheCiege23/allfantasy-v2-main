import { describe, expect, it } from 'vitest'
import { buildImportedLeaguePreview } from '@/lib/league-import/ImportedLeaguePreviewBuilder'
import type { NormalizedImportResult } from '@/lib/league-import/types'
import { summarizeImportCoverage } from '@/lib/league-import/importCoverageSummary'
import { buildImportReview } from '@/lib/league-import/review/buildImportReview'

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

/* The preview's scoring follows the reception RATE, with the Sleeper mapper's labels. */
describe('buildImportedLeaguePreview — reception scoring label', () => {
  const settingsFor = (league: Record<string, unknown>, scoringFormat: string | null = null) =>
    buildImportedLeaguePreview(
      buildBaseNormalized({
        league: { ...buildBaseNormalized().league, scoring: null as unknown as string, ...league },
        scoring: { scoring_format: scoringFormat, rules: [] },
      }),
    ).league.settings

  it('reads Sleeper’s rec rate: 1 is PPR, 0.5 is Half PPR, 0.25 is "0.25 PPR", 0 is Standard', () => {
    expect(settingsFor({ scoring_settings: { rec: 1 } })).toMatchObject({ ppr: true, scoringLabel: 'PPR' })
    expect(settingsFor({ scoring_settings: { rec: 0.5 } })).toMatchObject({ ppr: true, scoringLabel: 'Half PPR' })
    expect(settingsFor({ scoring_settings: { rec: 0.25 } })).toMatchObject({ ppr: true, scoringLabel: '0.25 PPR' })
    expect(settingsFor({ scoring_settings: { rec: 0 } })).toMatchObject({ ppr: false, scoringLabel: 'Standard' })
  })

  it('a provider that states only "half" is Half PPR, not PPR', () => {
    expect(settingsFor({}, 'half')).toMatchObject({ ppr: true, scoringLabel: 'Half PPR' })
    expect(settingsFor({}, 'ppr')).toMatchObject({ ppr: true, scoringLabel: 'PPR' })
    expect(settingsFor({}, 'standard')).toMatchObject({ ppr: false, scoringLabel: 'Standard' })
  })
})

/*
 * ESPN, Yahoo, MFL and Fantrax store `roster_positions` as `SLOT:COUNT` pairs. The preview compared the
 * raw entries against slot names, so an ordinary ESPN redraft lineup came back as nine "unsupported"
 * spots and the review said "AF does not support these lineup spots yet: QB:1, RB:2, WR:2…", which a
 * commissioner read as "AllFantasy doesn't support redraft" (2026-11-15). The lineup is the one in the
 * real ESPN NFL capture.
 */
describe('buildImportedLeaguePreview — SLOT:COUNT roster positions', () => {
  const ESPN_REDRAFT = ['QB:1', 'RB:2', 'WR:2', 'TE:1', 'D/ST:1', 'K:1', 'BE:7', 'IR:1', 'FLEX:1']

  function espn(rosterPositions: string[]) {
    return buildImportedLeaguePreview(
      buildBaseNormalized({
        source: { source_provider: 'espn', source_league_id: '919055222', imported_at: '2026-11-15T00:00:00Z' },
        league: {
          name: 'Jacksonville Pro H2H Points PPR League',
          sport: 'NFL',
          season: 2026,
          leagueSize: 10,
          rosterSize: 17,
          scoring: 'ppr',
          isDynasty: false,
          playoff_team_count: 4,
          roster_positions: rosterPositions,
        } as NormalizedImportResult['league'],
      }),
    )
  }

  it('an ordinary ESPN redraft lineup has no unsupported spots', () => {
    const preview = espn(ESPN_REDRAFT)
    expect(preview.formatSummary.unsupportedPositions).toEqual([])
    expect(preview.formatSummary.detectedFormat).toBe('Redraft')
    // Returned as stored: the re-import diff compares it with the league's own settings.
    expect(preview.rosterPositions).toEqual(ESPN_REDRAFT)
  })

  it('control: a slot AF really does not have is still named, once and without its count', () => {
    expect(espn([...ESPN_REDRAFT, 'XYZ:2']).formatSummary.unsupportedPositions).toEqual(['XYZ'])
  })

  it("ESPN's superflex (OP) is superflex", () => {
    const preview = espn(['QB:1', 'OP:1', 'RB:2', 'WR:2', 'TE:1', 'FLEX:1', 'BE:7'])
    expect(preview.league.settings.superflex).toBe(true)
    expect(preview.formatSummary.modifiers).toContain('superflex')
    expect(preview.formatSummary.unsupportedPositions).toEqual([])
  })

  it('a Sleeper one-per-seat list reads exactly as before', () => {
    const preview = buildImportedLeaguePreview(
      buildBaseNormalized({
        league: {
          ...buildBaseNormalized().league,
          roster_positions: ['QB', 'RB', 'RB', 'WR', 'FLEX', 'SUPER_FLEX', 'BN', 'BN'],
        } as NormalizedImportResult['league'],
      }),
    )
    expect(preview.formatSummary.unsupportedPositions).toEqual([])
    expect(preview.league.settings.superflex).toBe(true)
  })

  it('the review counts seats and says nothing about unsupported spots', () => {
    const preview = espn(ESPN_REDRAFT)
    const review = buildImportReview({ platform: 'espn', preview, playerMatches: null } as Parameters<typeof buildImportReview>[0])
    expect(review.warnings.map((w) => w.code)).not.toContain('unsupported_roster_slots')
    const slots = Object.fromEntries(review.rosterSlots.map((s) => [s.slot, s.count]))
    expect(slots).toMatchObject({ QB: 1, RB: 2, WR: 2, Bench: 7, 'Injured reserve': 1, 'Flex (RB/WR/TE)': 1 })
  })
})
