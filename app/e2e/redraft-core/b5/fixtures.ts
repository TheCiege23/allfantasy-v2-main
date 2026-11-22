/**
 * Fixture data for the B5 harness (/e2e/redraft-core/b5/[screen]) — Waivers, Player Finder, Draft HQ on
 * /core for an IMPORTED redraft league, which is the only kind /core renders league screens for
 * (`/core?league=<native id>` redirects to /league/[id]). Harness only: app/e2e is 404 in production.
 *
 * Every value here is a FIXTURE in the shape the real loaders return (lib/core-app/waivers.ts,
 * lib/core-app/draftHq.ts, lib/core-app/playerFinder.ts). Nothing is read from a database or a provider.
 * Where the real loader would withhold a section for an imported league, so does the fixture — Draft HQ
 * has no AllFantasy draft session for an imported league, and says so with the loader's own sentence.
 */
import type { WaiversData } from '@/lib/core-app/waivers'
import type { DraftHqData } from '@/lib/core-app/draftHq'
import type { PlayerDetail, PlayerMatch } from '@/lib/core-app/playerFinder'

export const HARNESS_SCREENS = ['waivers', 'players', 'draft-hq'] as const
export type HarnessScreen = (typeof HARNESS_SCREENS)[number]

export const HARNESS_SPORTS = ['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'] as const
export type HarnessSport = (typeof HARNESS_SPORTS)[number]

const missing = (reason: string) => ({ available: false as const, reason })

/** A few names and positions per sport, so a board or a match list reads like that sport's league. */
const SAMPLE: Record<HarnessSport, { team: string; players: Array<[string, string, string]> }> = {
  NFL: { team: 'BUF', players: [['Dalton Kincaid', 'TE', 'BUF'], ['Puka Nacua', 'WR', 'LAR'], ['Bijan Robinson', 'RB', 'ATL'], ['Jalen Hurts', 'QB', 'PHI'], ['Trey McBride', 'TE', 'ARI'], ['Garrett Wilson', 'WR', 'NYJ']] },
  NBA: { team: 'OKC', players: [['Shai Gilgeous-Alexander', 'G', 'OKC'], ['Nikola Jokic', 'C', 'DEN'], ['Jayson Tatum', 'F', 'BOS'], ['Tyrese Haliburton', 'G', 'IND'], ['Victor Wembanyama', 'C', 'SAS'], ['Paolo Banchero', 'F', 'ORL']] },
  NHL: { team: 'EDM', players: [['Connor McDavid', 'C', 'EDM'], ['Igor Shesterkin', 'G', 'NYR'], ['Cale Makar', 'D', 'COL'], ['Nikita Kucherov', 'RW', 'TBL'], ['Artemi Panarin', 'LW', 'NYR'], ['Quinn Hughes', 'D', 'VAN']] },
  MLB: { team: 'LAD', players: [['Will Smith', 'C', 'LAD'], ['Freddie Freeman', '1B', 'LAD'], ['Tarik Skubal', 'SP', 'DET'], ['Bobby Witt Jr.', 'SS', 'KC'], ['Emmanuel Clase', 'RP', 'CLE'], ['Juan Soto', 'OF', 'NYM']] },
  NCAAF: { team: 'TEX', players: [['Arch Manning', 'QB', 'TEX'], ['Jeremiah Smith', 'WR', 'OSU'], ['Ryan Williams', 'WR', 'ALA'], ['Nick Singleton', 'RB', 'PSU'], ['Kenyon Sadiq', 'TE', 'ORE'], ['Ahmad Hardy', 'RB', 'MIZ']] },
  NCAAB: { team: 'DUKE', players: [['Cameron Boozer', 'F', 'DUKE'], ['Braden Smith', 'G', 'PUR'], ['Thomas Haugh', 'F', 'FLA'], ['Darryn Peterson', 'G', 'KU'], ['Flory Bidunga', 'C', 'KU'], ['Labaron Philon', 'G', 'ALA']] },
  SOCCER: { team: 'LIV', players: [['Mohamed Salah', 'F', 'LIV'], ['Bukayo Saka', 'M', 'ARS'], ['William Saliba', 'D', 'ARS'], ['David Raya', 'GK', 'ARS'], ['Cole Palmer', 'M', 'CHE'], ['Erling Haaland', 'F', 'MCI']] },
}

const LEAGUE = { id: 'e2e-redraft-core', name: 'Sunday Night Redraft' }

export function waiversFixture(sport: HarnessSport, platform: string): WaiversData {
  return {
    league: { id: LEAGUE.id, name: LEAGUE.name, platform, format: `12-team ${sport} redraft`, platformLeagueId: '1180000000000000000' },
    budget: { available: true, data: { faabRemaining: 63, rankByBudget: 4, rostersWithBudget: 12 } },
    waiverPriority: { available: true, data: { priority: 7, leagueRosters: 12 } },
    rosterLoad: { available: true, data: { playersHeld: 15, starters: 9, bench: 5, reserve: 1 } },
    claimsQueued: { available: true, data: { count: 2 } },
    waiverType: { available: true, data: { kind: 'faab', label: 'FAAB blind bidding', budget: 100 } },
    processTime: {
      available: true,
      data: {
        schedule: { dayOfWeek: 3, time: '03:00', timeZone: 'America/Los_Angeles' },
        dayLabel: 'Wednesday',
        timeLabel: '03:00 Pacific',
        observedRuns: 6,
      },
    },
    tiebreak: { available: true, data: 'Rolling waiver priority' },
    claimLimits: missing('this league’s claim limits are not imported from Sleeper'),
  } as WaiversData
}

export function draftHqFixture(sport: HarnessSport, platform: string): DraftHqData {
  const sample = SAMPLE[sport].players
  const teams = [
    { teamKey: 't1', name: 'Ciege Squad', isYou: true },
    { teamKey: 't2', name: 'Hardwood Heroes', isYou: false },
    { teamKey: 't3', name: 'Bench Mob', isYou: false },
    { teamKey: 't4', name: 'Waiver Wire Wizards', isYou: false },
  ]
  const rounds = [1, 2, 3].map((round) => ({
    round,
    picks: teams.map((t, i) => {
      const seat = round % 2 === 1 ? i : teams.length - 1 - i
      const overall = (round - 1) * teams.length + i + 1
      const [playerName, position] = sample[(overall - 1) % sample.length]!
      return {
        round,
        overall,
        label: `${round}.${String(i + 1).padStart(2, '0')}`,
        teamKey: teams[seat]!.teamKey,
        teamName: teams[seat]!.name,
        isYou: teams[seat]!.isYou,
        playerName,
        position,
      }
    }),
  }))
  const mine = rounds.flatMap((r) => r.picks).filter((p) => p.isYou)
  const reason = 'no upcoming draft is scheduled in AllFantasy — the picks below are from the draft this league already ran'
  return {
    league: { id: LEAGUE.id, name: LEAGUE.name, platform, format: 'redraft' },
    session: missing(reason),
    pickSlots: missing(reason),
    madePicks: {
      available: true,
      data: mine.map((p) => ({ overall: p.overall, round: p.round, label: p.label, playerName: p.playerName, position: p.position, team: SAMPLE[sport].team, imageUrl: null })),
    },
    board: { available: true, data: { season: 2026, rounds, teams: teams.map((t) => ({ ...t, picks: 3 })), totalPicks: 12 } },
    grades: {
      available: true,
      data: {
        season: '2026',
        partial: false,
        gradedPicks: 12,
        totalPicks: 12,
        scale: 'A+ to F, from each pick’s value against where it was taken',
        scoringNote: null,
        teams: [
          { ownerId: 'o1', name: 'ciege', teamName: 'Ciege Squad', picks: 3, initialGrade: 'B', currentGrade: 'A', trend: 'improved' },
          { ownerId: 'o2', name: 'dre', teamName: 'Hardwood Heroes', picks: 3, initialGrade: 'B', currentGrade: 'B', trend: 'steady' },
          { ownerId: 'o3', name: 'kim', teamName: 'Bench Mob', picks: 3, initialGrade: 'B', currentGrade: 'C', trend: 'declined' },
          { ownerId: 'o4', name: 'tash', teamName: 'Waiver Wire Wizards', picks: 3, initialGrade: 'C', currentGrade: 'B', trend: 'improved' },
        ],
      },
    },
    lottery: missing('this league does not run a draft lottery'),
    queue: missing(reason),
    keepers: missing('this league keeps no players'),
  } as unknown as DraftHqData
}

export function playerFinderFixture(sport: HarnessSport, platform: string): { query: string; matches: PlayerMatch[]; detail: PlayerDetail } {
  const sample = SAMPLE[sport].players
  const matches = sample.slice(0, 4).map(([name, position, team], i) => ({
    externalId: `e2e-${sport}-${i}`,
    sleeperId: null,
    name,
    position,
    team,
    imageUrl: null,
    number: null,
    rosteredIn: i === 0 ? 1 : null,
    platforms: i === 0 ? [platform] : [],
    sport,
    source: null,
  })) as unknown as PlayerMatch[]
  const lead = matches[0]!
  const detail = {
    player: lead,
    identityResolved: true,
    bio: { height: null, weight: null, age: 26, college: null },
    injury: { available: true, data: { status: 'Active', description: null, reportedAt: null } },
    seasonStats: missing('no season stats in this fixture'),
    leagues: {
      available: true,
      data: [
        { leagueId: LEAGUE.id, leagueName: LEAGUE.name, platform, format: 'Redraft', platformLeagueId: '1180000000000000000', season: 2026, slot: 'STARTER', isYours: true, owner: null },
      ],
    },
    projection: missing('no projection in this fixture'),
    game: missing('no game in this fixture'),
    kickoffs: {},
    scheduleWeek: null,
    kickoffsUnresolved: 0,
    snapShare: missing('no snap share in this fixture'),
    positionRank: { available: true, data: { rank: 6, outOf: 118, position: lead.position } },
    impact: missing('no lineup impact in this fixture'),
    recommendedMoves: { available: true, data: [] },
    freshness: { label: '12m ago', stale: false },
    rosterCoverage: { unmatched: [] },
  } as unknown as PlayerDetail
  return { query: sample[0]![0].split(' ')[0]!, matches, detail }
}
