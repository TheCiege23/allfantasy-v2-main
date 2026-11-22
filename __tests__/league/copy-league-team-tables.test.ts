/**
 * The NBA, NHL and MLB copy-league team tables (lib/league/copyLeagueTeamTables.ts) are ESPN's team lists as
 * captured in contracts/espn/fixtures/teams.{NBA,NHL,MLB}.json. This reads those captures and fails if the
 * table and the capture disagree on any team: one added, dropped, renamed, recoded or given another crest.
 * When ESPN's list is recaptured (contracts/espn/scripts/probe.sh teams <SPORT>), this is what says the
 * table has to follow.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { COPY_LEAGUE_MLB_TEAMS, COPY_LEAGUE_NBA_TEAMS, COPY_LEAGUE_NHL_TEAMS } from '@/lib/league/copyLeagueTeamTables'
import { copyLeagueTeams, darkCrestUrl } from '@/lib/league/copyLeague'

type EspnTeam = { abbreviation: string; displayName: string; isActive: boolean; isAllStar: boolean; logos: Array<{ href: string; rel: string[] }> }

function capture(sport: string): EspnTeam[] {
  const file = path.join(process.cwd(), 'contracts', 'espn', 'fixtures', `teams.${sport}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { sports: Array<{ leagues: Array<{ teams: Array<{ team: EspnTeam }> }> }> }
  return json.sports[0]!.leagues[0]!.teams.map((t) => t.team)
}

const fromCapture = (sport: string) =>
  capture(sport)
    .filter((t) => t.isActive && !t.isAllStar)
    .map((t) => ({
      code: t.abbreviation,
      name: t.displayName,
      logo: t.logos.find((l) => l.rel.includes('default') && !l.rel.includes('dark'))?.href ?? null,
    }))

describe.each([
  ['NBA', COPY_LEAGUE_NBA_TEAMS, 30],
  ['NHL', COPY_LEAGUE_NHL_TEAMS, 32],
  ['MLB', COPY_LEAGUE_MLB_TEAMS, 30],
] as const)('%s', (sport, table, count) => {
  it(`is exactly ESPN's ${count} active teams: code, name and default crest`, () => {
    expect(table).toHaveLength(count)
    expect([...table]).toEqual(fromCapture(sport))
  })

  it('every crest is the 500px ESPN logo for that code, so the code is its file name', () => {
    for (const t of table) {
      expect(t.logo).toBe(`https://a.espncdn.com/i/teamlogos/${sport.toLowerCase()}/500/${t.code.toLowerCase()}.png`)
    }
  })

  it('the capture has no inactive or all-star entry the table quietly left out', () => {
    expect(capture(sport)).toHaveLength(count)
  })
})

/** Each team's default and dark-background crests in a capture. */
function capturedCrests(sport: string): Array<{ logo: string | undefined; logoDark: string | undefined }> {
  return capture(sport).map((t) => ({
    logo: t.logos.find((l) => l.rel.includes('default') && !l.rel.includes('dark'))?.href,
    // The full-size dark crest is rel ["full","dark"]; ["full","scoreboard","dark"] is a different file.
    logoDark: t.logos.find((l) => l.rel.includes('dark') && !l.rel.includes('scoreboard'))?.href,
  }))
}

describe.each(['NFL', 'NBA', 'NHL', 'MLB'] as const)('%s copy-league crests', (sport) => {
  it("every team's crest and dark crest are ESPN's, as captured", () => {
    const crests = capturedCrests(sport)
    const catalog = copyLeagueTeams(sport)
    expect(catalog.length).toBeGreaterThanOrEqual(30)
    for (const t of catalog) {
      const match = crests.find((c) => c.logo === t.logo)
      expect(match, `${sport} ${t.code}: crest ${t.logo} is not in the capture`).toBeDefined()
      expect(t.logoDark).toBe(match!.logoDark)
    }
  })
})

describe('NFL', () => {
  it("covers ESPN's 32 clubs, one catalog team each", () => {
    expect(capture('NFL').filter((t) => t.isActive && !t.isAllStar)).toHaveLength(32)
    expect(new Set(copyLeagueTeams('NFL').map((t) => t.logo)).size).toBe(32)
  })
})

describe('darkCrestUrl', () => {
  it('maps a default ESPN crest to its dark file and refuses anything else', () => {
    expect(darkCrestUrl('https://a.espncdn.com/i/teamlogos/mlb/500/nyy.png')).toBe('https://a.espncdn.com/i/teamlogos/mlb/500-dark/nyy.png')
    expect(darkCrestUrl('https://a.espncdn.com/i/teamlogos/mlb/500/scoreboard/nyy.png')).toBeNull()
    expect(darkCrestUrl('https://example.com/logo.png')).toBeNull()
    expect(darkCrestUrl(null)).toBeNull()
  })
})
