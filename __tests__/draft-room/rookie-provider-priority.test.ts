import { describe, expect, it } from 'vitest'

import {
  isDraftRoomRookie,
  resolveNflRookieDiagnosticSource,
} from '@/lib/draft-room/draftPlayerRookie'
import { buildRookieSignalDiagnostics } from '@/lib/draft-room/draftRoomRookieDiagnostics'
import type { DraftRoomRookiePlayerLike } from '@/lib/draft-room/draftPlayerRookie'
import { getProviderForField } from '@/lib/providers/providerPriority'

const nflOpts = { sport: 'NFL', seasonYear: 2026 } as const

describe('Rookie source + provider alignment', () => {
  it('explicit imported isRookie true wins', () => {
    expect(isDraftRoomRookie({ name: 'A', position: 'RB', isRookie: true }, nflOpts)).toBe(true)
    expect(resolveNflRookieDiagnosticSource({ isRookie: true })).toBe('rolling_insights_imported')
  })

  it('explicit imported yearsExperience path (yearsExp 0) wins', () => {
    expect(isDraftRoomRookie({ name: 'B', position: 'WR', yearsExp: 0 }, nflOpts)).toBe(true)
  })

  it('when imported RI-like fields missing, Sleeper years_exp 0 marks rookie', () => {
    expect(isDraftRoomRookie({ name: 'C', position: 'TE', yearsExp: 0 }, nflOpts)).toBe(true)
    expect(resolveNflRookieDiagnosticSource({ yearsExp: 0 })).toBe('sleeper_years_exp')
  })

  it('Sleeper years_exp > 0 is not rookie', () => {
    expect(isDraftRoomRookie({ name: 'D', position: 'QB', yearsExp: 3 }, nflOpts)).toBe(false)
  })

  it('no imported fields and no yearsExp → not treated as rookie (unknown)', () => {
    expect(isDraftRoomRookie({ name: 'E', position: 'LB', team: 'DAL' }, nflOpts)).toBe(false)
    expect(resolveNflRookieDiagnosticSource({ name: 'E' })).toBe('unknown')
  })

  it('diagnostics sample exposes rookieSource', () => {
    const players: DraftRoomRookiePlayerLike[] = [{ name: 'F', position: 'K', yearsExp: 0 }]
    const d = buildRookieSignalDiagnostics(players, 'NFL', 2026)
    expect(d.sample[0]?.rookieSource).toBe('sleeper_years_exp')
  })

  it('getProviderForField NFL rookie_years_exp is Sleeper', () => {
    expect(getProviderForField('NFL', 'rookie_years_exp')).toBe('sleeper')
  })

  it('maps sleeper_db_cache provenance to sleeper_cache diagnostic', () => {
    expect(
      resolveNflRookieDiagnosticSource({
        display: {
          metadata: { rookieYearsExpSource: 'sleeper_db_cache' },
        },
      } as DraftRoomRookiePlayerLike),
    ).toBe('sleeper_cache')
  })
})
