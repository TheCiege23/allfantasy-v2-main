import { describe, expect, it } from 'vitest'
import { normalizeBigBrotherShellLeague } from '@/lib/big-brother/shellLeague'

describe('Big Brother canonical shell compatibility', () => {
  it('recognizes the actual canonical creator shape without mutating persisted fields', () => {
    const stored = { id: 'native', leagueType: 'big_brother', leagueVariant: null, settings: { draft_type: 'snake' } }
    const shell = normalizeBigBrotherShellLeague(stored)
    expect(shell.leagueVariant).toBe('big_brother')
    expect(shell.settings).toBe(stored.settings)
    expect(stored.leagueVariant).toBeNull()
  })
  it('preserves legacy Big Brother leagues', () => {
    const stored = { leagueType: 'redraft', leagueVariant: 'big_brother' }
    expect(normalizeBigBrotherShellLeague(stored)).toBe(stored)
  })
  it('preserves an explicit alternate variant', () => {
    const stored = { leagueType: 'big_brother', leagueVariant: 'idp' }
    expect(normalizeBigBrotherShellLeague(stored)).toBe(stored)
  })
  it.each(['redraft', 'dynasty', 'survivor', 'zombie', null])('does not reclassify %s leagues', leagueType => {
    const stored = { leagueType, leagueVariant: null }
    expect(normalizeBigBrotherShellLeague(stored)).toBe(stored)
  })
})
