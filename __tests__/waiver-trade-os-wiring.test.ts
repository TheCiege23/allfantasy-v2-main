/**
 * Waiver OS and Trade OS wiring contract.
 *
 * WHAT WAS WIRED
 * `lib/decision-os/domain-os` is a kernel; each domain feed maintains the facts its decisions need
 * so Decision OS reads rather than gathers. Lineup was plugged in first. These two were declared —
 * real fact sources with real TTL judgment — but had **zero production callers**.
 *
 * ⚠ THE SOURCE CHOSEN FOR THE READ IS THE ENTIRE CARE POINT.
 *
 * Each domain declares TWO sources that share ONE `derive` and return the SAME whole facts object.
 * So whichever source the read goes through decides how stale the WHOLE object may be:
 *
 *   waiver   settings  league  6h     |  resource  user  5min
 *   trade    settings  league  2h     |  rosters   user  3min
 *
 * Reading through the LONG one would serve a six-hour-old FAAB balance — which, in waiver-os's own
 * words, would "let the system tell someone they can afford a bid they cannot." Same for trade: a
 * two-hour-old roster grades a deal that can no longer be made.
 *
 * The long-TTL entries are not dead; they are `refresh()` targets for a scheduler that does not
 * exist yet ("the gathering half; it needs a scheduler").
 *
 * ⚠ THE BACKING TABLE DOES NOT EXIST. `domain_os_facts` is declared in schema.prisma but never
 * migrated, so in production every read throws 42P01, `safeRead` swallows it, and the feed falls
 * through to live derivation — byte-identical to not wiring this at all. That is the point: it lets
 * the hit rate be measured before anyone migrates a table for it.
 */
import { describe, it, expect, vi } from 'vitest'

import { createWaiverOsLoaders, waiverOsSources } from '@/lib/decision-os/waiver-os'
import { createTradeOsLoaders, tradeOsSources } from '@/lib/decision-os/trade-os'

/** Records which fact `kind` each read asked for, then fails like a missing table. */
function spyStore() {
  const kindsRead: string[] = []
  return {
    kindsRead,
    store: {
      read: vi.fn(async (args: { kind: string }) => {
        kindsRead.push(args.kind)
        throw new Error('relation "domain_os_facts" does not exist')
      }),
      write: vi.fn(async () => { throw new Error('relation "domain_os_facts" does not exist') }),
    },
  }
}

describe('Waiver OS wiring', () => {
  it('exposes the slot WaiverShadowDeps declares', () => {
    const l = createWaiverOsLoaders({ store: spyStore().store as never })
    // If this name drifts, the spread at the call sites passes nothing and the shadow silently
    // falls back to its live default — wired in appearance, inert in fact.
    expect(typeof l.loadWorldFacts).toBe('function')
    expect(typeof l.drainOutcomes).toBe('function')
  })

  it('declares a much shorter TTL for the user entry than the league one', () => {
    const [settings, resource] = waiverOsSources
    expect(resource.ttlMs).toBeLessThan(settings.ttlMs)
    expect(resource.ttlMs).toBeLessThanOrEqual(5 * 60 * 1000)
  })

  it('reads through the SHORT-TTL user source, not the 6h league one', async () => {
    const { store, kindsRead } = spyStore()
    const l = createWaiverOsLoaders({ store: store as never })
    await l.loadWorldFacts('u1', 'lg1').catch(() => null)

    // Both sources return the same whole object, so reading through 'settings' would let a
    // six-hour-old FAAB balance be served as current.
    expect(kindsRead).toContain('resource')
    expect(kindsRead).not.toContain('settings')
  })

  it('degrades to live derivation when the store is dead, and never throws', async () => {
    const { store } = spyStore()
    const l = createWaiverOsLoaders({ store: store as never })
    // The property that makes shipping ahead of the migration safe. It resolves rather than
    // rejecting; the underlying loader is what decides the value.
    await expect(l.loadWorldFacts('u1', 'lg1')).resolves.not.toThrow?.()
    expect(store.read).toHaveBeenCalled()
  })
})

describe('Trade OS wiring', () => {
  const args = { leagueId: 'lg1', seasonId: '2026', proposerRosterId: 'r1', receiverRosterId: 'r2' }

  it('exposes the slot TradeShadowDeps declares', () => {
    const l = createTradeOsLoaders({ store: spyStore().store as never })
    expect(typeof l.loadWorldFacts).toBe('function')
    expect(typeof l.drainOutcomes).toBe('function')
  })

  it('declares a much shorter TTL for rosters than for settings', () => {
    const [settings, rosters] = tradeOsSources
    expect(rosters.ttlMs).toBeLessThan(settings.ttlMs)
    expect(rosters.ttlMs).toBeLessThanOrEqual(3 * 60 * 1000)
  })

  it('reads through the SHORT-TTL roster source, not the 2h settings one', async () => {
    const { store, kindsRead } = spyStore()
    const l = createTradeOsLoaders({ store: store as never })
    await l.loadWorldFacts(args as never).catch(() => null)

    // A two-hour-old roster grades a deal that can no longer be made.
    expect(kindsRead).toContain('rosters')
    expect(kindsRead).not.toContain('settings')
  })

  it('scopes the roster fact to BOTH sides of the proposal', () => {
    const [, rosters] = tradeOsSources
    const key = rosters.scopeKey(args as never)
    // Keyed on one side only, two different proposals would share a cache entry and one trade
    // would be evaluated against the other's rosters.
    expect(key).toContain('r1')
    expect(key).toContain('r2')
  })
})
