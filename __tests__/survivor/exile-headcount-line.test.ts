import { describe, expect, it } from 'vitest'
import { exileHeadcountLine } from '@/lib/survivor/survivorExileSecrecy'

/** "1 players marooned" shipped on the Exile page header (2026-11-07 Survivor audit). */
describe('Exile headcount line', () => {
  it('says "player" for one manager', () => {
    expect(exileHeadcountLine(1, 9)).toBe('1 player marooned · Week 9')
  })
  it('says "players" for none or several', () => {
    expect(exileHeadcountLine(0, 9)).toBe('0 players marooned · Week 9')
    expect(exileHeadcountLine(3, '9')).toBe('3 players marooned · Week 9')
  })
})
