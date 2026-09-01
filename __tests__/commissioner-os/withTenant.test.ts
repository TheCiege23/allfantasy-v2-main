/**
 * Commissioner OS · T-002 acceptance — `withTenant` re-entry semantics.
 *
 * WHY THIS ONE IS `.test.ts` AND RUNS IN THE DEFAULT SUITE
 * The T-002 acceptance criteria are about the SHAPE of the nesting — "reuses
 * the outer transaction rather than opening a second connection", "a mismatched
 * inner tenantId throws TENANT_MISMATCH". Both are properties of the control
 * flow, not of Postgres, and `createWithTenant` takes the client as an argument
 * precisely so they can be asserted against a fake. No database, so it belongs
 * in CI rather than in the opt-in suite.
 *
 * The third criterion — "the session value does not survive the transaction" —
 * is a genuine Postgres behaviour and cannot be faked. It lives in
 * `withTenant.spec.ts`, which needs a live database.
 *
 * ⚠ Importing `@/lib/domain/db` does NOT connect. The client is lazy for this
 * reason; if that ever changes, this file starts opening a pool in CI.
 */

import { describe, it, expect, vi } from 'vitest'
import { createWithTenant, TenantMismatchError } from '@/lib/domain/db'

/**
 * A fake standing in for the Prisma client.
 *
 * `$executeRaw` is invoked as a TAGGED TEMPLATE, so it receives
 * (strings, ...values). Capturing `values` separately from `strings` is what
 * lets the test below prove the tenantId is BOUND rather than interpolated —
 * an assertion on the finished SQL string could not tell the difference.
 */
function makeFakeClient() {
  const boundValues: unknown[] = []
  const transactionOptions: unknown[] = []
  const txObjects: unknown[] = []

  const tx = {
    $executeRaw: (_strings: TemplateStringsArray, ...values: unknown[]) => {
      boundValues.push(...values)
      return Promise.resolve(1)
    },
  }

  const $transaction = vi.fn(async (cb: (tx: any) => Promise<unknown>, opts?: unknown) => {
    transactionOptions.push(opts)
    txObjects.push(tx)
    return cb(tx)
  })

  return { client: { $transaction }, $transaction, tx, boundValues, transactionOptions }
}

/**
 * The isolation assertion, stubbed out.
 *
 * ⚠ THIS SUITE IS ABOUT CONTROL FLOW, NOT ABOUT ISOLATION, AND THE STUB IS HOW IT SAYS SO.
 * `createWithTenant` takes the assertion as a REQUIRED argument precisely so this choice is
 * visible at every construction site. The alternative — having the guard skip itself when the
 * fake tx has no `$queryRawUnsafe` — would disable it exactly when handed something unfamiliar,
 * which is the failure the guard exists to prevent, one layer up.
 *
 * What the assertion itself does is covered in `isolationGuard.test.ts`, against every branch.
 */
const noIsolationCheck = async () => {}

describe('T-002 · withTenant', () => {
  it('opens exactly one transaction and binds the tenantId as a parameter', async () => {
    const f = makeFakeClient()
    const withTenant = createWithTenant(() => f.client as any, noIsolationCheck)

    const result = await withTenant('tenant-a', async () => 'ok')

    expect(result).toBe('ok')
    expect(f.$transaction).toHaveBeenCalledTimes(1)

    // Bound, not interpolated. `SET LOCAL` cannot take a bind parameter, which
    // is why the implementation uses set_config() — if someone "simplifies" it
    // back to string interpolation this assertion is what fails.
    expect(f.boundValues).toEqual(['tenant-a'])
  })

  it('passes the explicit timeout and maxWait', async () => {
    // Every read now sits in a transaction, so the 5s Prisma default is too
    // tight. Pinned here so a silent change to either shows up as a test diff.
    const f = makeFakeClient()
    const withTenant = createWithTenant(() => f.client as any, noIsolationCheck)

    await withTenant('tenant-a', async () => null)

    expect(f.transactionOptions[0]).toEqual({ timeout: 15_000, maxWait: 5_000 })
  })

  it('re-entry for the SAME tenant reuses the open transaction', async () => {
    // The headline acceptance criterion. A second $transaction would take a
    // second connection, which then blocks on the outer transaction's
    // SELECT … FOR UPDATE — a self-deadlock that only appears under load.
    const f = makeFakeClient()
    const withTenant = createWithTenant(() => f.client as any, noIsolationCheck)

    let outerTx: unknown
    let innerTx: unknown

    await withTenant('tenant-a', async (tx) => {
      outerTx = tx
      await withTenant('tenant-a', async (inner) => {
        innerTx = inner
      })
    })

    expect(f.$transaction, 'a nested call opened a second transaction').toHaveBeenCalledTimes(1)
    expect(innerTx, 'the inner callback got a different tx object').toBe(outerTx)

    // And the inner call must NOT re-issue set_config: it is already scoped,
    // and a second one inside the same transaction would be pure noise on the
    // hot path of every nested domain call.
    expect(f.boundValues).toEqual(['tenant-a'])
  })

  it('re-entry for a DIFFERENT tenant throws TENANT_MISMATCH', async () => {
    // Not defensive tidiness. The inner callback would run against the OUTER
    // tenant's RLS scope — reads returning the wrong tenant's rows and writes
    // landing in the wrong tenant, with no error anywhere.
    const f = makeFakeClient()
    const withTenant = createWithTenant(() => f.client as any, noIsolationCheck)

    const attempt = withTenant('tenant-a', async () => {
      return withTenant('tenant-b', async () => 'should not reach here')
    })

    await expect(attempt).rejects.toBeInstanceOf(TenantMismatchError)
    await expect(attempt).rejects.toMatchObject({ code: 'TENANT_MISMATCH' })
  })

  it('the scope does not leak past the transaction', async () => {
    // The in-process half of "the session value does not survive the
    // transaction". If AsyncLocalStorage leaked, the SECOND top-level call
    // would be treated as re-entry and silently reuse a transaction that has
    // already committed.
    const f = makeFakeClient()
    const withTenant = createWithTenant(() => f.client as any, noIsolationCheck)

    await withTenant('tenant-a', async () => null)
    await withTenant('tenant-b', async () => null)

    expect(f.$transaction, 'the second top-level call did not open its own transaction').toHaveBeenCalledTimes(2)
    expect(f.boundValues).toEqual(['tenant-a', 'tenant-b'])
  })

  it('a throw inside the callback still clears the scope', async () => {
    // A rolled-back transaction must not leave the store populated — the next
    // request on this async context would then look like re-entry into a dead
    // transaction. AsyncLocalStorage.run unwinds on throw, and this pins it.
    const f = makeFakeClient()
    const withTenant = createWithTenant(() => f.client as any, noIsolationCheck)

    await expect(
      withTenant('tenant-a', async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    await withTenant('tenant-b', async () => null)
    expect(f.$transaction).toHaveBeenCalledTimes(2)
  })

  it('refuses an empty tenantId', async () => {
    // §3.2's policies guard with nullif(current_setting(…), ''), so an empty
    // value matches NOTHING. That is safe, but it presents as "the database is
    // empty" — one of the most expensive bugs to read. Fail at the call site.
    const f = makeFakeClient()
    const withTenant = createWithTenant(() => f.client as any, noIsolationCheck)

    await expect(withTenant('', async () => null)).rejects.toThrow(/non-empty tenantId/)
    expect(f.$transaction).not.toHaveBeenCalled()
  })
})
