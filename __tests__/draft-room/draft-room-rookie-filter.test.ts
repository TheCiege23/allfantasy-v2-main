import { describe, expect, it } from 'vitest'

import {
  getDraftRoomRookieDataState,
  isDraftRoomRookie,
} from '@/lib/draft-room/draftPlayerRookie'

const baseOpts = { sport: 'NFL', seasonYear: 2026 } as const

describe('isDraftRoomRookie — NFL', () => {
  it('detects explicit isRookie true', () => {
    expect(isDraftRoomRookie({ name: 'x', position: 'RB', isRookie: true }, baseOpts)).toBe(true)
  })

  it('detects metadata.isRookie true', () => {
    expect(
      isDraftRoomRookie(
        { name: 'x', position: 'RB', display: { metadata: { isRookie: true } as Record<string, unknown> } },
        baseOpts,
      ),
    ).toBe(true)
  })

  it('detects yearsExperience 0 via yearsExp', () => {
    expect(isDraftRoomRookie({ name: 'x', position: 'WR', yearsExp: 0 }, baseOpts)).toBe(true)
  })

  it('detects experience 0 via loose metadata', () => {
    expect(isDraftRoomRookie({ name: 'x', position: 'TE', metadata: { experience: 0 } }, baseOpts)).toBe(true)
  })

  it('detects draftYear matching season', () => {
    expect(isDraftRoomRookie({ name: 'x', position: 'QB', draftYear: 2026 }, baseOpts)).toBe(true)
  })

  it('Sleeper-style yearsExp > 0 excludes rookie even when draftYear matches season', () => {
    expect(
      isDraftRoomRookie(
        { name: 'x', position: 'QB', draftYear: 2026, yearsExp: 1 },
        baseOpts,
      ),
    ).toBe(false)
  })

  it('detects metadata nflDraftYear matching season', () => {
    expect(
      isDraftRoomRookie(
        { name: 'x', position: 'LB', metadata: { nflDraftYear: 2026 } },
        baseOpts,
      ),
    ).toBe(true)
  })
})

describe('getDraftRoomRookieDataState — messaging reasons', () => {
  it('returns rookies_found when inferable rookies exist', () => {
    const st = getDraftRoomRookieDataState(
      [{ name: 'a', position: 'RB', yearsExp: 0 }],
      baseOpts,
    )
    expect(st.reason).toBe('rookies_found')
    expect(st.rookieCount).toBe(1)
  })

  it('returns no_rookie_metadata when pool lacks rookie signals', () => {
    const st = getDraftRoomRookieDataState([{ name: 'a', position: 'WR', team: 'BUF' }], baseOpts)
    expect(st.reason).toBe('no_rookie_metadata')
    expect(st.rookieCount).toBe(0)
  })

  it('returns empty_pool for empty input', () => {
    const st = getDraftRoomRookieDataState([], baseOpts)
    expect(st.reason).toBe('empty_pool')
  })
})
