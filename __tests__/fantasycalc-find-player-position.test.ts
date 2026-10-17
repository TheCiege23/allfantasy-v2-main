import { describe, expect, it } from 'vitest'

import { findPlayerByName, type FantasyCalcPlayer } from '@/lib/fantasycalc'

/*
 * FantasyCalc lists offensive players only, so a defender who shares a star's name finds exactly ONE
 * row — the star's — and took his market value (LB Josh Allen ← QB Josh Allen; LB Justin Jefferson,
 * CB DeVonta Smith likewise). 2026-10-11.
 */
const fc = (name: string, position: string, team: string, value: number) =>
  ({ player: { name, position, maybeTeam: team }, value }) as unknown as FantasyCalcPlayer
const players = [fc('Josh Allen', 'QB', 'BUF', 9800), fc('Justin Jefferson', 'WR', 'MIN', 9500), fc('Rome Odunze', 'WR', 'CHI', 4100)]

describe('findPlayerByName — a single match must be the position the caller said', () => {
  it('🛑 a linebacker named Josh Allen does not get the quarterback’s row', () => {
    expect(findPlayerByName(players, 'Josh Allen', { position: 'LB' })).toBeNull()
    expect(findPlayerByName(players, 'Justin Jefferson', { position: 'LB', team: 'CLE' })).toBeNull()
  })
  it('the right position still matches, and no hint keeps the old behaviour', () => {
    expect(findPlayerByName(players, 'Josh Allen', { position: 'QB' })?.value).toBe(9800)
    expect(findPlayerByName(players, 'Josh Allen')?.value).toBe(9800)
  })
  it('a unique partial match is position-checked too', () => {
    expect(findPlayerByName(players, 'Odunze', { position: 'CB' })).toBeNull()
    expect(findPlayerByName(players, 'Odunze', { position: 'WR' })?.value).toBe(4100)
  })
})
