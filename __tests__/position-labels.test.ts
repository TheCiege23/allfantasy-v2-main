import { describe, expect, it } from 'vitest'

import { displayPosition, foldLongPosition, inferSlotLabel } from '@/lib/core-app/positionLabels'

/*
 * `SportsPlayer` stores long-form positions — 415 `Wide Receiver`, 216 `Running
 * Back`, 135 `Quarterback` on production — and the repo's own normalizer folds
 * abbreviations only. This was invisible while Sleeper rosters (which carry
 * abbreviations) were the only ones resolving; the moment the ESPN crosswalk
 * started resolving players, a My Team slot rendered "WIDE RECEIVER" beside
 * another reading "WR".
 */
describe('positionLabels', () => {
  it('folds the long spellings production actually stores', () => {
    expect(foldLongPosition('Wide Receiver')).toBe('WR')
    expect(foldLongPosition('Running Back')).toBe('RB')
    expect(foldLongPosition('Quarterback')).toBe('QB')
    expect(foldLongPosition('Tight End')).toBe('TE')
    expect(foldLongPosition('Place Kicker')).toBe('K')
  })

  it('is case- and whitespace-insensitive', () => {
    expect(foldLongPosition('  wide receiver ')).toBe('WR')
    expect(foldLongPosition('WIDE RECEIVER')).toBe('WR')
  })

  it('returns null when there is nothing to fold', () => {
    expect(foldLongPosition('WR')).toBeNull()
    expect(foldLongPosition('')).toBeNull()
    expect(foldLongPosition(null)).toBeNull()
  })

  /* An unfamiliar position is shown as given, not dropped — it is still
     information, and inventing a fold for it would be the guess. */
  it('shows an already-short or unknown position as-is', () => {
    expect(displayPosition('WR')).toBe('WR')
    expect(displayPosition('EDGE')).toBe('EDGE')
    expect(displayPosition(null)).toBeNull()
  })

  it('labels a slot by the folded position', () => {
    expect(inferSlotLabel('Wide Receiver', 0)).toBe('WR')
    expect(inferSlotLabel('WR', 0)).toBe('WR')
    expect(inferSlotLabel('DST', 0)).toBe('DEF')
  })

  /*
   * ⚠ THE NEUTRAL FALLBACK IS LOAD-BEARING. Naming a slot after whoever stands
   * in it names a FLEX after its occupant, and the bench check run against that
   * label then refuses every player who is in fact eligible for it.
   */
  it('falls back to a neutral slot number, never a guess', () => {
    expect(inferSlotLabel(null, 2)).toBe('SLOT 3')
    expect(inferSlotLabel('', 0)).toBe('SLOT 1')
  })
})
