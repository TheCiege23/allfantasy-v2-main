import { describe, expect, it } from 'vitest'

import {
  buildRookieSignalDiagnostics,
  coalesceYearsExpFromNormalizedEntry,
  rookieHelperTrueWhenNflDraftYearMatchesSeason,
} from '@/lib/draft-room/draftRoomRookieDiagnostics'
import type { DraftRoomRookiePlayerLike } from '@/lib/draft-room/draftPlayerRookie'
import type { NormalizedDraftEntry } from '@/lib/draft-sports-models/types'

describe('buildRookieSignalDiagnostics', () => {
  it('reports zero rookie signals when rows lack fields', () => {
    const players: DraftRoomRookiePlayerLike[] = [
      { name: 'A', position: 'RB' },
      { name: 'B', position: 'WR' },
    ]
    const d = buildRookieSignalDiagnostics(players, 'NFL', 2026)
    expect(d.totalPlayers).toBe(2)
    expect(d.rookieSignalCount).toBe(0)
    expect(d.draftYearSignalCount).toBe(0)
    expect(d.experienceZeroCount).toBe(0)
  })

  it('counts draftYear signals', () => {
    const players: DraftRoomRookiePlayerLike[] = [
      { name: 'A', draftYear: 2026 },
      { name: 'B' },
    ]
    const d = buildRookieSignalDiagnostics(players, 'NFL', 2026)
    expect(d.draftYearSignalCount).toBe(1)
  })

  it('counts experience zero signals', () => {
    const players: DraftRoomRookiePlayerLike[] = [
      { name: 'A', yearsExp: 0 },
      { name: 'B', yearsExp: 3 },
    ]
    const d = buildRookieSignalDiagnostics(players, 'NFL', 2026)
    expect(d.experienceZeroCount).toBe(1)
  })
})

describe('coalesceYearsExpFromNormalizedEntry', () => {
  it('reads years_exp from display.metadata when top-level missing', () => {
    const e = {
      yearsExp: null,
      display: { metadata: { years_exp: 0 } },
    } as NormalizedDraftEntry
    expect(coalesceYearsExpFromNormalizedEntry(e)).toBe(0)
  })
})

describe('rookie helper + nflDraftYear', () => {
  it('returns true when metadata.nflDraftYear equals season (NFL)', () => {
    expect(
      rookieHelperTrueWhenNflDraftYearMatchesSeason({
        sport: 'NFL',
        seasonYear: 2026,
        nflDraftYear: 2026,
      }),
    ).toBe(true)
  })
})
