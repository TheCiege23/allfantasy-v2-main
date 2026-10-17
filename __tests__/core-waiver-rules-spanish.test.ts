import { describe, expect, it } from 'vitest'
import { waiverRuleText } from '@/components/core-app/screens/Waivers'

describe('server waiver rules in Spanish', () => {
  it('keeps the exact limits and minimum bid', () => {
    expect(waiverRuleText('4 per period · $2 minimum bid', 'es')).toBe('4 por periodo · oferta mínima de $2')
    expect(waiverRuleText('4 per period · $2 minimum bid', 'en')).toBe('4 per period · $2 minimum bid')
  })

  it('translates known tiebreak rules', () => {
    expect(waiverRuleText('Highest FAAB bid', 'es')).toBe('Oferta FAAB más alta')
  })
})
