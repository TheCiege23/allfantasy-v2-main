import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'

/*
 * The /core depth paywall (lib/core-app/coreDepthAccess.ts) — the rule, the plan mapping, and the
 * two response filters that withhold paid depth on the server.
 *
 * Owner's decisions, 2026-09-24: creating, importing and running leagues stays free; the depth on
 * Player Finder and the Trade Center is AF Pro and the Commissioner hub's depth is AF Commissioner,
 * from the October 15 paywall launch. Before launch everything is open and says "Free until".
 */

const resolveSnapshot = vi.hoisted(() => vi.fn())
vi.mock('@/lib/subscription/EntitlementResolver', () => ({
  EntitlementResolver: class {
    resolveSnapshot = resolveSnapshot
  },
}))

import { CORE_DEPTH, decideCoreDepth, formatPaywallDay, type CoreDepth } from '@/lib/core-app/coreDepthAccess'
import { resolveCorePaywall, resolveCoreDepth } from '@/lib/core-app/corePaywall'
import { hasFeatureAccessForPlans } from '@/lib/subscription/feature-access'
import { DEFAULT_PAYWALL_STARTS_AT } from '@/lib/monetization/paywallLaunch'
import {
  applyTradeAnalysisDepth,
  SEPARATELY_GATED_FIELDS,
  TRADE_DEPTH_FIELDS,
  TRADE_VERDICT_FIELDS,
} from '@/lib/trade-value-console/tradeAnalysisDepth'
import { applyPlayerCardDepth } from '@/lib/core-app/playerCardDepth'
import type { PlayerCardData } from '@/lib/core-app/playerCard'

const BEFORE = new Date('2026-10-01T12:00:00.000Z')
const AFTER = new Date('2026-10-20T12:00:00.000Z')
const DEPTHS: CoreDepth[] = ['player_depth', 'trade_depth', 'commissioner_depth', 'competitive_edge']

const locked = (depth: CoreDepth) => decideCoreDepth(depth, { live: true, startsAt: DEFAULT_PAYWALL_STARTS_AT, hasPlan: false })
const open = (depth: CoreDepth) => decideCoreDepth(depth, { live: true, startsAt: DEFAULT_PAYWALL_STARTS_AT, hasPlan: true })

describe('the rule', () => {
  it('before launch everything is open, and says so only to the people who will lose it', () => {
    const noPlan = decideCoreDepth('player_depth', { live: false, startsAt: DEFAULT_PAYWALL_STARTS_AT, hasPlan: false })
    expect(noPlan).toMatchObject({ unlocked: true, preLaunchFree: true, hasPlan: false })
    const withPlan = decideCoreDepth('player_depth', { live: false, startsAt: DEFAULT_PAYWALL_STARTS_AT, hasPlan: true })
    expect(withPlan).toMatchObject({ unlocked: true, preLaunchFree: false })
  })

  it('after launch the plan decides, and nobody is told "free until"', () => {
    expect(locked('trade_depth')).toMatchObject({ unlocked: false, preLaunchFree: false })
    expect(open('trade_depth')).toMatchObject({ unlocked: true, preLaunchFree: false })
  })

  it('names the launch day in US Eastern — midnight Oct 15 ET is still Oct 14 in UTC-minus-anything', () => {
    expect(formatPaywallDay(DEFAULT_PAYWALL_STARTS_AT.toISOString())).toBe('Oct 15')
    expect(formatPaywallDay('not a date')).toBe('')
  })

  it('sends each lock to the plan that actually opens it', () => {
    expect(CORE_DEPTH.player_depth).toMatchObject({ planName: 'AF Pro', upgradePath: '/upgrade?plan=pro' })
    expect(CORE_DEPTH.trade_depth).toMatchObject({ planName: 'AF Pro', upgradePath: '/upgrade?plan=pro' })
    expect(CORE_DEPTH.commissioner_depth).toMatchObject({
      planName: 'AF Commissioner',
      upgradePath: '/upgrade?plan=commissioner',
    })
    expect(CORE_DEPTH.competitive_edge).toMatchObject({ planName: 'AF Pro', upgradePath: '/upgrade?plan=pro' })
  })
})

/*
 * 🛑 THE FEATURE IDS ARE CHECKED AGAINST THE REAL ENTITLEMENT MATRIX, NOT RESTATED. A lock that
 * names "AF Pro" while its feature id is only in the Commissioner plan would charge a Pro buyer and
 * keep the door shut — and nothing else in the repo would notice.
 */
describe('the plan mapping, read through the real entitlement matrix', () => {
  const opens = (plans: string[], depth: CoreDepth) =>
    hasFeatureAccessForPlans(plans as never, 'active', CORE_DEPTH[depth].featureId)

  it('AF Pro opens player and trade depth, not the commissioner depth', () => {
    expect(opens(['pro'], 'player_depth')).toBe(true)
    expect(opens(['pro'], 'trade_depth')).toBe(true)
    expect(opens(['pro'], 'commissioner_depth')).toBe(false)
  })

  it('AF Commissioner opens the commissioner depth, not Pro depth', () => {
    expect(opens(['commissioner'], 'commissioner_depth')).toBe(true)
    expect(opens(['commissioner'], 'player_depth')).toBe(false)
    expect(opens(['commissioner'], 'trade_depth')).toBe(false)
    expect(opens(['commissioner'], 'competitive_edge')).toBe(false)
  })

  it('Competitive Edge opens for AF Pro AND the War Room plan — which does not get the trade breakdown', () => {
    expect(opens(['pro'], 'competitive_edge')).toBe(true)
    expect(opens(['war_room'], 'competitive_edge')).toBe(true)
    expect(opens(['war_room'], 'trade_depth')).toBe(false)
  })

  it('Supreme opens everything; no plan opens nothing', () => {
    for (const d of DEPTHS) {
      expect(opens(['supreme'], d)).toBe(true)
      expect(opens([], d)).toBe(false)
    }
  })

  it('a lapsed subscription opens nothing', () => {
    expect(hasFeatureAccessForPlans(['pro'], 'expired' as never, CORE_DEPTH.player_depth.featureId)).toBe(false)
  })
})

describe('resolveCorePaywall — one plan read per render', () => {
  // BEFORE and AFTER are relative to the DEFAULT start; an exported AF_PAYWALL_STARTS_AT would move it.
  beforeAll(() => {
    vi.stubEnv('AF_PAYWALL_STARTS_AT', '')
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })
  /*
   * ⚠ NO beforeEach RESET. Measured on this vitest: with a `mockReset`/`mockClear` in beforeEach,
   * a later implementation that rejects is reported as a failure of that test AND the next one,
   * although the code under test catches it (it logs, and returns locked). Without the hook the
   * same assertions pass. Each test sets its own implementation, and call counts are read as deltas.
   */

  it('before launch, a viewer without a plan sees everything, marked free-until', async () => {
    resolveSnapshot.mockResolvedValue({ plans: [], status: 'none' })
    const paywall = await resolveCorePaywall('u1', { now: BEFORE })
    for (const d of DEPTHS) expect(paywall[d]).toMatchObject({ unlocked: true, preLaunchFree: true })
  })

  it('after launch, AF Pro opens Pro depth and leaves the commissioner depth locked', async () => {
    resolveSnapshot.mockResolvedValue({ plans: ['pro'], status: 'active' })
    const before = resolveSnapshot.mock.calls.length
    const paywall = await resolveCorePaywall('u1', { now: AFTER })
    expect(paywall.player_depth.unlocked).toBe(true)
    expect(paywall.trade_depth.unlocked).toBe(true)
    expect(paywall.commissioner_depth.unlocked).toBe(false)
    // One read for all three depths.
    expect(resolveSnapshot.mock.calls.length - before).toBe(1)
  })

  it('passes the email through, which is how admin and QA accounts bypass', async () => {
    resolveSnapshot.mockResolvedValue({ plans: [], status: 'none' })
    await resolveCorePaywall('u1', { email: 'qa@example.com', now: AFTER })
    expect(resolveSnapshot.mock.calls.at(-1)).toEqual(['u1', 'qa@example.com'])
  })

  it('🛑 after launch a failed plan read LOCKS (fail closed), it does not open', async () => {
    resolveSnapshot.mockImplementation(async () => {
      throw new Error('db down')
    })
    const paywall = await resolveCorePaywall('u1', { now: AFTER })
    for (const d of DEPTHS) expect(paywall[d].unlocked).toBe(false)
  })

  it('signed out: no read at all, locked after launch and open before', async () => {
    const before = resolveSnapshot.mock.calls.length
    expect((await resolveCoreDepth(null, 'player_depth', { now: AFTER })).unlocked).toBe(false)
    expect((await resolveCoreDepth(null, 'player_depth', { now: BEFORE })).unlocked).toBe(true)
    expect(resolveSnapshot.mock.calls.length).toBe(before)
  })
})

describe('the trade analysis filter — the verdict stays, the breakdown goes', () => {
  const FULL: Record<string, unknown> = Object.fromEntries(
    [...TRADE_VERDICT_FIELDS, ...TRADE_DEPTH_FIELDS].map((k) => [k, `value-of-${k}`]),
  )

  it('locked: every depth field is gone and every verdict field is untouched', () => {
    const out = applyTradeAnalysisDepth(FULL, locked('trade_depth')) as Record<string, unknown>
    for (const k of TRADE_DEPTH_FIELDS) expect(out, k).not.toHaveProperty(k)
    for (const k of TRADE_VERDICT_FIELDS) expect(out[k], k).toBe(`value-of-${k}`)
    expect(out.depth).toMatchObject({ unlocked: false, planName: 'AF Pro' })
  })

  it('open: nothing is withheld', () => {
    const out = applyTradeAnalysisDepth(FULL, open('trade_depth')) as Record<string, unknown>
    for (const k of [...TRADE_VERDICT_FIELDS, ...TRADE_DEPTH_FIELDS]) expect(out[k], k).toBe(`value-of-${k}`)
  })

  it('the three lists do not overlap', () => {
    const depth = new Set<string>(TRADE_DEPTH_FIELDS)
    const own = new Set<string>(SEPARATELY_GATED_FIELDS)
    expect(TRADE_VERDICT_FIELDS.filter((k) => depth.has(k) || own.has(k))).toEqual([])
    expect(TRADE_DEPTH_FIELDS.filter((k) => own.has(k))).toEqual([])
  })

  it('a separately gated field passes the trade filter untouched, even when trade depth is locked', () => {
    const out = applyTradeAnalysisDepth({ ...FULL, competitiveEdge: 'edge' }, locked('trade_depth')) as Record<string, unknown>
    expect(out.competitiveEdge).toBe('edge')
  })

  /*
   * 🛑 A DROP-LIST LEAKS WHATEVER IS ADDED LATER. Every key the analysis returns, and every note
   * group the route merges in, must be on one of the two lists — a new field has to be classified
   * on purpose, or this goes red.
   */
  it('🛑 every field the route can return is classified as verdict or depth', () => {
    // CRLF-normalised: a Windows checkout with autocrlf would otherwise match nothing below.
    const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
    const src = read('lib/trade-value-console/runTradeConsoleAnalysis.ts')
    const block = src.slice(src.lastIndexOf('  return {\n    ok: true,'))
    const body = block.slice(0, block.indexOf('\n  }\n'))
    const returned = [...body.matchAll(/^ {4}([A-Za-z]+)(?:,|:)/gm)].map((m) => m[1]!)
    // Positive control — the scan is reading the analysis's own return object.
    expect(returned).toContain('fairnessScore')
    expect(returned).toContain('tradeIntelligence')
    expect(returned.length).toBeGreaterThan(25)

    const notes = read('app/api/trade-value/analyze/route.ts')
    const empty = notes.slice(notes.indexOf('const EMPTY_CONTEXT'), notes.indexOf('}', notes.indexOf('const EMPTY_CONTEXT')))
    const noteKeys = [...empty.matchAll(/^ {2}([A-Za-z]+):/gm)].map((m) => m[1]!)
    expect(noteKeys).toContain('formatNotes')

    const known = new Set<string>([...TRADE_VERDICT_FIELDS, ...TRADE_DEPTH_FIELDS, ...SEPARATELY_GATED_FIELDS])
    // Every key the ROUTE adds on top of the analysis — read from its own spreads, not restated.
    const routeAdded = [...notes.matchAll(/\{ \.\.\.\w+, (\w+) \}/g)].map((m) => m[1]!)
    expect(routeAdded).toEqual(expect.arrayContaining(['aiLimit', 'decisionOs', 'competitiveEdge']))
    const unclassified = [...returned, ...noteKeys, ...routeAdded].filter((k) => !known.has(k))
    expect(unclassified).toEqual([])
  })
})

describe('the player card filter — reference stays, market and history go', () => {
  const CARD = {
    context: 'league',
    player: { name: 'Dalton Kincaid' },
    bio: {},
    market: {
      available: true,
      data: { value: 6840, overallRank: 40, positionRank: 6, delta: { change: 310, days: 14 }, format: 'dynasty', qbFormat: 'sf', source: 'fc', capturedAt: '2026-09-20' },
    },
    ownership: { available: false, reason: 'n/a' },
    schedule: { available: false, reason: 'n/a' },
    byeWeek: 7,
    trades: { available: true, data: [{ transactionId: 't1' }] },
    comps: { available: true, data: [{ sleeperId: '9', name: 'Kyle Pitts', position: 'TE', value: 6700 }] },
    news: { available: true, data: [{ title: 'Kincaid limited', source: 'x', url: null, publishedAt: null }] },
    injury: { available: true, data: { status: 'QUESTIONABLE', note: null, bodyPart: null, reportedAt: null, source: 'x' } },
    injuryFeed: { available: false, reason: 'n/a' },
    insight: { headline: 'Up 310 in 14 days', detail: 'd', basis: 'b' },
    league: {
      leagueId: 'L1',
      trades: [{ transactionId: 'lt1' }],
      price: { available: true, data: { value: 7000, mode: 'dynasty', numQbs: 2, teams: 12 } },
      playoffSchedule: { available: true, data: { weeks: [], startWeek: 15 } },
    },
  } as unknown as PlayerCardData

  it('locked: the price move, trades, comps and insight are withheld, and the sections say why', () => {
    const out = applyPlayerCardDepth(CARD, locked('player_depth'))
    expect(out.market.available && out.market.data.delta).toBeNull()
    expect(out.market.available && out.market.data.value).toBe(6840)
    expect(out.trades).toEqual({ available: false, reason: 'Trade history is part of AF Pro.' })
    expect(out.comps).toEqual({ available: false, reason: 'Similar-price players are part of AF Pro.' })
    expect(out.insight).toBeNull()
    expect(out.league?.trades).toEqual([])
    expect(out.depth?.unlocked).toBe(false)
  })

  it('locked: the reference card — news, injury, league price, playoff fixtures — is untouched', () => {
    const out = applyPlayerCardDepth(CARD, locked('player_depth'))
    expect(out.news).toBe(CARD.news)
    expect(out.injury).toBe(CARD.injury)
    expect(out.league?.price).toBe(CARD.league?.price)
    expect(out.league?.playoffSchedule).toBe(CARD.league?.playoffSchedule)
  })

  it('open: nothing is withheld', () => {
    const out = applyPlayerCardDepth(CARD, open('player_depth'))
    expect({ ...out, depth: undefined }).toEqual({ ...CARD, depth: undefined })
    expect(out.depth?.unlocked).toBe(true)
  })
})

/*
 * 🛑 THE LOADERS ARE THE GATE; THE LOCK CARDS ONLY DECIDE WHAT IS DRAWN. The /core page, the player
 * detail loader and the hub loader are database-bound with no harness in this repo, so these read
 * their source. Each guard is the SHAPE "this paid read sits behind the depth check", plus a count
 * of the paid call sites — so a second, unguarded call cannot be added beside a guarded one.
 */
describe('the loaders skip what a locked viewer may not see', () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8').replace(/\r\n/g, '\n')
  /** The text of the statement that begins with `start`, up to and including the call `call`. */
  const guardOf = (src: string, start: string, call: string) => {
    const at = src.indexOf(start)
    expect(at, `${start} not found`).toBeGreaterThan(-1)
    const end = src.indexOf(call, at)
    expect(end, `${call} not found after ${start}`).toBeGreaterThan(at)
    return src.slice(at, end)
  }
  const count = (src: string, needle: string) => src.split(needle).length - 1

  const PAGE = read('app/core/(shell)/[[...screen]]/page.tsx')

  it('/core Player Finder: compare, trade visual, windows and presence each wait on player depth', () => {
    expect(guardOf(PAGE, 'const playerCompare =', 'getPlayerDetail(vsRef')).toContain('playerDepthOpen')
    expect(guardOf(PAGE, 'const playerTradeVisual =', 'getPlayerTradeVisual(')).toContain('playerDepthOpen')
    expect(guardOf(PAGE, 'const otherLeagueIds =', '? playerDetail.leagues.data')).toContain('playerDepthOpen')
    expect(guardOf(PAGE, 'const presenceLeagueId =', 'return null')).toContain('!playerDepthOpen')
    // The pickups are withheld inside the detail loader, which the page tells.
    expect(guardOf(PAGE, 'const playerDetail =', '.catch(')).toContain('includeMoves: playerDepthOpen')
  })

  it('/core Player Finder: no paid read exists outside those guarded statements', () => {
    expect(count(PAGE, 'getPlayerTradeVisual(')).toBe(1)
    // One from the cross-league windows, one from the single-league presence.
    expect(count(PAGE, 'getManagerPresence(')).toBe(2)
    // The detail itself, and the compare.
    expect(count(PAGE, 'getPlayerDetail(')).toBe(2)
  })

  it('/core: the hub and the Trade Center are handed their depth', () => {
    expect(guardOf(PAGE, 'const commissionerHub =', '.catch(')).toContain('depth: corePaywall?.commissioner_depth')
    expect(PAGE).toContain('depthAccess={corePaywall?.trade_depth ?? null}')
    // Competitive Edge's own depth — without it the Trade Center could never draw its lock.
    expect(PAGE).toContain('edgeAccess={corePaywall?.competitive_edge ?? null}')
    expect(PAGE).toContain('depthAccess={corePaywall?.player_depth ?? null}')
  })

  it('the player detail loader computes no pickups when told not to', () => {
    const src = read('lib/core-app/playerFinder.ts')
    expect(guardOf(src, 'const moveLeagues =', '.filter((l) => l.isYours)')).toContain('includeMoves &&')
    expect(count(src, 'resolveReplacementOptions(')).toBe(1)
  })

  it('the hub loader skips the waiver read and the calendar export when locked', () => {
    const src = read('lib/core-app/commissionerHub.ts')
    expect(guardOf(src, 'depthOpen\n', 'getCommissionerWaiverOversight(')).toMatch(/^depthOpen\n\s*\?\s*$/)
    expect(guardOf(src, 'const ics = depthOpen', 'buildIcs(')).toBeTruthy()
    expect(count(src, 'getCommissionerWaiverOversight(')).toBe(1)
    expect(count(src, 'buildIcs(')).toBe(1)
  })

  it('the public player page applies the same player-depth rule when someone is signed in', () => {
    const src = read('app/players/[slug]/page.tsx')
    // The page's own read — the metadata read above it is signed out and per-league-free.
    expect(guardOf(src, 'getPlayerDetail(identity.playerReference, leagueIds', '.catch(')).toContain(
      'includeMoves: playerDepth?.unlocked !== false',
    )
    expect(src).toContain('depthAccess={playerDepth}')
  })
})
