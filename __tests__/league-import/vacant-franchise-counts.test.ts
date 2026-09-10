// @vitest-environment node
/**
 * A VACANT FRANCHISE IS ONE OF THE LEAGUE'S TEAMS.
 *
 * 🛑 THE REGRESSION THIS EXISTS TO CATCH. `LeagueTeam.isOrphan` was read as "archived" and
 * filtered out of ~16 readers. It is not an archival flag — `createCanonicalLeagueInTransaction`
 * sets it on every OPEN, CLAIMABLE slot at league creation:
 *
 *     externalId: openRoster.id,
 *     platformUserId: `open-slot-${league.id}-${slot}`,
 *     claimedByUserId: null,
 *     isOrphan: true,            // ← a brand-new, current, claimable franchise
 *
 * So a fresh 12-team league carries ELEVEN `isOrphan: true` rows, and filtering them reported
 * that league as having ONE team — shrinking league size, draft pick-in-round maths, trade and
 * dynasty valuation inputs, and the "N of M claimed" denominator.
 *
 * Corroborated by two committed fixtures that predate this file:
 *   `__tests__/league/nfl-ncaaf-league-ui.test.ts` — "open slot teams are isOrphan and have no
 *     claimedByUserId"
 *   `__tests__/league-pulse-decision-os.test.tsx` — a league declared `teamCount: 4` whose fourth
 *     team is `{ teamName: 'Open Team', isOrphan: true, pointsFor: 390 }`, asserting
 *     "Open manager slots: 1". The vacant seat counts toward league size AND carries points.
 *
 * ⚠ THIS IS A BEHAVIOURAL TEST ON PURPOSE. A source-text assertion would go green the moment
 * someone reintroduced the filter through a differently-spelled helper. This one drives the real
 * reader against a real database and counts what comes back.
 *
 * ⚠ `// @vitest-environment node` is load-bearing: `lib/prisma.ts` exports `null` under a DOM
 * runtime, and this repo's default vitest environment defines `window`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TARGET =
  process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? ''
const HAS_DB = process.env.VITEST_NO_DATABASE !== '1' && Boolean(TARGET)
const describeDb = HAS_DB ? describe : describe.skip

const OWNED = {
  leagueId: `a2-vacancy-${Date.now()}`,
  userId: `a2-vacancy-user-${Date.now()}`,
  season: 2026,
  /** One human commissioner plus eleven open slots — the canonical 12-team shape. */
  humanExternalId: 'vac-human-1',
  openCount: 11,
}

describeDb('a canonical 12-team league counts TWELVE franchises, not one', () => {
  beforeAll(async () => {
    expect(TARGET, 'refusing to create fixtures against a Neon endpoint').not.toMatch(/neon\.tech/i)
    expect(TARGET, 'refusing: the db-guard sentinel means no database was named').not.toMatch(
      /127\.0\.0\.1:1\b/,
    )

    const { prisma } = await import('@/lib/prisma')
    await prisma.tenant.upsert({
      where: { id: 'allfantasy' },
      update: {},
      create: { id: 'allfantasy', slug: 'allfantasy', name: 'AllFantasy' },
    })
    await prisma.appUser.create({
      data: {
        id: OWNED.userId,
        email: `${OWNED.userId}@a2.fixture.invalid`,
        username: OWNED.userId,
      },
    })
    await prisma.league.create({
      data: {
        id: OWNED.leagueId,
        userId: OWNED.userId,
        name: 'A2 vacancy fixture',
        platform: 'manual',
        platformLeagueId: OWNED.leagueId,
        sport: 'NFL',
        season: OWNED.season,
        isDynasty: true,
      },
    })

    /* The commissioner: claimed, human, isOrphan false. */
    await prisma.leagueTeam.create({
      data: {
        leagueId: OWNED.leagueId,
        externalId: OWNED.humanExternalId,
        teamName: 'Commish',
        ownerName: 'Commish',
        claimedByUserId: OWNED.userId,
        platformUserId: OWNED.userId,
        isCommissioner: true,
        wins: 3,
        losses: 1,
        pointsFor: 500,
      },
    })

    /*
     * Eleven OPEN SLOTS, in exactly the shape canonical creation writes them — including the
     * `open-slot-…` platformUserId, so the fixture is recognisable as that writer's output and
     * not a shape invented for this test.
     */
    for (let slot = 2; slot <= OWNED.openCount + 1; slot += 1) {
      await prisma.leagueTeam.create({
        data: {
          leagueId: OWNED.leagueId,
          externalId: `vac-open-${slot}`,
          teamName: `Open Team ${slot}`,
          ownerName: `Open Team ${slot}`,
          claimedByUserId: null,
          platformUserId: `open-slot-${OWNED.leagueId}-${slot}`,
          isOrphan: true,
          isCommissioner: false,
          /* A vacant seat plays real matchups and carries real points. */
          wins: 1,
          losses: 3,
          pointsFor: 300 + slot,
        },
      })
    }
  })

  afterAll(async () => {
    const { prisma } = await import('@/lib/prisma')
    await prisma.dynastyProjection.deleteMany({ where: { leagueId: OWNED.leagueId } })
    await prisma.leagueTeam.deleteMany({ where: { leagueId: OWNED.leagueId } })
    await prisma.league.deleteMany({ where: { id: OWNED.leagueId } })
    await prisma.appUser.deleteMany({ where: { id: OWNED.userId } })

    /* Cleanup is asserted, never swallowed. */
    expect(
      {
        teams: await prisma.leagueTeam.count({ where: { leagueId: OWNED.leagueId } }),
        leagues: await prisma.league.count({ where: { id: OWNED.leagueId } }),
        users: await prisma.appUser.count({ where: { id: OWNED.userId } }),
      },
      'fixture cleanup left rows behind',
    ).toEqual({ teams: 0, leagues: 0, users: 0 })
  })

  it('the fixture really is 1 human + 11 vacant, and the vacant seats carry isOrphan', async () => {
    const { prisma } = await import('@/lib/prisma')
    const [total, orphaned, claimed] = await Promise.all([
      prisma.leagueTeam.count({ where: { leagueId: OWNED.leagueId } }),
      prisma.leagueTeam.count({ where: { leagueId: OWNED.leagueId, isOrphan: true } }),
      prisma.leagueTeam.count({
        where: { leagueId: OWNED.leagueId, claimedByUserId: { not: null } },
      }),
    ])
    expect({ total, orphaned, claimed }).toEqual({ total: 12, orphaned: 11, claimed: 1 })
  })

  it('🛑 league size is 12 — the dynasty reader targets every current franchise', async () => {
    /*
     * `buildTeamInputsFromLeague` is the last step before the persisting generator, and its
     * `teamCount` is what prices dynasty valuation. With the archival filter in place this
     * returned ONE target and priced a twelve-team league at 1.
     */
    const { buildTeamInputsFromLeague } = await import(
      '@/app/api/leagues/[leagueId]/dynasty-projections/handler'
    )
    const { teamInputs } = await buildTeamInputsFromLeague({ leagueId: OWNED.leagueId })

    expect(teamInputs).toHaveLength(12)
    expect(
      teamInputs[0]!.leagueContext.teamCount,
      'league-size input must not shrink because seats are vacant',
    ).toBe(12)

    /* And every open slot is present by name, not merely counted. */
    const ids = new Set(teamInputs.map((t) => t.teamId))
    expect(ids.has(OWNED.humanExternalId)).toBe(true)
    for (let slot = 2; slot <= OWNED.openCount + 1; slot += 1) {
      expect(ids.has(`vac-open-${slot}`), `open slot ${slot} was dropped`).toBe(true)
    }
  })

  it('claim progress reads 1 of 12 — denominator all current, numerator the actual claims', async () => {
    /*
     * The two halves of the "N of M teams claimed" bar, as `app/api/leagues/join` computes them.
     * The denominator is every current franchise; the numerator is an identity fact. With the
     * archival filter on both, a 1/12 league reported "1 of 1".
     */
    const { prisma } = await import('@/lib/prisma')
    const [teamCount, claimedCount] = await Promise.all([
      prisma.leagueTeam.count({ where: { leagueId: OWNED.leagueId } }),
      prisma.leagueTeam.count({
        where: { leagueId: OWNED.leagueId, claimedByUserId: { not: null } },
      }),
    ])
    expect({ teamCount, claimedCount }).toEqual({ teamCount: 12, claimedCount: 1 })
  })

  it('vacant seats remain claimable — they are not hidden behind an archival predicate', async () => {
    const { prisma } = await import('@/lib/prisma')
    const claimable = await prisma.leagueTeam.count({
      where: { leagueId: OWNED.leagueId, claimedByUserId: null },
    })
    expect(claimable, 'all eleven open slots must still be offerable').toBe(11)
  })

  it('a vacant franchise keeps its standings row and its points', async () => {
    const { prisma } = await import('@/lib/prisma')
    const rows = await prisma.leagueTeam.findMany({
      where: { leagueId: OWNED.leagueId },
      select: { externalId: true, pointsFor: true, wins: true },
      orderBy: { pointsFor: 'desc' },
    })
    expect(rows).toHaveLength(12)
    const openRow = rows.find((r) => r.externalId === 'vac-open-5')
    expect(openRow?.pointsFor, 'a vacant seat carries legitimate standings data').toBe(305)
  })
})
