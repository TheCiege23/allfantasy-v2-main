import { describe, expect, it } from 'vitest'
import { gradeRecommendationText } from '@/lib/core-app/finderTradeValueCopy'

/*
 * The package-review recommendation lost its "Quoted values:" prefix on 2026-11-11 ("Major win (you).
 * You send …"). Grades saved before that still carry the old form, so the Spanish reader takes both.
 */
const NOTE =
  'You send 1 player and receive 2. You’ll need 1 more roster spot; if your roster is full, you’ll have to drop someone. The grade only adds up values, so check your lineup and any drops too.'
const NOTE_ES =
  'Envías 1 jugador y recibes 2. Necesitarás 1 puesto más en la plantilla; si está llena, tendrás que dar de baja a alguien. La nota solo suma valores, así que revisa también tu alineación y las bajas.'

describe('package-review recommendation in Spanish', () => {
  it('translates the current form', () => {
    expect(gradeRecommendationText(`Major win (you). ${NOTE}`, 'es')).toBe(`Gran ventaja para ti. ${NOTE_ES}`)
  })
  it('still translates a grade saved with the old "Quoted values:" prefix', () => {
    expect(gradeRecommendationText(`Quoted values: major win (you). ${NOTE}`, 'es')).toBe(`Gran ventaja para ti. ${NOTE_ES}`)
  })
  it('leaves English alone', () => {
    expect(gradeRecommendationText(`Major win (you). ${NOTE}`, 'en')).toBe(`Major win (you). ${NOTE}`)
  })
})
