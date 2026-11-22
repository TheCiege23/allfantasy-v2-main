import { describe, expect, it } from 'vitest'
import { opponentScoreAdjustment } from '@/lib/chimmy/opponentStrength'

const games = Array.from({ length: 12 }, (_, i) => [
  { homeTeam: 'Weak Defense', awayTeam: `A${i}`, homeScore: 120, awayScore: 120 },
  { homeTeam: 'Strong Defense', awayTeam: `B${i}`, homeScore: 80, awayScore: 80 },
]).flat()

describe('opponent real-score strength proxy', () => {
  it('favors a scorer facing the higher-conceding defense and caps the adjustment', () => {
    const weak = opponentScoreAdjustment({ sport: 'NBA', position: 'G', opponents: ['Weak Defense'], games })
    const strong = opponentScoreAdjustment({ sport: 'NBA', position: 'G', opponents: ['Strong Defense'], games })
    expect(weak?.factor).toBeGreaterThan(strong!.factor)
    expect(weak?.factor).toBeLessThanOrEqual(1.1)
    expect(strong?.factor).toBeGreaterThanOrEqual(0.9)
  })

  it('reverses the direction for a pitcher facing a stronger offense', () => {
    const weakOffense = opponentScoreAdjustment({ sport: 'MLB', position: 'SP', opponents: ['Strong Defense'], games })
    const strongOffense = opponentScoreAdjustment({ sport: 'MLB', position: 'SP', opponents: ['Weak Defense'], games })
    expect(weakOffense!.factor).toBeGreaterThan(strongOffense!.factor)
  })

  it('refuses a partial opponent sample and unsupported soccer identity mapping', () => {
    expect(opponentScoreAdjustment({ sport: 'NBA', position: 'G', opponents: ['Unknown'], games })).toBeNull()
    expect(opponentScoreAdjustment({ sport: 'SOCCER', position: 'F', opponents: ['Weak Defense'], games })).toBeNull()
  })
})
