/**
 * R1.6 — gaps that share one cause collapse into one line.
 *
 * 🛑 MEASURED ON A LIVE PACKET: ten gap lines, eight of them the identical
 * `teams_rosters did not finish syncing` — one per context slice depending on that scope.
 * Every line was correct; the repetition is the defect. A prompt that says the same sentence
 * eight times teaches a reader to skim the gap block, which is how the one gap that matters
 * gets missed.
 *
 * The collapse must shorten the prompt WITHOUT removing information: every affected slice
 * name still has to appear, because "which facts must I decline on" is the entire job of that
 * block.
 */
import { describe, it, expect } from 'vitest'

import { collapseGapsByCause } from '@/lib/decision-os/grounding/serialize'

const notSynced = (slice: string) => ({
  slice,
  reason: 'not_synced',
  detail: 'teams_rosters did not finish syncing.',
  remedy: 'It retries automatically on the next sync; a manual refresh will also pick it up.',
})

describe('R1.6 · collapseGapsByCause', () => {
  it('🛑 eight slices blocked by one cause become ONE entry naming all eight', () => {
    const gaps = ['rosters', 'matchup', 'standings', 'waivers', 'trades', 'lineup', 'values', 'devy'].map(notSynced)
    const out = collapseGapsByCause(gaps)

    expect(out).toHaveLength(1)
    expect(out[0].slices).toHaveLength(8)
  })

  it('loses no slice name — every blocked fact is still listed', () => {
    const names = ['rosters', 'matchup', 'standings']
    const out = collapseGapsByCause(names.map(notSynced))
    expect(out[0].slices).toEqual(names)
  })

  it('a single-slice gap stays a single entry, so the common case is unchanged', () => {
    const out = collapseGapsByCause([notSynced('rosters')])
    expect(out).toHaveLength(1)
    expect(out[0].slices).toEqual(['rosters'])
  })

  /**
   * ⚠ THE GUARD THAT KEEPS THIS SAFE. Grouping on `detail` alone would merge two slices blocked
   * for different reasons and attach one slice's remedy to the other's problem — a confidently
   * wrong fix, which is worse than a repetitive right one.
   */
  it('🛑 identical detail with a DIFFERENT remedy does not merge', () => {
    const out = collapseGapsByCause([
      { slice: 'a', reason: 'not_synced', detail: 'Same words.', remedy: 'Fix one.' },
      { slice: 'b', reason: 'not_synced', detail: 'Same words.', remedy: 'Fix two.' },
    ])
    expect(out).toHaveLength(2)
  })

  it('identical detail with a different REASON does not merge either', () => {
    const out = collapseGapsByCause([
      { slice: 'a', reason: 'not_synced', detail: 'Same words.', remedy: 'Same fix.' },
      { slice: 'b', reason: 'no_producer', detail: 'Same words.', remedy: 'Same fix.' },
    ])
    expect(out).toHaveLength(2)
    expect(out.map((g) => g.reason)).toEqual(['not_synced', 'no_producer'])
  })

  it('distinct causes are all preserved, in first-occurrence order', () => {
    const out = collapseGapsByCause([
      notSynced('rosters'),
      { slice: 'devy', reason: 'no_producer', detail: 'No devy model for NFL.', remedy: 'Nothing to fix.' },
      notSynced('matchup'),
    ])
    expect(out).toHaveLength(2)
    expect(out[0].slices).toEqual(['rosters', 'matchup'])
    expect(out[1].slices).toEqual(['devy'])
  })

  it('is deterministic — the same packet renders the same order every time', () => {
    const gaps = [
      notSynced('b'),
      { slice: 'a', reason: 'no_producer', detail: 'X.', remedy: 'Y.' },
      notSynced('c'),
    ]
    expect(collapseGapsByCause(gaps)).toEqual(collapseGapsByCause(gaps))
  })

  /**
   * A separator-joined key would merge these two, because "a|b" + "c" and "a" + "b|c" collide.
   * JSON.stringify cannot.
   */
  it('a separator character inside a detail cannot merge two different causes', () => {
    const out = collapseGapsByCause([
      { slice: 'one', reason: 'not_synced', detail: 'x', remedy: 'y|z' },
      { slice: 'two', reason: 'not_synced', detail: 'x|y', remedy: 'z' },
    ])
    expect(out).toHaveLength(2)
  })

  it('the same slice repeated under one cause is listed once', () => {
    const out = collapseGapsByCause([notSynced('rosters'), notSynced('rosters')])
    expect(out[0].slices).toEqual(['rosters'])
  })

  it('an empty gap list collapses to nothing', () => {
    expect(collapseGapsByCause([])).toEqual([])
  })
})
