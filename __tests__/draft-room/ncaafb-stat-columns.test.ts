import { describe, expect, it } from 'vitest'

import {
  getDraftStatColumnsForSport,
  getStatValueForDraftPlayer,
} from '@/lib/draft-room/draftSportStatColumns'

describe('NCAAFB stat columns (NCAAF LeagueSport)', () => {
  it('offense skill uses pass/rec/rush RI aliases', () => {
    const cols = getDraftStatColumnsForSport('NCAAF', { position: 'QB' })
    const passYds = cols.find((c) => c.key === 'pass_yds')!
    const player = { display: { stats: { passing_yards: 2800 } } }
    expect(getStatValueForDraftPlayer(player, passYds)).toBe(2800)
  })

  it('IDP uses fumbles_recoveries alias', () => {
    const cols = getDraftStatColumnsForSport('NCAAF', { position: 'LB' })
    const fr = cols.find((c) => c.key === 'idp_fr')!
    expect(getStatValueForDraftPlayer({ display: { stats: { fumbles_recoveries: 3 } } }, fr)).toBe(3)
  })

  it('punter reads punting_yards', () => {
    const cols = getDraftStatColumnsForSport('NCAAF', { position: 'P' })
    const py = cols.find((c) => c.key === 'punt_yds')!
    expect(getStatValueForDraftPlayer({ display: { stats: { punting_yards: 2100 } } }, py)).toBe(2100)
  })
})
