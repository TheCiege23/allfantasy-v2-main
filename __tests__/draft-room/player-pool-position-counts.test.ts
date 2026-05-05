import { describe, expect, it } from 'vitest'

import {
  getDraftRoomPositionGroupCounts,
  poolPlayerMatchesPositionPill,
} from '@/lib/draft-room/draftPoolPositionGroups'

describe('poolPlayerMatchesPositionPill', () => {
  it('counts QB/RB/WR/TE exactly', () => {
    expect(poolPlayerMatchesPositionPill('QB', 'QB', { sport: 'NFL' })).toBe(true)
    expect(poolPlayerMatchesPositionPill('RB', 'RB', { sport: 'NFL' })).toBe(true)
  })

  it('aliases PK to K', () => {
    expect(poolPlayerMatchesPositionPill('PK', 'K', { sport: 'NFL' })).toBe(true)
  })

  it('aliases DEF/DST/D/ST for DST pill', () => {
    expect(poolPlayerMatchesPositionPill('DEF', 'DST', { sport: 'NFL' })).toBe(true)
    expect(poolPlayerMatchesPositionPill('D/ST', 'DEF', { sport: 'NFL' })).toBe(true)
  })

  it('FLEX includes RB/WR/TE', () => {
    expect(poolPlayerMatchesPositionPill('RB', 'FLEX', { sport: 'NFL' })).toBe(true)
    expect(poolPlayerMatchesPositionPill('QB', 'FLEX', { sport: 'NFL' })).toBe(false)
  })

  it('groups IDP positions under IDP FLEX when format is IDP', () => {
    expect(poolPlayerMatchesPositionPill('DE', 'IDP FLEX', { sport: 'NFL', formatType: 'IDP' })).toBe(true)
  })
})

describe('getDraftRoomPositionGroupCounts', () => {
  it('aggregates offense buckets', () => {
    const counts = getDraftRoomPositionGroupCounts(
      [
        { position: 'QB' },
        { position: 'RB' },
        { position: 'WR' },
        { position: 'TE' },
        { position: 'PK' },
        { position: 'DEF' },
      ],
      { sport: 'NFL' },
    )
    expect(counts.QB).toBe(1)
    expect(counts.RB).toBe(1)
    expect(counts.WR).toBe(1)
    expect(counts.TE).toBe(1)
    expect(counts.K).toBe(1)
    expect(counts.DST).toBe(1)
    expect(counts.FLEX).toBe(3)
    expect(counts.OFFENSE).toBe(6)
  })
})
