/**
 * Commissioner OS · T-006 acceptance.
 *
 * "Tests cover every intercepted operation. One test documents the known hole —
 * a nested `include` returning soft-deleted children — with a comment pointing
 * at the service-layer filter. Don't paper over it; the same limitation is
 * load-bearing in T-102."
 *
 * "Every intercepted operation" is driven off the exported list rather than
 * written out by hand, so adding an eighth operation without a test is not
 * possible: the data-driven block would cover it, and the coverage assertion
 * would notice if the list and the extension disagreed.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  READ_DELETED_ACTION,
  SOFT_DELETE_FILTERED_OPERATIONS,
  applySoftDeleteArgs,
  assertModelsHaveDeletedAt,
  createSoftDeleteExtension,
  isIncludeDeletedScope,
  softDeletableModelsFromDmmf,
  withDeleted,
} from '@/lib/domain/softDelete'
import { createActorContext } from '@/lib/domain/actorContext'
import { ok } from '@/lib/domain/result'

const SOFT = new Set(['League', 'TenantUser'])
const isSoftDeletable = (m: string) => SOFT.has(m)

const apply = (
  operation: string,
  args: Record<string, unknown> | undefined,
  opts: { model?: string; includeDeleted?: boolean } = {},
) =>
  applySoftDeleteArgs({
    model: opts.model ?? 'League',
    operation,
    args,
    isSoftDeletable,
    includeDeleted: opts.includeDeleted ?? false,
  })

const actor = (reason?: string) => {
  const r = createActorContext({
    userId: 'u1',
    actorLabel: 'Dana',
    tenantId: 't1',
    tenantRole: 'TENANT_SUPPORT',
    ...(reason ? { reason } : {}),
  })
  if (!r.ok) throw new Error('bad fixture')
  return r.value
}

describe('T-006 · every intercepted operation', () => {
  it.each([...SOFT_DELETE_FILTERED_OPERATIONS])('%s injects deletedAt: null', (operation) => {
    expect(apply(operation, undefined)).toEqual({ where: { deletedAt: null } })
  })

  it.each([...SOFT_DELETE_FILTERED_OPERATIONS])(
    '%s preserves the caller’s own where clause',
    (operation) => {
      expect(apply(operation, { where: { phase: 'ACTIVE' } })).toEqual({
        where: { AND: [{ phase: 'ACTIVE' }, { deletedAt: null }] },
      })
    },
  )

  it.each([...SOFT_DELETE_FILTERED_OPERATIONS])('%s preserves other args', (operation) => {
    const result = apply(operation, { where: { a: 1 }, take: 10, orderBy: { id: 'asc' } })
    expect(result).toMatchObject({ take: 10, orderBy: { id: 'asc' } })
  })

  it('the extension registers a handler for exactly those operations', () => {
    // Guards the guard: if the extension and the exported list ever disagree,
    // the data-driven tests above would be asserting about operations the
    // extension never intercepts.
    const ext = createSoftDeleteExtension({ softDeletableModels: SOFT })
    expect(Object.keys(ext.query.$allModels).sort()).toEqual(
      [...SOFT_DELETE_FILTERED_OPERATIONS].sort(),
    )
  })
})

describe('T-006 · what it deliberately does NOT touch', () => {
  it('leaves deleteMany completely alone', () => {
    // 🛑 NOT AN OVERSIGHT. deleteMany is BANNED (T-005), not filtered.
    // Injecting deletedAt:null does not make it safe — it still HARD-DELETES
    // every row it matches, just fewer of them. Filtering it would produce a
    // destructive operation wearing the costume of a safe one.
    expect(apply('deleteMany', { where: { phase: 'ARCHIVED' } })).toEqual({
      where: { phase: 'ARCHIVED' },
    })
  })

  it('leaves delete alone', () => {
    expect(apply('delete', { where: { id: 'l1' } })).toEqual({ where: { id: 'l1' } })
  })

  it('leaves findUnique alone', () => {
    // findUnique's `where` accepts only unique fields, so `deletedAt` is not a
    // legal filter on it. It is structurally unfilterable, which is why T-005
    // bans it on this surface rather than trying to filter it here.
    expect(apply('findUnique', { where: { id: 'l1' } })).toEqual({ where: { id: 'l1' } })
  })

  it.each(['create', 'update', 'upsert', 'createMany'])('leaves %s alone', (operation) => {
    expect(apply(operation, { data: { name: 'x' } })).toEqual({ data: { name: 'x' } })
  })

  it('leaves models without the column alone', () => {
    expect(apply('findMany', { where: { a: 1 } }, { model: 'SportTeam' })).toEqual({
      where: { a: 1 },
    })
  })
})

describe('T-006 · AND composition, not a spread', () => {
  it('does not clobber a caller’s explicit deletedAt filter', () => {
    // A spread would silently overwrite it. AND makes the contradiction
    // explicit and empty, which is the honest outcome — the caller wanted
    // withDeleted().
    const result = apply('findMany', { where: { deletedAt: { not: null } } })
    expect(result).toEqual({
      where: { AND: [{ deletedAt: { not: null } }, { deletedAt: null }] },
    })
  })

  it('composes correctly with a top-level OR', () => {
    // The shape that makes a spread wrong: `{ OR: [...], deletedAt: null }`
    // reads correctly only by luck of Prisma's semantics.
    const result = apply('findMany', { where: { OR: [{ a: 1 }, { b: 2 }] } })
    expect(result).toEqual({
      where: { AND: [{ OR: [{ a: 1 }, { b: 2 }] }, { deletedAt: null }] },
    })
  })

  it('composes correctly with a top-level NOT', () => {
    const result = apply('findMany', { where: { NOT: { a: 1 } } })
    expect(result).toEqual({ where: { AND: [{ NOT: { a: 1 } }, { deletedAt: null }] } })
  })
})

describe('T-006 · model awareness throws', () => {
  it('throws when a listed model has no deletedAt column', () => {
    expect(() =>
      assertModelsHaveDeletedAt(new Set(['League', 'SportTeam']), (m) => m === 'League'),
    ).toThrow(/SportTeam/)
  })

  it('names every offender, not just the first', () => {
    expect(() =>
      assertModelsHaveDeletedAt(new Set(['A', 'B']), () => false),
    ).toThrow(/A, B/)
  })

  it('throws at CONSTRUCTION, not on the first query', () => {
    // A misconfiguration found at construction is a boot failure. Found on a
    // query it is intermittent, appearing only on the path that touches the bad
    // model — quite possibly in production, months later.
    expect(() =>
      createSoftDeleteExtension({
        softDeletableModels: new Set(['Nope']),
        hasDeletedAtColumn: () => false,
      }),
    ).toThrow(/Nope/)
  })

  it('accepts a set that checks out', () => {
    expect(() =>
      createSoftDeleteExtension({ softDeletableModels: SOFT, hasDeletedAtColumn: () => true }),
    ).not.toThrow()
  })
})

describe('T-006 · deriving the model set from DMMF', () => {
  const dmmf = {
    datamodel: {
      models: [
        { name: 'League', fields: [{ name: 'id' }, { name: 'deletedAt' }] },
        { name: 'SportTeam', fields: [{ name: 'id' }] },
        { name: 'TenantUser', fields: [{ name: 'deletedAt' }] },
      ],
    },
  }

  it('selects exactly the models carrying deletedAt', () => {
    expect([...softDeletableModelsFromDmmf(dmmf)].sort()).toEqual(['League', 'TenantUser'])
  })

  it('returns an empty set rather than throwing when none qualify', () => {
    const empty = softDeletableModelsFromDmmf({ datamodel: { models: [] } })
    expect(empty.size).toBe(0)
  })
})

describe('T-006 · the withDeleted escape', () => {
  const allow = async () => ok(undefined)
  const GOOD_REASON = 'Support ticket 4192: confirming what the commissioner removed.'

  it('is not active by default', () => {
    expect(isIncludeDeletedScope()).toBe(false)
  })

  it('fails closed with no authorize configured', async () => {
    // denyAll is the default. Until T-104 supplies the matrix there is no basis
    // on which to permit reading deleted data.
    const r = await withDeleted(actor(GOOD_REASON), async () => 'x')
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('FORBIDDEN')
  })

  it('requires a reason', async () => {
    const r = await withDeleted(actor(), async () => 'x', { authorize: allow })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error.code).toBe('REASON_REQUIRED')
  })

  it('rejects a placeholder reason', async () => {
    const r = await withDeleted(actor('n/a'), async () => 'x', { authorize: allow })
    expect(r.ok).toBe(false)
    if (r.ok) return
    expect(r.error).toMatchObject({ code: 'REASON_REQUIRED', problem: 'STOPLISTED' })
  })

  it('checks authorization BEFORE the reason', async () => {
    // Same ordering as the mutation wrapper: telling someone their reason is
    // too short for an action they may not take leaks which actions exist.
    const r = await withDeleted(actor(), async () => 'x')
    if (r.ok) return
    expect(r.error.code).toBe('FORBIDDEN')
  })

  it('suspends filtering inside the scope', async () => {
    const seen: boolean[] = []
    const r = await withDeleted(
      actor(GOOD_REASON),
      async () => {
        seen.push(isIncludeDeletedScope())
        return 'done'
      },
      { authorize: allow },
    )
    expect(r.ok).toBe(true)
    expect(seen).toEqual([true])
  })

  it('does not leak past the scope', async () => {
    await withDeleted(actor(GOOD_REASON), async () => 'x', { authorize: allow })
    expect(isIncludeDeletedScope()).toBe(false)
  })

  it('does not leak when the callback throws', async () => {
    await expect(
      withDeleted(
        actor(GOOD_REASON),
        async () => {
          throw new Error('boom')
        },
        { authorize: allow },
      ),
    ).rejects.toThrow('boom')
    expect(isIncludeDeletedScope()).toBe(false)
  })

  it('names the audited action', async () => {
    const authorize = vi.fn(async () => ok(undefined))
    await withDeleted(actor(GOOD_REASON), async () => 'x', { authorize })
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ requires: READ_DELETED_ACTION }),
    )
  })

  it('passes args through untouched while the scope is open', () => {
    expect(apply('findMany', { where: { a: 1 } }, { includeDeleted: true })).toEqual({
      where: { a: 1 },
    })
  })
})

describe('T-006 · THE KNOWN HOLE — nested include returns soft-deleted children', () => {
  /**
   * 🛑 THIS TEST DOCUMENTS A LIMITATION. IT IS NOT A BUG REPORT AND IT MUST NOT
   * BE "FIXED" BY MAKING THE ASSERTION PASS THE OTHER WAY.
   *
   * Prisma client extensions fire on the top-level operation and NOT on
   * included relations. So a `findMany` on League filters the leagues and
   * returns soft-deleted teams inside them.
   *
   * Until a service-layer filter exists, a query that includes children of a
   * soft-deletable model must filter them itself:
   *
   *     tx.league.findMany({
   *       include: { teams: { where: { deletedAt: null } } },
   *     })
   *
   * ⚠ THE SAME LIMITATION IS LOAD-BEARING AT T-102, WHICH IS WHY IT IS PINNED
   * HERE RATHER THAN NOTED IN A COMMENT. For soft delete the consequence is a
   * stale row in a list. For TENANCY the identical hole is one operator reading
   * another's customer data — a breach. It is the entire reason isolation rests
   * on Postgres RLS instead of on an extension like this one (TENANCY.md §2).
   */
  it('does not reach into include, and that is expected', () => {
    const args = { include: { teams: true } }
    const result = apply('findMany', args)

    // The top level IS filtered.
    expect(result).toMatchObject({ where: { deletedAt: null } })

    // The include is untouched — no `where` was added to `teams`.
    expect(result).toMatchObject({ include: { teams: true } })
  })

  it('does not reach into a nested select either', () => {
    const result = apply('findMany', { select: { id: true, teams: { select: { id: true } } } })
    expect(result).toMatchObject({ select: { teams: { select: { id: true } } } })
  })

  it('leaves an explicitly filtered include exactly as the caller wrote it', () => {
    // The workaround, pinned so a future "improvement" that rewrites nested
    // args has to break this test to land.
    const args = { include: { teams: { where: { deletedAt: null } } } }
    expect(apply('findMany', args)).toMatchObject({
      include: { teams: { where: { deletedAt: null } } },
    })
  })
})
