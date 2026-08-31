/**
 * Commissioner OS · T-004 criterion 3, against real Postgres.
 *
 * "A test proves a concurrent phase change yields `CONFLICT`, not a write
 * against a stale phase."
 *
 * `mutation.test.ts` proves the DECISION — given a row whose phase has moved,
 * the wrapper returns CONFLICT and never calls `run`. It cannot prove the
 * mechanism that makes the decision possible: that `SELECT … FOR UPDATE` in
 * `load` actually blocks the second transaction until the first commits. A
 * fake tx has no locks. Without that, the wrapper reads a phase that another
 * transaction is still free to change, and every gate below it is deciding
 * about a world that may not exist by the time the write lands — the TOCTOU bug
 * `CLAUDE.md` names.
 *
 * 🛑 NOT YET RUN. Written, never executed. It creates and drops a scratch table
 * and needs a database that is not production; this session has none (T-001
 * roles unprovisioned, and this project's Vercel previews share the production
 * database). Run it against a Neon branch:
 *
 *     npx tsx scripts/check-staging-env.ts      # exit 1 = not safe
 *     npm run test:commissioner-os
 *
 * ⚠ IT NEEDS AT LEAST TWO CONNECTIONS. With connection_limit=1 the second
 * transaction cannot even start, so the test would pass without ever
 * demonstrating a lock — the opposite of the pinning `withTenant.spec.ts`
 * needs, and worth stating because copying that file's datasource would make
 * this one vacuous.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PrismaClient } from '@prisma/client'
import { createMutationRunner } from '@/lib/domain/mutation'
import { createActorContext } from '@/lib/domain/actorContext'
import { ok } from '@/lib/domain/result'

const CONNECTION = process.env.COMMISH_APP_URL ?? process.env.DIRECT_URL ?? process.env.DATABASE_URL

const TABLE = '_commish_t004_phase_probe'

type Row = { id: string; phase: string }

let db: PrismaClient

/** A withTenant that opens a real transaction. Standing in until T-102 wires roles. */
function realWithTenant(client: PrismaClient) {
  return <T,>(tenantId: string, fn: (tx: any) => Promise<T>): Promise<T> =>
    client.$transaction(
      async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${tenantId}, true)`
        return fn(tx)
      },
      { timeout: 15_000, maxWait: 5_000 },
    )
}

const actor = () => {
  const r = createActorContext({
    userId: 'u1',
    actorLabel: 'Dana',
    tenantId: 'tenant_probe',
    tenantRole: 'TENANT_ADMIN',
  })
  if (!r.ok) throw new Error('bad fixture')
  return r.value
}

beforeAll(async () => {
  if (!CONNECTION) return
  db = new PrismaClient({ datasources: { db: { url: CONNECTION } } })
  await db.$connect()
  await db.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS "${TABLE}" (id text primary key, phase text not null)`)
  await db.$executeRawUnsafe(`INSERT INTO "${TABLE}" (id, phase) VALUES ('l1','PRESEASON')
                              ON CONFLICT (id) DO UPDATE SET phase = 'PRESEASON'`)
})

afterAll(async () => {
  // Dropped, not left behind: a stray table with a tenantId-less schema would
  // trip T-103's policy-coverage test later and read as a real finding.
  await db?.$executeRawUnsafe(`DROP TABLE IF EXISTS "${TABLE}"`)
  await db?.$disconnect()
})

describe('T-004 · concurrency against Postgres', () => {
  it('has a connection string configured', () => {
    expect(CONNECTION, 'Set COMMISH_APP_URL. Without it nothing below runs.').toBeTruthy()
  })

  it('SELECT … FOR UPDATE actually blocks a competing transaction (positive control)', async () => {
    // The control for everything else here. If FOR UPDATE does not block —
    // wrong isolation, a pooler collapsing transactions, a load() someone
    // rewrote without the lock — then the CONFLICT test below passes for the
    // wrong reason and proves nothing about races.
    const order: string[] = []

    const holder = db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT * FROM "${TABLE}" WHERE id = 'l1' FOR UPDATE`)
      order.push('A:locked')
      await new Promise((r) => setTimeout(r, 300))
      await tx.$executeRawUnsafe(`UPDATE "${TABLE}" SET phase = 'DRAFTING' WHERE id = 'l1'`)
      order.push('A:updated')
    })

    await new Promise((r) => setTimeout(r, 50))

    const waiter = db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT * FROM "${TABLE}" WHERE id = 'l1' FOR UPDATE`)
      order.push('B:locked')
    })

    await Promise.all([holder, waiter])

    // B must not have acquired the lock before A committed.
    expect(order).toEqual(['A:locked', 'A:updated', 'B:locked'])
  })

  it('a phase changed by a competing transaction yields CONFLICT', async () => {
    await db.$executeRawUnsafe(`UPDATE "${TABLE}" SET phase = 'PRESEASON' WHERE id = 'l1'`)

    const run = createMutationRunner({
      withTenant: realWithTenant(db) as any,
      authorize: async () => ok(undefined),
      writeAudit: async () => {},
    })

    let ran = false

    // A commits a phase change while B is deciding.
    const competitor = (async () => {
      await new Promise((r) => setTimeout(r, 100))
      await db.$executeRawUnsafe(`UPDATE "${TABLE}" SET phase = 'DRAFTING' WHERE id = 'l1'`)
    })()

    await new Promise((r) => setTimeout(r, 200))

    const result = await run(
      {
        action: 'league.rename',
        requires: 'league.settings.update',
        resourceType: 'League',
        load: async (tx) => {
          // The lock. Prisma's query builder cannot express FOR UPDATE, which
          // is why load() takes raw SQL — and why lib/domain/ is one of the two
          // places T-005's lint rule permits it.
          const rows = await (tx as any).$queryRawUnsafe(
            `SELECT id, phase FROM "${TABLE}" WHERE id = 'l1' FOR UPDATE`,
          )
          return (rows as Row[])[0] ?? null
        },
        phases: { of: (r: Row) => r.phase, allowed: ['PRESEASON', 'DRAFTING'] },
        run: async () => {
          ran = true
          return ok({ id: 'l1' })
        },
        audit: () => ({ action: 'league.rename', resourceType: 'League', resourceId: 'l1' }),
      },
      actor(),
      {},
      // What the caller believed when it rendered the page.
      { expectedPhase: 'PRESEASON' },
    )

    await competitor

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('CONFLICT')

    // The half that matters more than the error code: no write happened
    // against the stale phase. Note DRAFTING is in `allowed`, so without the
    // expectedPhase check this mutation would have succeeded — correctly, by
    // every rule except the one that says the caller decided about a world that
    // no longer exists.
    expect(ran).toBe(false)
  })

  it('the row is unchanged after the refused mutation', async () => {
    const rows = await db.$queryRawUnsafe<Row[]>(`SELECT id, phase FROM "${TABLE}" WHERE id = 'l1'`)
    expect(rows[0].phase).toBe('DRAFTING')
  })
})
