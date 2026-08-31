/**
 * Commissioner OS · T-008 acceptance.
 *
 * "A test per constraint proving the violation is rejected. A test proving an
 * owner swap (two UPDATEs, one transaction) succeeds."
 *
 * 🛑 NOT YET RUN. Written, never executed — no non-production database is
 * available in this session (T-001 roles absent, and this project's Vercel
 * previews share the production database). Run against a Neon branch:
 *
 *     npx tsx scripts/check-staging-env.ts      # exit 1 = not safe
 *     npm run test:commissioner-os
 *
 * ⚠ IT ALSO SETTLES A CLAIM RATHER THAN ASSUMING ONE.
 * The T-008 migration asserts, from the Postgres documentation, that a partial
 * unique and a DEFERRABLE unique are mutually exclusive — and that this
 * collides with invariant 4, because a soft-deletable model's uniqueness must
 * be partial and therefore cannot be deferred. That claim is load-bearing for
 * how the owner swap gets built, and it is stated from memory of the docs. The
 * `deferrable vs partial` block below makes the database answer it.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'

const CONNECTION = process.env.COMMISH_MIGRATE_URL ?? process.env.DIRECT_URL

const SCRATCH = '_commish_t008_probe'

let db: PrismaClient

beforeAll(async () => {
  if (!CONNECTION) return
  db = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
  await db.$connect()

  // 🛑 CLEAN FIRST — THIS SUITE COULD ONLY PASS ONCE.
  // The PlatformGrant tests INSERT fixed ids (pg-probe-1..3) and rely on there
  // being no LIVE grant for ('u-probe','PLATFORM_ADMIN') at the start. On a
  // second run against the same database the partial unique index rejects the
  // seed and two tests fail — which is the index doing its job, reported as a
  // defect. Observed on the second-ever run, 2026-08-31.
  //
  // ⚠ At the START, not in afterAll: an afterAll is skipped when the process
  // dies mid-run, and the next run then inherits exactly the state that breaks
  // it. Cleaning on entry is the only version that survives a crash.
  await db.$executeRawUnsafe(`DELETE FROM "PlatformGrant" WHERE "userId" = 'u-probe'`)
})

afterAll(async () => {
  await db?.$executeRawUnsafe(`DROP TABLE IF EXISTS "${SCRATCH}"`)
  await db?.$disconnect()
})

describe('T-008 · PlatformGrant — one live grant per (user, role)', () => {
  it('has a connection string configured', () => {
    expect(CONNECTION, 'Set COMMISH_MIGRATE_URL or DIRECT_URL.').toBeTruthy()
  })

  it('the partial index exists (positive control)', async () => {
    // Without this, every rejection assertion below could pass because the
    // INSERT failed for some unrelated reason — or because the migration was
    // never applied and the table does not exist at all.
    const rows = await db.$queryRawUnsafe<{ indexname: string }[]>(
      `SELECT indexname FROM pg_indexes
        WHERE tablename = 'PlatformGrant' AND indexname = 'PlatformGrant_userId_role_live_key'`,
    )
    expect(rows, 'T-008 migration not applied').toHaveLength(1)
  })

  it('rejects a second LIVE grant for the same user and role', async () => {
    await db.$executeRawUnsafe(
      `INSERT INTO "PlatformGrant" (id,"userId","role","grantedBy")
       VALUES ('pg-probe-1','u-probe','PLATFORM_ADMIN','tester')
       ON CONFLICT DO NOTHING`,
    )
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "PlatformGrant" (id,"userId","role","grantedBy")
         VALUES ('pg-probe-2','u-probe','PLATFORM_ADMIN','tester')`,
      ),
    ).rejects.toThrow()
  })

  it('ALLOWS a re-grant after revocation', async () => {
    // The reason this is a partial index rather than @@unique. A plain unique
    // would mean a revoked grant could never be re-issued — the person is
    // locked out of a role forever by the act of having once lost it.
    await db.$executeRawUnsafe(
      `UPDATE "PlatformGrant" SET "revokedAt" = now(), "revokedBy" = 'tester' WHERE id = 'pg-probe-1'`,
    )
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "PlatformGrant" (id,"userId","role","grantedBy")
         VALUES ('pg-probe-3','u-probe','PLATFORM_ADMIN','tester')`,
      ),
    ).resolves.toBeGreaterThan(0)
  })

  it('allows the same user to hold a DIFFERENT role live', async () => {
    await expect(
      db.$executeRawUnsafe(
        `INSERT INTO "PlatformGrant" (id,"userId","role","grantedBy")
         VALUES ('pg-probe-4','u-probe','PLATFORM_SUPPORT','tester')`,
      ),
    ).resolves.toBeGreaterThan(0)
  })

  it('leaves exactly one live grant per role after all of that', async () => {
    // Read the EFFECT. A rejection that somehow still wrote is invisible to
    // rejects.toThrow(), and this is the assertion that would catch it.
    const rows = await db.$queryRawUnsafe<{ role: string; n: bigint }[]>(
      `SELECT "role", count(*)::bigint AS n FROM "PlatformGrant"
        WHERE "userId" = 'u-probe' AND "revokedAt" IS NULL GROUP BY "role"`,
    )
    for (const r of rows) expect(Number(r.n)).toBe(1)
  })
})

describe('T-008 · deferrable vs partial — settling the claim', () => {
  /**
   * The migration's central finding, put to the database.
   *
   * If BOTH of the following hold, the finding is confirmed and the owner-swap
   * design in HANDOFF.md cannot be built as written on a soft-deletable model:
   *
   *   - a UNIQUE CONSTRAINT cannot carry a WHERE clause  (so: not partial)
   *   - a UNIQUE INDEX cannot be declared DEFERRABLE     (so: not deferrable)
   */
  beforeAll(async () => {
    if (!CONNECTION) return
    await db.$executeRawUnsafe(
      `CREATE TABLE IF NOT EXISTS "${SCRATCH}" (id int primary key, k text, "deletedAt" timestamptz)`,
    )
  })

  it('a DEFERRABLE unique CONSTRAINT is accepted (positive control)', async () => {
    // Establishes that deferrable uniques work here at all. Without it, the two
    // rejections below could both be "this Postgres does not do DEFERRABLE"
    // rather than the specific incompatibility being claimed.
    await expect(
      db.$executeRawUnsafe(
        `ALTER TABLE "${SCRATCH}" ADD CONSTRAINT probe_deferrable UNIQUE (k) DEFERRABLE INITIALLY DEFERRED`,
      ),
    ).resolves.toBeDefined()
    await db.$executeRawUnsafe(`ALTER TABLE "${SCRATCH}" DROP CONSTRAINT probe_deferrable`)
  })

  it('a partial unique INDEX is accepted (positive control)', async () => {
    await expect(
      db.$executeRawUnsafe(
        `CREATE UNIQUE INDEX probe_partial ON "${SCRATCH}" (k) WHERE "deletedAt" IS NULL`,
      ),
    ).resolves.toBeDefined()
    await db.$executeRawUnsafe(`DROP INDEX probe_partial`)
  })

  it('a unique CONSTRAINT cannot be partial', async () => {
    await expect(
      db.$executeRawUnsafe(
        `ALTER TABLE "${SCRATCH}" ADD CONSTRAINT probe_both UNIQUE (k) WHERE "deletedAt" IS NULL`,
      ),
    ).rejects.toThrow()
  })

  it('a unique INDEX cannot be DEFERRABLE', async () => {
    await expect(
      db.$executeRawUnsafe(
        `CREATE UNIQUE INDEX probe_both2 ON "${SCRATCH}" (k) WHERE "deletedAt" IS NULL DEFERRABLE INITIALLY DEFERRED`,
      ),
    ).rejects.toThrow()
  })
})

describe('T-008 · the owner swap', () => {
  /**
   * The acceptance test "an owner swap (two UPDATEs, one transaction) succeeds".
   *
   * ⚠ IT IS RUN AGAINST A SCRATCH TABLE, NOT AGAINST A REAL MODEL, and that is
   * a deliberate limitation rather than a shortcut. `Membership` does not exist
   * in this repo; the real analogues (RedraftLeagueMember, Roster,
   * LeagueEntrySlot) are AllFantasy tables carrying live data and are outside
   * the Commissioner OS surface. So what this can honestly prove is the
   * MECHANISM — which of the three options in the migration's finding actually
   * works — not that any shipped constraint supports a swap.
   */
  const T = `${SCRATCH}_swap`

  beforeAll(async () => {
    if (!CONNECTION) return
    await db.$executeRawUnsafe(`DROP TABLE IF EXISTS "${T}"`)
    await db.$executeRawUnsafe(`CREATE TABLE "${T}" (id int primary key, "teamId" int not null)`)
    await db.$executeRawUnsafe(`INSERT INTO "${T}" VALUES (1, 10), (2, 20)`)
  })

  afterAll(async () => {
    await db?.$executeRawUnsafe(`DROP TABLE IF EXISTS "${T}"`)
  })

  it('two UPDATEs in one transaction FAIL against a plain unique', async () => {
    // The problem the ticket is describing. The intermediate state after the
    // first UPDATE has two rows on teamId 20, and a non-deferrable constraint
    // checks per statement.
    await db.$executeRawUnsafe(`ALTER TABLE "${T}" ADD CONSTRAINT swap_plain UNIQUE ("teamId")`)
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "${T}" SET "teamId" = 20 WHERE id = 1`)
        await tx.$executeRawUnsafe(`UPDATE "${T}" SET "teamId" = 10 WHERE id = 2`)
      }),
    ).rejects.toThrow()
    await db.$executeRawUnsafe(`ALTER TABLE "${T}" DROP CONSTRAINT swap_plain`)
  })

  it('the same two UPDATEs SUCCEED against a DEFERRABLE constraint', async () => {
    await db.$executeRawUnsafe(
      `ALTER TABLE "${T}" ADD CONSTRAINT swap_deferred UNIQUE ("teamId") DEFERRABLE INITIALLY DEFERRED`,
    )
    // ⚠ THE CALLBACK MUST RETURN SOMETHING. This asserted `.resolves.toBeDefined()`
    // on a $transaction whose callback returns void — which resolves to
    // `undefined`, so the assertion could never pass no matter how the database
    // behaved. It failed as "expected undefined to be defined" on the first real
    // run, which reads like a database problem and is not one.
    await expect(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`UPDATE "${T}" SET "teamId" = 20 WHERE id = 1`)
        await tx.$executeRawUnsafe(`UPDATE "${T}" SET "teamId" = 10 WHERE id = 2`)
        return 'committed'
      }),
    ).resolves.toBe('committed')

    const rows = await db.$queryRawUnsafe<{ id: number; teamId: number }[]>(
      `SELECT id, "teamId" FROM "${T}" ORDER BY id`,
    )
    expect(rows).toEqual([
      { id: 1, teamId: 20 },
      { id: 2, teamId: 10 },
    ])
    await db.$executeRawUnsafe(`ALTER TABLE "${T}" DROP CONSTRAINT swap_deferred`)
  })

  it('🛑 a SINGLE statement does NOT rescue the swap — option (c) is not viable', async () => {
    // Option (c) from the migration's finding, and the one worth trying first:
    // it appeared to give up neither soft delete nor atomicity, and to work under
    // a PARTIAL unique index — which a DEFERRABLE constraint cannot be.
    //
    // ⚠ IT DOES NOT WORK, AND THIS TEST USED TO ASSERT THAT IT DID. Measured on
    // the first real run, 2026-08-31:
    //
    //   ERROR: duplicate key value violates unique constraint "swap_partial"
    //   DETAIL: Key ("teamId")=(10) already exists.
    //
    // Postgres enforces a plain unique INDEX per ROW as the update walks the
    // table, not once per statement. Row 1 takes teamId 10 while row 2 still
    // holds it, and the index rejects it there and then. Only a DEFERRABLE
    // CONSTRAINT postpones the check to commit — and `DEFERRABLE` cannot be
    // applied to a partial index, which is the whole difficulty.
    //
    // 🛑 SO THE "make it deferrable" FRAMING IN HANDOFF.md IS NOT SOLVING AN
    // IMAGINARY PROBLEM, which is what the previous version of this test would
    // have concluded had it ever been run. The tension between soft-delete
    // partial uniques (invariant 4) and swap-style updates is real and unresolved;
    // it is recorded here rather than papered over by an assertion nobody checked.
    await db.$executeRawUnsafe(
      `CREATE UNIQUE INDEX swap_partial ON "${T}" ("teamId") WHERE "teamId" IS NOT NULL`,
    )
    await expect(
      db.$executeRawUnsafe(
        `UPDATE "${T}" AS m SET "teamId" = v."teamId"
           FROM (VALUES (1, 10), (2, 20)) AS v(id, "teamId")
          WHERE m.id = v.id`,
      ),
    ).rejects.toThrow(/duplicate key|already exists/i)
    await db.$executeRawUnsafe(`DROP INDEX swap_partial`)
  })
})
