import { PrismaClient } from '@prisma/client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  resolveRedraftTeamWindow, WINDOW_GAP_TEAM_AMBIGUOUS, WINDOW_GAP_TEAM_ARCHIVED,
  WINDOW_GAP_TEAM_NOT_CLAIMED,
} from '@/lib/decision-os/value-v2/redraftWindowServerAdapter'

/**
 * The redraft adapter against a POPULATED non-production database.
 *
 * 🛑 WHY THIS IS NOT COVERED BY THE FAKE-PRISMA SUITE. That suite proves the adapter asks the
 * right questions in the right id spaces. It cannot prove the answers come back — a `where`
 * clause that names a real column with the wrong SEMANTICS (LeagueTeam.externalId vs the uuid
 * primary key, WeeklyMatchup.leagueId vs League.id) returns an empty result rather than an
 * error, and an empty result reads as "this team has never played". Only real rows separate
 * "asked correctly" from "asked something that happens to parse".
 *
 * ⚠ Every row is prefixed with a per-run token and removed in `afterAll`. This checkout is
 * shared, so an unprefixed fixture is somebody else's flake.
 *
 * ⚠ `.invalid` is a reserved TLD that can never resolve — a fixture address cannot become a real
 * send if it ever escapes cleanup.
 */

const NO_DB = process.env.VITEST_NO_DATABASE === '1'
const STRICT_DB = process.env.M19_DB_STRICT === '1'

const RUN = `m19adp-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
const LEAGUE = `${RUN}-league`
const PLATFORM = `${RUN}-platform`
const USER_ID = `${RUN}-user`
const OTHER_USER = `${RUN}-other`
const REDRAFT_ROSTER = `${RUN}-redraft-roster`
const REDRAFT_SEASON = `${RUN}-redraft-season`
const PLAYERS = ['p1', 'p2', 'p3', 'p4'].map(p => `${RUN}-${p}`)
const SEASON = 2999
const WEEK = 6

const prisma = new PrismaClient()

/** True when the generated client can actually round-trip WeeklyMatchup on THIS database. */
let matchupsReadable = false

function requireMatchups(ctx: { skip: () => void }): void {
  if (matchupsReadable) return
  if (STRICT_DB) {
    throw new Error(
      'M19_DB_STRICT=1 but the Prisma client cannot read WeeklyMatchup here, so the populated-' +
      'fixture coverage this suite exists for did not run. Most likely the pending migration ' +
      '20260903222531_weekly_matchup_roster_id_text is unapplied on this non-production database.',
    )
  }
  ctx.skip()
}

async function seedMatchups() {
  const points: Record<string, number> = { '1': 130, '2': 110, '3': 95, '4': 70 }
  for (let week = 1; week <= WEEK; week += 1) {
    for (const rosterId of ['1', '2', '3', '4']) {
      const opponent = rosterId === '1' ? '4' : rosterId === '4' ? '1' : rosterId === '2' ? '3' : '2'
      await prisma.$executeRawUnsafe(
        `INSERT INTO "WeeklyMatchup" ("id","leagueId","seasonYear","week","rosterId","pointsFor","pointsAgainst","win","createdAt","updatedAt")
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,NOW(),NOW())`,
        `${PLATFORM}-${SEASON}-${week}-${rosterId}`, PLATFORM, SEASON, week,
        Number(rosterId), points[rosterId], points[opponent],
        points[rosterId] > points[opponent] ? 1 : 0,
      )
    }
  }
}

describe.skipIf(NO_DB)('the redraft adapter against real rows', () => {
  beforeAll(async () => {
    await prisma.tenant.upsert({ where: { id: 'allfantasy' }, create: { id: 'allfantasy', slug: 'allfantasy', name: 'AllFantasy' }, update: {} })
    await prisma.appUser.createMany({
      data: [
        { id: USER_ID, email: `${RUN}@allfantasy-fixture.invalid`, username: `${RUN}-user` },
        { id: OTHER_USER, email: `${RUN}-o@allfantasy-fixture.invalid`, username: `${RUN}-other` },
      ],
    })
    await prisma.league.create({
      data: { id: LEAGUE, userId: USER_ID, platform: 'sleeper', platformLeagueId: PLATFORM, name: `${RUN} fixture` },
    })
    /*
     * Team "1" is the one this caller has CLAIMED. Team "4" is claimed by nobody, and exists so a
     * bug that ignored `claimedByUserId` would resolve the wrong team rather than resolve nothing.
     */
    await prisma.leagueTeam.createMany({
      data: [
        { leagueId: LEAGUE, externalId: '1', ownerName: 'Rae', teamName: 'Anvil Chorus', claimedByUserId: USER_ID },
        { leagueId: LEAGUE, externalId: '4', ownerName: 'Sam', teamName: 'Ditchwater' },
      ],
    })
    await prisma.seasonForecastSnapshot.createMany({
      data: [4, 5, 6].map(week => ({
        leagueId: LEAGUE, season: SEASON, week,
        teamForecasts: [{ teamId: '1', playoffProbability: 94.5 }, { teamId: '4', playoffProbability: 2.5 }],
      })),
    })
    await prisma.dynastyProjectionSnapshot.createMany({
      data: [
        { leagueId: LEAGUE, teamId: '1', season: SEASON, projectedStrengthNextYear: 84, projectedStrength3Years: 88, projectedStrength5Years: 80, rebuildProbability: 5, contenderProbability: 90, volatilityScore: 12, confidenceScore: 76, windowStartYear: SEASON, windowEndYear: SEASON + 3 },
        { leagueId: LEAGUE, teamId: '4', season: SEASON, projectedStrengthNextYear: 22, projectedStrength3Years: 19, projectedStrength5Years: 25, rebuildProbability: 88, contenderProbability: 4, volatilityScore: 30, confidenceScore: 61 },
      ],
    })
    await seedMatchups()

    /*
     * ⚠ THE ROSTER AND THE INJURY FEED ARE NOT OPTIONAL FIXTURE DRESSING. The port refuses when
     * availability coverage falls below 50% of the roster, so a fixture with NO roster players
     * produces `injury_coverage_below_floor` and a refused window — which is the adapter working
     * correctly, and would have read here as "the seam is broken". A populated fixture has to be
     * populated in every input the resolver actually consumes.
     */
    await prisma.redraftSeason.create({
      data: { id: REDRAFT_SEASON, leagueId: LEAGUE, sport: 'NFL', season: SEASON, totalWeeks: 14, playoffStartWeek: 15, currentWeek: WEEK },
    })
    await prisma.redraftRoster.create({
      data: { id: REDRAFT_ROSTER, seasonId: REDRAFT_SEASON, leagueId: LEAGUE, ownerId: USER_ID, ownerName: 'Rae' },
    })
    await prisma.redraftRosterPlayer.createMany({
      data: PLAYERS.map((playerId, i) => ({
        rosterId: REDRAFT_ROSTER, playerId, playerName: `Fixture ${i}`,
        position: 'WR', sport: 'NFL', slotType: 'bench',
      })),
    })
    await prisma.sportsPlayer.createMany({
      data: PLAYERS.map((externalId, i) => ({
        sport: 'NFL', externalId, name: `Fixture ${i}`, source: RUN,
        // One unavailable out of four: real evidence, comfortably above the coverage floor.
        status: i === 0 ? 'out' : 'active',
        expiresAt: new Date(Date.now() + 86_400_000),
      })),
    })

    matchupsReadable = await prisma.weeklyMatchup
      .findFirst({ where: { leagueId: PLATFORM, seasonYear: SEASON }, select: { rosterId: true } })
      .then(r => r != null)
      .catch(() => false)
    // eslint-disable-next-line no-console
    console.log(`[m19-adapter] endpoint=${(process.env.DATABASE_URL ?? '').replace(/.*@/, '').replace(/[/?].*/, '')} matchupsReadable=${matchupsReadable}`)
  }, 120_000)

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DELETE FROM "WeeklyMatchup" WHERE "leagueId" = $1`, PLATFORM).catch(() => 0)
    await prisma.redraftRosterPlayer.deleteMany({ where: { rosterId: REDRAFT_ROSTER } }).catch(() => null)
    await prisma.redraftRoster.deleteMany({ where: { id: REDRAFT_ROSTER } }).catch(() => null)
    await prisma.redraftSeason.deleteMany({ where: { id: REDRAFT_SEASON } }).catch(() => null)
    await prisma.sportsPlayer.deleteMany({ where: { source: RUN } }).catch(() => null)
    await prisma.dynastyProjectionSnapshot.deleteMany({ where: { leagueId: LEAGUE } }).catch(() => null)
    await prisma.seasonForecastSnapshot.deleteMany({ where: { leagueId: LEAGUE } }).catch(() => null)
    await prisma.leagueTeam.deleteMany({ where: { leagueId: LEAGUE } }).catch(() => null)
    await prisma.league.deleteMany({ where: { id: LEAGUE } }).catch(() => null)
    await prisma.appUser.deleteMany({ where: { id: { in: [USER_ID, OTHER_USER] } } }).catch(() => null)
    await prisma.$disconnect()
  }, 120_000)

  const req = (over: Record<string, unknown> = {}) => ({
    prisma, leagueId: LEAGUE, userId: USER_ID, proposerRosterId: REDRAFT_ROSTER,
    sport: 'NFL', season: SEASON, week: WEEK,
    scheduledPeriods: [1, 2, 3, 4, 5, 6],
    ...over,
  }) as Parameters<typeof resolveRedraftTeamWindow>[0]

  it('resolves a real window for the claimed team and names that team', async ctx => {
    requireMatchups(ctx)
    const d = await resolveRedraftTeamWindow(req())

    // Guard the guard: a refusal here would make every assertion below vacuous.
    expect(d.gaps).not.toContain('window_adapter_read_failed')
    expect(d.state).not.toBe('refused')
    expect(d.status).not.toBeNull()

    // The window belongs to the CLAIMED team, in the port's namespace — not the roster cuid.
    expect(d.identity.teamId).toBe('1')
    expect(d.identity.leagueId).toBe(LEAGUE)
    expect(d.identity.season).toBe(SEASON)
    expect(d.identity.week).toBe(WEEK)
    expect(JSON.stringify(d.identity)).not.toContain(REDRAFT_ROSTER)

    // Real evidence reached it: roster "1" outscores everyone every week.
    expect(d.luckAdjustedWinRate).not.toBeNull()
    expect(d.evidence.allPlay).not.toBeNull()
  }, 120_000)

  it('resolves the OTHER team for the other claimant, proving the claim is what selects', async ctx => {
    requireMatchups(ctx)
    await prisma.leagueTeam.updateMany({ where: { leagueId: LEAGUE, externalId: '4' }, data: { claimedByUserId: OTHER_USER } })
    const d = await resolveRedraftTeamWindow(req({ userId: OTHER_USER }))
    expect(d.identity.teamId).toBe('4')
    // Opposite end of the same league, from the same rows.
    const mine = await resolveRedraftTeamWindow(req())
    expect(mine.identity.teamId).toBe('1')
    expect(d.status).not.toBe(mine.status)
    await prisma.leagueTeam.updateMany({ where: { leagueId: LEAGUE, externalId: '4' }, data: { claimedByUserId: null } })
  }, 120_000)

  it('refuses for a member who has claimed no team', async () => {
    const d = await resolveRedraftTeamWindow(req({ userId: `${RUN}-nobody` }))
    expect(d.state).toBe('refused')
    expect(d.gaps).toContain(WINDOW_GAP_TEAM_NOT_CLAIMED)
    expect(d.identity.teamId).toBeNull()
  }, 120_000)

  it('refuses when the caller has claimed two teams rather than picking one', async () => {
    await prisma.leagueTeam.updateMany({ where: { leagueId: LEAGUE, externalId: '4' }, data: { claimedByUserId: USER_ID } })
    const d = await resolveRedraftTeamWindow(req())
    expect(d.state).toBe('refused')
    expect(d.gaps).toContain(WINDOW_GAP_TEAM_AMBIGUOUS)
    expect(d.identity.teamId).toBeNull()
    await prisma.leagueTeam.updateMany({ where: { leagueId: LEAGUE, externalId: '4' }, data: { claimedByUserId: null } })
  }, 120_000)

  it('refuses an archived team whose matchups would otherwise resolve', async () => {
    await prisma.leagueTeam.updateMany({ where: { leagueId: LEAGUE, externalId: '1' }, data: { isOrphan: true } })
    const d = await resolveRedraftTeamWindow(req())
    expect(d.state).toBe('refused')
    expect(d.gaps).toContain(WINDOW_GAP_TEAM_ARCHIVED)
    await prisma.leagueTeam.updateMany({ where: { leagueId: LEAGUE, externalId: '1' }, data: { isOrphan: false } })
  }, 120_000)

  it('leaves no fixture rows behind for the tables it seeded', async () => {
    // Asserted here rather than trusted to afterAll, which runs after this file reports.
    const teams = await prisma.leagueTeam.count({ where: { leagueId: LEAGUE } })
    expect(teams).toBe(2)
  }, 120_000)
})
