// @vitest-environment node
/**
 * Import Certification Phase A — cross-provider truth invariants.
 *
 * These are BEHAVIORAL tests: each one runs a real adapter's `normalize()` over a payload
 * shaped like the provider's actual API response and asserts on the normalized output. None
 * of them inspect adapter source text, so they keep holding if an adapter is rewritten.
 *
 * Each invariant encodes one failure the certification audit found in production code:
 *
 *   1. An unsupported canonical field must not be filled with a magic constant.
 *   2. A coverage bucket must not claim `full` when the canonical data behind it is absent.
 *   3. An adapter must not route a league's free-text description into `scoring`.
 *   4. An unavailable provider must expose an honest, specific reason.
 *   5. A credential flow must not be advertised as functional when the importer reads a
 *      different credential store.
 */
import { describe, it, expect } from 'vitest'
import { FleaflickerAdapter } from '@/lib/league-import/adapters/fleaflicker/FleaflickerAdapter'
import { YahooAdapter } from '@/lib/league-import/adapters/yahoo/YahooAdapter'
import type { FleaflickerImportPayload } from '@/lib/league-import/fleaflicker/types'
import type { YahooImportPayload } from '@/lib/league-import/adapters/yahoo/types'
import {
  IMPORT_PROVIDER_UI_OPTIONS,
  getImportProviderUnavailableDetail,
  getImportProviderUnavailableReason,
  isImportProviderAvailable,
} from '@/lib/league-import/provider-ui-config'

const LEAGUE_DESCRIPTION = 'Est. 2014 — 12 team superflex dynasty, $200 buy-in'

/**
 * Mirrors a real `FetchLeagueStandings` + `FetchLeagueRosters` pair for a league whose
 * response omits `rosterRequirements` — the case that used to yield a fabricated roster
 * size of 40 and an invented playoff-team count.
 */
function fleaflickerPayload(
  overrides: Partial<FleaflickerImportPayload['standings']['league']> = {},
): FleaflickerImportPayload {
  return {
    sport: 'NFL',
    season: 2025,
    standings: {
      season: 2025,
      league: {
        id: 206154,
        name: 'The Gauntlet',
        description: LEAGUE_DESCRIPTION,
        size: 12,
        waiverType: 'BLIND_BID',
        defaultWaiverBudget: 100,
        ...overrides,
      },
      divisions: [
        {
          id: 1,
          name: 'East',
          teams: [
            {
              id: 11,
              name: 'Team One',
              recordOverall: { wins: 8, losses: 5, ties: 0 },
              pointsFor: { value: 1500 },
              pointsAgainst: { value: 1400 },
              owners: [{ id: 91, displayName: 'Manager One' }],
            },
            {
              id: 12,
              name: 'Team Two',
              recordOverall: { wins: 5, losses: 8, ties: 0 },
              pointsFor: { value: 1300 },
              pointsAgainst: { value: 1450 },
              owners: [{ id: 92, displayName: 'Manager Two' }],
            },
          ],
        },
      ],
    },
    rosters: { rosters: [] },
  }
}

function yahooPayload(settings: Partial<YahooImportPayload['settings']> | null): YahooImportPayload {
  const baseSettings: NonNullable<YahooImportPayload['settings']> = {
    draftType: 'live',
    scoringType: 'head',
    usesPlayoff: true,
    playoffStartWeek: 15,
    usesPlayoffReseeding: null,
    usesLockEliminatedTeams: null,
    usesFaab: true,
    tradeEndDate: null,
    tradeRatifyType: null,
    rosterPositions: [{ position: 'QB', count: 1 }],
    statCategories: [],
    statModifiers: [{ statId: '9', value: 6 }],
    raw: {},
  }

  return {
    sourceInput: '461.l.12345',
    resolvedFromLeagueList: false,
    league: {
      leagueKey: '461.l.12345',
      leagueId: '12345',
      name: 'Yahoo Dynasty',
      sport: 'NFL',
      season: 2025,
      numTeams: 12,
      draftStatus: 'postdraft',
      currentWeek: 10,
      startWeek: 1,
      endWeek: 17,
      isFinished: false,
    },
    settings: settings === null ? null : { ...baseSettings, ...settings },
    teams: [],
    schedule: [],
    scheduleWeeksExpected: 14,
    scheduleWeeksCovered: 14,
    transactions: [],
    draftPicks: [],
    previousSeasons: [],
  }
}

describe('Invariant 1 — unsupported fields are never magic constants', () => {
  it('leaves Fleaflicker rosterSize null when the provider omits rosterRequirements', async () => {
    const result = await FleaflickerAdapter.normalize(fleaflickerPayload())

    // Regression: this used to be a hardcoded 40 that flowed into `League.rosterSize`
    // indistinguishable from a real, source-provided value.
    expect(result.league.rosterSize).toBeNull()
    expect(result.league.rosterSize).not.toBe(40)
  })

  it('still carries a genuine Fleaflicker rosterSize when the provider does supply one', async () => {
    const result = await FleaflickerAdapter.normalize(
      fleaflickerPayload({ rosterRequirements: { rosterSize: 26 } }),
    )

    // The fix must not have thrown away real data along with the fabricated default.
    expect(result.league.rosterSize).toBe(26)
  })

  it('omits Fleaflicker playoff_team_count entirely — never derives it from league size', async () => {
    const result = await FleaflickerAdapter.normalize(fleaflickerPayload())

    expect(result.league.playoff_team_count).toBeUndefined()
    // The old expression was Math.max(2, floor(size / 2)) => 6 for a 12-team league.
    expect(result.league.playoff_team_count).not.toBe(6)
  })

  it('does not fabricate a Yahoo playoff-team count when Yahoo does not report the setting', async () => {
    // `usesPlayoff: null` is Yahoo simply not returning it. The old falsy test collapsed
    // this to a hard 0, which then overrode the documented downstream default.
    const result = await YahooAdapter.normalize(yahooPayload({ usesPlayoff: null }))

    expect(result.league.playoff_team_count).toBeUndefined()
    expect(result.league.playoff_team_count).not.toBe(0)
  })

  it('records 0 Yahoo playoff teams only when Yahoo explicitly reports playoffs are off', async () => {
    const result = await YahooAdapter.normalize(yahooPayload({ usesPlayoff: false }))

    // This one IS a real derivation from real evidence, so it must survive.
    expect(result.league.playoff_team_count).toBe(0)
  })
})

describe('Invariant 2 — coverage never claims more than the adapter produced', () => {
  it('Yahoo playoffSettings is not full while the playoff-team count is unknown', async () => {
    const result = await YahooAdapter.normalize(yahooPayload({ usesPlayoff: true }))

    expect(result.league.playoff_team_count).toBeUndefined()
    expect(result.coverage.playoffSettings.state).not.toBe('full')
    expect(result.coverage.playoffSettings.state).toBe('partial')
  })

  it('Yahoo playoffSettings may be full only when playoffs are explicitly disabled', async () => {
    const result = await YahooAdapter.normalize(yahooPayload({ usesPlayoff: false }))

    expect(result.coverage.playoffSettings.state).toBe('full')
  })

  it('Yahoo playoffSettings is missing when there are no settings at all', async () => {
    const result = await YahooAdapter.normalize(yahooPayload(null))

    expect(result.coverage.playoffSettings.state).toBe('missing')
  })

  it('Fleaflicker reports playoff and scoring coverage as missing, not partial', async () => {
    const result = await FleaflickerAdapter.normalize(fleaflickerPayload())

    // `partial` implied some real playoff data had been imported. None ever was.
    expect(result.coverage.playoffSettings.state).toBe('missing')
    expect(result.coverage.scoringSettings.state).toBe('missing')
  })

  it('generalizes: a full/partial playoff bucket requires real playoff evidence', async () => {
    const cases = [
      await FleaflickerAdapter.normalize(fleaflickerPayload()),
      await YahooAdapter.normalize(yahooPayload({ usesPlayoff: true })),
      await YahooAdapter.normalize(yahooPayload({ usesPlayoff: false })),
      await YahooAdapter.normalize(yahooPayload(null)),
    ]

    for (const result of cases) {
      if (result.coverage.playoffSettings.state === 'full') {
        // "full" is only defensible when the count is known or playoffs are known-off.
        expect(typeof result.league.playoff_team_count).toBe('number')
      }
      if (result.coverage.scoringSettings.state === 'full') {
        expect(result.scoring?.rules.length ?? 0).toBeGreaterThan(0)
      }
    }
  })
})

describe('Invariant 3 — league description never becomes scoring', () => {
  it('does not route the Fleaflicker league description into the scoring field', async () => {
    const result = await FleaflickerAdapter.normalize(fleaflickerPayload())

    expect(result.league.scoring).not.toBe(LEAGUE_DESCRIPTION)
    expect(result.league.scoring).toBeNull()
    // And it must not have leaked in via the placeholder the old code fell back to.
    expect(result.league.scoring).not.toBe('imported')
  })

  it('keeps the description out of the normalized scoring block too', async () => {
    const result = await FleaflickerAdapter.normalize(fleaflickerPayload())

    expect(JSON.stringify(result.scoring ?? null)).not.toContain(LEAGUE_DESCRIPTION)
  })
})

describe('Invariant 4 — unavailable providers state an honest reason', () => {
  it('every unavailable provider carries a machine-readable reason and user-facing detail', () => {
    const unavailable = IMPORT_PROVIDER_UI_OPTIONS.filter((o) => !o.available)
    expect(unavailable.length).toBeGreaterThan(0)

    for (const option of unavailable) {
      expect(
        getImportProviderUnavailableReason(option.provider),
        `${option.provider} is unavailable with no reason`,
      ).not.toBeNull()

      const detail = getImportProviderUnavailableDetail(option.provider)
      expect(detail, `${option.provider} is unavailable with no detail`).toBeTruthy()
      // "Coming soon" is the exact non-answer this field replaces.
      expect(String(detail).toLowerCase()).not.toContain('coming soon')
    }
  })

  it('available providers expose no unavailability reason', () => {
    for (const option of IMPORT_PROVIDER_UI_OPTIONS.filter((o) => o.available)) {
      expect(getImportProviderUnavailableReason(option.provider)).toBeNull()
      expect(getImportProviderUnavailableDetail(option.provider)).toBeNull()
    }
  })

  it('describes Fantrax as needing a manual upload, not as unbuilt', () => {
    // The stale claim being corrected: Fantrax was blocked on an ownership bug that has
    // since been fixed. Its real limitation is that the wizard offers no upload step.
    expect(isImportProviderAvailable('fantrax')).toBe(false)
    expect(getImportProviderUnavailableReason('fantrax')).toBe('manual-upload-required')

    const detail = String(getImportProviderUnavailableDetail('fantrax')).toLowerCase()
    expect(detail).toContain('csv')
    // Must not resurrect the disproven ownership explanation.
    expect(detail).not.toContain('appuserid')
    expect(detail).not.toContain('ownership')
  })
})

describe('Invariant 5 — no credential flow is advertised that the importer cannot use', () => {
  it('marks MFL unavailable specifically because no screen writes the importer credential', () => {
    expect(isImportProviderAvailable('mfl')).toBe(false)
    expect(getImportProviderUnavailableReason('mfl')).toBe('credential-entry-missing')
  })

  it('does not tell users an MFL username and password will work', () => {
    const detail = String(getImportProviderUnavailableDetail('mfl')).toLowerCase()

    expect(detail).toContain('api key')
    // The removed flow: username/password → MFLConnection, a table the importer never reads.
    expect(detail).toMatch(/not supported|unavailable|no screen/)
  })
})
