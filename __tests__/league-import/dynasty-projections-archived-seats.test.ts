/**
 * Batch A.2 — dynasty projections must not be PERSISTED for an archived seat.
 *
 * This is the last of the four reads that were registered `MIXED (deferred)`, and the only one
 * whose consumer writes. `generateDynastyProjection(input, { persist: true })` stores a row per
 * target, so an archived seat did not merely appear in a ranking — it acquired a stored dynasty
 * projection that every later read treats as real.
 *
 * ── WHY THE PERSISTED ASSERTION IS GATED, AND WHAT THAT COSTS ────────────────────────────────
 *
 * 🛑 `DATABASE_URL` UNSET IN THIS REPO MEANS PRODUCTION, NOT "NO DATABASE". Importing
 * `@prisma/client` populates `process.env` from `.env`, so a spec that names no database still
 * connects to the production endpoint. `vitest.setup.db-guard.ts` pins the unset case to
 * `127.0.0.1:1` precisely so that cannot happen silently.
 *
 * So the write-path assertion runs ONLY against a database a human named, exactly like
 * `real-data-validation-phase35`. With no target it SKIPS — visibly, in the run summary —
 * rather than failing red or, far worse, writing projections into production to prove a point
 * about not writing projections.
 *
 * The structural assertions below are NOT gated and run everywhere. They pin the three things
 * the fix consists of, which is what a reviewer can rely on in CI today.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const HANDLER = 'app/api/leagues/[leagueId]/dynasty-projections/handler.ts'
const src = readFileSync(join(process.cwd(), HANDLER), 'utf8')

/** Comments stripped — prose describing the fix must not be able to satisfy the assertion. */
const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')

describe('dynasty projections: current targets, historical pick provenance', () => {
  it('the projection targets come from the FILTERED set', () => {
    expect(code).toMatch(/const activeTeams = selectActiveTeams\(teams\)/)
    /* Both branches — the explicit teamIdFilter must not mint a projection for a departed seat. */
    expect(code).toMatch(/const targetTeams = params\.teamIdFilter\s*\?\s*activeTeams\.filter/)
    expect(code).toMatch(/:\s*activeTeams\b/)
  })

  it('the league-size fallback counts live seats, not stored rows', () => {
    expect(code).toMatch(/teamCount: league\.leagueSize \?\? activeTeams\.length/)
    expect(code).not.toMatch(/teamCount: league\.leagueSize \?\? teams\.length/)
  })

  it('🛑 the future-pick ledger still sees EVERY team, including archived', () => {
    /*
     * The half that must NOT be filtered. `buildFuturePicksByTeam` seeds its ledger from every
     * ORIGINAL team and resolves traded picks through an alias map keyed on ids a departed seat
     * still owns. Filtering it would silently delete a pick that a LIVE team acquired from a
     * manager who has since left — destroying attribution to fix a display bug.
     */
    const call = code.slice(code.indexOf('buildFuturePicksByTeam({'))
    const args = call.slice(0, call.indexOf('})') + 2)
    expect(args, 'the pick ledger must receive the unfiltered array').toMatch(/\bteams\b/)
    expect(args, 'the pick ledger must NOT receive activeTeams').not.toMatch(/activeTeams/)
  })

  it('isOrphan is selected, or the filter is a silent no-op', () => {
    /*
     * `isActiveTeam` reads `isOrphan !== true`; an omitted column is `undefined`, which reads
     * ACTIVE. `TeamOrphanState` marks the field optional, so nothing type-checks this.
     */
    const query = code.slice(code.indexOf('prisma.leagueTeam.findMany'))
    const select = query.slice(query.indexOf('select:'), query.indexOf('}),'))
    expect(select.length, 'could not locate the select block').toBeGreaterThan(0)
    expect(select).toMatch(/isOrphan: true/)
  })
})

/*
 * The persisted behaviour. Runs only against a database a human named.
 *
 * Set up: point `DATABASE_URL` at an isolated database carrying this schema, then
 *   DATABASE_URL=postgresql://…/af_test npx vitest run __tests__/league-import/dynasty-projections-archived-seats.test.ts
 * It creates its own league, archives one seat, generates, and asserts no row was stored for it.
 */
const HAS_DB =
  process.env.VITEST_NO_DATABASE !== '1' &&
  Boolean(process.env.DATABASE_URL || process.env.POSTGRES_PRISMA_URL || process.env.POSTGRES_URL)
const describeDb = HAS_DB ? describe : describe.skip

describeDb('projection targets (isolated database only)', () => {
  it('an archived seat never reaches the persisting generator', async () => {
    const { prisma } = await import('@/lib/prisma')
    const url = String(
      process.env.DATABASE_URL ?? process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? '',
    )
    /*
     * A second, independent refusal. `vitest.setup.db-guard.ts` already pins an INHERITED url to
     * 127.0.0.1:1, but this suite creates rows, so it re-checks rather than trusting a setup file
     * it does not own. Neon is where this repo's production database lives.
     */
    expect(url, 'refusing to create fixtures against a Neon endpoint').not.toMatch(/neon\.tech/)

    const league = await prisma.league.create({
      data: { name: 'A2 archived-seat fixture', platform: 'manual', sport: 'NFL', season: 2026 },
      select: { id: true },
    })
    try {
      await prisma.leagueTeam.create({
        data: { leagueId: league.id, externalId: 'live-1', teamName: 'Live', ownerName: 'Live' },
      })
      await prisma.leagueTeam.create({
        data: {
          leagueId: league.id,
          externalId: 'gone-1',
          teamName: 'Departed',
          ownerName: 'Departed',
          isOrphan: true,
        },
      })

      /*
       * `buildTeamInputsFromLeague` is the last step before
       * `generateDynastyProjection(input, { persist: true })`. Asserting on WHAT IT RETURNS proves
       * no row can be written for an archived seat, and writes no projection to prove it.
       */
      const { buildTeamInputsFromLeague } = await import(
        '@/app/api/leagues/[leagueId]/dynasty-projections/handler'
      )
      const { teamInputs } = await buildTeamInputsFromLeague({ leagueId: league.id })
      const targeted = new Set(teamInputs.map((t) => t.teamId))

      expect(targeted.has('live-1'), 'the live seat should be a projection target').toBe(true)
      expect(targeted.has('gone-1'), 'the archived seat must NOT be a projection target').toBe(false)
    } finally {
      /* Cascade removes the team rows with the league. */
      await prisma.league.delete({ where: { id: league.id } }).catch(() => {})
    }
  })
})
