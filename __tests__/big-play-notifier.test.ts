import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  findMany: vi.fn(), ingestBatch: vi.fn(),
  identityFind: vi.fn(), rawQuery: vi.fn(), profileFind: vi.fn(),
  rosterFind: vi.fn(), appUserFind: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    redraftRosterPlayer: { findMany: h.findMany },
    playerIdentityMap: { findMany: h.identityFind },
    userProfile: { findMany: h.profileFind },
    roster: { findMany: h.rosterFind },
    appUser: { findMany: h.appUserFind },
    $queryRawUnsafe: h.rawQuery,
  },
}))
vi.mock('@/lib/notification-engine', () => ({ ingestBatch: h.ingestBatch }))

import { notifyBigPlays, notificationTitleFor, ownersByPlayerId, starterImpactsByPlayerId } from '@/lib/live/bigPlayNotifier'
import type { LiveEvent } from '@/lib/live/eventDetector'

const ev = (over: Partial<LiveEvent> = {}): LiveEvent =>
  ({
    gameId: '20260920-1-26',
    playerId: '101',
    playerName: 'Bijan Robinson',
    team: 'ATL',
    type: 'BIG_PLAY',
    stat: 'run',
    role: 'rusher',
    delta: 24,
    value: 24,
    detectedAt: new Date('2026-09-20T18:00:00Z'),
    idempotencyKey: 'pbp:20260920-1-26:42:BIG_PLAY',
    ...over,
  }) as LiveEvent

// Redraft roster rows hold the SLEEPER id ('11560'), never the RI feed id ('101').
const rostered = (playerId = '11560', ownerId = 'user-1') => [
  { playerId, roster: { ownerId } },
]

beforeEach(() => {
  h.findMany.mockReset()
  h.ingestBatch.mockReset()
  h.findMany.mockResolvedValue(rostered())
  h.ingestBatch.mockResolvedValue([])
  h.identityFind.mockReset()
  h.identityFind.mockResolvedValue([{ sport: 'NFL', rollingInsightsId: '101', sleeperId: '11560' }])
  h.rawQuery.mockReset(); h.rawQuery.mockResolvedValue([])
  h.profileFind.mockReset(); h.profileFind.mockResolvedValue([])
  h.rosterFind.mockReset(); h.rosterFind.mockResolvedValue([])
  h.appUserFind.mockReset(); h.appUserFind.mockResolvedValue([])
})

describe('who gets told', () => {
  it('notifies the managers starting the player', async () => {
    const res = await notifyBigPlays([ev()])
    expect(res.notificationsSent).toBe(1)
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['user-1'])
  })

  it('sends nothing when nobody starts the player', async () => {
    h.findMany.mockResolvedValue([])
    const res = await notifyBigPlays([ev()])
    expect(res.skipped).toBe('no-rosters')
    expect(h.ingestBatch).not.toHaveBeenCalled()
  })

  it('STARTERS ONLY: bench, IR and taxi slots are excluded at the query, in both spellings', async () => {
    // User decision 2026-09-13: a benched player's touchdown scores nothing for you.
    await notifyBigPlays([ev()])
    const where = h.findMany.mock.calls[0][0].where
    expect(where.NOT.slotType.in).toEqual(expect.arrayContaining(['bench', 'BENCH', 'IR', 'TAXI']))
    // A dropped player keeps his row until droppedAt is set.
    expect(where.droppedAt).toBeNull()
    // Seasons still being played, in every stored spelling — see the 'which seasons' block below.
    expect(where.roster.season.status.in).toEqual(expect.arrayContaining(['active', 'in_season', 'playoffs']))
    // ...and queries by the TRANSLATED Sleeper id, never the RI feed id.
    expect(where.playerId.in).toEqual(['11560'])
  })

  it('STARTERS ONLY on imported leagues too: the lineup array, not the whole roster', async () => {
    await notifyBigPlays([ev()])
    expect(h.rawQuery.mock.calls[0][0]).toContain(`->'starters'`)
    expect(h.rawQuery.mock.calls[0][0]).not.toContain(`->'players'`)
  })

  it('control: the injury importer still gets the whole roster by default', async () => {
    await ownersByPlayerId(['101'], { sport: 'NFL' })
    expect(h.findMany.mock.calls[0][0].where.NOT).toBeUndefined()
    expect(h.rawQuery.mock.calls[0][0]).toContain(`->'players'`)
  })

  it('tells a manager once even when they start the player in several leagues', async () => {
    h.findMany.mockResolvedValue([
      { playerId: '11560', roster: { ownerId: 'user-1' } },
      { playerId: '11560', roster: { ownerId: 'user-1' } },
      { playerId: '11560', roster: { ownerId: 'user-2' } },
    ])
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['user-1', 'user-2'])
  })
})

describe('a passing play is told to both ends', () => {
  const td = ev({
    type: 'TOUCHDOWN', stat: 'pass', role: 'receiver', delta: 34, value: 34,
    playerId: '101', playerName: 'Drake London', passerId: '202', passerName: 'Kirk Cousins',
    idempotencyKey: 'pbp:20260920-1-26:77:TOUCHDOWN',
  })

  beforeEach(() => {
    h.identityFind.mockResolvedValue([
      { sport: 'NFL', rollingInsightsId: '101', sleeperId: '11560' },
      { sport: 'NFL', rollingInsightsId: '202', sleeperId: '5000' },
    ])
    h.findMany.mockResolvedValue([
      { playerId: '11560', roster: { ownerId: 'user-wr' } },
      { playerId: '5000', roster: { ownerId: 'user-qb' } },
      // Starts both: hears it once, from the scorer's side.
      { playerId: '5000', roster: { ownerId: 'user-wr' } },
    ])
  })

  it("the receiver's managers and the passer's managers each get their own line", async () => {
    const res = await notifyBigPlays([td])
    expect(res.notificationsSent).toBe(2)
    const [receiver, passer] = h.ingestBatch.mock.calls[0][0]
    expect(receiver.userIds).toEqual(['user-wr'])
    expect(receiver.body).toBe('Drake London 34-yard receiving TD from Kirk Cousins')
    expect(passer.userIds).toEqual(['user-qb'])
    expect(passer.body).toBe('Kirk Cousins 34-yard TD pass to Drake London')
    // Looked up both players in one pass.
    expect(h.identityFind.mock.calls[0][0].where.rollingInsightsId.in).toEqual(['101', '202'])
  })

  it('each side is its own notification, grouped under the game on the device', async () => {
    await notifyBigPlays([td])
    const [receiver, passer] = h.ingestBatch.mock.calls[0][0]
    // Different people; a tag only groups on one person's device.
    expect(receiver.userIds).not.toEqual(passer.userIds)
    expect(receiver.meta.pushTag).toBe(`live-play:${td.gameId}`)
    expect(receiver.meta.playerId).toBe('101')
    expect(passer.meta.playerId).toBe('202')
  })
})

describe('the correction guard', () => {
  it('NEVER alerts on a negative delta', async () => {
    // A cumulative stat going down is a stat correction, not a play.
    const res = await notifyBigPlays([ev({ delta: -24 })])
    expect(res.eventsAlertable).toBe(0)
    expect(h.ingestBatch).not.toHaveBeenCalled()
  })

  it('still alerts on a genuine zero-yard touchdown', async () => {
    const res = await notifyBigPlays([ev({ type: 'TOUCHDOWN', delta: 0 })])
    expect(res.notificationsSent).toBe(1)
  })
})

describe('every score and every 20+ yard play', () => {
  it('covers every scoring type, big plays and turnovers', async () => {
    for (const type of ['TOUCHDOWN', 'BIG_PLAY', 'FIELD_GOAL', 'DEFENSIVE_SCORE', 'SPECIAL_TEAMS_SCORE', 'TURNOVER'] as const) {
      h.ingestBatch.mockClear()
      const res = await notifyBigPlays([ev({ type })])
      expect(res.notificationsSent, `${type} should alert`).toBe(1)
    }
  })

  it('a field goal is a score now (user decision 2026-09-13)', async () => {
    await notifyBigPlays([ev({ type: 'FIELD_GOAL', stat: 'field_goal', role: 'kicker' })])
    const n = h.ingestBatch.mock.calls[0][0][0]
    expect(n.title).toBe('Field goal')
    expect(n.severity).toBe('medium')
  })

  it('wakes you for a touchdown, not for a 21-yard catch', async () => {
    await notifyBigPlays([ev({ type: 'TOUCHDOWN' })])
    expect(h.ingestBatch.mock.calls[0][0][0].severity).toBe('high')
    h.ingestBatch.mockClear()
    await notifyBigPlays([ev({ type: 'BIG_PLAY' })])
    expect(h.ingestBatch.mock.calls[0][0][0].severity).toBe('low')
  })
})

describe('the payload', () => {
  it('carries the idempotency key so an alert can be retracted and a second TD is not collapsed', async () => {
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].meta.idempotencyKey).toBe('pbp:20260920-1-26:42:BIG_PLAY')
  })

  it('groups plays from one game under one push tag, keeping a distinct key per play', async () => {
    await notifyBigPlays([ev(), ev({ idempotencyKey: 'pbp:20260920-1-26:55:BIG_PLAY' })])
    const [a, b] = h.ingestBatch.mock.calls[0][0]
    expect(a.meta.pushTag).toBe(`live-play:${a.meta.gameId}`)
    expect(a.meta.pushTag).toBe(b.meta.pushTag)
    expect(a.meta.idempotencyKey).not.toBe(b.meta.idempotencyKey)
  })

  it('reads like a sentence with the yardage, and opens Live Scores', async () => {
    await notifyBigPlays([ev()])
    const n = h.ingestBatch.mock.calls[0][0][0]
    expect(n.title).toBe('Big play')
    expect(n.body).toBe('Bijan Robinson 24-yard run')
    expect(n.actionHref).toBe('/core/live?sport=NFL')
  })

  it('pushes a play but never emails or texts it', async () => {
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].skipChannels).toEqual({ sms: true, email: true })
  })

  it('never throws when the notification engine fails', async () => {
    h.ingestBatch.mockRejectedValue(new Error('queue down'))
    await expect(notifyBigPlays([ev()])).resolves.toMatchObject({ notificationsSent: 0 })
  })

  it('is a no-op on an empty batch', async () => {
    await expect(notifyBigPlays([])).resolves.toMatchObject({ skipped: 'no-events' })
  })
})

describe('notificationTitleFor', () => {
  it('names each event the way a person would', () => {
    expect(notificationTitleFor(ev({ type: 'TOUCHDOWN', delta: 19 }))).toBe('Touchdown')
    expect(notificationTitleFor(ev({ type: 'TOUCHDOWN', delta: 20 }))).toBe('20-yard touchdown')
    expect(notificationTitleFor(ev({ type: 'FIELD_GOAL' }))).toBe('Field goal')
    expect(notificationTitleFor(ev({ type: 'DEFENSIVE_SCORE', delta: 19 }))).toBe('Defensive touchdown')
    expect(notificationTitleFor(ev({ type: 'SPECIAL_TEAMS_SCORE', delta: 19 }))).toBe('Special teams touchdown')
  })
})

describe('imported leagues', () => {
  it('names the affected starter league and guillotine rank', async () => {
    h.findMany.mockResolvedValue([])
    h.identityFind.mockResolvedValue([{
      sport: 'NFL', rollingInsightsId: '101', sleeperId: '11560', espnId: null,
      fantraxId: 'fx-101', mflId: null, fleaflickerId: null,
    }])
    h.rosterFind.mockResolvedValue([{
      platformUserId: 'af-user-9',
      playerData: { starters: ['fx-101'], players: ['fx-101'] },
      redraftRoster: null,
      league: {
        id: 'league-cut', name: 'Sunday Guilly', platform: 'fantrax', guillotineMode: true,
        teams: [{ platformUserId: 'af-user-9', claimedByUserId: 'af-user-9', currentRank: 11 }],
      },
    }])
    h.appUserFind.mockResolvedValue([{ id: 'af-user-9' }])

    await notifyBigPlays([ev({ type: 'TOUCHDOWN', delta: 20 })])
    const notification = h.ingestBatch.mock.calls[0][0][0]
    expect(notification.userIds).toEqual(['af-user-9'])
    expect(notification.title).toBe('20-yard touchdown')
    expect(notification.body).toContain('Starting in Sunday Guilly (#11, guillotine)')
    expect(notification.meta.starterLeagueIds).toEqual(['league-cut'])
  })

  it('notifies Sleeper managers, who outnumber redraft managers 4 to 1', async () => {
    h.findMany.mockResolvedValue([])
    h.rawQuery.mockResolvedValue([{ platformUserId: 'sleeper-user-9' }])
    h.profileFind.mockResolvedValue([{ userId: 'af-user-9', sleeperUserId: 'sleeper-user-9' }])

    const res = await notifyBigPlays([ev()])
    expect(res.notificationsSent).toBe(1)
    // The Sleeper user id is translated to OUR user id.
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['af-user-9'])
  })

  it('crosses RI ids to Sleeper ids rather than assuming they match', async () => {
    await notifyBigPlays([ev()])
    expect(h.identityFind.mock.calls[0][0].where.rollingInsightsId.in).toEqual(['101'])
    expect(h.rawQuery.mock.calls[0][1]).toBe(JSON.stringify(['11560']))
  })

  it('skips a player with no identity row instead of guessing', async () => {
    h.findMany.mockResolvedValue([])
    h.identityFind.mockResolvedValue([])
    const res = await notifyBigPlays([ev()])
    expect(res.skipped).toBe('no-rosters')
    expect(h.rawQuery).not.toHaveBeenCalled()
  })

  it('still alerts redraft managers when the imported roster lookup fails', async () => {
    h.rawQuery.mockRejectedValue(new Error('db down'))
    const res = await notifyBigPlays([ev()])
    expect(res.notificationsSent).toBe(1)
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['user-1'])
  })

  /*
   * 2026-10-13: the importer claims a linked manager's LeagueTeam AND rekeys the roster to the AF
   * user id, so a linked Sleeper manager's row never holds a Sleeper id to translate. Production:
   * 0 of 6,973 NFL Sleeper rosters translated through UserProfile.sleeperUserId; 582 carry a claim.
   */
  it('REGRESSION: a claimed Sleeper team resolves to its claimer, with no sleeperUserId to translate', async () => {
    h.findMany.mockResolvedValue([])
    h.rawQuery.mockResolvedValue([{ platformUserId: 'af-claimer', claimedByUserId: 'af-claimer' }])
    // A profile double that honours its `where`: nobody's sleeperUserId is an AF user id.
    h.profileFind.mockImplementation(async ({ where }: { where: Record<string, any> }) =>
      [{ userId: 'af-other', sleeperUserId: 'sleeper-other' }]
        .filter((p) => where.sleeperUserId.in.includes(p.sleeperUserId)))

    // Starters (big plays, TD clips) and the whole roster (injury alerts) alike.
    for (const startersOnly of [true, false]) {
      const owners = await ownersByPlayerId(['101'], { startersOnly, sport: 'NFL' })
      expect(owners.get('101')).toEqual(['af-claimer'])
    }

    const res = await notifyBigPlays([ev({ type: 'TOUCHDOWN', delta: 20 })])
    expect(res.notificationsSent).toBe(1)
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['af-claimer'])
  })

  it('the claim is read off the team this roster belongs to, by the import\'s team id', async () => {
    await ownersByPlayerId(['101'], { startersOnly: true, sport: 'NFL' })
    const sql = h.rawQuery.mock.calls[0][0] as string
    expect(sql).toMatch(/LEFT JOIN league_teams t ON t\."leagueId" = r\."leagueId"/)
    expect(sql).toContain(`t."externalId" = coalesce(r."playerData"->>'source_team_id'`)
    expect(sql).toContain(`t."claimedByUserId"`)
  })

  it('an unclaimed Sleeper manager with no linked account is skipped, not guessed at', async () => {
    h.findMany.mockResolvedValue([])
    // No claim. The platformUserId is a raw Sleeper id nobody linked — and even one that LOOKS
    // like an AF id is not taken on its own say-so; only a claim or a linked profile names a user.
    h.rawQuery.mockResolvedValue([
      { platformUserId: '468164924573478912', claimedByUserId: null },
      { platformUserId: 'af-lookalike' },
    ])
    h.profileFind.mockImplementation(async ({ where }: { where: Record<string, any> }) =>
      [{ userId: 'af-other', sleeperUserId: 'sleeper-other' }]
        .filter((p) => where.sleeperUserId.in.includes(p.sleeperUserId)))

    const owners = await ownersByPlayerId(['101'], { startersOnly: true, sport: 'NFL' })
    expect(owners.get('101')).toBeUndefined()
    const res = await notifyBigPlays([ev()])
    expect(res.skipped).toBe('no-rosters')
  })

  it('merges a claimed owner and a profile-linked owner of the same player once each', async () => {
    h.findMany.mockResolvedValue([])
    h.rawQuery.mockResolvedValue([
      { platformUserId: 'af-claimer', claimedByUserId: 'af-claimer' },
      { platformUserId: 'sleeper-user-9', claimedByUserId: null },
      // The claimer in a second league.
      { platformUserId: 'af-claimer', claimedByUserId: 'af-claimer' },
    ])
    h.profileFind.mockResolvedValue([{ userId: 'af-claimer', sleeperUserId: 'sleeper-user-9' }])
    const owners = await ownersByPlayerId(['101'], { startersOnly: true, sport: 'NFL' })
    expect(owners.get('101')).toEqual(['af-claimer'])
  })

  it('merges both league types for the same player without duplicates', async () => {
    h.findMany.mockResolvedValue(rostered('11560', 'redraft-user'))
    h.rawQuery.mockResolvedValue([{ platformUserId: 'sleeper-user-9' }, { platformUserId: 'sleeper-user-9' }])
    h.profileFind.mockResolvedValue([{ userId: 'af-user-9', sleeperUserId: 'sleeper-user-9' }])
    await notifyBigPlays([ev()])
    expect(h.ingestBatch.mock.calls[0][0][0].userIds).toEqual(['redraft-user', 'af-user-9'])
  })
})

/*
 * 2026-10-11: ids are per provider AND per sport. A database double that honours the `where` it is
 * given, holding what production holds: one Rolling Insights number that is an NFL player AND a
 * college player with a Fantrax id, and an NHL league whose lineup holds a number that is also an
 * NFL Sleeper id. A query that forgets to scope gets exactly what the real database would hand it.
 */
describe('one sport per play — no cross-sport recipients', () => {
  type Identity = {
    sport: string; rollingInsightsId: string; sleeperId: string | null
    espnId: string | null; fantraxId: string | null; mflId: string | null; fleaflickerId: string | null
  }
  const IDENTITIES: Identity[] = [
    { sport: 'NFL', rollingInsightsId: '101', sleeperId: '11560', espnId: null, fantraxId: null, mflId: null, fleaflickerId: null },
    // Same RI number, different people: production has 8,056 NCAAF and 2,824 MLB rows with a fantraxId.
    { sport: 'NCAAF', rollingInsightsId: '101', sleeperId: null, espnId: null, fantraxId: '06k5m', mflId: null, fleaflickerId: null },
    { sport: 'NCAAB', rollingInsightsId: '101', sleeperId: null, espnId: '4433', fantraxId: null, mflId: null, fleaflickerId: null },
  ]
  const leagueRoster = (sport: string, leagueName: string, userId: string, starter: string, platform = 'fantrax') => ({
    sport,
    platformUserId: userId,
    playerData: { starters: [starter], players: [starter] },
    redraftRoster: null,
    league: {
      id: `league-${sport}`, name: leagueName, platform, guillotineMode: false,
      teams: [{ platformUserId: userId, claimedByUserId: userId, currentRank: null }],
    },
  })
  const ROSTERS = [
    // A Sleeper league: '11560' is a Sleeper id only where the league speaks Sleeper's ids.
    leagueRoster('NFL', 'Dynasty Bros', 'af-nfl', '11560', 'sleeper'),
    leagueRoster('NCAAF', 'Saturday CFB', 'af-cfb', '06k5m'),
    leagueRoster('NCAAB', 'March Pool', 'af-cbb', '4433', 'espn'),
    // An NHL lineup holding the number 11560, which is NOT Bijan Robinson in hockey.
    leagueRoster('NHL', 'Puck League', 'af-nhl', '11560'),
  ]

  beforeEach(() => {
    h.identityFind.mockImplementation(async ({ where }: { where: Record<string, any> }) =>
      IDENTITIES.filter((row) =>
        (where.sport == null || row.sport === where.sport)
        && where.rollingInsightsId.in.includes(row.rollingInsightsId)
        && (where.sleeperId?.not !== null || row.sleeperId !== null)))
    h.rosterFind.mockImplementation(async ({ where }: { where: Record<string, any> }) => {
      const wanted = new Set<string>(where.OR.map((clause: any) => clause.playerData.array_contains[0]))
      return ROSTERS.filter((r) =>
        (where.league?.sport == null || r.sport === where.league.sport)
        && r.playerData.starters.some((id) => wanted.has(id)))
    })
    h.appUserFind.mockResolvedValue(ROSTERS.map((r) => ({ id: r.platformUserId })))
    // Redraft rows: the NFL season's and an NHL season's, both holding the number 11560.
    h.findMany.mockImplementation(async ({ where }: { where: Record<string, any> }) =>
      [
        { sport: 'NFL', playerId: '11560', roster: { ownerId: 'redraft-nfl' } },
        { sport: 'NHL', playerId: '11560', roster: { ownerId: 'redraft-nhl' } },
      ].filter((row) => where.roster.season.sport == null || row.sport === where.roster.season.sport))
    // Imported Sleeper rosters: $2 is the league sport.
    h.rawQuery.mockImplementation(async (_sql: string, _ids: string, sport?: string) =>
      [
        { sport: 'NFL', platformUserId: 'sleeper-nfl' },
        { sport: 'NHL', platformUserId: 'sleeper-nhl' },
      ].filter((row) => sport == null || row.sport === sport))
    h.profileFind.mockResolvedValue([
      { userId: 'af-sleeper-nfl', sleeperUserId: 'sleeper-nfl' },
      { userId: 'af-sleeper-nhl', sleeperUserId: 'sleeper-nhl' },
    ])
  })

  const recipients = () => h.ingestBatch.mock.calls.flatMap((call) => call[0].flatMap((n: any) => n.userIds))
  const bodies = () => h.ingestBatch.mock.calls.flatMap((call) => call[0].map((n: any) => n.body as string))

  it('REGRESSION: an NFL play never says "Starting in" a college league that shares the RI number', async () => {
    await notifyBigPlays([ev({ type: 'TOUCHDOWN', delta: 20 })])

    expect(bodies().join(' | ')).not.toMatch(/Saturday CFB|March Pool/)
    expect(recipients()).not.toContain('af-cfb')
    expect(recipients()).not.toContain('af-cbb')
    // The genuine NFL starter still hears it, with his league named.
    expect(recipients()).toContain('af-nfl')
    expect(bodies().find((b) => b.includes('Dynasty Bros'))).toBeTruthy()
  })

  it('REGRESSION: another sport\'s league whose lineup holds the same number is not told about an NFL play', async () => {
    await notifyBigPlays([ev({ type: 'TOUCHDOWN', delta: 20 })])

    for (const wrong of ['af-nhl', 'redraft-nhl', 'af-sleeper-nhl']) expect(recipients()).not.toContain(wrong)
    expect(bodies().join(' | ')).not.toContain('Puck League')
    // ...while every NFL path still delivers.
    for (const right of ['af-nfl', 'redraft-nfl', 'af-sleeper-nfl']) expect(recipients()).toContain(right)
  })

  it('refuses to resolve anyone when no sport is named, rather than run an unscoped lookup', async () => {
    const owners = await (ownersByPlayerId as (ids: string[], opts?: unknown) => Promise<Map<string, string[]>>)(['101'])
    expect(owners.size).toBe(0)
    expect(h.identityFind).not.toHaveBeenCalled()
  })
})

/*
 * 2026-10-12: ids are per PROVIDER within a sport too. One NFL player (RI 101) whose Sleeper,
 * ESPN and Fleaflicker ids differ, and leagues on each platform whose lineups hold those numbers —
 * some as their own platform's id for him, some as a number that on that platform is a stranger.
 * Production: 23 Fleaflicker and 6 ESPN NFL starter slots hold an NFL Sleeper id that is not theirs.
 */
describe('one id column per league platform — no cross-provider recipients', () => {
  const IDENTITY = {
    sport: 'NFL', rollingInsightsId: '101', sleeperId: '11560',
    espnId: '4241', fantraxId: null, mflId: null, fleaflickerId: '9001',
  }
  const roster = (leagueId: string, platform: string, userId: string, starter: string) => ({
    platformUserId: userId,
    playerData: { starters: [starter], players: [starter] },
    redraftRoster: null,
    league: {
      id: leagueId, name: leagueId, platform, guillotineMode: false,
      teams: [{ platformUserId: userId, claimedByUserId: userId, currentRank: null }],
    },
  })
  const ROSTERS = [
    roster('sleeper-own', 'sleeper', 'u-sleeper-own', '11560'),
    roster('native-own', 'manual', 'u-native-own', '11560'),
    roster('espn-own', 'espn', 'u-espn-own', '4241'),
    roster('flea-own', 'fleaflicker', 'u-flea-own', '9001'),
    // His Sleeper number on Fleaflicker / ESPN, and his ESPN number on Sleeper: three strangers.
    roster('flea-stranger', 'fleaflicker', 'u-flea-stranger', '11560'),
    roster('espn-stranger', 'espn', 'u-espn-stranger', '11560'),
    roster('sleeper-stranger', 'sleeper', 'u-sleeper-stranger', '4241'),
  ]

  beforeEach(() => {
    h.identityFind.mockResolvedValue([IDENTITY])
    h.rosterFind.mockImplementation(async ({ where }: { where: Record<string, any> }) => {
      const wanted = new Set<string>(where.OR.map((clause: any) => clause.playerData.array_contains[0]))
      return ROSTERS.filter((r) => r.playerData.starters.some((id) => wanted.has(id)))
    })
    h.appUserFind.mockResolvedValue(ROSTERS.map((r) => ({ id: r.platformUserId })))
    h.findMany.mockResolvedValue([])
  })

  it('REGRESSION: a roster matches only on its own platform\'s id column', async () => {
    const impacts = await starterImpactsByPlayerId(['101'], 'NFL')
    const leagues = (impacts.get('101') ?? []).flatMap((u) => u.leagues.map((l) => l.leagueId)).sort()
    expect(leagues).toEqual(['espn-own', 'flea-own', 'native-own', 'sleeper-own'])
  })

  it('REGRESSION: a stranger sharing the number on another platform is not told "your starter scored"', async () => {
    await notifyBigPlays([ev({ type: 'TOUCHDOWN', delta: 20 })])
    const recipients = h.ingestBatch.mock.calls.flatMap((call) => call[0].flatMap((n: any) => n.userIds))
    for (const wrong of ['u-flea-stranger', 'u-espn-stranger', 'u-sleeper-stranger']) {
      expect(recipients).not.toContain(wrong)
    }
    for (const right of ['u-sleeper-own', 'u-native-own', 'u-espn-own', 'u-flea-own']) {
      expect(recipients).toContain(right)
    }
  })

  it('REGRESSION: the imported-owner SQL only reads Sleeper leagues for a Sleeper id', async () => {
    // A double that honours the platform predicate the SQL carries, and a profile for BOTH owners,
    // so the owner-id translation is not what keeps the Fleaflicker manager out.
    h.rawQuery.mockImplementation(async (sql: string) =>
      [
        { platform: 'sleeper', platformUserId: 'sl-owner' },
        { platform: 'fleaflicker', platformUserId: 'ff-owner' },
      ].filter((row) => !/lower\(l\.platform\) = 'sleeper'/.test(sql) || row.platform === 'sleeper'))
    h.profileFind.mockImplementation(async ({ where }: { where: Record<string, any> }) =>
      [
        { userId: 'af-sl-owner', sleeperUserId: 'sl-owner' },
        { userId: 'af-ff-owner', sleeperUserId: 'ff-owner' },
      ].filter((p) => where.sleeperUserId.in.includes(p.sleeperUserId)))

    for (const startersOnly of [true, false]) {
      const owners = await ownersByPlayerId(['101'], { startersOnly, sport: 'NFL' })
      expect(owners.get('101')).toEqual(['af-sl-owner'])
    }
  })
})

/*
 * 2026-10-11: `RedraftSeason.status` is written as 'active' by native drafts and 'in_season' by
 * imports (lib/redraft/seasonStatus.ts). Production: 534 NFL seasons 'in_season', 1 'active'. A
 * double that honours the status filter it is given, holding one owner per season state.
 */
describe('which redraft seasons are live', () => {
  const SEASONS = [
    { status: 'in_season', ownerId: 'owner-in-season' },
    { status: 'active', ownerId: 'owner-active' },
    { status: 'playoffs', ownerId: 'owner-playoffs' },
    { status: 'complete', ownerId: 'owner-complete' },
    { status: 'setup', ownerId: 'owner-setup' },
    { status: 'regular_season_complete', ownerId: 'owner-between' },
  ]
  const matches = (filter: unknown, status: string) =>
    typeof filter === 'string' ? filter === status
      : Array.isArray((filter as { in?: string[] })?.in) ? (filter as { in: string[] }).in.includes(status)
        : true

  beforeEach(() => {
    h.rawQuery.mockResolvedValue([])
    h.findMany.mockImplementation(async ({ where }: { where: Record<string, any> }) =>
      SEASONS
        .filter((s) => matches(where.roster.season.status, s.status))
        .map((s) => ({ playerId: '11560', roster: { ownerId: s.ownerId } })))
  })

  it('REGRESSION: an imported NFL league\'s manager ("in_season") IS told about his starter', async () => {
    const owners = await ownersByPlayerId(['101'], { startersOnly: true, sport: 'NFL' })
    expect(owners.get('101')).toEqual(expect.arrayContaining(['owner-in-season', 'owner-active', 'owner-playoffs']))

    await notifyBigPlays([ev({ type: 'TOUCHDOWN', delta: 20 })])
    const told = h.ingestBatch.mock.calls.flatMap((call) => call[0].flatMap((n: any) => n.userIds))
    expect(told).toContain('owner-in-season')
  })

  it('a finished, not-yet-started or between-phases season\'s manager is NOT told', async () => {
    const owners = await ownersByPlayerId(['101'], { startersOnly: true, sport: 'NFL' })
    for (const idle of ['owner-complete', 'owner-setup', 'owner-between']) {
      expect(owners.get('101') ?? []).not.toContain(idle)
    }
  })
})
