import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * The card's news list, after it stopped being one feed.
 *
 * ── Why there are two sources here ──────────────────────────────────────────
 *
 * `SportsNews` is a general NFL feed whose per-player attribution is n-grams
 * lifted out of headlines. `SportsInjury` is a per-player feed whose rows carry
 * a real sentence about a named man. Measured against production 2026-09-07,
 * over the 1,663 players actually rostered in our leagues:
 *
 *   names in the feed that are real players   SportsNews 31.4%   SportsInjury 97.8%
 *   rostered players reachable                          26.2%                31.5%
 *   UNION of the two                                            42.4%
 *
 * So merging is worth +270 players who see nothing today — a 62% relative lift
 * — from a table already ingested every 30 minutes. It needs no new provider,
 * which matters because there ISN'T one: Sleeper's public API has no news
 * endpoint, TheSportsDB documents none, and Rolling Insights' `/news` 404s.
 *
 * ⚠ A BLURB HAS NO URL AND THAT IS WHY THIS IS A MERGE, NOT A REPLACEMENT.
 * `SportsInjury` has no `sourceUrl` column, so blurbs cannot be linked out.
 * `SportsNews` items can. Dropping either source loses something real.
 */

const newsFindMany = vi.fn()
const injuryFindMany = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    sportsNews: { findMany: (...a: unknown[]) => newsFindMany(...a) },
    sportsInjury: { findMany: (...a: unknown[]) => injuryFindMany(...a) },
  },
}))

const DAY = 86_400_000
const iso = (d: number) => new Date(Date.now() - d * DAY)

async function subject() {
  const mod = await import('@/lib/core-app/playerCard')
  return mod.loadPlayerBlurbs
}

beforeEach(() => {
  newsFindMany.mockReset().mockResolvedValue([])
  injuryFindMany.mockReset().mockResolvedValue([])
})
afterEach(() => vi.restoreAllMocks())

describe('loadPlayerBlurbs — per-player news from the attributed feed', () => {
  it('turns a blurb into a news item with no url, because the table has no link', async () => {
    // ⚠ CAPTURE THE DATE ONCE. `iso()` reads the clock, so calling it in the
    // fixture and again in the assertion compares two different instants — which
    // is what this test did at first, and it failed by 312ms.
    const when = iso(1)
    injuryFindMany.mockResolvedValue([
      {
        description: 'Odunze sustained an apparent right leg injury during Thursday’s practice.',
        status: 'Questionable',
        date: when,
        updatedAt: when,
        source: 'espn',
      },
    ])
    const loadPlayerBlurbs = await subject()
    const out = await loadPlayerBlurbs('9221', 'Rome Odunze', 'NFL')
    expect(out).toHaveLength(1)
    expect(out[0].title).toContain('right leg injury')
    expect(out[0].url).toBeNull()
    expect(out[0].source).toBe('espn')
    expect(out[0].publishedAt).toBe(when.toISOString())
  })

  /*
   * ⚠ A DESCRIPTION THAT ONLY ECHOES THE STATUS IS NOT NEWS. Some rows carry
   * literally the word "questionable"; as a headline that says nothing the
   * status line above it has not already said.
   */
  it('drops a blurb that is just the status echoed back', async () => {
    injuryFindMany.mockResolvedValue([
      { description: 'questionable', status: 'Questionable', date: iso(1), updatedAt: iso(1), source: 'espn' },
    ])
    const loadPlayerBlurbs = await subject()
    expect(await loadPlayerBlurbs('9221', 'Jahmyr Gibbs', 'NFL')).toHaveLength(0)
  })

  it('drops a blurb too short to be a sentence', async () => {
    injuryFindMany.mockResolvedValue([
      { description: 'IR.', status: 'IR', date: iso(1), updatedAt: iso(1), source: 'espn' },
    ])
    const loadPlayerBlurbs = await subject()
    expect(await loadPlayerBlurbs('9221', 'Jahmyr Gibbs', 'NFL')).toHaveLength(0)
  })

  /*
   * 🛑 THE SAME 14-DAY GATE AS THE DESIGNATION, FOR THE SAME REASON. One source
   * in this table is frozen — `api_sports` has 1,444 rows for rostered players
   * and none fresher than 7 days. Stale rows must not resurface as "news".
   */
  it('asks for a 14-day window', async () => {
    const before = Date.now()
    const loadPlayerBlurbs = await subject()
    await loadPlayerBlurbs('9221', 'Jahmyr Gibbs', 'NFL')
    const json = JSON.stringify(injuryFindMany.mock.calls[0][0].where)
    const gte = json.match(/"gte":"([^"]+)"/)?.[1]
    expect(gte).toBeTruthy()
    const days = (before - new Date(gte as string).getTime()) / DAY
    expect(days).toBeGreaterThan(13.99)
    expect(days).toBeLessThan(14.01)
  })

  it('matches on the sleeper id AND the name', async () => {
    const loadPlayerBlurbs = await subject()
    await loadPlayerBlurbs('9221', 'Jahmyr Gibbs', 'NFL')
    const json = JSON.stringify(injuryFindMany.mock.calls[0][0].where)
    expect(json).toContain('9221')
    expect(json).toContain('Jahmyr Gibbs')
  })

  it('de-duplicates identical sentences repeated across sources', async () => {
    const same = 'Charbonnet (knee) looks unlikely to play Sunday against the Rams.'
    injuryFindMany.mockResolvedValue([
      { description: same, status: 'Out', date: iso(1), updatedAt: iso(1), source: 'espn' },
      { description: same, status: 'Out', date: iso(2), updatedAt: iso(2), source: 'rolling_insights' },
    ])
    const loadPlayerBlurbs = await subject()
    expect(await loadPlayerBlurbs('9221', 'Zach Charbonnet', 'NFL')).toHaveLength(1)
  })

  it('returns nothing rather than throwing when the query fails', async () => {
    injuryFindMany.mockRejectedValue(new Error('db down'))
    const loadPlayerBlurbs = await subject()
    expect(await loadPlayerBlurbs('9221', 'Jahmyr Gibbs', 'NFL')).toEqual([])
  })
})

describe('mergeNewsItems — one list, newest first', () => {
  async function merge() {
    const mod = await import('@/lib/core-app/playerCard')
    return mod.mergeNewsItems
  }

  it('interleaves both sources by date, newest first', async () => {
    const mergeNewsItems = await merge()
    const out = mergeNewsItems(
      [{ title: 'Headline A', source: 'espn', url: 'https://x/1', publishedAt: iso(3).toISOString() }],
      [{ title: 'Blurb B, which is a full sentence about the man.', source: 'espn', url: null, publishedAt: iso(1).toISOString() }],
      null
    )
    expect(out.map((r) => r.title)).toEqual([
      'Blurb B, which is a full sentence about the man.',
      'Headline A',
    ])
  })

  /*
   * ⚠ THE INJURY NOTE IS ALREADY ON THE CARD, ONE BLOCK ABOVE. Repeating it as
   * the top news item wastes the most valuable row on the card saying a thing
   * the reader has just read.
   */
  it('drops a blurb identical to the designation note shown above it', async () => {
    const note = 'Charbonnet (knee) looks unlikely to play Sunday.'
    const mergeNewsItems = await merge()
    const out = mergeNewsItems(
      [],
      [{ title: note, source: 'espn', url: null, publishedAt: iso(1).toISOString() }],
      note
    )
    expect(out).toHaveLength(0)
  })

  /*
   * 🛑 THIS TEST WAS WRITTEN WRONG FIRST, AND ONLY THE MUTATION CONTROL SAID SO.
   * The original version passed a linked NEWS item and an identical unlinked
   * BLURB, and asserted the linked one survived. It did — but because news is
   * iterated first and claims the key, not because of the prefer-linked branch.
   * Deleting that branch left the test GREEN: a check that could not fail,
   * standing as coverage for logic that was never exercised.
   *
   * The branch is genuinely reachable, just not that way: two `SportsNews` rows
   * can carry the same title where the first has no `sourceUrl` and a later one
   * does. That is the case below, and deleting the branch now turns it red.
   */
  it('prefers the LINKED copy when the same headline arrives twice, unlinked first', async () => {
    const same = 'Odunze sustained an apparent right leg injury during practice.'
    const mergeNewsItems = await merge()
    const out = mergeNewsItems(
      [
        { title: same, source: 'espn', url: null, publishedAt: iso(2).toISOString() },
        { title: same, source: 'espn', url: 'https://x/1', publishedAt: iso(2).toISOString() },
      ],
      [],
      null
    )
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe('https://x/1')
  })

  /* And the ordering guarantee itself, which is what actually protects a blurb
     from displacing a linked headline. */
  it('a url-less blurb never displaces an identical linked headline', async () => {
    const same = 'Odunze sustained an apparent right leg injury during practice.'
    const mergeNewsItems = await merge()
    const out = mergeNewsItems(
      [{ title: same, source: 'espn', url: 'https://x/1', publishedAt: iso(2).toISOString() }],
      [{ title: same, source: 'espn', url: null, publishedAt: iso(2).toISOString() }],
      null
    )
    expect(out).toHaveLength(1)
    expect(out[0].url).toBe('https://x/1')
  })

  it('caps the list rather than letting one player flood it', async () => {
    const mergeNewsItems = await merge()
    const many = Array.from({ length: 9 }, (_, i) => ({
      title: `Blurb number ${i} about this particular player today.`,
      source: 'espn',
      url: null,
      publishedAt: iso(i + 1).toISOString(),
    }))
    expect(mergeNewsItems([], many, null).length).toBeLessThanOrEqual(5)
  })
})
