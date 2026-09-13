import { describe, expect, it } from 'vitest'
import { evaluatePendingOffer } from '@/lib/core-app/pendingOfferEvaluation'

const book = { source: 'FANTASYCALC' as const, format: 'DYNASTY' as const, qbFormat: 'SUPERFLEX' as const }
const player = (playerId: string) => ({ playerId, playerName: playerId, position: 'WR', team: 'NYJ' })

describe('evaluatePendingOffer', () => {
  it('grades a fully priced player and pick offer from the viewer perspective', () => {
    const result = evaluatePendingOffer({
      received: [player('star')],
      sent: [{ playerId: null, playerName: '2027 2nd round pick', position: 'PICK', team: '—', isPick: true, pickYear: 2027, pickRoundNumber: 2 }],
      playerValues: new Map([['star', 8000]]),
      book,
      teamCount: 12,
    })

    expect(result.graded).toBe(true)
    if (result.graded) {
      expect(result.letter).toBe('A')
      expect(result.sharePct).toBeGreaterThan(65)
      expect(result.recommendation).toMatch(/Accept/)
    }
  })

  it('withholds a grade rather than valuing an unknown player at zero', () => {
    const result = evaluatePendingOffer({
      received: [player('unknown')],
      sent: [player('priced')],
      playerValues: new Map([['priced', 4000]]),
      book,
      teamCount: 12,
    })

    expect(result).toMatchObject({ graded: false, covered: 1, total: 2 })
  })

  it('withholds a grade when FAAB cannot be compared to market value', () => {
    const result = evaluatePendingOffer({
      received: [{ playerId: null, playerName: '$25 FAAB', position: 'FAAB', team: '—', faabAmount: 25 }],
      sent: [player('priced')],
      playerValues: new Map([['priced', 4000]]),
      book,
      teamCount: 12,
    })

    expect(result).toMatchObject({ graded: false, covered: 1, total: 2 })
  })
})
