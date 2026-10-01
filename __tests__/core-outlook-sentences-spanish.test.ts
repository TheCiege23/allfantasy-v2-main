import { describe, expect, it } from 'vitest'
import { seasonOutlookSentence } from '@/components/core-app/screens/SeasonOutlook'

describe('server forecast explanations in Spanish', () => {
  it('preserves live counts and the simulation basis', () => {
    const basis = "10,000 simulations per league, played over each league's own remaining schedule, playoff field and first-round byes."
    expect(seasonOutlookSentence(basis, 'es')).toContain('10,000 simulaciones por liga')
    expect(seasonOutlookSentence(basis, 'en')).toBe(basis)
    expect(seasonOutlookSentence('Only 5 of 12 teams have three or more completed weeks on file, in any season — not enough to simulate.', 'es')).toContain('5 de 12 equipos')
  })

  it('translates actionable conditions without changing the thresholds', () => {
    expect(seasonOutlookSentence('Get to 8 wins — 2 of your last 3 — and you are in nine times in ten. You will likely need help too.', 'es')).toContain('8 victorias: necesitas 2 de los últimos 3')
    expect(seasonOutlookSentence('On the bubble at 48% with 3 to play — this is where a lineup call is worth the most.', 'es')).toContain('48% y 3 partidos')
    expect(seasonOutlookSentence('Settled — you are in.', 'es')).toBe('Decidido: estás dentro.')
  })
})
