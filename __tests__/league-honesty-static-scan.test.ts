import { readFileSync, existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// Honesty Pack 1A regression guards: source-level scans proving the five fabrication
// surfaces cannot silently return. Same pattern as the existing
// nfl-redraft-player-stat-card-no-stub test.

const read = (path: string) => readFileSync(path, 'utf8')

describe('placeholder projections are gone', () => {
  it('the fabrication module no longer exists', () => {
    expect(existsSync('components/weather/placeholderBaseline.ts')).toBe(false)
  })

  it.each([
    'app/league/[leagueId]/tabs/TeamTab.tsx',
    'app/league/[leagueId]/tabs/PlayersTab.tsx',
    'app/waiver-ai/page.tsx',
  ])('%s does not reference placeholderBaselineProjection', (path) => {
    expect(read(path)).not.toContain('placeholderBaselineProjection')
  })
})

describe('mock IDP standings do not render', () => {
  it('known mock team names and scores are absent', () => {
    const src = read('app/league/[leagueId]/tabs/StandingsTab.tsx')
    expect(src).not.toContain('Team A')
    expect(src).not.toContain('1240.2')
    expect(src).not.toMatch(/const MOCK/)
    expect(src).toContain('idp-standings-unavailable')
  })
})

describe('static checklist no longer claims completion', () => {
  it('completion-claim strings and the all-green check icon are gone from the checklist block', () => {
    const src = read('components/league-home/NflRedraftLeagueHomeDashboard.tsx')
    expect(src).not.toContain('Standings up to date')
    expect(src).not.toContain('Waivers reviewed')
    expect(src).not.toContain('Basic issue checklist')
    // The suggested list renders neutral dots, not CheckCircle2 rows mapped over static strings.
    expect(src).toContain('Suggested checklist')
  })
})

describe('plural-shell label honesty', () => {
  it('does not claim "Live from" APIs over placeholder sections', () => {
    const src = read('app/leagues/[leagueId]/page.tsx')
    expect(src).not.toContain('Live from bracket league and standings APIs')
    // The label is policy-driven: the page calls the shared source-label helper with the
    // mixed freshness ("Combined league data" — asserted in league-honesty-pack.test.tsx).
    expect(src).toContain('getSourceLabel({ freshness: "mixed" })')
  })
})

describe('League Pulse sufficiency has exactly one owner', () => {
  it('the engine refuses to score a league with zero claimed teams', () => {
    const src = read('lib/decision-os/league-pulse.ts')
    expect(src).toContain('hasAnyClaimedTeam')
    expect(src).toContain('claimedByUserId')
    expect(src).toContain("'insufficient-data'")
  })

  it('LeagueTab consumes the engine decision instead of running a second predicate', () => {
    const src = read('app/league/[leagueId]/tabs/LeagueTab.tsx')
    expect(src).not.toContain('hasLeaguePulseData')
    expect(src).not.toMatch(/leaguePulse \? \(/)
    expect(src).toContain('<LeaguePulseCard pulse={leaguePulse}')
  })

  it('the retired duplicate predicates are gone from dataHonesty', () => {
    const src = read('lib/league/dataHonesty.ts')
    expect(src).not.toContain('hasLeaguePulseData')
    expect(src).not.toContain('resolveChecklistSignal')
  })
})

describe('matchup center never presents the flat position fallback as a real projection', () => {
  it('the slot type carries the honesty flag and the service sets it', () => {
    expect(read('lib/matchup-center/types.ts')).toContain('hasRealProjection: boolean')
    const service = read('server/services/matchupCenterService.ts')
    expect(service).toContain('isReal: true')
    expect(service).toContain('isReal: false')
    expect(service).toContain('hasRealProjection: proj.isReal')
  })

  it('the starter row renders a dash instead of the fallback number', () => {
    expect(read('components/matchup-center/MatchupStarterRow.tsx')).toContain('side.hasRealProjection')
  })

  it('the engine fixture builder satisfies the required field', () => {
    expect(read('lib/engine-testing/fixtures/enginePayloadBuilders.ts')).toContain('hasRealProjection: true')
  })
})

describe('/legacy page has no fabricated identity or career stats', () => {
  it('hardcoded identity, records, and Legacy Score are gone; real session identity is used', () => {
    const src = read('app/legacy/page.tsx')
    expect(src).not.toContain('TheCiege24')
    expect(src).not.toContain('2918-3664-63')
    expect(src).not.toContain('284,844 XP')
    expect(src).not.toContain('43.1%')
    expect(src).not.toContain('Updated moments ago')
    expect(src).not.toMatch(/>531</)
    expect(src).toContain('session?.user?.name')
    expect(src).toContain('legacy-score-unavailable')
    expect(src).toContain('Career record unavailable')
    expect(src).toContain('mockLeagues.filter')
  })

  it('the hardcoded PersonalizedInsights fabrication is deleted and unmounted', () => {
    expect(existsSync('app/components/PersonalizedInsights.tsx')).toBe(false)
    expect(read('app/legacy/page.tsx')).not.toContain('PersonalizedInsights')
  })

  it('RosterLegacyReport never renders a raw API response body as the error', () => {
    const src = read('app/components/RosterLegacyReport.tsx')
    expect(src).not.toContain('await res.text()')
    expect(src).toContain('Sign in to generate your Roster Legacy Report.')
  })
})
