// @vitest-environment node
/**
 * The in-place switch (lib/league/convertImportedLeagueInPlace.ts) against a real PostgreSQL: an imported Sleeper dynasty
 * league is seeded the way the import leaves one — provider team ids, provider user keys, mirrored season rows marked
 * `imported`, a traded pick keyed by provider team ids, a mirrored Sleeper draft, history facts — then switched, and
 * every id space is checked on the far side.
 *
 * ⚠ WHY A DATABASE AND NOT MOCKS. The switch is two-phase renames under four unique keys and a dozen tables that have
 * to agree with each other afterwards (Roster.platformUserId == RedraftRoster.ownerId, LeagueTeam.externalId ==
 * Roster.id, pick owners == Roster.id). A mocked transaction proves none of that; Postgres refuses a collision.
 *
 * Runs only when RUN_NATIVE_CONVERSION_DB=1 and DATABASE_URL names the disposable local `nativeconv` database
 * (.github/workflows/native-conversion-db.yml); skipped everywhere else.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
// The roster registry loads each sport with a CommonJS require vitest cannot resolve; the same registry over ESM imports.
vi.mock('@/lib/roster-engine/RosterEngineRegistry', async () => (await import('../dynasty-sim/rosterRegistryEsm')).buildEsmRosterRegistryModule())
import { randomUUID } from 'node:crypto'

const enabled = process.env.RUN_NATIVE_CONVERSION_DB === '1'
if (enabled) {
  const target = new URL(process.env.DATABASE_URL ?? 'http://invalid')
  if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.pathname !== '/nativeconv') {
    throw new Error('The in-place conversion test needs the disposable local nativeconv database')
  }
}

const { prisma } = await import('@/lib/prisma')
const { convertImportedLeagueInPlace, NativeConversionRefusal } = await import('@/lib/league/convertImportedLeagueInPlace')
const { nativeWeeklyLeague } = await import('@/lib/core-app/weeklyCapabilities')
const { isNativePlatform } = await import('@/lib/league/isNativeLeague')

const created = { leagueIds: [] as string[], userIds: [] as string[], sleeperIds: [] as string[], providerLeagueIds: [] as string[] }

async function seedImportedLeague() {
  const tag = randomUUID().slice(0, 8)
  await prisma.tenant.upsert({ where: { id: 'allfantasy' }, create: { id: 'allfantasy', slug: 'allfantasy', name: 'Native conversion test' }, update: {} })
  const [commish, friend] = await Promise.all([0, 1].map((i) =>
    prisma.appUser.create({ data: { email: `nc-${tag}-${i}@nativeconv.invalid`, username: `nc-${tag}-${i}` } })))
  created.userIds.push(commish!.id, friend!.id)
  const platformLeagueId = `sl-${tag}`
  const league = await prisma.league.create({
    data: {
      userId: commish!.id, platform: 'sleeper', platformLeagueId, name: `Dynasty ${tag}`, season: 2026, sport: 'NFL',
      leagueType: 'dynasty', isDynasty: true, status: 'complete', lastSyncedAt: new Date(), syncStatus: 'synced',
      // What a Sleeper import stores: its lineup and its scoring rules in Sleeper's own keys.
      settings: {
        roster_positions: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX', 'SUPER_FLEX', 'K', 'DEF', 'BN', 'BN', 'BN', 'BN', 'BN'],
        reserve_slots: 1,
        scoringSettings: { rules: { rec: 0.5, pass_td: 4, pass_yd: 0.04, rush_yd: 0.1, rush_td: 6, rec_yd: 0.1, rec_td: 6 } },
      },
    },
  })
  created.leagueIds.push(league.id)

  const players = (seat: number) => [`nc${tag}${seat}a`, `nc${tag}${seat}b`]
  for (const seat of [1, 2, 3]) {
    for (const [i, id] of players(seat).entries()) {
      created.sleeperIds.push(id)
      await prisma.playerIdentityMap.create({
        data: { sport: 'NFL', sleeperId: id, canonicalName: `Player ${seat}${i}`, normalizedName: `player ${seat}${i}`, position: i ? 'RB' : 'QB', currentTeam: 'KC' },
      })
    }
  }
  const claim = [commish!.id, friend!.id, null]
  const season = await prisma.redraftSeason.create({
    data: { leagueId: league.id, sport: 'NFL', season: 2026, status: 'complete', totalWeeks: 14, playoffStartWeek: 15, currentWeek: 14 },
  })
  const seats: Array<{ teamId: string; rosterId: string; redraftId: string }> = []
  for (const seat of [1, 2, 3]) {
    const team = await prisma.leagueTeam.create({
      data: {
        leagueId: league.id, externalId: String(seat), platformUserId: `sl-user-${seat}`, claimedByUserId: claim[seat - 1],
        teamName: `Team ${seat}`, ownerName: `provider_name_${seat}`, avatarUrl: `https://img.invalid/${seat}.png`, isCommissioner: seat === 1,
      },
    })
    const rr = await prisma.redraftRoster.create({
      data: { seasonId: season.id, leagueId: league.id, ownerId: `sl-user-${seat}`, ownerName: `provider_name_${seat}`, teamName: `Team ${seat}` },
    })
    const roster = await prisma.roster.create({
      data: {
        leagueId: league.id, platformUserId: `sl-user-${seat}`, redraftRosterId: rr.id,
        playerData: { source_provider: 'sleeper', source_team_id: String(seat), players: players(seat), starters: [players(seat)[0]] },
      },
    })
    await prisma.redraftRosterPlayer.createMany({
      data: players(seat).map((playerId, i) => ({ rosterId: rr.id, playerId, playerName: `Player ${seat}${i}`, position: i ? 'RB' : 'QB', sport: 'NFL', slotType: i ? 'bench' : 'starter', acquisitionType: 'imported' })),
    })
    seats.push({ teamId: team.id, rosterId: roster.id, redraftId: rr.id })
  }
  // Seat 1 bought seat 3's 2028 first.
  await prisma.futureDraftPick.create({ data: { leagueId: league.id, pickSeason: 2028, round: 1, originalRosterId: '3', currentOwnerId: '1', traded: true, status: 'active' } })
  await prisma.draftSession.create({
    data: { leagueId: league.id, status: 'completed', sleeperDraftId: `sd-${tag}`, slotOrder: [1, 2, 3].map((n) => ({ slot: n, rosterId: String(n) })) },
  })
  await prisma.matchupFact.create({
    data: { matchupId: `mf-${tag}`, leagueId: league.id, sport: 'NFL', weekOrPeriod: 1, teamA: '1', teamB: '2', scoreA: 101, scoreB: 99, winnerTeamId: '1', season: 2026 },
  })
  await prisma.leagueChatMessage.create({ data: { leagueId: league.id, userId: commish!.id, message: 'before the switch' } })
  // The provider's own week rows, keyed by ITS league id and team ids: week 1 is seat 1 v seat 2 with seat 3 on a bye,
  // week 15 a playoff game. Plus one player's points (provider rows, which other members' imports still read).
  created.providerLeagueIds.push(platformLeagueId)
  await prisma.weeklyMatchup.createMany({ data: [
    { leagueId: platformLeagueId, seasonYear: 2026, week: 1, rosterId: '1', matchupId: 1, pointsFor: 101, pointsAgainst: 99, win: 1 },
    { leagueId: platformLeagueId, seasonYear: 2026, week: 1, rosterId: '2', matchupId: 1, pointsFor: 99, pointsAgainst: 101, win: 0 },
    { leagueId: platformLeagueId, seasonYear: 2026, week: 1, rosterId: '3', matchupId: null, pointsFor: 80, pointsAgainst: 0, win: 0 },
    { leagueId: platformLeagueId, seasonYear: 2026, week: 15, rosterId: '1', matchupId: 7, pointsFor: 120, pointsAgainst: 110, win: 1 },
    { leagueId: platformLeagueId, seasonYear: 2026, week: 15, rosterId: '3', matchupId: 7, pointsFor: 110, pointsAgainst: 120, win: 0 },
  ] })
  await prisma.leaguePlayerWeeklyScore.create({
    data: { leagueId: platformLeagueId, seasonYear: 2026, week: 1, playerId: players(1)[0]!, rosterId: 1, isStarter: true, points: 24.5, isFinalized: true, source: 'sleeper' },
  })
  return { league, commish: commish!, friend: friend!, seats, platformLeagueId, tag, firstPlayer: players(1)[0]! }
}

async function clean() {
  // Keyed by provider and native league ids, not foreign keys: nothing removes these with the league.
  for (const id of created.providerLeagueIds.splice(0)) {
    await prisma.weeklyMatchup.deleteMany({ where: { leagueId: id } })
    await prisma.leaguePlayerWeeklyScore.deleteMany({ where: { leagueId: id } })
  }
  for (const id of created.leagueIds) await prisma.leaguePlayerWeeklyScore.deleteMany({ where: { leagueId: id } })
  for (const id of created.leagueIds.splice(0)) {
    await prisma.leagueChatMessage.deleteMany({ where: { leagueId: id } })
    await prisma.matchupFact.deleteMany({ where: { leagueId: id } })
    await prisma.futureDraftPick.deleteMany({ where: { leagueId: id } })
    await prisma.league.delete({ where: { id } }).catch(() => {})
  }
  await prisma.playerIdentityMap.deleteMany({ where: { sleeperId: { in: created.sleeperIds.splice(0) } } })
  await prisma.appUser.deleteMany({ where: { id: { in: created.userIds.splice(0) } } })
}

describe.runIf(enabled)('switching an imported league to native in place, against a real database', () => {
  beforeAll(async () => { await prisma.$connect() })
  afterEach(clean)
  afterAll(async () => { await prisma.$disconnect() })

  it('rewrites every id space on the same row and keeps names, logos, chat and history', async () => {
    const { league, commish, friend, seats, platformLeagueId, firstPlayer } = await seedImportedLeague()
    // Positive control: before the switch every native gate says imported.
    expect(isNativePlatform(league.platform)).toBe(false)
    expect(nativeWeeklyLeague(league)).toBe(false)

    const result = await convertImportedLeagueInPlace(prisma, { leagueId: league.id, userId: commish.id })
    expect(result).toMatchObject({ kind: 'converted', seats: 3, scoring: 'converted', roster: 'mapped' })

    const after = await prisma.league.findUniqueOrThrow({ where: { id: league.id } })
    expect(after.platform).toBe('manual')
    expect(after.platformLeagueId).toMatch(/^manual-/)
    // Native settings (step 4b-1): without them the league would score standard PPR on a default roster.
    const afterSettings = after.settings as Record<string, any>
    expect(afterSettings.nfl_scoring_config).toMatchObject({ source: 'IMPORTED_MAPPED', presetKey: 'custom' })
    expect(afterSettings.roster.config.sections[0].slots).toMatchObject({ QB: 1, RB: 2, WR: 2, TE: 1, FLEX: 1, SUPERFLEX: 1, K: 1, DEF: 1, BN: 5, IR: 1 })
    expect(await prisma.leagueWaiverSettings.count({ where: { leagueId: league.id } })).toBe(1)
    expect(await prisma.leagueSettings.count({ where: { leagueId: league.id } })).toBe(1)
    expect(await prisma.leagueInvite.count({ where: { leagueId: league.id, isActive: true } })).toBe(1)

    // Past weeks copied into native tables (Q4): final matchups on the season's rows, playoff week marked, the bye kept.
    expect(result).toMatchObject({ pastScores: { matchups: 3, matchupsSkipped: 0, playerScores: 1, playerScoresUnmapped: 0 } })
    const season = await prisma.redraftSeason.findFirstOrThrow({ where: { leagueId: league.id } })
    const matchups = await prisma.redraftMatchup.findMany({ where: { seasonId: season.id }, orderBy: [{ week: 'asc' }, { homeScore: 'desc' }] })
    expect(matchups.map((m) => [m.week, m.type, m.status, m.homeRosterId, m.awayRosterId, m.homeScore, m.awayScore])).toEqual([
      [1, 'regular', 'final', seats[0]!.redraftId, seats[1]!.redraftId, 101, 99],
      [1, 'regular', 'final', seats[2]!.redraftId, null, 80, 0],
      [15, 'playoff', 'final', seats[0]!.redraftId, seats[2]!.redraftId, 120, 110],
    ])
    expect(await prisma.leaguePlayerWeeklyScore.findMany({ where: { leagueId: league.id }, select: { playerId: true, points: true, source: true, week: true } }))
      .toEqual([{ playerId: firstPlayer, points: 24.5, source: 'allfantasy', week: 1 }])
    // The provider's own rows are untouched: other members' imports of that league still read them.
    expect(await prisma.weeklyMatchup.count({ where: { leagueId: platformLeagueId } })).toBe(5)
    expect(await prisma.leaguePlayerWeeklyScore.count({ where: { leagueId: platformLeagueId } })).toBe(1)
    expect(isNativePlatform(after.platform)).toBe(true)
    expect(nativeWeeklyLeague(after)).toBe(true)

    const teams = await prisma.leagueTeam.findMany({ where: { leagueId: league.id }, orderBy: { teamName: 'asc' } })
    const rosters = await prisma.roster.findMany({ where: { leagueId: league.id } })
    const rosterById = new Map(rosters.map((r) => [r.id, r]))
    for (const [i, team] of teams.entries()) {
      // LeagueTeam.externalId is Roster.id; names, logos and the provider manager name are untouched (Q3).
      expect(team.externalId).toBe(seats[i]!.rosterId)
      expect(team.teamName).toBe(`Team ${i + 1}`)
      expect(team.ownerName).toBe(`provider_name_${i + 1}`)
      expect(team.avatarUrl).toBe(`https://img.invalid/${i + 1}.png`)
    }
    expect(rosterById.get(seats[0]!.rosterId)!.platformUserId).toBe(commish.id)
    expect(rosterById.get(seats[1]!.rosterId)!.platformUserId).toBe(friend.id)
    expect(rosterById.get(seats[2]!.rosterId)!.platformUserId).toBe(`open-slot-${league.id}-3`)
    expect(teams[2]!.isOrphan).toBe(true)

    // The standings engine maps RedraftRoster.ownerId onto Roster.platformUserId: they must be identical.
    for (const seat of seats) {
      const rr = await prisma.redraftRoster.findUniqueOrThrow({ where: { id: seat.redraftId } })
      expect(rr.ownerId).toBe(rosterById.get(seat.rosterId)!.platformUserId)
    }
    // Carried players are ordinary drafted players (Q6).
    expect(await prisma.redraftRosterPlayer.count({ where: { rosterId: { in: seats.map((s) => s.redraftId) }, acquisitionType: 'imported' } })).toBe(0)
    expect(await prisma.redraftRosterPlayer.count({ where: { rosterId: { in: seats.map((s) => s.redraftId) }, acquisitionType: 'drafted' } })).toBe(6)

    const pick = await prisma.futureDraftPick.findFirstOrThrow({ where: { leagueId: league.id } })
    expect(pick).toMatchObject({ originalRosterId: seats[2]!.rosterId, currentOwnerId: seats[0]!.rosterId })

    const draft = await prisma.draftSession.findFirstOrThrow({ where: { leagueId: league.id } })
    expect(draft.sleeperDraftId).toBeNull()
    expect((draft.slotOrder as Array<{ rosterId: string }>).map((s) => s.rosterId)).toEqual(seats.map((s) => s.rosterId))

    const fact = await prisma.matchupFact.findFirstOrThrow({ where: { leagueId: league.id } })
    expect(fact).toMatchObject({ teamA: seats[0]!.teamId, teamB: seats[1]!.teamId, winnerTeamId: seats[0]!.teamId })

    const members = await prisma.redraftLeagueMember.findMany({ where: { leagueId: league.id } })
    expect(new Map(members.map((m) => [m.userId, m.role]))).toEqual(new Map([[commish.id, 'COMMISSIONER'], [friend.id, 'MEMBER']]))
    const slots = await prisma.leagueEntrySlot.findMany({ where: { leagueId: league.id }, orderBy: { slotNumber: 'asc' } })
    expect(slots.map((s) => [s.rosterId, s.status])).toEqual(seats.map((s, i) => [s.rosterId, i < 2 ? 'FILLED' : 'OPEN']))
    expect(await prisma.redraftLeagueChatRoom.count({ where: { leagueId: league.id } })).toBe(1)
    expect(await prisma.leagueChatMessage.count({ where: { leagueId: league.id } })).toBe(1)

    const conversion = await prisma.leagueNativeConversion.findUniqueOrThrow({ where: { leagueId: league.id } })
    expect(conversion).toMatchObject({ status: 'applied', fromPlatform: 'sleeper', fromPlatformLeagueId: league.platformLeagueId, fromSeason: 2026 })
    expect((conversion.snapshot as { league: { platform: string } }).league.platform).toBe('sleeper')

    // A retry is a receipt, not a second switch.
    expect(await convertImportedLeagueInPlace(prisma, { leagueId: league.id, userId: commish.id })).toEqual({ kind: 'already_converted', conversionId: conversion.id })
  })

  it('refuses while another copy of the league exists, and writes nothing', async () => {
    const { league, commish, friend, platformLeagueId } = await seedImportedLeague()
    const copy = await prisma.league.create({
      data: { userId: friend.id, platform: 'sleeper', platformLeagueId, name: 'Their copy', season: 2026, sport: 'NFL', status: 'complete' },
    })
    created.leagueIds.push(copy.id)

    const attempt = convertImportedLeagueInPlace(prisma, { leagueId: league.id, userId: commish.id })
    await expect(attempt).rejects.toBeInstanceOf(NativeConversionRefusal)
    await expect(attempt).rejects.toMatchObject({ blockers: [expect.objectContaining({ code: 'duplicate_copies' })] })

    expect((await prisma.league.findUniqueOrThrow({ where: { id: league.id } })).platform).toBe('sleeper')
    expect((await prisma.leagueTeam.findMany({ where: { leagueId: league.id } })).map((t) => t.externalId).sort()).toEqual(['1', '2', '3'])
    expect(await prisma.leagueNativeConversion.count({ where: { leagueId: league.id } })).toBe(0)
  })
})
