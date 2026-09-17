import { describe, expect, it } from 'vitest'
import {
  readStoredTitleGame,
  storedBracketGames,
  storedHistoricalRosterId,
} from '@/lib/league-import/sleeper/bracketPlacements'
import { FINALS_NOTE_NO_BRACKET, summarizeFinals } from '@/lib/core-app/careerFinals'
import { buildFinalsIndex, finalResultFor, type DynastyTitleRow } from '@/lib/core-app/careerFinalsResolve'
import { buildCareerData, type CareerRow, type CareerSource } from '@/lib/core-app/careerModel'
import { row } from './careerFixtures'

/*
 * A 6-team bracket as the sync stored it BEFORE bracketPlacementVersion 2: flattened, no
 * `placement`, and the fifth- and third-place games listed ahead of the title game in the
 * same last round. Roster 1 beat roster 2 for the title.
 */
const OLD_SIX = {
  winnersBracket: [
    { round: 1, matchup: 1, team1: 3, team2: 6, winner: 3, loser: 6 },
    { round: 1, matchup: 2, team1: 4, team2: 5, winner: 5, loser: 4 },
    { round: 2, matchup: 3, team1: 1, team2: 5, winner: 1, loser: 5 },
    { round: 2, matchup: 4, team1: 2, team2: 3, winner: 2, loser: 3 },
    { round: 2, matchup: 5, team1: 6, team2: 4, winner: 4, loser: 6 },
    { round: 3, matchup: 7, team1: 3, team2: 5, winner: 5, loser: 3 },
    { round: 3, matchup: 6, team1: 1, team2: 2, winner: 1, loser: 2 },
  ],
  canonicalRosterIdByHistoricalRosterId: { '1': '1', '2': '7', '3': '3', '4': '4', '5': '5', '6': '6' },
}

const V2 = {
  bracketPlacementVersion: 2,
  championRosterId: 4,
  runnerUpRosterId: 9,
  // A stored bracket that disagrees, to prove a version-2 row is read as stored.
  winnersBracket: OLD_SIX.winnersBracket,
  canonicalRosterIdByHistoricalRosterId: { '4': '4', '9': '2' },
}

describe('readStoredTitleGame', () => {
  it('resolves an old flattened bracket with placement games in the final round', () => {
    expect(readStoredTitleGame(OLD_SIX)).toEqual({ championRosterId: 1, runnerUpRosterId: 2, source: 'inferred' })
  })

  it('reads a version-2 row as stored', () => {
    expect(readStoredTitleGame(V2)).toEqual({ championRosterId: 4, runnerUpRosterId: 9, source: 'stored' })
  })

  it('uses the stored placement when a bracket kept it', () => {
    const withP = {
      winnersBracket: [
        { round: 1, matchup: 1, team1: 1, team2: 4, winner: 1, loser: 4 },
        { round: 1, matchup: 2, team1: 2, team2: 3, winner: 2, loser: 3 },
        { round: 2, matchup: 4, team1: 3, team2: 4, winner: 4, loser: 3, placement: 3, team1From: { l: 2 }, team2From: { l: 1 } },
        { round: 2, matchup: 3, team1: 1, team2: 2, winner: 2, loser: 1, placement: 1, team1From: { w: 1 }, team2From: { w: 2 } },
      ],
    }
    expect(readStoredTitleGame(withP)).toEqual({ championRosterId: 2, runnerUpRosterId: 1, source: 'placement' })
  })

  it('returns null when nothing names a decided final', () => {
    const undecided = {
      winnersBracket: OLD_SIX.winnersBracket.map((g) => (g.round === 3 ? { ...g, winner: null, loser: null } : g)),
    }
    expect(readStoredTitleGame(undecided)).toBeNull()
    expect(readStoredTitleGame({ bracketPlacementVersion: 2, championRosterId: null })).toBeNull()
    expect(readStoredTitleGame({ winnersBracket: [] })).toBeNull()
    expect(readStoredTitleGame(null)).toBeNull()
    expect(readStoredTitleGame('nope')).toBeNull()
    expect(readStoredTitleGame({ winnersBracket: 'nope' })).toBeNull()
  })

  it('refuses a last round it cannot tell apart', () => {
    // Two last-round games whose teams never lost before: no title game is guessed.
    const ambiguous = {
      winnersBracket: [
        { round: 1, matchup: 1, team1: 1, team2: 2, winner: 1, loser: 2 },
        { round: 2, matchup: 2, team1: 1, team2: 3, winner: 1, loser: 3 },
        { round: 2, matchup: 3, team1: 4, team2: 5, winner: 4, loser: 5 },
      ],
    }
    expect(readStoredTitleGame(ambiguous)).toBeNull()
  })

  it('maps the stored field names back to Sleeper names', () => {
    expect(storedBracketGames({ winnersBracket: [{ round: 2, matchup: 3, team1: 1, team2: 2, winner: 1, loser: 2, placement: 1, team1From: { w: 1 } }] })).toEqual([
      { r: 2, m: 3, t1: 1, t2: 2, w: 1, l: 2, p: 1, t1_from: { w: 1, l: null }, t2_from: null },
    ])
  })
})

describe('storedHistoricalRosterId', () => {
  it('traces a current team id back to that season', () => {
    expect(storedHistoricalRosterId(OLD_SIX, '7')).toBe(2)
    expect(storedHistoricalRosterId(OLD_SIX, '3')).toBe(3)
  })

  it('refuses an id two historical rosters share, and an unknown one', () => {
    const shared = { canonicalRosterIdByHistoricalRosterId: { '2': '5', '5': '5' } }
    expect(storedHistoricalRosterId(shared, '5')).toBeNull()
    expect(storedHistoricalRosterId(OLD_SIX, '99')).toBeNull()
    expect(storedHistoricalRosterId(OLD_SIX, null)).toBeNull()
    expect(storedHistoricalRosterId({}, '1')).toBeNull()
  })
})

describe('finalResultFor', () => {
  const dyn: DynastyTitleRow[] = [
    { leagueId: 'L1', season: 2023, platformLeagueId: 'S23', playoffStructure: OLD_SIX },
    { leagueId: 'L1', season: 2024, platformLeagueId: 'S24', playoffStructure: V2 },
  ]

  const legacyRow = { platform: 'sleeper', season: 2023, refId: 'legacy-1', providerLeagueId: 'S23' }

  it('reads a legacy season by its Sleeper league id and legacy roster', () => {
    const lost = buildFinalsIndex(dyn, {
      legacyRosterBySleeperLeague: new Map([['S23', 2]]),
      claimedTeamByLeagueId: new Map(),
    })
    expect(finalResultFor(legacyRow, lost)).toBe('lost')

    const won = buildFinalsIndex(dyn, { legacyRosterBySleeperLeague: new Map([['S23', 1]]), claimedTeamByLeagueId: new Map() })
    expect(finalResultFor(legacyRow, won)).toBe('won')

    const out = buildFinalsIndex(dyn, { legacyRosterBySleeperLeague: new Map([['S23', 5]]), claimedTeamByLeagueId: new Map() })
    expect(finalResultFor(legacyRow, out)).toBe('out')
  })

  it('reads imported season history by League.id + season through the claimed team', () => {
    // Claimed team 7 today was roster 2 in 2023 (lost the final) and roster 9 in 2024 (lost again).
    const index = buildFinalsIndex(dyn, { legacyRosterBySleeperLeague: new Map(), claimedTeamByLeagueId: new Map([['L1', '7']]) })
    expect(finalResultFor({ platform: 'sleeper', season: 2023, refId: 'L1', providerLeagueId: 'S-current' }, index)).toBe('lost')
    const claimed2 = buildFinalsIndex(dyn, { legacyRosterBySleeperLeague: new Map(), claimedTeamByLeagueId: new Map([['L1', '2']]) })
    expect(finalResultFor({ platform: 'sleeper', season: 2024, refId: 'L1', providerLeagueId: 'S-current' }, claimed2)).toBe('lost')
    const claimed4 = buildFinalsIndex(dyn, { legacyRosterBySleeperLeague: new Map(), claimedTeamByLeagueId: new Map([['L1', '4']]) })
    expect(finalResultFor({ platform: 'sleeper', season: 2024, refId: 'L1', providerLeagueId: null }, claimed4)).toBe('won')
  })

  it('never matches another season, another platform, or a team it cannot place', () => {
    const index = buildFinalsIndex(dyn, { legacyRosterBySleeperLeague: new Map([['S23', 2]]), claimedTeamByLeagueId: new Map() })
    expect(finalResultFor({ ...legacyRow, season: 2022 }, index)).toBeNull()
    expect(finalResultFor({ ...legacyRow, platform: 'espn' }, index)).toBeNull()
    expect(finalResultFor({ platform: 'sleeper', season: 2024, refId: 'L1', providerLeagueId: 'S24' }, index)).toBeNull()
    expect(finalResultFor({ ...legacyRow, providerLeagueId: 'unknown' }, index)).toBeNull()
  })

  it('answers null when two stored rows for one season disagree, and agrees when they agree', () => {
    const twin = (ps: unknown): DynastyTitleRow => ({ leagueId: 'L2', season: 2023, platformLeagueId: 'S23', playoffStructure: ps })
    const ownership = { legacyRosterBySleeperLeague: new Map([['S23', 2]]), claimedTeamByLeagueId: new Map<string, string>() }
    expect(finalResultFor(legacyRow, buildFinalsIndex([...dyn, twin(OLD_SIX)], ownership))).toBe('lost')
    const other = { bracketPlacementVersion: 2, championRosterId: 2, runnerUpRosterId: 1 }
    expect(finalResultFor(legacyRow, buildFinalsIndex([...dyn, twin(other)], ownership))).toBeNull()
  })
})

describe('summarizeFinals', () => {
  it('is titles plus finals lost, and counts only finished seasons', () => {
    const s = summarizeFinals([
      { counted: true, isChampion: true, finalResult: 'won' },
      { counted: true, isChampion: true },
      { counted: true, isChampion: false, finalResult: 'lost' },
      { counted: true, isChampion: false, finalResult: 'out' },
      { counted: true, isChampion: false, finalResult: null },
      { counted: false, isChampion: false, finalResult: 'lost' },
    ])
    expect(s).toMatchObject({ finals: 3, won: 2, lost: 1, known: 4, withBracket: 3, total: 5, uncountedTitleWins: 0 })
    expect(s.note).toMatch(/1 of 5 finished league-seasons have no bracket/)
  })

  it('reports a bracket title the row does not record, without counting it', () => {
    const s = summarizeFinals([
      { counted: true, isChampion: false, finalResult: 'won' },
      { counted: true, isChampion: false, finalResult: 'out' },
    ])
    expect(s).toMatchObject({ finals: 0, won: 0, lost: 0, known: 1, uncountedTitleWins: 1 })
    expect(s.note).toMatch(/every finished league-season could be checked/)
  })

  it('is null, not zero, when no finished season has a bracket', () => {
    const s = summarizeFinals([
      { counted: true, isChampion: true },
      { counted: true, isChampion: false },
      { counted: false, isChampion: false, finalResult: 'lost' },
    ])
    expect(s.finals).toBeNull()
    expect(s.won).toBe(1)
    expect(s.note).toBe(FINALS_NOTE_NO_BRACKET)
  })
})

describe('buildCareerData — finals', () => {
  const source = (rows: CareerRow[]): CareerSource => ({
    identity: { handle: 'guap', avatarUrl: null, xpTotal: null },
    rows,
    platforms: [...new Set(rows.map((r) => r.platform))],
    rosterless: 0,
  })

  it('shows titles and lost finals, and follows the filter', () => {
    const rows = [
      row({ season: 2021, isChampion: true, madePlayoffs: true, finalResult: 'won' }),
      row({ season: 2022, finalResult: 'lost', madePlayoffs: true }),
      row({ season: 2023, finalResult: 'out' }),
      row({ season: 2023, leagueName: 'Espn Pals', platform: 'espn', source: 'import' }),
    ]
    const all = buildCareerData(source(rows)).accomplishments
    expect(all).toMatchObject({ championships: 1, finals: 2, finalsLost: 1, finalsKnown: 3, finalsUncountedTitles: 0 })
    expect(all.finalsNote).toMatch(/1 of 4 finished/)

    const espn = buildCareerData(source(rows), {
      platform: 'espn',
      sport: null,
      league: null,
      fromSeason: null,
      toSeason: null,
    }).accomplishments
    expect(espn.finals).toBeNull()
  })
})
