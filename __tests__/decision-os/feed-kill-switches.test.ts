import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * 5.3 — per-feed kill switches.
 *
 * ── 🛑 THE TWO THINGS THAT MUST BE TRUE, AND THEY PULL AGAINST EACH OTHER ───────────────────
 *   1. A kill must WORK.    Either layer can stop a feed.
 *   2. A kill must be SAID. A killed feed leaves a named gap, never a silent absence.
 *
 * And the trap underneath both: a kill switch read through `getBoolean` would treat a database
 * read ERROR as a kill order for every feed at once, because `getValue` swallows the error and
 * returns null. That is §2.20's silence failure rebuilt one layer up, in the control plane — so
 * the fail-open direction is asserted here rather than trusted.
 */

const findMany = vi.fn()
const upsert = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: { platformConfig: { findMany: (...a: unknown[]) => findMany(...a), upsert: (...a: unknown[]) => upsert(...a) } },
}))

const flagsMod = await import('@/lib/decision-os/flags')
const {
  resolveDecisionOsFeedFlags,
  invalidateDecisionOsFlagCache,
  decisionOsFeedEnvName,
  DECISION_OS_FEEDS,
} = flagsMod

const ENV_KEYS = DECISION_OS_FEEDS.map(decisionOsFeedEnvName)

beforeEach(() => {
  vi.clearAllMocks()
  invalidateDecisionOsFlagCache()
  findMany.mockResolvedValue([])
  for (const k of ENV_KEYS) delete process.env[k]
})

afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k]
  invalidateDecisionOsFlagCache()
})

describe('5.3 — polarity: absence of a kill order is not a kill order', () => {
  it('every feed is enabled when nothing is set anywhere', async () => {
    const f = await resolveDecisionOsFeedFlags()
    expect(f.killed).toEqual([])
    for (const feed of DECISION_OS_FEEDS) expect(f.enabled(feed)).toBe(true)
  })

  it('🛑 a database read failure enables everything — it must never read as "kill all"', async () => {
    // The whole reason this does not use `getBoolean`: that returns its default on a read error,
    // so a transient blip would strip every fact out of every answer with nothing saying why.
    findMany.mockRejectedValue(new Error('connection refused'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const f = await resolveDecisionOsFeedFlags()

    expect(f.killed).toEqual([])
    expect(f.enabled('marketValues')).toBe(true)
    // Fails open, but not quietly — an operator has to be able to find out the store was unreadable.
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
  })

  it('a value that is neither on nor off is not a kill', async () => {
    // "maybe", a typo, a half-written edit — none of them should take a feed down.
    findMany.mockResolvedValue([{ key: 'decision_os_feed_projections', value: 'maybe' }])
    expect((await resolveDecisionOsFeedFlags()).enabled('projections')).toBe(true)
  })

  it('accepts every ordinary spelling of off', async () => {
    for (const value of ['false', 'FALSE', ' off ', '0', 'no']) {
      invalidateDecisionOsFlagCache()
      findMany.mockResolvedValue([{ key: 'decision_os_feed_devyValues', value }])
      expect((await resolveDecisionOsFeedFlags()).enabled('devyValues')).toBe(false)
    }
  })
})

describe('5.3 — either layer can kill, neither can revive', () => {
  it('the environment alone kills, with no database row', async () => {
    process.env.DECISION_OS_FEED_MARKET_VALUES = 'off'
    const f = await resolveDecisionOsFeedFlags()
    expect(f.enabled('marketValues')).toBe(false)
    expect(f.killed).toEqual(['marketValues'])
  })

  it('the database alone kills, with no environment variable', async () => {
    findMany.mockResolvedValue([{ key: 'decision_os_feed_leagueRules', value: 'false' }])
    expect((await resolveDecisionOsFeedFlags()).enabled('leagueRules')).toBe(false)
  })

  it('🛑 an "on" in one layer does NOT undo an "off" in the other, in either direction', async () => {
    // With a precedence rule instead of an OR, an emergency kill is silently undone by a stale
    // value in the other layer and you cannot tell which layer you are fighting.
    findMany.mockResolvedValue([{ key: 'decision_os_feed_projections', value: 'true' }])
    process.env.DECISION_OS_FEED_PROJECTIONS = 'off'
    expect((await resolveDecisionOsFeedFlags()).enabled('projections')).toBe(false)

    invalidateDecisionOsFlagCache()
    findMany.mockResolvedValue([{ key: 'decision_os_feed_devyValues', value: 'false' }])
    process.env.DECISION_OS_FEED_DEVY_VALUES = 'true'
    expect((await resolveDecisionOsFeedFlags()).enabled('devyValues')).toBe(false)
  })

  it('maps camelCase feeds to SCREAMING_SNAKE env names', async () => {
    // Pinned because a call site that guesses this wrong sets a variable nothing reads, and the
    // failure is a kill switch that silently does nothing.
    expect(decisionOsFeedEnvName('marketValues')).toBe('DECISION_OS_FEED_MARKET_VALUES')
    expect(decisionOsFeedEnvName('commissionerIntelligence')).toBe('DECISION_OS_FEED_COMMISSIONER_INTELLIGENCE')
    expect(decisionOsFeedEnvName('portfolio')).toBe('DECISION_OS_FEED_PORTFOLIO')
  })
})

describe('5.3 — the read is batched and cached, because this runs per chat turn', () => {
  it('one query for nine feeds, and none at all on the next call inside the window', async () => {
    // `liveReadiness.ts`'s per-key uncached findUnique has zero callers and has never run on a hot
    // path. Nine of those inside the chat route's 3s ceiling would be nine round-trips per turn.
    await resolveDecisionOsFeedFlags()
    await resolveDecisionOsFeedFlags()
    await resolveDecisionOsFeedFlags()
    expect(findMany).toHaveBeenCalledTimes(1)
    expect(findMany.mock.calls[0]?.[0]).toMatchObject({
      where: { key: { startsWith: 'decision_os_feed_' } },
    })
  })

  it('a failed read is cached too, so a dead database is not hammered once per turn', async () => {
    findMany.mockRejectedValue(new Error('down'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await resolveDecisionOsFeedFlags()
    await resolveDecisionOsFeedFlags()
    expect(findMany).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('flipping a switch invalidates the cache, so an operator sees it immediately', async () => {
    await resolveDecisionOsFeedFlags()
    upsert.mockResolvedValue({})
    await flagsMod.setDecisionOsFeedEnabled('projections', false)
    findMany.mockResolvedValue([{ key: 'decision_os_feed_projections', value: 'false' }])
    expect((await resolveDecisionOsFeedFlags()).enabled('projections')).toBe(false)
    expect(findMany).toHaveBeenCalledTimes(2)
  })
})
