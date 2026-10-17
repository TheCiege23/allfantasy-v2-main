/**
 * Every defensive label the player tables actually hold is a defender to BOTH IDP predicates, and
 * lands in the same group — the price coverage audit (2026-09-28) found NT grouped as DL by
 * `idpPositionGroup` but refused by `isIdpPosition`, so nose tackles never reached the league board.
 */
import { describe, expect, it } from 'vitest'
import { idpPositionGroup, isIdpPosition } from '@/lib/core-app/scoringNotes'
import { isIdpPosition as isIdpForValues, normalizeIdpPosition } from '@/lib/idp-kicker-values'

const LABELS: Array<[string, 'DL' | 'LB' | 'DB']> = [
  ['DL', 'DL'], ['DE', 'DL'], ['DT', 'DL'], ['NT', 'DL'], ['EDGE', 'DL'],
  ['LB', 'LB'], ['ILB', 'LB'], ['OLB', 'LB'], ['MLB', 'LB'],
  ['DB', 'DB'], ['CB', 'DB'], ['S', 'DB'], ['SS', 'DB'], ['FS', 'DB'],
]

describe('the IDP position lists name the same defenders', () => {
  it.each(LABELS)('%s is a defender to both predicates, in group %s', (label, group) => {
    expect(isIdpPosition(label)).toBe(true)
    expect(isIdpForValues(label)).toBe(true)
    expect(idpPositionGroup(label)).toBe(group)
    expect(normalizeIdpPosition(label)).toBe(group)
  })

  it('[control] offensive labels and kickers are defenders to neither', () => {
    for (const label of ['QB', 'RB', 'WR', 'TE', 'K']) {
      expect(isIdpPosition(label)).toBe(false)
      expect(isIdpForValues(label)).toBe(false)
    }
  })
})
