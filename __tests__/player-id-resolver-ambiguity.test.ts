// @vitest-environment node
/**
 * The name fallback refuses when the registry holds several people of one name.
 *
 * 🛑 THIS WAS `findFirst`, WHICH IS A COIN FLIP REPORTED AS A MATCH. When two
 * players share a normalized name the database returns whichever row it reached
 * first, and the caller receives `confidence: 'name_match'` — indistinguishable
 * from a real one. Measured on production 2026-08-31: 1,227 NCAAF normalized
 * names in `PlayerIdentityMap` are already held by more than one row, so this
 * was already arbitrary for them and had been silently.
 *
 * ⚠ AND THE WIDENING MAKES IT MUCH WORSE, WHICH IS WHY THIS LANDS ALONGSIDE IT
 * RATHER THAN AFTER. Widening the NCAAF registry from `SportsPlayer` adds rows
 * keyed on (name, team) precisely BECAUSE 4,925 colliding names are different
 * people at different schools. Adding those while `findFirst` still picks one at
 * random converts a coverage gap into confident wrong answers — and a mis-link
 * is the worse failure, because a miss shows a gap while a mis-link shows
 * another player's projection on your roster.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

const findFirst = vi.fn()
const findMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    playerIdentityMap: {
      findFirst: (...a: unknown[]) => findFirst(...a),
      findMany: (...a: unknown[]) => findMany(...a),
    },
  },
}))

import { resolveCanonicalPlayerId } from '@/lib/league-import/playerIdResolver'

beforeEach(() => {
  findFirst.mockReset()
  findMany.mockReset()
  /* No direct-id hit unless a test says so, so the name path is what runs. */
  findFirst.mockResolvedValue(null)
})

describe('the name fallback', () => {
  it('matches when exactly one row carries the name', async () => {
    findMany.mockResolvedValue([{ id: 'p1' }])
    const out = await resolveCanonicalPlayerId({
      provider: 'sleeper',
      sourceId: 'x',
      nameHint: 'Ryan Davis',
    })
    expect(out).toEqual({ canonicalId: 'p1', confidence: 'name_match' })
  })

  /**
   * 🛑 THE CENTRAL REFUSAL. Ryan Davis is 8 rows across 7 schools on production.
   */
  it('refuses when several rows carry the name, and returns no id', async () => {
    findMany.mockResolvedValue([{ id: 'p1' }, { id: 'p2' }])
    const out = await resolveCanonicalPlayerId({
      provider: 'sleeper',
      sourceId: 'x',
      nameHint: 'Ryan Davis',
    })
    expect(out.canonicalId).toBeNull()
    expect(out.confidence).toBe('ambiguous')
  })

  /**
   * ⚠ `ambiguous` IS NOT `miss`. "We hold no row for this player" wants wider
   * ingestion; "we hold several and cannot choose" wants a better discriminator.
   * Folding them together is how the second stays invisible while coverage
   * numbers merely look disappointing.
   */
  it('distinguishes ambiguous from a genuine miss', async () => {
    findMany.mockResolvedValue([])
    const out = await resolveCanonicalPlayerId({
      provider: 'sleeper',
      sourceId: 'x',
      nameHint: 'Nobody At All',
    })
    expect(out).toEqual({ canonicalId: null, confidence: 'miss' })
  })

  /**
   * ⚠ IT MUST ASK FOR MORE THAN ONE ROW. `take: 1` would make the query answer
   * "is there a match" instead of "is there exactly one", and every assertion
   * above would pass while the refusal never fired.
   */
  it('asks for two rows, so it can tell one from many', async () => {
    findMany.mockResolvedValue([{ id: 'p1' }])
    await resolveCanonicalPlayerId({ provider: 'sleeper', sourceId: 'x', nameHint: 'Ryan Davis' })
    expect(findMany.mock.calls[0]![0].take).toBeGreaterThanOrEqual(2)
  })

  /** The position hint still narrows before the count is taken. */
  it('applies the position hint to the query', async () => {
    findMany.mockResolvedValue([{ id: 'p1' }])
    await resolveCanonicalPlayerId({
      provider: 'sleeper',
      sourceId: 'x',
      nameHint: 'Ryan Davis',
      positionHint: 'wr',
    })
    expect(findMany.mock.calls[0]![0].where.position).toBe('WR')
  })

  /**
   * ⚠ A DIRECT ID STILL WINS AND MUST NOT REACH THE NAME PATH AT ALL. Ambiguity
   * among people sharing a name says nothing about a player identified by id.
   */
  it('never consults the name path when a direct id matched', async () => {
    findFirst.mockResolvedValue({ id: 'direct-1' })
    const out = await resolveCanonicalPlayerId({
      provider: 'sleeper',
      sourceId: 'sleeper-77',
      nameHint: 'Ryan Davis',
    })
    expect(out).toEqual({ canonicalId: 'direct-1', confidence: 'direct' })
    expect(findMany).not.toHaveBeenCalled()
  })

  it('does not query at all without a name hint', async () => {
    const out = await resolveCanonicalPlayerId({ provider: 'yahoo', sourceId: 'x', nameHint: null })
    expect(out.confidence).toBe('miss')
    expect(findMany).not.toHaveBeenCalled()
  })
})
