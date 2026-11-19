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
