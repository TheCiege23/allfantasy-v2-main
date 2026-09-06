import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { getTeamInfo, normalizeTeamAbbrev, teamDisplayNameForSport } from '@/lib/team-abbrev'

/**
 * `SportsPlayer.team` carried two vocabularies at once, exactly as `position` did — measured on
 * production 2026-09-06: 11,580 long-form NFL rows against 4,019 code-form, 67 distinct values
 * for 32 teams. `WHERE team = 'DET'` silently missed 388 rows.
 *
 * 🛑 THE CANONICAL DIRECTION IS THE DISPLAY NAME, and that is the opposite of `position`.
 * Guap's decision, 2026-09-06, and the reason is in the code rather than in the row counts:
 * `normalizeTeamCode`'s own header states that the full display name "remains available in the
 * unbounded source tables (SportsPlayer.team, SportsTeam.name); never render `code` where a
 * display name is expected". The bounded `SportsPlayerRecord.team @db.VarChar(32)` is where the
 * short code belongs. So the long-form rows were right and the abbreviations were the anomaly.
 *
 * ⚠ `lib/core-app/teamLogo.ts` asserted the opposite — "SportsPlayer.team is an abbreviation on
 * production" — and that comment was simply WRONG: long-form outnumbers code-form 3:1. It is
 * corrected in the same commit. A stale comment that reads as authoritative is how the wrong
 * direction nearly got shipped here.
 */

const SLEEPER_CODES = [
  'ARI', 'ATL', 'BAL', 'BUF', 'CAR', 'CHI', 'CIN', 'CLE', 'DAL', 'DEN', 'DET', 'GB', 'HOU', 'IND',
  'JAX', 'KC', 'LV', 'LAC', 'LAR', 'MIA', 'MIN', 'NE', 'NO', 'NYG', 'NYJ', 'PHI', 'PIT', 'SF',
  'SEA', 'TB', 'TEN', 'WAS',
]

describe('teamDisplayNameForSport — NFL', () => {
  it('expands an abbreviation to the display name', () => {
    expect(teamDisplayNameForSport('NFL', 'DET')).toBe('Detroit Lions')
    expect(teamDisplayNameForSport('NFL', 'GB')).toBe('Green Bay Packers')
    expect(teamDisplayNameForSport('NFL', 'LV')).toBe('Las Vegas Raiders')
  })

  it('is idempotent — a display name stays itself', () => {
    /* The ingest re-runs daily over rows it already wrote; a fold that is not idempotent
     * churns `updatedAt` on every lap and makes "what changed today" unreadable. */
    expect(teamDisplayNameForSport('NFL', 'Detroit Lions')).toBe('Detroit Lions')
    expect(teamDisplayNameForSport('NFL', 'Green Bay Packers')).toBe('Green Bay Packers')
  })

  it('resolves the relocation aliases other writers still emit', () => {
    expect(teamDisplayNameForSport('NFL', 'JAC')).toBe('Jacksonville Jaguars')
    expect(teamDisplayNameForSport('NFL', 'OAK')).toBe('Las Vegas Raiders')
    expect(teamDisplayNameForSport('NFL', 'STL')).toBe('Los Angeles Rams')
    expect(teamDisplayNameForSport('NFL', 'WSH')).toBe('Washington Commanders')
  })

  it('🛑 EVERY Sleeper code resolves — one that did not would silently stay an abbreviation', () => {
    /* Sleeper writes 3,425 of the code-form rows, so an unresolved code leaves the column
     * mixed AFTER the fix, which is worse than before: it looks repaired. */
    const unresolved = SLEEPER_CODES.filter((c) => !getTeamInfo(c)?.fullName)
    expect(unresolved).toEqual([])
  })

  it('🛑 ROUND TRIPS — the display name folds BACK to the same code', () => {
    /*
     * This is the property that makes the whole change safe. 63 files call `normalizeTeamAbbrev`
     * at read time; if a display name did not fold back to its own code, every one of them would
     * break the moment the ingest switched direction.
     */
    for (const code of SLEEPER_CODES) {
      const full = getTeamInfo(code)?.fullName
      expect(full, `no display name for ${code}`).toBeTruthy()
      expect(normalizeTeamAbbrev(full!), `${code} does not round trip`).toBe(code)
    }
  })

  it('⚠ returns an UNKNOWN value unchanged rather than guessing or uppercasing', () => {
    // Neither is in the 32-team table; inventing a name for them would be a fabrication.
    expect(teamDisplayNameForSport('NFL', 'SD')).toBe('SD')
    expect(teamDisplayNameForSport('NFL', 'ARZ')).toBe('ARZ')
    expect(teamDisplayNameForSport('NFL', 'Some Practice Squad')).toBe('Some Practice Squad')
  })

  it('handles absent input without inventing a team', () => {
    expect(teamDisplayNameForSport('NFL', null)).toBeNull()
    expect(teamDisplayNameForSport('NFL', undefined)).toBeNull()
    expect(teamDisplayNameForSport('NFL', '   ')).toBeNull()
  })
})

describe('🛑 SPORT-GATED, because the table is the 32 NFL teams and nothing else', () => {
  it('🛑 does NOT mis-map a college team onto an NFL club', () => {
    /*
     * MEASURED, NOT HYPOTHETICAL. `normalizeTeamAbbrev` matches on mascot AND city, so on
     * production these two rows would fold onto NFL clubs if the gate were absent:
     *     NCAAB "Miami"      -> MIA (Miami Dolphins)
     *     NCAAB "Washington" -> WAS (Washington Commanders)
     * Same shape as MLB `Center` meaning centre FIELDER, one column over.
     */
    expect(teamDisplayNameForSport('NCAAB', 'Miami')).toBe('Miami')
    expect(teamDisplayNameForSport('NCAAB', 'Washington')).toBe('Washington')
  })

  it('🛑 does NOT uppercase a non-football team — the 35,093-row mutation', () => {
    /*
     * `normalizeTeamAbbrev` ends in `return upper`, so an ungated fold does not merely fail to
     * help outside the NFL — it MUTATES. Measured: 35,093 of 40,069 non-football rows carrying
     * a team would change case. That is the larger of the two hazards by far.
     */
    expect(teamDisplayNameForSport('MLB', 'San Francisco Giants')).toBe('San Francisco Giants')
    expect(teamDisplayNameForSport('NHL', 'Florida Panthers')).toBe('Florida Panthers')
    expect(teamDisplayNameForSport('SOCCER', 'Real Madrid')).toBe('Real Madrid')
  })

  it('🛑 NCAAF is EXCLUDED, unlike the position gate beside it', () => {
    /*
     * `normalizePositionForSport` gates on FOOTBALL_SPORTS = {NFL, NCAAF} because position CODES
     * are shared between the two. Team names are not: the canonical table holds 32 NFL clubs and
     * no college programmes, so folding NCAAF would hit the `return upper` path and uppercase
     * every school. Copying the sibling's gate verbatim would have been wrong.
     */
    expect(teamDisplayNameForSport('NCAAF', 'Ohio State Buckeyes')).toBe('Ohio State Buckeyes')
    expect(teamDisplayNameForSport('NCAAF', 'Miami')).toBe('Miami')
  })

  it('[control] an absent or unknown sport folds nothing', () => {
    expect(teamDisplayNameForSport(null, 'DET')).toBe('DET')
    expect(teamDisplayNameForSport('', 'DET')).toBe('DET')
    expect(teamDisplayNameForSport('BASKETBALL', 'DET')).toBe('DET')
  })
})

describe('the writers agree with the decision', () => {
  const raw = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
  const stripComments = (src: string) =>
    src
      .split(/\r?\n/)
      .filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l))
      .join('\n')

  it('🛑 the Sleeper seed writes the DISPLAY NAME, not an abbreviation', () => {
    /* Sleeper is the dominant code-form writer — 3,425 rows. Asserted on comment-stripped
     * source because the file now documents the old call as the thing it replaced. */
    const code = stripComments(raw('lib/sleeper/SleeperPlayerSeedService.ts'))
    expect(code).toContain('teamDisplayNameForSport')
    expect(code).not.toMatch(/normalizeTeamAbbrev\(player\.team\)/)
  })

  it('[control] the scan reads real code', () => {
    const code = stripComments(raw('lib/sleeper/SleeperPlayerSeedService.ts'))
    expect(code.length).toBeGreaterThan(400)
    expect(code).toContain('sportsPlayer')
  })
})
