import { describe, expect, it } from 'vitest'

import { idpPositionGroup, isIdpPosition, shortIdpPosition } from '@/lib/core-app/scoringNotes'

/**
 * The position label a defender's rank is printed against.
 *
 * 🛑 THE BUG, SEEN ON A REAL BOARD. The Defense Hub printed `${player.position}${rank}`, and
 * `SportsPlayer.position` carries whatever spelling that row holds — so KBFL showed `CB78`,
 * `DB81` and `Cornerback80` in one column. All three are the same ranking; `Cornerback80`
 * names a cornerback-specific board that does not exist, because ranks are computed per GROUP.
 *
 * ⚠ `normalizePositionForSport` in lib/team-abbrev.ts folds CB/S -> DB and is NOT sufficient:
 * its table is abbreviations only, so long forms fall through `|| upper` unchanged. That is
 * precisely how `Cornerback` reached the screen, and it is why this fold lives beside the
 * long-form set rather than in the abbreviation table.
 */
describe('idpPositionGroup', () => {
  it('folds every abbreviation to its group', () => {
    for (const p of ['LB', 'ILB', 'OLB', 'MLB']) expect(idpPositionGroup(p)).toBe('LB')
    for (const p of ['DL', 'DE', 'DT', 'NT']) expect(idpPositionGroup(p)).toBe('DL')
    for (const p of ['DB', 'CB', 'S', 'SS', 'FS']) expect(idpPositionGroup(p)).toBe('DB')
  })

  /** 🛑 THE REGRESSION. Every one of these reached a real board as its own label. */
  it('folds the long-form spellings the player cache actually stores', () => {
    expect(idpPositionGroup('Cornerback')).toBe('DB')
    expect(idpPositionGroup('Safety')).toBe('DB')
    expect(idpPositionGroup('Free Safety')).toBe('DB')
    expect(idpPositionGroup('Strong Safety')).toBe('DB')
    expect(idpPositionGroup('Defensive Back')).toBe('DB')
    expect(idpPositionGroup('Linebacker')).toBe('LB')
    expect(idpPositionGroup('Outside Linebacker')).toBe('LB')
    expect(idpPositionGroup('Inside Linebacker')).toBe('LB')
    expect(idpPositionGroup('Middle Linebacker')).toBe('LB')
    expect(idpPositionGroup('Defensive End')).toBe('DL')
    expect(idpPositionGroup('Defensive Tackle')).toBe('DL')
    expect(idpPositionGroup('Defensive Lineman')).toBe('DL')
    expect(idpPositionGroup('Nose Tackle')).toBe('DL')
    expect(idpPositionGroup('Edge Rusher')).toBe('DL')
  })

  it('is case and whitespace insensitive, like the vocabulary it mirrors', () => {
    expect(idpPositionGroup('  cornerback ')).toBe('DB')
    expect(idpPositionGroup('lb')).toBe('LB')
  })

  it('returns null for offence rather than guessing a group', () => {
    for (const p of ['QB', 'RB', 'WR', 'TE', 'K', 'Quarterback', '', null, undefined]) {
      expect(idpPositionGroup(p)).toBeNull()
    }
  })

  /**
   * ⚠ MUST COVER EVERY POSITION THE BOARD ACCEPTS. `isIdpPosition` decides who is ranked; if it
   * admits a spelling this cannot fold, that player gets a rank printed against a raw label
   * again — the exact bug, reintroduced through the back door.
   */
  it('folds every spelling isIdpPosition admits', () => {
    const admitted = [
      'DL', 'DE', 'DT', 'LB', 'ILB', 'OLB', 'MLB', 'DB', 'CB', 'S', 'SS', 'FS',
      'LINEBACKER', 'OUTSIDE LINEBACKER', 'INSIDE LINEBACKER', 'MIDDLE LINEBACKER',
      'CORNERBACK', 'SAFETY', 'FREE SAFETY', 'STRONG SAFETY', 'DEFENSIVE BACK',
      'DEFENSIVE END', 'DEFENSIVE TACKLE', 'DEFENSIVE LINEMAN', 'EDGE RUSHER', 'NOSE TACKLE',
    ]
    for (const p of admitted) {
      expect(isIdpPosition(p), `${p} should be admitted`).toBe(true)
      expect(idpPositionGroup(p), `${p} should fold to a group`).not.toBeNull()
    }
  })

  /**
   * IDP_FLEX is a roster SLOT, not a player position. It is admitted by `isIdpPosition`
   * because slot lists are checked with the same predicate, but no player carries it, so it
   * correctly folds to nothing.
   */
  it('does not invent a group for the IDP_FLEX slot', () => {
    expect(idpPositionGroup('IDP_FLEX')).toBeNull()
  })
})

describe('shortIdpPosition', () => {
  it('abbreviates the long forms so one column spells them one way', () => {
    expect(shortIdpPosition('Cornerback')).toBe('CB')
    expect(shortIdpPosition('Defensive End')).toBe('DE')
    expect(shortIdpPosition('Outside Linebacker')).toBe('OLB')
  })

  /** Keeps CB and S distinct — the group rank is beside it, so the column can afford detail. */
  it('does not collapse specific positions into their group', () => {
    expect(shortIdpPosition('CB')).toBe('CB')
    expect(shortIdpPosition('S')).toBe('S')
    expect(shortIdpPosition('Safety')).toBe('S')
  })

  it('passes an unknown spelling through rather than guessing', () => {
    expect(shortIdpPosition('ROVER')).toBe('ROVER')
    expect(shortIdpPosition(null)).toBeNull()
  })
})
