/**
 * contracts/fantrax/fixtures/cfb-league-2026.json — the F-14 capture (contracts/fantrax/GAPS.md).
 * Pins the answer it gave (no team picture field in getLeagueInfo / getTeamRosters / getStandings)
 * and that every team identity in it is a placeholder.
 */
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const fixture = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'contracts/fantrax/fixtures/cfb-league-2026.json'), 'utf8'))

function keys(v: unknown, acc: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keys(x, acc))
  else if (v && typeof v === 'object')
    for (const [k, x] of Object.entries(v)) {
      acc.push(k)
      keys(x, acc)
    }
  return acc
}

describe('Fantrax cfb league capture (F-14)', () => {
  it('carries no team picture field in any of the three endpoints', () => {
    expect(fixture.provenance.pictureKeys).toEqual([])
    const teamShapes = [
      ...Object.values(fixture.info.teamInfo),
      ...Object.values(fixture.rosters.rosters),
      ...fixture.standings,
      ...fixture.info.matchups.flatMap((m: { matchupList: { home?: object; away?: object }[] }) => m.matchupList.flatMap((p) => [p.home, p.away]).filter(Boolean)),
    ]
    const teamKeys = new Set(teamShapes.flatMap((t) => Object.keys(t as object)))
    expect([...teamKeys].filter((k) => /logo|image|img|avatar|icon|photo|pic|url/i.test(k))).toEqual([])
  })

  it('names every team by placeholder only', () => {
    expect(fixture.counts.teams).toBe(12)
    expect(Object.keys(fixture.info.teamInfo).every((id) => /^team\d\d$/.test(id))).toBe(true)
    for (const s of fixture.standings) {
      expect(s.teamId).toMatch(/^team\d\d$/)
      expect(s.teamName).toMatch(/^Team \d\d$/)
    }
    for (const r of Object.values(fixture.rosters.rosters) as { teamName: string }[]) expect(r.teamName).toMatch(/^Team \d\d$/)
    for (const m of fixture.info.matchups)
      for (const p of m.matchupList)
        for (const side of [p.home, p.away].filter(Boolean)) {
          if (side.name !== undefined) expect(side.name).toMatch(/^Team \d\d$/)
          if (side.shortName) expect(side.shortName).toMatch(/^(T|Team )\d\d$/)
        }
    expect(fixture.info.leagueName).toBe('League')
    expect(fixture.info.leagueHistoryId).toBe('<withheld>')
    expect(keys(fixture).length).toBeGreaterThan(100)
  })
})
