/**
 * Pasted Yahoo league → the same YahooImportPayload the API path builds, proven by running it through
 * the REAL YahooAdapter and the REAL scoring resolver rather than asserting on the payload alone. A
 * payload that merely type-checks could still import a league that scores nothing.
 */
import { describe, expect, it } from 'vitest'
import { YahooAdapter } from '@/lib/league-import/adapters/yahoo/YahooAdapter'
import { resolveProviderScoringStatKey } from '@/lib/scoring-defaults/ScoringKeyAliasResolver'
import {
  buildYahooSnapshotPayload,
  isYahooSnapshotSourceId,
  isYahooSnapshotYahooSettings,
  mergeYahooSnapshotPage,
  parseYahooLeagueId,
  parseYahooSnapshotSourceId,
  YahooSnapshotIncompleteError,
  yahooSnapshotChecklist,
  yahooSnapshotSourceId,
} from '@/lib/league-import/yahoo/snapshot/yahooSnapshotModel'
import { parseYahooSnapshotReply } from '@/lib/league-import/yahoo/snapshot/extractYahooSnapshotPage'
import {
  emptyYahooSnapshot,
  type YahooLeagueSnapshot,
  type YahooSnapshotDraft,
  type YahooSnapshotRoster,
  type YahooSnapshotSettings,
  type YahooSnapshotStandings,
} from '@/lib/league-import/yahoo/snapshot/yahooSnapshotTypes'

const LEAGUE = '987654'

const settings: YahooSnapshotSettings = {
  kind: 'settings',
  leagueName: 'Sunday Funday',
  numTeams: 4,
  season: 2026,
  scoringType: 'Head-to-Head - Points',
  draftType: 'Live Standard Draft',
  usesFaab: true,
  playoffStartWeek: 15,
  playoffTeams: 2,
  rosterPositions: [
    { position: 'QB', count: 1 },
    { position: 'WR', count: 2 },
    { position: 'W/R/T', count: 1 },
    { position: 'BN', count: 5 },
    { position: 'IR', count: 1 },
  ],
  scoring: [
    { group: 'offense', name: 'Passing Yards', points: 0.04 },
    { group: 'offense', name: 'Receptions', points: 1 },
    { group: 'offense', name: 'Interceptions', points: -2 },
    { group: 'defense', name: 'Interceptions', points: 2 },
  ],
}

const standings: YahooSnapshotStandings = {
  kind: 'standings',
  teams: [
    { rank: 2, teamName: 'Gridiron Ghosts', managerName: 'Sam', wins: 8, losses: 5, ties: 0, pointsFor: 1500.2 },
    { rank: 1, teamName: 'Turf Toe', managerName: 'Alex', wins: 10, losses: 3, ties: 0, pointsFor: 1601.5 },
    { rank: 3, teamName: 'Fourth & Long', managerName: 'Riley', wins: 6, losses: 7, ties: 0, pointsFor: 1400 },
    { rank: 4, teamName: 'Punt Club', managerName: 'Jo', wins: 2, losses: 11, ties: 0, pointsFor: 1100 },
  ],
}

const roster: YahooSnapshotRoster = {
  kind: 'roster',
  teamName: 'turf toe', // different case on purpose — matched by normalized name
  managerName: 'Alex',
  players: [
    { slot: 'QB', playerName: 'Patrick Mahomes', position: 'QB', nflTeam: 'KC' },
    { slot: 'WR', playerName: "Ja'Marr Chase", position: 'WR', nflTeam: 'CIN' },
    { slot: 'BN', playerName: 'Rome Odunze', position: 'WR', nflTeam: 'CHI' },
    { slot: 'IR', playerName: 'Christian McCaffrey', position: 'RB', nflTeam: 'SF' },
  ],
}

const draft: YahooSnapshotDraft = {
  kind: 'draft',
  picks: [
    { round: 1, pick: null, teamName: 'Turf Toe', playerName: "Ja'Marr Chase", position: 'WR', nflTeam: 'CIN' },
    { round: 1, pick: null, teamName: 'Gridiron Ghosts', playerName: 'Bijan Robinson', position: 'RB', nflTeam: 'ATL' },
    { round: 1, pick: null, teamName: 'Nobody FC', playerName: 'Ghost Player', position: 'WR', nflTeam: 'NYJ' },
    { round: 2, pick: 9, teamName: 'Punt Club', playerName: 'Patrick Mahomes', position: 'QB', nflTeam: 'KC' },
  ],
}

function full(): YahooLeagueSnapshot {
  let s = emptyYahooSnapshot(LEAGUE)
  for (const page of [settings, standings, roster, draft] as const) s = mergeYahooSnapshotPage(s, page)
  return s
}

describe('league id and source id', () => {
  it.each([
    ['https://football.fantasysports.yahoo.com/f1/987654', '987654'],
    ['football.fantasysports.yahoo.com/f1/987654/3?week=2', '987654'],
    ['nfl.l.987654', '987654'],
    ['461.l.987654', '987654'],
    [' 987654 ', '987654'],
  ])('reads %s', (input, id) => {
    expect(parseYahooLeagueId(input)).toBe(id)
  })

  it.each([
    'https://basketball.fantasysports.yahoo.com/nba/12345',
    'https://evil.test/f1/987654',
    'not a league',
    '',
  ])('refuses %s rather than guessing', (input) => {
    expect(parseYahooLeagueId(input)).toBeNull()
  })

  it('round-trips the snapshot source id and rejects look-alikes', () => {
    expect(parseYahooSnapshotSourceId(yahooSnapshotSourceId(LEAGUE))).toBe(LEAGUE)
    expect(isYahooSnapshotSourceId('yahoo-snapshot:987654')).toBe(true)
    expect(isYahooSnapshotSourceId('nfl.l.987654')).toBe(false)
    expect(isYahooSnapshotSourceId('yahoo-snapshot:abc')).toBe(false)
    expect(isYahooSnapshotSourceId('yahoo-snapshot:1/../2')).toBe(false)
  })
})

describe('checklist and merge', () => {
  it('needs settings and standings, names what is missing, and links to each page', () => {
    const empty = yahooSnapshotChecklist(emptyYahooSnapshot(LEAGUE))
    expect(empty.ready).toBe(false)
    expect(empty.missing).toEqual(['League settings', 'Standings'])
    expect(empty.links.settings).toBe('https://football.fantasysports.yahoo.com/f1/987654/settings')
    expect(empty.links.draft).toBe('https://football.fantasysports.yahoo.com/f1/987654/draftresults')

    const c = yahooSnapshotChecklist(full())
    expect(c.ready).toBe(true)
    expect(c.leagueName).toBe('Sunday Funday')
    expect(c.teams.map((t) => t.name)).toEqual(['Turf Toe', 'Gridiron Ghosts', 'Fourth & Long', 'Punt Club'])
    expect(c.teams.map((t) => t.hasRoster)).toEqual([true, false, false, false])
  })

  it('re-pasting a page replaces it instead of piling up', () => {
    const once = mergeYahooSnapshotPage(emptyYahooSnapshot(LEAGUE), roster)
    const twice = mergeYahooSnapshotPage(once, { ...roster, players: roster.players.slice(0, 1) })
    expect(Object.keys(twice.rosters)).toHaveLength(1)
    expect(Object.values(twice.rosters)[0]!.players).toHaveLength(1)
  })

  it('reports a roster for a team the standings do not name', () => {
    const s = mergeYahooSnapshotPage(full(), { ...roster, teamName: 'Renamed Team' })
    expect(yahooSnapshotChecklist(s).unmatchedRosters).toEqual(['Renamed Team'])
  })
})

describe('buildYahooSnapshotPayload', () => {
  it('refuses to build without settings and standings', () => {
    expect(() => buildYahooSnapshotPayload(mergeYahooSnapshotPage(emptyYahooSnapshot(LEAGUE), standings))).toThrow(
      YahooSnapshotIncompleteError,
    )
  })

  it('keys the league so the Yahoo API can read it later, and orders teams by rank', () => {
    const p = buildYahooSnapshotPayload(full())
    expect(p.league.leagueKey).toBe('nfl.l.987654')
    expect(p.sourceInput).toBe('yahoo-snapshot:987654')
    expect(p.teams.map((t) => [t.teamKey, t.teamName])).toEqual([
      ['nfl.l.987654.t.1', 'Turf Toe'],
      ['nfl.l.987654.t.2', 'Gridiron Ghosts'],
      ['nfl.l.987654.t.3', 'Fourth & Long'],
      ['nfl.l.987654.t.4', 'Punt Club'],
    ])
  })

  it('splits a pasted roster into starters, bench and IR, and marks un-pasted rosters as placeholders', () => {
    const p = buildYahooSnapshotPayload(full())
    const turf = p.teams[0]!
    expect(turf.rosterFetchStatus).toBe('fetched')
    expect(turf.rosterPlayerIds).toHaveLength(4)
    expect(turf.starterPlayerIds.map((id) => turf.playerMap[id]!.name)).toEqual(['Patrick Mahomes', "Ja'Marr Chase"])
    expect(turf.reservePlayerIds.map((id) => turf.playerMap[id]!.name)).toEqual(['Christian McCaffrey'])
    // IMP-04: no pasted roster must never read as "this team has nobody".
    expect(p.teams.slice(1).every((t) => t.rosterFetchStatus === 'failed')).toBe(true)
    expect(p.failedRosterTeamKeys).toEqual(['nfl.l.987654.t.2', 'nfl.l.987654.t.3', 'nfl.l.987654.t.4'])
  })

  it('maps draft picks to teams by name, derives missing pick numbers, and drops picks for unknown teams', () => {
    const p = buildYahooSnapshotPayload(full())
    expect(p.draftPicks.map((d) => [d.round, d.pickNumber, d.teamKey, d.playerName])).toEqual([
      [1, 1, 'nfl.l.987654.t.1', "Ja'Marr Chase"],
      [1, 2, 'nfl.l.987654.t.2', 'Bijan Robinson'],
      [2, 9, 'nfl.l.987654.t.4', 'Patrick Mahomes'],
    ])
    expect(p.league.draftStatus).toBe('postdraft')
  })

  it('gives a drafted player the same id he has on a roster', () => {
    const p = buildYahooSnapshotPayload(full())
    const chaseOnRoster = p.teams[0]!.rosterPlayerIds.find((id) => p.teams[0]!.playerMap[id]!.name === "Ja'Marr Chase")
    expect(p.draftPicks[0]!.playerId).toBe(chaseOnRoster)
  })
})

describe('through the real YahooAdapter and scoring resolver', () => {
  it('normalizes as a PPR NFL league marked as pasted, with partial roster coverage', async () => {
    const n = await YahooAdapter.normalize(buildYahooSnapshotPayload(full()))
    expect(n.source.source_league_id).toBe('nfl.l.987654')
    expect(n.league.name).toBe('Sunday Funday')
    expect(n.league.sport).toBe('NFL')
    expect(n.league.leagueSize).toBe(4)
    expect(n.league.scoring).toBe('ppr')
    expect(isYahooSnapshotYahooSettings(n.league.yahoo_settings)).toBe(true)
    expect(n.coverage.currentRosters.state).toBe('partial')
    expect(n.scoring?.rules).toHaveLength(4)
  })

  it('resolves every pasted offensive rule back to a projection key, and keeps interceptions apart', async () => {
    const n = await YahooAdapter.normalize(buildYahooSnapshotPayload(full()))
    const ys = n.league.yahoo_settings as { stat_categories: { stats: Array<{ stat: Record<string, string | null> }> } }
    const byId = new Map(
      ys.stat_categories.stats.map(({ stat }) => [
        String(stat.stat_id),
        { name: stat.name, displayName: stat.display_name, positionType: stat.position_type },
      ]),
    )
    const resolved = n.scoring!.rules.map((r) => resolveProviderScoringStatKey(r.stat_key, { yahooStatCategoriesById: byId }))
    // Passing Yards, Receptions, offensive INT resolve; the DEFENSIVE interception stays unresolved
    // on purpose rather than being mistaken for a thrown one.
    expect(resolved).toEqual(['pass_yd', 'rec', 'pass_int', null])
  })
})

describe('parseYahooSnapshotReply', () => {
  it('accepts a fenced JSON reply that matches the schema', () => {
    const r = parseYahooSnapshotReply('```json\n' + JSON.stringify(standings) + '\n```')
    expect(r.status).toBe('ok')
  })

  it('treats "unknown" as an answer with a reason, not a failure', () => {
    const r = parseYahooSnapshotReply(JSON.stringify({ kind: 'unknown', reason: 'This is the matchup page.' }))
    expect(r).toEqual({ status: 'unrecognized', reason: 'This is the matchup page.' })
  })

  it('discards a reply whose table does not validate, rather than using part of it', () => {
    const bad = { ...settings, scoring: [{ group: 'offense', name: 'Passing Yards', points: '0.04' }] }
    expect(parseYahooSnapshotReply(JSON.stringify(bad)).status).toBe('invalid')
    expect(parseYahooSnapshotReply('Sure! Here is the data you asked for.').status).toBe('invalid')
    expect(parseYahooSnapshotReply(JSON.stringify({ kind: 'standings', teams: [] })).status).toBe('invalid')
  })
})

describe('summarizeSlots (review screen lineup)', () => {
  it('names each slot once, with a count, in first-seen order', async () => {
    const { summarizeSlots } = await import('@/components/core-app/import/YahooSnapshotImport')
    expect(summarizeSlots(['QB', 'RB', 'RB', 'WR', 'BN', 'BN', 'BN', 'IR'])).toBe('QB, 2 RB, WR, 3 BN, IR')
    expect(summarizeSlots([])).toBe('')
  })
})
