import { describe, expect, it } from 'vitest'
import { buildTeamIndex, resolveTeam, type CanonicalTeam } from '@/lib/follows/teamResolver'

/**
 * Team strings exactly as `player_news.team` carried them in production (30 days to 2026-10-03).
 * Measured on that window with these rules: NFL 99.1%, MLB 99.8%, NHL 97.3%, NBA 94.6%, NCAAF 96.3%
 * of team-bearing rows resolve — and the remainder are CORRECT nulls (college in a pro feed, NFL
 * codes in the college feed, "Multiple (…)", "Free Agent", former teams).
 */

const T = (s: string): CanonicalTeam[] =>
  s.split(';').map((p) => {
    const i = p.indexOf('|')
    return { abbr: p.slice(0, i), name: p.slice(i + 1) }
  })

const NFL = buildTeamIndex(
  'NFL',
  T('ARI|Arizona Cardinals;BAL|Baltimore Ravens;CHI|Chicago Bears;DAL|Dallas Cowboys;GB|Green Bay Packers;HOU|Houston Texans;LAC|Los Angeles Chargers;LAR|Los Angeles Rams;LV|Las Vegas Raiders;NE|New England Patriots;NO|New Orleans Saints;NYG|New York Giants;NYJ|New York Jets;SF|San Francisco 49ers;TEN|Tennessee Titans;WAS|Washington Commanders'),
)
const NBA = buildTeamIndex('NBA', T('LAC|Los Angeles Clippers;LAL|Los Angeles Lakers;GS|Golden State Warriors;PHI|Philadelphia 76ers;POR|Portland Trail Blazers'))
const MLB = buildTeamIndex('MLB', T('AZ|Arizona Diamondbacks;BOS|Boston Red Sox;CWS|Chicago White Sox;STL|St. Louis Cardinals;ATH|Athletics'))
const NCAAF = buildTeamIndex(
  'NCAAF',
  T('ALA|University of Alabama;ALST|Alabama State University;LSU|Louisiana State University;OSU|Ohio State University;OHIO|Ohio University;MISS|University of Mississippi;MSST|Mississippi State University;UGA|University of Georgia;GT|Georgia Institute of Technology;TENN|University of Tennessee;TNTC|Tennessee Technological University;M-OH|Miami University;MIA|University of Miami;TEX|University of Texas at Austin;TAMU|Texas A&M University;CIN|University of Cincinnati;SJSU|San Jose State University;BGSU|Bowling Green State University;HAW|University of Hawaii at Manoa'),
)

describe('pro leagues', () => {
  it('abbreviation, full name, nickname and "ABBR (Nickname)" all reach one team', () => {
    for (const s of ['GB', 'Green Bay Packers', 'Packers', 'packers']) expect(resolveTeam(NFL, s), s).toBe('GB')
    expect(resolveTeam(NFL, 'LV (Raiders)')).toBe('LV')
    expect(resolveTeam(NFL, 'DAL (Cowboys)')).toBe('DAL')
    expect(resolveTeam(NFL, '49ers')).toBe('SF')
    expect(resolveTeam(NFL, 'WSH')).toBe('WAS')
    expect(resolveTeam(NBA, 'LA CLIPPERS')).toBe('LAC')
    expect(resolveTeam(NBA, 'PORTLAND TRAIL BLAZERS')).toBe('POR')
    expect(resolveTeam(MLB, 'BOSTON RED SOX')).toBe('BOS')
    expect(resolveTeam(MLB, 'ST. LOUIS CARDINALS')).toBe('STL')
    expect(resolveTeam(MLB, 'ARI')).toBe('AZ')
  })

  it('anything that names no single CURRENT team resolves to null, never a guess', () => {
    for (const s of [
      'Multiple (Ravens, Falcons, etc.)',
      'Various (Bears, etc.)',
      'Free Agent',
      'Free Agent (formerly 49ers)',
      'Unknown/FA',
      'League-wide',
      'NFL',
      'Chargers (to Seahawks)',
      'Chargers (from Panthers)',
      'Baltimore Ravens (former)',
      'Titans (or former team)',
      'Tennessee Titans (formerly)',
      'TEXAS LONGHORNS',
      'NEW YORK YANKEES',
      '',
    ]) {
      expect(resolveTeam(NFL, s), s).toBeNull()
    }
    expect(resolveTeam(NFL, null)).toBeNull()
  })
})

describe('college', () => {
  it('school + mascot reaches the school, longest school first', () => {
    expect(resolveTeam(NCAAF, 'ALABAMA CRIMSON TIDE')).toBe('ALA')
    expect(resolveTeam(NCAAF, 'OHIO STATE BUCKEYES')).toBe('OSU')
    expect(resolveTeam(NCAAF, 'OHIO BOBCATS')).toBe('OHIO')
    expect(resolveTeam(NCAAF, 'MISSISSIPPI STATE BULLDOGS')).toBe('MSST')
    expect(resolveTeam(NCAAF, 'TEXAS A&M AGGIES')).toBe('TAMU')
    expect(resolveTeam(NCAAF, 'TEXAS LONGHORNS')).toBe('TEX')
  })

  it('short names and abbreviations with a mascot', () => {
    expect(resolveTeam(NCAAF, 'LSU TIGERS')).toBe('LSU')
    expect(resolveTeam(NCAAF, 'OLE MISS REBELS')).toBe('MISS')
    expect(resolveTeam(NCAAF, 'MIAMI HURRICANES')).toBe('MIA')
    expect(resolveTeam(NCAAF, 'MIAMI (OH) REDHAWKS')).toBe('M-OH')
    expect(resolveTeam(NCAAF, 'SAN JOSÉ STATE SPARTANS')).toBe('SJSU')
    expect(resolveTeam(NCAAF, "HAWAI'I RAINBOW WARRIORS")).toBe('HAW')
    expect(resolveTeam(NCAAF, 'BOWLING GREEN FALCONS')).toBe('BGSU')
  })

  it('the measured mismatches stay fixed: "X TECH" is not X', () => {
    expect(resolveTeam(NCAAF, 'GEORGIA TECH YELLOW JACKETS')).toBe('GT')
    expect(resolveTeam(NCAAF, 'GEORGIA BULLDOGS')).toBe('UGA')
    expect(resolveTeam(NCAAF, 'TENNESSEE TECH GOLDEN EAGLES')).toBe('TNTC')
    expect(resolveTeam(NCAAF, 'TENNESSEE VOLUNTEERS')).toBe('TENN')
  })

  it('a bare code in the college feed is NFL noise, not a school ("CIN" is the Bengals, not the Bearcats)', () => {
    for (const s of ['CIN', 'PHI', 'TB', 'DET']) expect(resolveTeam(NCAAF, s), s).toBeNull()
    expect(resolveTeam(NCAAF, 'CINCINNATI BEARCATS')).toBe('CIN')
  })
})
