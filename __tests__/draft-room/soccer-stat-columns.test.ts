import { describe, expect, it } from 'vitest'

import {
  getDraftStatColumnsForSport,
  getStatValueForDraftPlayer,
  isLikelySoccerDefenderPosition,
  isLikelySoccerGoalkeeperPosition,
} from '@/lib/draft-room/draftSportStatColumns'

describe('SOCCER stat columns', () => {
  it('fielders get offensive RI-style stat keys', () => {
    const cols = getDraftStatColumnsForSport('SOCCER', { position: 'F' })
    expect(cols.some((c) => c.key === 'soc_g')).toBe(true)
    expect(cols.some((c) => c.key === 'soc_sog')).toBe(true)
  })

  it('goalkeepers get saves / goals conceded', () => {
    expect(isLikelySoccerGoalkeeperPosition('GK')).toBe(true)
    const cols = getDraftStatColumnsForSport('SOCCER', { position: 'GK' })
    const sv = cols.find((c) => c.key === 'soc_sv')!
    expect(getStatValueForDraftPlayer({ display: { stats: { saves: 4 } } }, sv)).toBe(4)
  })

  it('defenders prefer clean sheets column group', () => {
    expect(isLikelySoccerDefenderPosition('CB')).toBe(true)
    const cols = getDraftStatColumnsForSport('SOCCER', { position: 'CB' })
    expect(cols.some((c) => c.key === 'soc_cs')).toBe(true)
  })
})
