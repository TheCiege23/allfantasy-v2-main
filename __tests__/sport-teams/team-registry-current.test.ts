/**
 * lib/sport-teams/SportTeamMetadataRegistry.ts's NBA, MLB and NHL lists are the current clubs (2026-11-19). They had
 * NHL ARI (gone; Utah Mammoth since) and MLB OAK (the Athletics are ATH), and built the White Sox crest as cws.png,
 * which ESPN names chw.png. Worse than the logos: Rolling Insights sends ATH and AZ, which matched no club, so those
 * players had no team_id.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPrimaryLogoUrlForTeam, getTeamByAbbreviation, getTeamIdByAbbreviationMap, getTeamMetadataForSport } from '@/lib/sport-teams/SportTeamMetadataRegistry'

function espnCaptureCrests(sport: string): Map<string, { name: string; logo: string }> {
  const file = path.join(process.cwd(), 'contracts', 'espn', 'fixtures', `teams.${sport}.json`)
  const json = JSON.parse(fs.readFileSync(file, 'utf8')) as { sports: Array<{ leagues: Array<{ teams: Array<{ team: { abbreviation: string; displayName: string; logos: Array<{ href: string; rel: string[] }> } }> }> }> }
  return new Map(json.sports[0]!.leagues[0]!.teams.map(({ team }) => [team.displayName, { name: team.displayName, logo: team.logos.find(l => l.rel.includes('default') && !l.rel.includes('dark'))!.href }]))
}

describe.each(['NBA', 'MLB', 'NHL'] as const)('%s registry', (sport) => {
  const teams = getTeamMetadataForSport(sport)
  const espn = espnCaptureCrests(sport)

  it("is ESPN's clubs: every one named as ESPN names it, with ESPN's crest", () => {
    expect(teams).toHaveLength(espn.size)
    for (const team of teams) {
      const match = espn.get(team.team_name)
      expect(match, `${sport} ${team.abbreviation}: "${team.team_name}" is not an ESPN club`).toBeDefined()
      expect(team.primary_logo_url).toBe(match!.logo)
    }
  })

  it('codes are unique, and team_id is the code', () => {
    expect(new Set(teams.map(t => t.abbreviation)).size).toBe(teams.length)
    expect(teams.every(t => t.team_id === t.abbreviation)).toBe(true)
  })
})

describe('the clubs that moved', () => {
  it('NHL: no Arizona, the Utah Mammoth instead', () => {
    expect(getTeamByAbbreviation('NHL', 'ARI')).toBeNull()
    expect(getTeamByAbbreviation('NHL', 'UTAH')?.team_name).toBe('Utah Mammoth')
    expect(getTeamByAbbreviation('NHL', 'UTA')?.abbreviation).toBe('UTAH')
  })

  it('MLB: the Athletics are ATH, and an old OAK row still finds them', () => {
    expect(getTeamByAbbreviation('MLB', 'ATH')?.team_name).toBe('Athletics')
    expect(getTeamByAbbreviation('MLB', 'OAK')?.abbreviation).toBe('ATH')
  })

  it("MLB: the White Sox keep the provider's code CWS, with ESPN's chw.png crest", () => {
    expect(getTeamByAbbreviation('MLB', 'CWS')?.team_name).toBe('Chicago White Sox')
    expect(getTeamByAbbreviation('MLB', 'CHW')?.abbreviation).toBe('CWS')
    expect(getPrimaryLogoUrlForTeam('MLB', 'CWS')).toBe('https://a.espncdn.com/i/teamlogos/mlb/500/chw.png')
  })
})

describe('players stored under a provider spelling get their team_id', () => {
  it("every MLB club code in Rolling Insights' capture maps to a team_id (ATH and AZ used to miss)", () => {
    const capture = fs.readFileSync(path.join(process.cwd(), 'contracts', 'rolling-insights', 'fixtures', 'live.MLB.json'), 'utf8')
    const codes = [...new Set([...capture.matchAll(/"abbrv"\s*:\s*"([A-Z]+)"/g)].map(m => m[1]!))]
    expect(codes.length).toBeGreaterThanOrEqual(20)
    const ids = getTeamIdByAbbreviationMap('MLB')
    expect(codes.filter(code => !ids.has(code))).toEqual([])
    expect(ids.get('AZ')).toBe('ARI')
    expect(ids.get('ATH')).toBe('ATH')
  })

  it("an alias maps to its club's team_id, never a team of its own", () => {
    const nba = getTeamIdByAbbreviationMap('NBA')
    expect(nba.get('WSH')).toBe('WAS')
    expect(nba.get('GSW')).toBe('GS')
    expect(new Set(nba.values()).size).toBe(30)
  })

  it('NFL has no aliases: one entry per club, so the defense rows built from it are not doubled', () => {
    expect(getTeamIdByAbbreviationMap('NFL').size).toBe(32)
  })
})
