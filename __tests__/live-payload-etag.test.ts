import { describe, expect, it } from 'vitest'

import { etagMatches, livePayloadEtag } from '@/lib/live/livePayloadEtag'

/*
 * The content validator behind the /live 304.
 *
 * ⚠ THE FAILURE THIS GUARDS IS SILENT IN BOTH DIRECTIONS, WHICH IS WHY IT IS
 * TESTED AT ALL. A validator that changes when nothing changed simply never
 * produces a 304: no error, no failing test, just the full payload on every
 * 20-second poll and no way to tell from the outside that the optimisation is
 * gone. A validator that DOESN'T change when something did is worse — the
 * scoreboard freezes on stale scores while claiming to be live.
 */

const payload = {
  sport: 'NFL',
  games: [{ gameId: 'g1', home: { abbrev: 'BUF', score: 7 }, away: { abbrev: 'KC', score: 3 } }],
  fetchedAt: '2026-09-17T17:00:00.000Z',
}

describe('livePayloadEtag', () => {
  it('is stable for the same content', () => {
    expect(livePayloadEtag(payload)).toBe(livePayloadEtag(structuredClone(payload)))
  })

  it('changes when a score moves', () => {
    const moved = structuredClone(payload)
    moved.games[0]!.home.score = 10
    expect(livePayloadEtag(moved)).not.toBe(livePayloadEtag(payload))
  })

  /*
   * ⚠ `fetchedAt` IS INSIDE THE HASH ON PURPOSE. Excluding it would return 304 for
   * a payload whose feed HAD been re-read, leaving the client holding new scores
   * under an old age label. Pinned here because "hash only the interesting fields"
   * is a tempting and wrong refactor.
   */
  it('changes when only fetchedAt moves, because that is a real change', () => {
    const refetched = { ...payload, fetchedAt: '2026-09-17T17:00:20.000Z' }
    expect(livePayloadEtag(refetched)).not.toBe(livePayloadEtag(payload))
  })

  /*
   * ⚠ THE REGRESSION THIS EXISTS FOR. `JSON.stringify` emits keys in insertion
   * order, so without the canonical sort a refactor that moves one field up an
   * object literal changes every validator and silently retires the 304 for
   * everyone. Same content, different key order, same tag.
   */
  it('ignores property order', () => {
    const reordered = {
      fetchedAt: payload.fetchedAt,
      games: [{ away: { score: 3, abbrev: 'KC' }, home: { score: 7, abbrev: 'BUF' }, gameId: 'g1' }],
      sport: 'NFL',
    }
    expect(livePayloadEtag(reordered)).toBe(livePayloadEtag(payload))
  })

  /*
   * ⚠ ARRAY ORDER IS CONTENT HERE, NOT INCIDENTAL. `games` is sorted by leagues
   * affected and `lockAlerts` by kickoff, so a reordered slate is a different
   * screen and must not share a validator with the old one.
   */
  it('does NOT ignore array order', () => {
    const two = { games: [{ id: 'a' }, { id: 'b' }] }
    const flipped = { games: [{ id: 'b' }, { id: 'a' }] }
    expect(livePayloadEtag(two)).not.toBe(livePayloadEtag(flipped))
  })

  it('is quoted, as a strong validator', () => {
    expect(livePayloadEtag(payload)).toMatch(/^"[A-Za-z0-9_-]+"$/)
  })
})

describe('etagMatches', () => {
  const tag = '"abc123"'

  it('matches the tag we issued', () => {
    expect(etagMatches(tag, tag)).toBe(true)
  })

  it('does not match a different tag', () => {
    expect(etagMatches('"other"', tag)).toBe(false)
  })

  it('treats a missing header as no match', () => {
    expect(etagMatches(null, tag)).toBe(false)
    expect(etagMatches('', tag)).toBe(false)
  })

  /*
   * ⚠ `If-None-Match` IS ALLOWED TO BE A LIST, AND A PROXY MAY MAKE IT ONE. A plain
   * `===` against the raw header fails the moment anything but our single value
   * arrives — which turns every poll back into a full payload with nothing to
   * indicate it happened.
   */
  it('matches when our tag is one of several the client offers', () => {
    expect(etagMatches(`"stale", ${tag} , "older"`, tag)).toBe(true)
  })

  /* A cache may hand ours back downgraded to weak; the content is identical. */
  it('matches a weak form of our own tag', () => {
    expect(etagMatches(`W/${tag}`, tag)).toBe(true)
  })

  it('matches the wildcard, which stands for any current representation', () => {
    expect(etagMatches('*', tag)).toBe(true)
  })
})
