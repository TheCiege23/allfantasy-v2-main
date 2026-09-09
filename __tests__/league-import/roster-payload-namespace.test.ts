/**
 * Batch A.1 item 6 — the status observation must be invisible to every player-id reader.
 *
 * `Roster.playerData` is an untyped Json column read by ~66 call sites. Persisting provenance
 * there is the cheapest way to avoid a migration, and also the cheapest way to have some reader
 * treat a metadata key as a player. These are the proofs that it cannot.
 */

import { describe, expect, it } from 'vitest'

import {
  IMPORT_META_KEY,
  getRosterPlayerIds,
  isRosterContentKnown,
  mayReplaceStoredRoster,
  readRosterObservation,
  withRosterObservation,
} from '@/lib/league-import/rosterPayload'

const PLAYERS = ['4046', '6794', 'KC', '0', '00']

function basePayload() {
  return {
    players: [...PLAYERS],
    starters: ['4046', '6794'],
    reserve: [] as string[],
    taxi: [] as string[],
    lineup_sections: { starters: ['4046'], bench: ['KC'], ir: [], taxi: [], devy: [] },
    source_provider: 'sleeper',
    source_team_id: '3',
  }
}

describe('player ids are byte-equivalent before and after metadata insertion', () => {
  it('extracts exactly the same ids, in the same order', () => {
    const before = getRosterPlayerIds(basePayload())
    const after = getRosterPlayerIds(withRosterObservation(basePayload(), 'fetched'))

    expect(after).toEqual(before)
    /* Byte-equivalence, not just deep equality — an id must not be re-serialized. */
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
    expect(after).toEqual(PLAYERS)
  })

  it('does not change the roster count', () => {
    const before = getRosterPlayerIds(basePayload()).length
    const after = getRosterPlayerIds(withRosterObservation(basePayload(), 'failed')).length
    expect(after).toBe(before)
    expect(after).toBe(PLAYERS.length)
  })

  it('never surfaces the namespace key as a player id', () => {
    const ids = getRosterPlayerIds(withRosterObservation(basePayload(), 'fetched'))
    expect(ids).not.toContain(IMPORT_META_KEY)
    expect(ids.some((id) => id.includes('af_import_meta'))).toBe(false)
    expect(ids.some((id) => id.includes('rosterStatus'))).toBe(false)
    expect(ids.some((id) => id.includes('observedAt'))).toBe(false)
  })

  it('leaves every other key of the payload untouched', () => {
    const before = basePayload()
    const after = withRosterObservation(before, 'fetched')
    for (const key of Object.keys(before)) {
      expect(JSON.stringify((after as Record<string, unknown>)[key])).toBe(
        JSON.stringify((before as Record<string, unknown>)[key]),
      )
    }
  })

  it('does not mutate the payload it was handed', () => {
    /* Several callers hold the object they are about to write; a surprise mutation is invisible. */
    const original = basePayload()
    const snapshot = JSON.stringify(original)
    withRosterObservation(original, 'failed')
    expect(JSON.stringify(original)).toBe(snapshot)
  })

  it('survives an empty roster without inventing a player', () => {
    const ids = getRosterPlayerIds(withRosterObservation({ players: [] }, 'fetched_empty'))
    expect(ids).toEqual([])
  })

  it('is invisible to the LEGACY array-shaped payload path', () => {
    /* Older rosters stored a bare array; the extractor handles it and metadata never applies. */
    expect(getRosterPlayerIds(['4046', '6794'])).toEqual(['4046', '6794'])
  })
})

describe('an unknown roster cannot look healthy or empty', () => {
  it('reports content unknown for every non-authoritative status', () => {
    for (const status of ['failed', 'unauthorized', 'not_fetched', 'partial'] as const) {
      const pd = withRosterObservation({ players: [] }, status)
      expect(isRosterContentKnown(pd)).toBe(false)
      expect(mayReplaceStoredRoster(readRosterObservation(pd)?.status)).toBe(false)
    }
  })

  it('reports content KNOWN for a genuinely empty pre-draft roster', () => {
    /*
     * The distinction the whole batch exists for: identical `players: []`, opposite meanings.
     */
    const pd = withRosterObservation({ players: [] }, 'fetched_empty')
    expect(isRosterContentKnown(pd)).toBe(true)
    expect(getRosterPlayerIds(pd)).toEqual([])
  })

  it('treats a roster written before this existed as known, not unknown', () => {
    /* Defaulting the other way marks every historical roster unknown and trains readers to ignore it. */
    expect(isRosterContentKnown(basePayload())).toBe(true)
    expect(readRosterObservation(basePayload())).toBeNull()
  })

  it('keeps lastGoodAt at the previous good read on a preserved write', () => {
    const pd = withRosterObservation(
      basePayload(),
      'failed',
      new Date('2026-09-09T12:00:00.000Z'),
      '2026-09-02T00:00:00.000Z',
    )
    const obs = readRosterObservation(pd)
    expect(obs?.observedAt).toBe('2026-09-09T12:00:00.000Z')
    expect(obs?.lastGoodAt).toBe('2026-09-02T00:00:00.000Z')
  })
})

describe('the metadata survives the structural readers that touch the whole object', () => {
  it('is preserved by a spread-based edit, the shape waiver roster-utils uses', () => {
    /*
     * `waiver-wire/roster-utils` returns `{ ...playerData, lineup_sections: next }`. That
     * spread is what carries an unknown sibling forward — verified here rather than assumed,
     * because if it ever stopped, a waiver edit would silently drop the observation and the
     * roster would look known again.
     */
    const pd = withRosterObservation(basePayload(), 'failed')
    const edited = { ...pd, lineup_sections: { starters: [], bench: [], ir: [], taxi: [], devy: [] } }
    expect(isRosterContentKnown(edited)).toBe(false)
    expect(readRosterObservation(edited)?.status).toBe('failed')
  })

  it('is preserved by a record spread, the shape DispersalDraftEngine uses', () => {
    const pd = withRosterObservation(basePayload(), 'unauthorized')
    const root = { ...(pd as Record<string, unknown>) }
    expect(readRosterObservation(root)?.status).toBe('unauthorized')
    expect(getRosterPlayerIds(root)).toEqual(PLAYERS)
  })
})
