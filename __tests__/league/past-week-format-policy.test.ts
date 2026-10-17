/**
 * Which specialty formats the commish past-week lineup editor may re-score
 * (lib/league/pastWeekFormatPolicy.ts). The editor re-runs the matchup and standings and nothing else,
 * so it is allowed only where that is the whole story, or where the commish is told what stays.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { decidePastWeekFormat } from '@/lib/league/pastWeekFormatPolicy'

const base = {
  specId: null as string | null,
  leagueVariant: null as string | null,
  guillotineMode: false,
  survivorMode: false,
  usesDevyEngine: false,
  usesC2CEngine: false,
  tournamentRoundCompleted: false,
}
const decide = (o: Partial<typeof base>) => decidePastWeekFormat({ ...base, ...o })

describe('decidePastWeekFormat', () => {
  it('an ordinary league and an IDP league re-score with no note', () => {
    expect(decide({})).toEqual({ ok: true, note: null })
    expect(decide({ specId: 'idp', leagueVariant: 'dynasty_idp' })).toEqual({ ok: true, note: null })
  })

  it.each([
    ['zombie', 'zombie'],
    ['big_brother', 'big_brother'],
    ['tournament', 'tournament'],
  ])('%s re-scores the matchup only, with a note that its own outcome stands', (specId, note) => {
    expect(decide({ specId })).toEqual({ ok: true, note })
  })

  it('a tournament league whose round has finished is refused', () => {
    expect(decide({ specId: 'tournament', tournamentRoundCompleted: true })).toMatchObject({ ok: false, reason: expect.stringContaining('advanced') })
  })

  it.each([
    ['guillotine by spec', { specId: 'guillotine' }],
    ['guillotine by the mode flag', { guillotineMode: true }],
    ['survivor guillotine (not in the registry)', { leagueVariant: 'Survivor_Guillotine' }],
    ['survivor by spec', { specId: 'survivor' }],
    ['survivor by the mode flag', { survivorMode: true }],
    ['devy by spec', { specId: 'devy' }],
    ['a league on the devy engine', { usesDevyEngine: true }],
    ['merged devy C2C', { specId: 'merged_devy_c2c' }],
    ['a league on the C2C engine', { usesC2CEngine: true }],
    ['a registered format nobody has checked', { specId: 'some_new_format' }],
  ])('refuses %s', (_label, o) => {
    expect(decide(o as Partial<typeof base>).ok).toBe(false)
  })
})
