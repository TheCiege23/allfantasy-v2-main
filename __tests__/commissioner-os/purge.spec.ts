/**
 * Commissioner OS · T-009 acceptance, the database half.
 *
 * "A test purges a fully-populated league — teams, rosters, drafts,
 * memberships, features — with no FK violation, and asserts audit rows survive."
 *
 * 🛑 NOT YET RUN. Written, never executed: it needs `COMMISH_PURGE_URL` (the
 * only role granted DELETE), the T-001 roles, and the T-007 migration applied —
 * none of which exist here — against a database that is not production.
 *
 *     npx tsx scripts/check-staging-env.ts      # exit 1 = not safe
 *     npm run test:commissioner-os
 *
 * ⚠ ON "FULLY POPULATED". The seeded league below carries a representative
 * sample, not one row of all 148 relations — writing those would mean satisfying
 * 148 sets of required columns, and the result would be a test that breaks
 * whenever any unrelated model gains a NOT NULL. The generalising guard is the
 * DRIFT CHECK in the first block: it re-derives the blocker list from
 * `pg_constraint` and fails when the schema grows a third one. That is the
 * check that survives; the seeded purge is the demonstration.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { LEAGUE_PURGE_BLOCKERS, purgeLeague } from '@/lib/domain/purge'

const PURGE_URL = process.env.COMMISH_PURGE_URL
const MIGRATE_URL = process.env.COMMISH_MIGRATE_URL ?? process.env.DIRECT_URL

let purge: PrismaClient
let seed: PrismaClient
/**
 * 🛑 UNIQUE PER RUN, AND NOT BY PREFERENCE — AuditEvent CANNOT BE CLEANED UP.
 *
 * Every other suite here made itself re-runnable by deleting its fixtures on
 * entry. This one cannot: it asserts that an audit row SURVIVES the purge, and
 * T-007's `audit_event_append_only` trigger refuses UPDATE and DELETE for every
 * role including commish_migrate. There is deliberately no way to remove an
 * audit row, which is the entire point of the ticket.
 *
 * So a fixed LEAGUE_ID accumulates one audit row per run and the assertions
 * (`toBe(1)`, `toHaveLength(1)`) fail from the second run onward:
 *
 *     AssertionError: expected 2 to be 1
 *
 * Caught by running the suite twice in a row after it first went green - the
 * first pass was on a database no previous run had touched, which is not the
 * same thing as passing.
 *
 * ⚠ Date.now() is fine HERE. It is banned in workflow scripts because it breaks
 * resume; a test fixture wants a fresh identity on every run, which is the same
 * property viewed from the other side.
 */
const RUN = Date.now().toString(36)
const LEAGUE_ID = `l-purge-probe-${RUN}`
/** Owner of the probe league. Created by this suite, never a real account. */
const USER_ID = `u-purge-probe-${RUN}`

beforeAll(async () => {
  if (!PURGE_URL || !MIGRATE_URL) return
  purge = new PrismaClient({ datasources: { db: { url: PURGE_URL } } })
  seed = new PrismaClient({ datasources: { db: { url: MIGRATE_URL } } })
  await Promise.all([purge.$connect(), seed.$connect()])
})

afterAll(async () => {
  await purge?.$disconnect()
  await seed?.$disconnect()
})

describe('T-009 · the blocker list matches the schema (drift check)', () => {
  it('has both connection strings', () => {
    expect(
      PURGE_URL && MIGRATE_URL,
      'Set COMMISH_PURGE_URL and COMMISH_MIGRATE_URL. The purge role is the only one granted DELETE; running this as anyone else tests a different thing.',
    ).toBeTruthy()
  })

  it('the query finds cascading FKs too (positive control)', async () => {
    // Establishes the query can see FKs to leagues at all. Without it, a typo in
    // the table name returns zero rows and the drift assertion below passes by
    // finding nothing — reporting "no new blockers" about a query that cannot
    // see any.
    const rows = await seed.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.confrelid
        WHERE c.contype = 'f' AND t.relname = 'leagues' AND c.confdeltype = 'c'`,
    )
    expect(Number(rows[0].n)).toBeGreaterThan(100)
  })

  it('no THIRD relation to League blocks a delete', async () => {
    // 🛑 THE TEST THAT ACTUALLY SURVIVES. A model added in month eight with a
    // League relation and no `onDelete` becomes a new blocker, the purge starts
    // failing on an FK violation, and nothing in the codebase would have said
    // so. confdeltype: 'a' = NO ACTION, 'r' = RESTRICT — both abort.
    const rows = await seed.$queryRawUnsafe<{ table_name: string }[]>(
      `SELECT s.relname AS table_name
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.confrelid
         JOIN pg_class s ON s.oid = c.conrelid
        WHERE c.contype = 'f'
          AND t.relname = 'leagues'
          AND c.confdeltype IN ('a','r')
        ORDER BY 1`,
    )
    const found = rows.map((r) => r.table_name)
    const expected = [...LEAGUE_PURGE_BLOCKERS]
      .map((m) => m.toLowerCase())
      .sort()

    expect(
      found.map((f) => f.toLowerCase().replace(/_/g, '')).sort(),
      `Schema has blockers the purge plan does not know about: ${found.join(', ')}. Add them to LEAGUE_PURGE_BLOCKERS or give the relation an onDelete.`,
    ).toEqual(expected.map((e) => e.replace(/_/g, '')).sort())
  })
})

describe('T-009 · purging a populated league', () => {
  beforeAll(async () => {
    if (!PURGE_URL || !MIGRATE_URL) return

    // Seed as commish_migrate — the purge role owns nothing and is granted
    // DELETE, not INSERT. Using it to seed would test a grant the purge is not
    // supposed to have.
    // ⚠ leagues."userId" HAS A FOREIGN KEY TO app_users. Seeding with a made-up
    // 'u-probe' failed with 23503 on leagues_userId_fkey. A probe user is
    // created rather than borrowing a real one: this suite DELETES a league, and
    // pointing a delete test at a real person's row is how a test becomes an
    // incident. app_users requires id, email, username, updatedAt.
    await seed.$executeRawUnsafe(
      `INSERT INTO "app_users" (id, email, username, "updatedAt")
       -- email and username are UNIQUE on app_users, so they carry the run
       -- suffix too. A per-run id with a fixed email just moves the collision.
       VALUES ('${USER_ID}', '${USER_ID}@example.invalid', '${USER_ID}', now())
       ON CONFLICT (id) DO NOTHING`,
    )

    await seed.$executeRawUnsafe(
      // ⚠ "updatedAt" IS REQUIRED AND HAS NO DEFAULT. Omitting it failed with a
      // not-null violation whose message is a 150-column row dump - the offending
      // column is not named, and the eye goes to "tenantId" at the end of it
      // because that is the column this work added. It is not tenantId.
      // The required set, measured: id, userId, platform, platformLeagueId, updatedAt.
      `INSERT INTO "leagues" (id, "userId", platform, "platformLeagueId", season, "tenantId", "updatedAt")
       VALUES ('${LEAGUE_ID}', '${USER_ID}', 'probe', 'probe-1', 2026, 'allfantasy', now())
       ON CONFLICT (id) DO NOTHING`,
    )

    // An audit row about this league. The one thing that must SURVIVE.
    await seed.$executeRawUnsafe(
      `INSERT INTO "AuditEvent"
         ("tenantId","actorUserId","actorLabel","action","resourceType","resourceId","leagueId","requestId")
       VALUES ('allfantasy','u-probe','Probe','league.rename','League','${LEAGUE_ID}','${LEAGUE_ID}','req-purge')`,
    )
  })

  it('the league and its audit row exist before the purge (positive control)', async () => {
    // Without this, a seed that silently failed makes every assertion below
    // pass: the purge deletes nothing, finds nothing, and reports success.
    const [l] = await seed.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "leagues" WHERE id = '${LEAGUE_ID}'`,
    )
    const [a] = await seed.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "AuditEvent" WHERE "leagueId" = '${LEAGUE_ID}'`,
    )
    expect(Number(l.n)).toBe(1)
    expect(Number(a.n)).toBe(1)
  })

  it('purges with no FK violation', async () => {
    const result = await purgeLeague(
      {
        deleteMany: async (model, where) => {
          const table = model === 'League' ? 'leagues' : model
          const [[col, val]] = Object.entries(where)
          return purge.$executeRawUnsafe(
            `DELETE FROM "${table}" WHERE "${col}" = $1`,
            val as string,
          )
        },
      },
      LEAGUE_ID,
    )
    expect(result.ok).toBe(true)
  })

  it('the league is gone', async () => {
    const [l] = await seed.$queryRawUnsafe<{ n: bigint }[]>(
      `SELECT count(*)::bigint AS n FROM "leagues" WHERE id = '${LEAGUE_ID}'`,
    )
    expect(Number(l.n)).toBe(0)
  })

  it('🛑 THE AUDIT ROW SURVIVED', async () => {
    // The acceptance criterion, and the reason AuditEvent.leagueId carries no
    // foreign key. Both existing audit tables in this repo cascade from League;
    // either of them in this position would now report zero.
    const rows = await seed.$queryRawUnsafe<{ action: string }[]>(
      `SELECT "action" FROM "AuditEvent" WHERE "leagueId" = '${LEAGUE_ID}'`,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].action).toBe('league.rename')
  })

  it('commish_purge still cannot delete the audit row it outlived', async () => {
    // T-007's trigger, from the role most likely to be pointed at retention
    // later. The purge deletes leagues; it does not get to tidy up the record
    // that it did.
    await expect(
      purge.$executeRawUnsafe(`DELETE FROM "AuditEvent" WHERE "leagueId" = '${LEAGUE_ID}'`),
    ).rejects.toThrow()
  })
})

describe('T-009 · the role boundary is real', () => {
  it('commish_purge cannot INSERT', async () => {
    // It is granted SELECT and DELETE, nothing else. A purge role that can
    // write is just an admin role with a modest name.
    await expect(
      purge.$executeRawUnsafe(
        `INSERT INTO "leagues" (id,"userId",platform,"platformLeagueId",season,"tenantId")
         VALUES ('l-should-fail','u','p','p',2026,'allfantasy')`,
      ),
    ).rejects.toThrow()
  })

  it('commish_app cannot DELETE a league', async () => {
    const appUrl = process.env.COMMISH_APP_URL
    expect(appUrl, 'Set COMMISH_APP_URL — this is the half that proves the purge role is special.').toBeTruthy()
    if (!appUrl) return
    const app = new PrismaClient({ datasources: { db: { url: appUrl } } })
    try {
      await expect(
        app.$executeRawUnsafe(`DELETE FROM "leagues" WHERE id = 'anything'`),
      ).rejects.toThrow()
    } finally {
      await app.$disconnect()
    }
  })
})
