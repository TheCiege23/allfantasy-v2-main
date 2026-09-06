/**
 * Draft OS contract.
 *
 * ⚠ THIS DOMAIN DECLARES ONE SOURCE, AND THE TWO IT OMITS ARE THE POINT.
 *
 * `resolveNflRedraftDraftRuntime` (deleted 2026-09-06) loaded three things. Only one is cacheable,
 * and the reasoning still governs this domain's shape, so it is kept rather than deleted with it:
 *
 *   RULES   `resolveCanonicalLeagueRules(leagueId)` — one league row plus six config reads in
 *           parallel, keyed on nothing but the league, changing a few times a season. Cacheable,
 *           and the expensive one: seven queries per resolve, which during a live draft is every
 *           poll and every pick.
 *   STATE   `buildSessionSnapshot` — changes on EVERY PICK. Other domains survive on a short TTL
 *           because their facts decay in minutes; a draft decays in seconds. No TTL is both
 *           useful and safe.
 *   POOL    `getResolvedDraftPoolForLeague(leagueId, { excludeDraftedNames })` — parameterised by
 *           the live set of drafted names. Its key LOOKS like a league id, but its result is a
 *           function of draft state, so caching on that key serves players taken seconds ago.
 *
 * Declaring sources for those two would look like better coverage and would manufacture exactly
 * the failure this codebase keeps finding — a confident answer resting on a fact that is no
 * longer true.
 *
 * 🛑 THERE IS NO DRAFT RUNTIME RESOLVER ANY MORE. `resolveNflRedraftDraftRuntime` had zero
 * invocations and was DELETED on 2026-09-06. This suite is now the ONLY importer of
 * `createDraftOsLoaders`, so the seam it pins is exercised by nothing but this file.
 *
 * ⚠ AND THE OLD WORDING HERE — "nothing imports `@/lib/draft-runtime`" — WAS TOO BROAD EVEN THEN.
 * That directory still holds `canonicalDraftRuntime.ts`, which IS imported: by
 * `lib/redraft-season-simulation/` and by `__tests__/g34-draft-runtime.test.ts`. The precise claim
 * is about the RESOLVER, never the directory. Stated so nobody reads the existence of Draft OS as
 * evidence the draft path is live, and so nobody deletes `lib/draft-runtime/` on the strength of a
 * sentence that was measuring something narrower than it said.
 */
import { describe, it, expect, vi } from 'vitest'

import { createDraftOsLoaders, draftOsSources, draftRulesSource } from '@/lib/decision-os/draft-os'
import { OS_SCOPE_LEVELS } from '@/lib/decision-os/domain-os'

function spyStore() {
  const kindsRead: string[] = []
  return {
    kindsRead,
    store: {
      read: vi.fn(async (a: { kind: string }) => {
        kindsRead.push(a.kind)
        throw new Error('relation "domain_os_facts" does not exist')
      }),
      write: vi.fn(async () => { throw new Error('relation "domain_os_facts" does not exist') }),
    },
  }
}

describe('Draft OS', () => {
  it('declares exactly ONE source, and it is the rules', () => {
    // The guard against quietly gaining a state or pool source. Adding one needs a reason why a
    // stale draft board is safe, not just a TTL — so make the count itself a decision.
    expect(draftOsSources).toHaveLength(1)
    expect(draftOsSources[0]!.kind).toBe('rules')
  })

  it('scopes rules to the league and gives them a long life', () => {
    expect(draftRulesSource.level).toBe('league')
    expect(OS_SCOPE_LEVELS).toContain(draftRulesSource.level)
    // Same 6h as Waiver OS's league entry on purpose: the same class of fact should have the same
    // lifetime across domains, or two domains' evidence cannot be compared.
    expect(draftRulesSource.ttlMs).toBe(6 * 60 * 60 * 1000)
    expect(draftRulesSource.scopeKey({ leagueId: 'lg1' })).toBe('lg1')
  })

  it('exposes only a rules loader — no state, no pool', () => {
    const l = createDraftOsLoaders({ store: spyStore().store as never })
    expect(typeof l.loadRules).toBe('function')
    expect(typeof l.drainOutcomes).toBe('function')
    // If either of these ever appears, the omission above has been undone silently.
    expect(l).not.toHaveProperty('loadState')
    expect(l).not.toHaveProperty('loadPool')
  })

  it('reads through the rules source', async () => {
    const { store, kindsRead } = spyStore()
    const l = createDraftOsLoaders({ store: store as never })
    await l.loadRules('lg1').catch(() => null)
    expect(kindsRead).toEqual(['rules'])
  })

  it('degrades to live derivation when the store is dead, and never throws', async () => {
    const { store } = spyStore()
    const l = createDraftOsLoaders({ store: store as never })
    // Same property as the other three domains: `domain_os_facts` has never been migrated, so in
    // production every read throws 42P01 and the feed must fall through rather than fail.
    await expect(l.loadRules('lg1')).resolves.toBeDefined()
    expect(store.read).toHaveBeenCalled()
  })
})
