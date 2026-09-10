// @vitest-environment node
/**
 * Batch A.2 — dynasty projections must not be PERSISTED for an archived seat.
 *
 * ⚠ THE `node` ENVIRONMENT ABOVE IS LOAD-BEARING. `lib/prisma.ts` exports `null` when
 * `isDomRuntime()` is true, and this repo's default vitest environment defines `window`. Under
 * jsdom the client is null and every call here dies with
 * "Cannot read properties of null (reading 'league')" — which reads like a broken fixture rather
 * than the wrong runtime.
 *
 * The last of the four reads registered `MIXED (deferred)` in Batch A, and the only one whose
 * consumer writes. `generateDynastyProjection(input, { persist: true })` reaches
 * `prisma.dynastyProjection.upsert`, so an archived seat did not merely appear in a power
 * ranking — it acquired a stored projection every later read treats as real.
 *
 * ── WHY THE BEHAVIOURAL BLOCK IS GATED, AND WHAT IT COSTS ───────────────────────────────────
 *
 * 🛑 `DATABASE_URL` UNSET IN THIS REPO MEANS PRODUCTION, NOT "NO DATABASE". Importing
 * `@prisma/client` populates `process.env` from `.env`, so a spec that names no database still
 * connects to the production endpoint. `vitest.setup.db-guard.ts` pins the unset case to
 * `127.0.0.1:1` precisely so that cannot happen silently.
 *
 * So the behavioural block runs ONLY against a database a human named, and re-checks the target
 * itself rather than trusting a setup file it does not own. Run it with:
 *
 *   DATABASE_URL=postgresql://…/af_a2_dynasty_test \
 *   DIRECT_URL=postgresql://…/af_a2_dynasty_test \
 *   npx vitest run __tests__/league-import/dynasty-projections-archived-seats.test.ts
 *
 * The structural assertions are NOT gated and run everywhere.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const HANDLER = 'app/api/leagues/[leagueId]/dynasty-projections/handler.ts'
const src = readFileSync(join(process.cwd(), HANDLER), 'utf8')

/** Comments stripped — prose describing the fix must not be able to satisfy the assertion. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('dynasty projections: current targets, historical pick provenance', () => {
  it('🛑 the targets are EVERY current franchise — vacant seats included', () => {
    /*
     * INVERTED ON PURPOSE, 2026-09-10. This asserted the opposite until the premise was shown
     * false: `isOrphan` is not an archival flag. Canonical league creation sets it on every OPEN,
     * CLAIMABLE slot, so filtering it gave a brand-new 12-team league ONE projection target and
     * priced `teamCount` at 1.
     *
     * Excluding a genuinely DEPARTED seat from a PERSISTED projection is still wanted — it needs
     * the lifecycle axis, which is a different transition from vacancy.
     */
    expect(code).not.toMatch(/selectActiveTeams\(teams\)/)
    expect(code).toMatch(/const targetTeams = params\.teamIdFilter/)
  })

  it('the league-size fallback counts every current franchise', () => {
    /* Also inverted — a vacant seat is part of the league being valued. */
    expect(code).toMatch(/teamCount: league\.leagueSize \?\? teams\.length/)
    expect(code).not.toMatch(/activeTeams\.length/)
  })

  it('🛑 the future-pick ledger still sees EVERY team, including archived', () => {
    const call = code.slice(code.indexOf('buildFuturePicksByTeam({'))
    const args = call.slice(0, call.indexOf('})') + 2)
    expect(args, 'the pick ledger must receive the unfiltered array').toMatch(/\bteams\b/)
    expect(args, 'the pick ledger must NOT receive activeTeams').not.toMatch(/activeTeams/)
  })

  it('isOrphan is selected, or the filter is a silent no-op', () => {
    const query = code.slice(code.indexOf('prisma.leagueTeam.findMany'))
    const select = query.slice(query.indexOf('select:'), query.indexOf('}),'))
    expect(select.length, 'could not locate the select block').toBeGreaterThan(0)
    expect(select).toMatch(/isOrphan: true/)
  })
})

/* ────────────────────────────────────────────────────────────────────────────────────────── */

const TARGET =
  process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? ''
const HAS_DB = process.env.VITEST_NO_DATABASE !== '1' && Boolean(TARGET)
const describeDb = HAS_DB ? describe : describe.skip

/** Everything this suite creates, so cleanup can be asserted rather than hoped for. */
const OWNED = {
  leagueId: `a2-dynasty-fixture-${Date.now()}`,
  live: 'a2-live-1',
  gone: 'a2-gone-1',
  season: 2026,
  userId: `a2-dynasty-user-${Date.now()}`,
}

/** A value no generator would ever produce, so "was it updated?" is unambiguous. */
const SENTINEL = -999

describeDb('PERSISTED behaviour (explicitly named disposable database only)', () => {
  beforeAll(async () => {
    /*
     * 🛑 A SECOND, INDEPENDENT REFUSAL. The db-guard pins an INHERITED url to 127.0.0.1:1, but
     * this suite WRITES, so it re-checks rather than trusting a setup file it does not own.
     * Neon is where this repo's production and shared branch databases live — all of them.
     */
    expect(TARGET, 'refusing to create fixtures against a Neon endpoint').not.toMatch(/neon\.tech/i)
    expect(TARGET, 'refusing: the db-guard sentinel means no database was named').not.toMatch(
      /127\.0\.0\.1:1\b/,
    )

    const { prisma } = await import('@/lib/prisma')
    /*
     * `League.tenantId` defaults to the literal 'allfantasy' and carries an FK, so a database
     * created from the schema alone has no row to point at. Upserted rather than created: the
     * tenant may legitimately already exist in a reused disposable database, and it is NOT
     * deleted in cleanup for the same reason — this suite did not necessarily create it.
     */
    await prisma.tenant.upsert({
      where: { id: 'allfantasy' },
      update: {},
      create: { id: 'allfantasy', slug: 'allfantasy', name: 'AllFantasy' },
    })
    /* `League.user` is a required relation, so the fixture owns a user too — and cleans it up. */
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
        name: 'A2 archived-seat fixture',
        platform: 'manual',
        platformLeagueId: OWNED.leagueId,
        sport: 'NFL',
        season: OWNED.season,
        isDynasty: true,
      },
    })
    await prisma.leagueTeam.create({
      data: {
        leagueId: OWNED.leagueId,
        externalId: OWNED.live,
        teamName: 'Live',
        ownerName: 'Live',
        wins: 8,
        losses: 4,
        pointsFor: 1400,
      },
    })
    await prisma.leagueTeam.create({
      data: {
        leagueId: OWNED.leagueId,
        externalId: OWNED.gone,
        teamName: 'Departed',
        ownerName: 'Departed',
        isOrphan: true,
        wins: 2,
        losses: 10,
        pointsFor: 900,
      },
    })

    /*
     * A pre-existing projection for the ARCHIVED seat, carrying an impossible value. The upsert
     * would UPDATE this row rather than create one, so "no new row" alone would not catch a
     * regression — the row's contents have to be shown unchanged.
     */
    await prisma.dynastyProjection.create({
      data: {
        leagueId: OWNED.leagueId,
        teamId: OWNED.gone,
        sport: 'NFL',
        championshipWindowScore: SENTINEL,
        rebuildProbability: SENTINEL,
        rosterStrength3Year: SENTINEL,
        rosterStrength5Year: SENTINEL,
        agingRiskScore: SENTINEL,
        futureAssetScore: SENTINEL,
        season: OWNED.season,
      },
    })

    /* The archived seat's 2027 first-rounder, traded to the LIVE team. */
    await prisma.draftSession.create({
      data: {
        leagueId: OWNED.leagueId,
        tradedPicks: [
          { round: 1, season: OWNED.season + 1, originalRosterId: OWNED.gone, newRosterId: OWNED.live },
        ],
      },
    })
  })

  afterAll(async () => {
    /*
     * ⚠ CLEANUP IS ASSERTED, NOT SWALLOWED. A `.catch(() => {})` here would leave rows behind in
     * whatever database was named and report success — the same shape of silent pass this whole
     * batch exists to remove. Every delete is scoped to ids this suite created.
     */
    const { prisma } = await import('@/lib/prisma')
    await prisma.dynastyProjection.deleteMany({ where: { leagueId: OWNED.leagueId } })
    await prisma.draftSession.deleteMany({ where: { leagueId: OWNED.leagueId } })
    await prisma.leagueTeam.deleteMany({ where: { leagueId: OWNED.leagueId } })
    await prisma.league.deleteMany({ where: { id: OWNED.leagueId } })
    await prisma.appUser.deleteMany({ where: { id: OWNED.userId } })

    const remaining = {
      projections: await prisma.dynastyProjection.count({ where: { leagueId: OWNED.leagueId } }),
      draftSessions: await prisma.draftSession.count({ where: { leagueId: OWNED.leagueId } }),
      teams: await prisma.leagueTeam.count({ where: { leagueId: OWNED.leagueId } }),
      leagues: await prisma.league.count({ where: { id: OWNED.leagueId } }),
      users: await prisma.appUser.count({ where: { id: OWNED.userId } }),
    }
    /* Throwing here fails the run. Leaving fixtures behind is a defect, not a footnote. */
    expect(remaining, 'fixture cleanup left rows behind').toEqual({
      projections: 0,
      draftSessions: 0,
      teams: 0,
      leagues: 0,
      users: 0,
    })
  })

  it('a LIVE target gets a stored projection; the ARCHIVED one is neither created nor updated', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { buildTeamInputsFromLeague, generateForInputs } = await import(
      '@/app/api/leagues/[leagueId]/dynasty-projections/handler'
    )

    const before = await prisma.dynastyProjection.findMany({
      where: { leagueId: OWNED.leagueId },
      select: { teamId: true },
    })
    expect(before.map((r) => r.teamId).sort(), 'fixture precondition').toEqual([OWNED.gone])

    const { teamInputs } = await buildTeamInputsFromLeague({ leagueId: OWNED.leagueId })
    /* The REAL persisting path — this is what GET and POST call. */
    await generateForInputs(teamInputs, true)

    const rows = await prisma.dynastyProjection.findMany({
      where: { leagueId: OWNED.leagueId },
      select: {
        teamId: true,
        championshipWindowScore: true,
        rosterStrength3Year: true,
        futureAssetScore: true,
      },
      orderBy: { teamId: 'asc' },
    })
    const byTeam = new Map(rows.map((r) => [r.teamId, r]))

    /* (a) the live seat actually produced a stored projection. */
    expect(byTeam.has(OWNED.live), 'the live seat should have been persisted').toBe(true)
    expect(
      byTeam.get(OWNED.live)!.championshipWindowScore,
      'a real projection, not the sentinel',
    ).not.toBe(SENTINEL)

    /* (b) exactly one row for the archived seat — no second row was created. */
    expect(rows.filter((r) => r.teamId === OWNED.gone)).toHaveLength(1)

    /* (b, continued) and its contents are untouched — no UPDATE reached it either. */
    const archived = byTeam.get(OWNED.gone)!
    expect(archived.championshipWindowScore, 'archived row was updated').toBe(SENTINEL)
    expect(archived.rosterStrength3Year, 'archived row was updated').toBe(SENTINEL)
    expect(archived.futureAssetScore, 'archived row was updated').toBe(SENTINEL)
  })

  it('an explicit request for the ARCHIVED team cannot bypass the restriction', async () => {
    const { prisma } = await import('@/lib/prisma')
    const { buildTeamInputsFromLeague } = await import(
      '@/app/api/leagues/[leagueId]/dynasty-projections/handler'
    )

    await expect(
      buildTeamInputsFromLeague({ leagueId: OWNED.leagueId, teamIdFilter: OWNED.gone }),
      'asking for a departed seat by id must find nothing, not mint a projection for it',
    ).rejects.toThrow(/not found in this league/i)

    /* And nothing was written on the way to that refusal. */
    const archived = await prisma.dynastyProjection.findFirst({
      where: { leagueId: OWNED.leagueId, teamId: OWNED.gone },
      select: { championshipWindowScore: true },
    })
    expect(archived?.championshipWindowScore).toBe(SENTINEL)
  })

  it('🛑 the LIVE team KEEPS a future pick that originated with the archived seat', async () => {
    /*
     * The half that must NOT be filtered. `buildFuturePicksByTeam` seeds its ledger from every
     * ORIGINAL team; the archived seat's 2027 first-rounder was traded to the live team, so
     * narrowing that array would silently delete a pick a LIVE team owns.
     *
     * Base entitlement is 3 seasons × 3 rounds = 9. The traded pick makes 10.
     */
    const { buildTeamInputsFromLeague } = await import(
      '@/app/api/leagues/[leagueId]/dynasty-projections/handler'
    )
    const { teamInputs } = await buildTeamInputsFromLeague({ leagueId: OWNED.leagueId })

    const live = teamInputs.find((t) => t.teamId === OWNED.live)
    expect(live, 'the live team should be a projection target').toBeTruthy()
    expect(
      live!.futurePicks.length,
      'the live team lost the pick it acquired from the departed manager',
    ).toBe(10)

    /* The archived seat is not a target at all, so it has no inputs to hold picks. */
    expect(teamInputs.map((t) => t.teamId)).toEqual([OWNED.live])
  })
})
