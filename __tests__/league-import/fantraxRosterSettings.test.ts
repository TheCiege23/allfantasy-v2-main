import { describe, expect, it } from 'vitest'
import { fantraxStarterSlots } from '@/lib/league-import/fantrax/fantraxRosterSettings'

describe('Fantrax starter slots', () => {
  it('accepts the measured 160-team NCAAB league limits only when they cover all active spots', () => {
    expect(fantraxStarterSlots({ positionConstraints: {
      Flx: { maxActive: 2 }, G: { maxActive: 5 }, 'F/C': { maxActive: 5 },
    }, maxTotalActivePlayers: 12, maxTotalPlayers: 18 })).toEqual([
      { position: 'FLX', count: 2 }, { position: 'G', count: 5 }, { position: 'F/C', count: 5 },
    ])
  })

  it('leaves partial or malformed limits unknown', () => {
    expect(fantraxStarterSlots({ positionConstraints: { G: { maxActive: 5 } },
      maxTotalActivePlayers: 12 })).toEqual([])
    expect(fantraxStarterSlots({ positionConstraints: { G: { maxActive: -1 } },
      maxTotalActivePlayers: 12 })).toEqual([])
  })
})
