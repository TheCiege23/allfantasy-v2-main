/**
 * The historical matchup sync skips a COMPLETED season only when its stored row is settled.
 *
 * 🛑 THE BUG THIS PINS. The four-hourly refresh re-runs the season being played, so a season is
 * first stored mid-season with an undecided winners bracket. The old gate skipped any completed
 * season that already had matchup facts, so once Sleeper flipped the league to `complete` the title
 * game was never written. Every later run skipped it.
 *
 * ⚠ AND THE OPPOSITE FAILURE IS PINNED TOO. Elimination formats never get a winners bracket, so a
 * gate on "decided title game" alone would re-fetch those seasons on every run, forever. A row
 * written while Sleeper already said `complete` is settled whatever its bracket holds.
 *
 * The draft and season-state siblings' gates are pinned in `sleeper-historical-completion-gates.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({
  league: { findUnique: vi.fn() },
  roster: { findMany: vi.fn() },
  leagueTeam: { findMany: vi.fn() },
  matchupFact: { findFirst: vi.fn(), deleteMany: vi.fn(), createMany: vi.fn() },
  leagueDynastySeason: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}))
const sleeper = vi.hoisted(() => ({
  getLeagueRosters: vi.fn(),
  getPlayoffBracket: vi.fn(),
  getLosersBracket: vi.fn(),
  getLeagueMatchups: vi.fn(),
}))
const chain = vi.hoisted(() => ({ getSleeperHistoricalLeagueChain: vi.fn() }))
const persist = vi.hoisted(() => ({ persistDynastySeason: vi.fn() }))

vi.mock('@/lib/prisma', () => ({ prisma: db }))
vi.mock('@/lib/sleeper-client', () => sleeper)
vi.mock('@/lib/league-import/sleeper/SleeperHistoricalLeagueChain', () => chain)
vi.mock('@/lib/dynasty-import/normalize-historical', () => persist)

const { syncSleeperHistoricalMatchupsAfterImport, isStoredSeasonSettled, storedTeamIdentityCurrent } = await import(
  '@/lib/league-import/sleeper/SleeperHistoricalMatchupSyncService'
)

/* A 4-team bracket as the sync stores it: roster 1 beat roster 2 for the title. */
const DECIDED_BRACKET = [
  { round: 1, matchup: 1, team1: 1, team2: 4, winner: 1, loser: 4 },
  { round: 1, matchup: 2, team1: 2, team2: 3, winner: 2, loser: 3 },
  { round: 2, matchup: 3, team1: 1, team2: 2, winner: 1, loser: 2, placement: 1 },
  { round: 2, matchup: 4, team1: 3, team2: 4, winner: 4, loser: 3, placement: 3 },
]
/* The same bracket stored mid-season: nothing decided yet. */
const UNDECIDED_BRACKET = DECIDED_BRACKET.map((g) => ({ ...g, winner: null, loser: null }))

/* What Sleeper returns once the season is over. */
const LIVE_BRACKET = [
  { r: 1, m: 1, t1: 1, t2: 4, w: 1, l: 4 },
  { r: 1, m: 2, t1: 2, t2: 3, w: 2, l: 3 },
  { r: 2, m: 3, t1: 1, t2: 2, w: 1, l: 2, p: 1, t1_from: { w: 1 }, t2_from: { w: 2 } },
  { r: 2, m: 4, t1: 3, t2: 4, w: 4, l: 3, p: 3, t1_from: { l: 1 }, t2_from: { l: 2 } },
]

function season(status: string) {
  return { externalLeagueId: 'S25', season: 2025, league: { league_id: 'S25', status, settings: { playoff_teams: 4 } } }
}

function stub(opts: { status: string; hasFacts: boolean; metadata: unknown }) {
  db.league.findUnique.mockResolvedValue({ id: 'L1', platform: 'sleeper', platformLeagueId: 'S26', sport: 'NFL' })
  // Today's league: u1–u4 hold slots 1–4, recorded the way the import records them.
  db.roster.findMany.mockResolvedValue(
    [1, 2, 3, 4].map((n) => ({ platformUserId: `u${n}`, playerData: { source_team_id: String(n), source_manager_id: `u${n}` } })),
  )
  db.leagueTeam.findMany.mockResolvedValue([])
  db.matchupFact.findFirst.mockResolvedValue(opts.hasFacts ? { matchupId: 'mf1' } : null)
  db.matchupFact.deleteMany.mockReturnValue({})
  db.matchupFact.createMany.mockReturnValue({})
  db.$transaction.mockResolvedValue([])
  db.leagueDynastySeason.findUnique.mockResolvedValue(opts.metadata === undefined ? null : { metadata: opts.metadata })
  chain.getSleeperHistoricalLeagueChain.mockResolvedValue([season(opts.status)])
  sleeper.getLeagueRosters.mockResolvedValue([
    { roster_id: 1, owner_id: 'u1' },
    { roster_id: 2, owner_id: 'u2' },
    { roster_id: 3, owner_id: 'u3' },
    { roster_id: 4, owner_id: 'u4' },
  ])
  sleeper.getPlayoffBracket.mockResolvedValue(LIVE_BRACKET)
  sleeper.getLosersBracket.mockResolvedValue([])
  sleeper.getLeagueMatchups.mockResolvedValue([])
  persist.persistDynastySeason.mockResolvedValue(undefined)
}

/** The metadata the sync wrote on this run. */
function written(): Record<string, any> {
  expect(persist.persistDynastySeason).toHaveBeenCalledTimes(1)
  return persist.persistDynastySeason.mock.calls[0][4]
}

beforeEach(() => {
  for (const group of [db.league, db.roster, db.leagueTeam, db.matchupFact, db.leagueDynastySeason, sleeper, chain, persist]) {
    for (const fn of Object.values(group)) (fn as ReturnType<typeof vi.fn>).mockReset()
  }
  db.$transaction.mockReset()
})

describe('completed seasons', () => {
  it('🛑 refreshes a completed season whose stored bracket is still undecided — the bug, pinned', async () => {
    stub({
      status: 'complete',
      hasFacts: true,
      metadata: { seasonStatusAtSync: 'in_season', playoffStructure: { winnersBracket: UNDECIDED_BRACKET } },
    })
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })

    expect(sleeper.getPlayoffBracket).toHaveBeenCalledWith('S25')
    expect(summary).toMatchObject({ seasonsProcessed: 1, seasonsSkippedComplete: 0, completedSeasonsRefreshed: 1 })
    const meta = written()
    expect(meta.seasonStatusAtSync).toBe('complete')
    expect(meta.playoffStructure).toMatchObject({ championRosterId: 1, runnerUpRosterId: 2, bracketPlacementVersion: 2 })
  })

  it('refreshes an old row that carries no status marker and no decided final', async () => {
    stub({ status: 'complete', hasFacts: true, metadata: { playoffStructure: { winnersBracket: UNDECIDED_BRACKET } } })
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(summary.completedSeasonsRefreshed).toBe(1)
    expect(sleeper.getPlayoffBracket).toHaveBeenCalledTimes(1)
  })

  it('skips a completed season whose stored bracket already names the champion', async () => {
    // An old flattened row with no marker: settled by its bracket alone.
    stub({ status: 'complete', hasFacts: true, metadata: { teamIdentityVersion: 2, playoffStructure: { winnersBracket: DECIDED_BRACKET } } })
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })

    expect(summary).toMatchObject({ seasonsProcessed: 0, seasonsSkippedComplete: 1, completedSeasonsRefreshed: 0 })
    for (const fetcher of Object.values(sleeper)) expect(fetcher).not.toHaveBeenCalled()
    expect(persist.persistDynastySeason).not.toHaveBeenCalled()
  })

  it('skips a version-2 row with a stored champion, even if its bracket copy says otherwise', async () => {
    stub({
      status: 'complete',
      hasFacts: true,
      metadata: {
        teamIdentityVersion: 2,
        playoffStructure: { bracketPlacementVersion: 2, championRosterId: 3, runnerUpRosterId: 1, winnersBracket: [] },
      },
    })
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(summary.seasonsSkippedComplete).toBe(1)
    expect(sleeper.getPlayoffBracket).not.toHaveBeenCalled()
  })

  it('⚠ refreshes a bracket-less completed season ONCE, then leaves it alone', async () => {
    // A Guillotine-style league: Sleeper has no winners bracket for it, ever.
    stub({ status: 'complete', hasFacts: true, metadata: { playoffStructure: { winnersBracket: [] } } })
    sleeper.getPlayoffBracket.mockResolvedValue([])

    const first = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(first.completedSeasonsRefreshed).toBe(1)
    const meta = written()
    expect(meta.seasonStatusAtSync).toBe('complete')
    expect(meta.playoffStructure.championRosterId).toBeNull()

    // The next run reads back what the first one wrote.
    db.leagueDynastySeason.findUnique.mockResolvedValue({ metadata: meta })
    sleeper.getPlayoffBracket.mockClear()
    persist.persistDynastySeason.mockClear()
    const second = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(second).toMatchObject({ seasonsProcessed: 0, seasonsSkippedComplete: 1, completedSeasonsRefreshed: 0 })
    expect(sleeper.getPlayoffBracket).not.toHaveBeenCalled()
  })

  it('refreshes a completed season whose matchups were never stored, whatever its row says', async () => {
    stub({ status: 'complete', hasFacts: false, metadata: { seasonStatusAtSync: 'complete', playoffStructure: {} } })
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(summary).toMatchObject({ seasonsProcessed: 1, seasonsSkippedComplete: 0, completedSeasonsRefreshed: 0 })
  })

  it('refreshes a completed season with matchups but no stored row', async () => {
    stub({ status: 'complete', hasFacts: true, metadata: undefined })
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(summary).toMatchObject({ seasonsProcessed: 1, completedSeasonsRefreshed: 1 })
    // The stored row is read once for the gate and reused, not read again.
    expect(db.leagueDynastySeason.findUnique).toHaveBeenCalledTimes(1)
  })
})

describe('the season being played', () => {
  it('is always refreshed, and records that it was not over', async () => {
    stub({
      status: 'in_season',
      hasFacts: true,
      metadata: { seasonStatusAtSync: 'complete', playoffStructure: { winnersBracket: DECIDED_BRACKET } },
    })
    sleeper.getPlayoffBracket.mockResolvedValue(UNDECIDED_BRACKET)
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(summary).toMatchObject({ seasonsProcessed: 1, seasonsSkippedComplete: 0, completedSeasonsRefreshed: 0 })
    expect(written().seasonStatusAtSync).toBe('in_season')
    // The completion gate never ran, so the matchup facts were not even checked.
    expect(db.matchupFact.findFirst).not.toHaveBeenCalled()
  })
})

describe('which team a past roster was (teamIdentityVersion 2)', () => {
  /* 2024: u1–u3 as today, but roster 4 was u-gone, who left; u4 took that slot for 2025. */
  const ROSTERS_2024 = [
    { roster_id: 1, owner_id: 'u1' },
    { roster_id: 2, owner_id: 'u2' },
    { roster_id: 3, owner_id: 'u3' },
    { roster_id: 4, owner_id: 'u-gone' },
  ]
  const WEEK_1 = [
    { roster_id: 1, matchup_id: 1, points: 100 },
    { roster_id: 4, matchup_id: 1, points: 120 },
    { roster_id: 2, matchup_id: 2, points: 90 },
    { roster_id: 3, matchup_id: 2, points: 80 },
  ]
  function seasonFacts() {
    return db.matchupFact.createMany.mock.calls[0][0].data as Array<{ teamA: string; teamB: string; winnerTeamId: string | null }>
  }

  it("🛑 stores a departed manager's games under their own key, not their old slot's new owner", async () => {
    stub({ status: 'complete', hasFacts: false, metadata: undefined })
    sleeper.getLeagueRosters.mockResolvedValue(ROSTERS_2024)
    sleeper.getLeagueMatchups.mockImplementation(async (_id: string, week: number) => (week === 1 ? WEEK_1 : []))
    await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })

    const facts = seasonFacts()
    expect(facts[0]).toMatchObject({ teamA: '1', teamB: 'former:sleeper:u-gone', winnerTeamId: 'former:sleeper:u-gone' })
    expect(facts.flatMap((f) => [f.teamA, f.teamB])).not.toContain('4')
    const meta = written()
    expect(meta.teamIdentityVersion).toBe(2)
    expect(meta.playoffStructure.canonicalRosterIdByHistoricalRosterId).toEqual({ '1': '1', '2': '2', '3': '3', '4': 'former:sleeper:u-gone' })
  })

  it('maps through source_manager_id, so a claimed team keyed on its AllFantasy id still resolves', async () => {
    stub({ status: 'complete', hasFacts: false, metadata: undefined })
    // u2 claimed their team: the roster row is keyed on the AF id, and u2 moved to slot 3 this year.
    db.roster.findMany.mockResolvedValue([
      { platformUserId: 'af-user-2', playerData: { source_team_id: '3', source_manager_id: 'u2' } },
      { platformUserId: 'u1', playerData: { source_team_id: '1', source_manager_id: 'u1' } },
    ])
    sleeper.getLeagueRosters.mockResolvedValue([{ roster_id: 2, owner_id: 'u2' }, { roster_id: 1, owner_id: 'u1' }])
    sleeper.getLeagueMatchups.mockImplementation(async (_id: string, week: number) =>
      week === 1 ? [{ roster_id: 1, matchup_id: 1, points: 80 }, { roster_id: 2, matchup_id: 1, points: 99 }] : [],
    )
    await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(seasonFacts()[0]).toMatchObject({ teamA: '1', teamB: '3', winnerTeamId: '3' })
  })

  it('keeps an ownerless roster of the CURRENT season as its own slot — it is a live team', async () => {
    stub({ status: 'in_season', hasFacts: false, metadata: undefined })
    chain.getSleeperHistoricalLeagueChain.mockResolvedValue([
      { externalLeagueId: 'S26', season: 2026, league: { league_id: 'S26', status: 'in_season', settings: {} } },
    ])
    sleeper.getLeagueRosters.mockResolvedValue([{ roster_id: 1, owner_id: 'u1' }, { roster_id: 7, owner_id: null }])
    await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(written().playoffStructure.canonicalRosterIdByHistoricalRosterId).toEqual({ '1': '1', '7': '7' })
  })

  it('re-checks a settled season written under the old mapping, and rewrites it when a game moved', async () => {
    stub({
      status: 'complete',
      hasFacts: true,
      metadata: {
        seasonStatusAtSync: 'complete',
        playoffStructure: { canonicalRosterIdByHistoricalRosterId: { '1': '1', '2': '2', '3': '3', '4': '4' } },
      },
    })
    sleeper.getLeagueRosters.mockResolvedValue(ROSTERS_2024)
    sleeper.getLeagueMatchups.mockImplementation(async (_id: string, week: number) => (week === 1 ? WEEK_1 : []))
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })

    expect(summary).toMatchObject({ seasonsIdentityChecked: 1, seasonsRemapped: 1, seasonsProcessed: 1, seasonsSkippedComplete: 0 })
    expect(db.matchupFact.deleteMany).toHaveBeenCalled()
    expect(seasonFacts()[0].teamB).toBe('former:sleeper:u-gone')
    expect(written().teamIdentityVersion).toBe(2)
  })

  it('only stamps the version when the old mapping was already right — one rosters call, no rewrite', async () => {
    stub({
      status: 'complete',
      hasFacts: true,
      metadata: {
        seasonStatusAtSync: 'complete',
        keep: 'me',
        playoffStructure: { canonicalRosterIdByHistoricalRosterId: { '1': '1', '2': '2', '3': '3', '4': '4' } },
      },
    })
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })

    expect(summary).toMatchObject({ seasonsIdentityChecked: 1, seasonsRemapped: 0, seasonsProcessed: 0, seasonsSkippedComplete: 1 })
    expect(sleeper.getLeagueRosters).toHaveBeenCalledTimes(1)
    expect(sleeper.getLeagueMatchups).not.toHaveBeenCalled()
    expect(sleeper.getPlayoffBracket).not.toHaveBeenCalled()
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(written()).toMatchObject({ teamIdentityVersion: 2, keep: 'me', seasonStatusAtSync: 'complete' })
  })

  it('⚠ writes nothing for a season whose rosters could not be read', async () => {
    stub({ status: 'complete', hasFacts: false, metadata: undefined })
    sleeper.getLeagueRosters.mockResolvedValue([])
    sleeper.getLeagueMatchups.mockImplementation(async (_id: string, week: number) => (week === 1 ? WEEK_1 : []))
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(summary).toMatchObject({ seasonsProcessed: 0, seasonsSkippedNoRosters: 1 })
    expect(db.$transaction).not.toHaveBeenCalled()
    expect(persist.persistDynastySeason).not.toHaveBeenCalled()
  })

  it('⚠ does not map at all when no current manager is on file', async () => {
    stub({ status: 'complete', hasFacts: false, metadata: undefined })
    db.roster.findMany.mockResolvedValue([])
    const summary = await syncSleeperHistoricalMatchupsAfterImport({ leagueId: 'L1' })
    expect(summary).toMatchObject({ skipped: true, attempted: false })
    expect(chain.getSleeperHistoricalLeagueChain).not.toHaveBeenCalled()
  })

  it('reads the version stamp', () => {
    expect(storedTeamIdentityCurrent({ teamIdentityVersion: 2 })).toBe(true)
    expect(storedTeamIdentityCurrent({ teamIdentityVersion: 1 })).toBe(false)
    expect(storedTeamIdentityCurrent({})).toBe(false)
    expect(storedTeamIdentityCurrent(null)).toBe(false)
  })
})

describe('isStoredSeasonSettled', () => {
  it('needs a decided title game or a write made after completion', () => {
    expect(isStoredSeasonSettled({ playoffStructure: { winnersBracket: DECIDED_BRACKET } })).toBe(true)
    expect(isStoredSeasonSettled({ seasonStatusAtSync: 'complete' })).toBe(true)
    expect(isStoredSeasonSettled({ seasonStatusAtSync: 'in_season', playoffStructure: { winnersBracket: UNDECIDED_BRACKET } })).toBe(false)
    expect(isStoredSeasonSettled({ playoffStructure: { bracketPlacementVersion: 2, championRosterId: null } })).toBe(false)
  })

  it('treats a missing or malformed row as unsettled', () => {
    for (const value of [null, undefined, 'x', 42, [], {}]) {
      expect(isStoredSeasonSettled(value), JSON.stringify(value)).toBe(false)
    }
  })
})
