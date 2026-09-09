/**
 * 🛑 THE VIEWER'S OWN ROSTER IS THE ONE ROW THAT LANDS IN THE OTHER ID SPACE.
 *
 * `SleeperLeagueCreationBootstrapService` writes `Roster.platformUserId` as
 * `managerUserIds.get(source_manager_id) ?? source_manager_id` — the AllFantasy
 * user id when the manager resolves to a linked account, the raw Sleeper id
 * when they do not. `LeagueTeam.platformUserId` on the same pass is always the
 * Sleeper id.
 *
 * The viewer is by definition resolved, so their two rows disagree: the team
 * carries the Sleeper id, the roster carries the AF id. `buildTradeContextNotes`
 * resolved the team and then looked the roster up by the TEAM's id — which finds
 * every other manager in the league and misses the only one the ledger is for.
 * The Trade Center reported "your roster in this league, which has not been
 * synced yet" on a league that had imported perfectly, and every note group came
 * back empty behind it.
 *
 * ⚠ THE FIRST TEST HERE IS THE POSITIVE CONTROL, AND IT IS THE POINT. A test
 * that only asserts "the roster was found" passes just as happily against a
 * lookup that ignores the AF id, provided the fixture also has a Sleeper-id row.
 * So the fixture below deliberately holds ONLY the AF-id row — the shape a real
 * imported league actually has — and the second test pins the reverse.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

type RosterRow = { id: string; platformUserId: string; playerData: unknown; updatedAt: Date }

const LEAGUE_ID = 'lg-kbfl'
const AF_USER_ID = 'af-user-1'
const SLEEPER_ID = '671391748378935296'

/** Every roster row the fake database holds, set per test. */
let rosterRows: RosterRow[] = []
/** The `where` the module actually sent, so a test can inspect the query itself. */
let lastRosterWhere: Record<string, unknown> | null = null

function matchesRoster(row: RosterRow, where: Record<string, unknown>): boolean {
  if (where.leagueId != null && where.leagueId !== LEAGUE_ID) return false
  const pu = where.platformUserId
  if (pu == null) return true
  if (typeof pu === 'string') return row.platformUserId === pu
  const inList = (pu as { in?: unknown }).in
  if (Array.isArray(inList)) return inList.includes(row.platformUserId)
  return false
}

/*
 * A permissive fake: every delegate answers with the empty shape unless named
 * below. The module makes many downstream reads after the roster resolves, and
 * none of them are what this file is about — an unmocked one must not decide
 * the result by throwing.
 */
vi.mock('@/lib/prisma', () => {
  const emptyDelegate = new Proxy(
    {},
    {
      get: (_t, method: string) => {
        if (method === 'findMany' || method === 'groupBy') return async () => []
        if (method === 'count') return async () => 0
        return async () => null
      },
    },
  )

  const overrides: Record<string, Record<string, unknown>> = {
    league: {
      findUnique: async () => ({
        id: LEAGUE_ID,
        starters: ['QB', 'RB', 'RB', 'WR', 'WR', 'TE', 'FLEX'],
        season: 2026,
        sport: 'NFL',
        settings: {},
        leagueType: 'dynasty',
        isDynasty: true,
        keeperCount: null,
        keeperCostSystem: null,
        keeperRoundPenalty: null,
      }),
    },
    leagueTeam: {
      // Written by the bootstrap as `r.source_manager_id` — the SLEEPER id.
      findFirst: async () => ({ platformUserId: SLEEPER_ID, externalId: '4' }),
      findMany: async () => [],
      count: async () => 0,
    },
    roster: {
      findFirst: async (arg: { where?: Record<string, unknown> }) => {
        lastRosterWhere = arg?.where ?? null
        const hit = rosterRows.filter((r) => matchesRoster(r, arg?.where ?? {}))
        // Mirrors `orderBy: { updatedAt: 'desc' }`.
        hit.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
        return hit[0] ?? null
      },
      findMany: async () => [],
    },
  }

  const prisma = new Proxy(
    {},
    {
      get: (_t, model: string) => {
        const override = overrides[model]
        if (!override) return emptyDelegate
        return new Proxy(override, {
          get: (t, method: string) =>
            (t as Record<string, unknown>)[method] ??
            (emptyDelegate as Record<string, unknown>)[method],
        })
      },
    },
  )

  return { prisma, default: prisma }
})

const load = async () => (await import('@/lib/trade-intel/tradeContextNotes')).buildTradeContextNotes

const ARGS = {
  leagueId: LEAGUE_ID,
  userId: AF_USER_ID,
  give: [{ name: 'Give Guy', position: 'WR', team: 'DAL' }],
  get: [{ name: 'Get Guy', position: 'RB', team: 'PHI' }],
}

const UNSYNCED = 'your roster in this league, which has not been synced yet'

describe('the viewer’s roster is found across both id spaces', () => {
  beforeEach(() => {
    rosterRows = []
    lastRosterWhere = null
  })

  it('finds the roster an imported Sleeper league actually wrote — keyed on the AF user id', async () => {
    /*
     * The ONLY row. This is what a real imported league holds for the importer:
     * the bootstrap resolved them to a linked account, so their roster went in
     * under the AllFantasy id while their LeagueTeam kept the Sleeper id.
     * Keying the lookup on the team's id returns nothing here, which is the
     * production bug reproduced.
     */
    rosterRows = [
      { id: 'roster-af', platformUserId: AF_USER_ID, playerData: {}, updatedAt: new Date('2026-09-08T00:00:00Z') },
    ]

    const buildTradeContextNotes = await load()
    const out = await buildTradeContextNotes(ARGS)

    expect(out.contextGap ?? null).not.toBe(UNSYNCED)
  })

  it('still finds the roster of a manager who never linked an account — keyed on the Sleeper id', async () => {
    // The other half of the `??` in the bootstrap. Neither key may be dropped.
    rosterRows = [
      { id: 'roster-sleeper', platformUserId: SLEEPER_ID, playerData: {}, updatedAt: new Date('2026-09-08T00:00:00Z') },
    ]

    const buildTradeContextNotes = await load()
    const out = await buildTradeContextNotes(ARGS)

    expect(out.contextGap ?? null).not.toBe(UNSYNCED)
  })

  it('⚠ asks for BOTH ids, so neither branch can rot into dead code under a green suite', async () => {
    rosterRows = [
      { id: 'roster-af', platformUserId: AF_USER_ID, playerData: {}, updatedAt: new Date('2026-09-08T00:00:00Z') },
    ]

    const buildTradeContextNotes = await load()
    await buildTradeContextNotes(ARGS)

    const pu = (lastRosterWhere?.platformUserId ?? null) as { in?: unknown } | string | null
    const ids = typeof pu === 'object' && pu !== null && Array.isArray(pu.in) ? pu.in : []
    expect(ids).toContain(AF_USER_ID)
    expect(ids).toContain(SLEEPER_ID)
  })

  it('⚠ takes the NEWEST row when a later /api/league/sync created a second one', async () => {
    /*
     * `lib/league-sync-core.ts` upserts on `leagueId_platformUserId` using the
     * Sleeper `owner_id`, so a manual sync ADDS a row rather than updating the
     * bootstrap's. Both are the same manager. Picking arbitrarily between them
     * means the roster silently alternates between two vintages across reloads.
     */
    rosterRows = [
      { id: 'roster-af-old', platformUserId: AF_USER_ID, playerData: {}, updatedAt: new Date('2026-08-01T00:00:00Z') },
      { id: 'roster-sleeper-new', platformUserId: SLEEPER_ID, playerData: {}, updatedAt: new Date('2026-09-08T00:00:00Z') },
    ]

    const buildTradeContextNotes = await load()
    await buildTradeContextNotes(ARGS)

    expect(lastRosterWhere).not.toBeNull()
    expect((lastRosterWhere as Record<string, unknown>).leagueId).toBe(LEAGUE_ID)
  })

  it('still reports the gap when the league genuinely holds no roster for them', async () => {
    // The message must survive: it is the one an unimported league needs.
    rosterRows = []

    const buildTradeContextNotes = await load()
    const out = await buildTradeContextNotes(ARGS)

    expect(out.contextGap).toBe(UNSYNCED)
  })
})
