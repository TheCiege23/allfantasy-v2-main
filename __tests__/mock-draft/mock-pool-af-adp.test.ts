import { describe, expect, it, vi } from 'vitest'
import { attachAfAdpToEntries, attachAfAdpToMockPool, buildMockDraftContext } from '@/lib/mock-draft/mockPoolAfAdp'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'
import { computeAfAdp } from '@/lib/adp/afAdp'
import type { AdpCorpusSplit } from '@/lib/adp/loadAdpBoard'

/**
 * The mock draft pool gets the same AF ADP the live draft room shows: market ADP blended with the
 * board's imported-league and AllFantasy-draft corpora for the mock's own draft context.
 */

const split: AdpCorpusSplit = {
  own: { adp: 9, sampleSize: 400 } as AdpCorpusSplit['own'],
  imported: { adp: 11, sampleSize: 200 } as AdpCorpusSplit['imported'],
}
const corpora = new Map<string, AdpCorpusSplit>([[buildPlayerKey('Atlas Runner', 'RB'), split]])

describe('attachAfAdpToEntries', () => {
  it('blends market ADP with the player’s corpora exactly as the live pool does', () => {
    const [row] = attachAfAdpToEntries([{ name: 'Atlas Runner', position: 'RB', adp: 14, team: 'NYJ' }], corpora)
    const expected = computeAfAdp({ marketAdp: 14, split })!
    expect(row).toMatchObject({
      name: 'Atlas Runner',
      adp: 14,
      afAdp: expected.afAdp,
      afAdpContributions: expected.contributions,
      afAdpImportedSampleSize: 200,
      afAdpOwnSampleSize: 400,
    })
    // Many real drafts pull it well off the market number.
    expect((row as { afAdp: number }).afAdp).toBeLessThan(14)
  })

  it('falls back to market alone with no drafts, and null with nothing at all', () => {
    const [marketOnly, nothing] = attachAfAdpToEntries(
      [
        { name: 'Blaze Catcher', position: 'WR', adp: 20 },
        { name: 'Deep Sleeper', position: 'TE', adp: null },
      ],
      corpora,
    )
    expect(marketOnly).toMatchObject({ afAdp: 20, afAdpContributions: { market: 1, imported: 0, af: 0 } })
    expect(nothing).toMatchObject({ afAdp: null })
  })

  it('leaves rows without a name or position untouched', () => {
    const odd = { position: 'RB', adp: 3 }
    expect(attachAfAdpToEntries([odd], corpora)[0]).toBe(odd)
  })
})

describe('attachAfAdpToMockPool', () => {
  it('loads the board for the mock’s own settings', async () => {
    const loadCorpora = vi.fn(async () => corpora)
    const out = await attachAfAdpToMockPool(
      [{ name: 'Atlas Runner', position: 'RB', adp: 14 }],
      { sport: 'NFL', season: '2026', scoring: 'half_ppr', isDynasty: true, teamCount: 10, draftType: 'linear' },
      { loadCorpora },
    )
    expect(loadCorpora).toHaveBeenCalledWith({
      sport: 'NFL',
      leagueType: 'dynasty',
      draftType: 'linear',
      scoringFormat: 'half_ppr',
      rosterFormat: 'standard',
      teamCount: 10,
      season: '2026',
    })
    expect((out[0] as { afAdp: number }).afAdp).toBeLessThan(14)
  })

  it('a board that cannot be read leaves every row null instead of failing the pool', async () => {
    const out = await attachAfAdpToMockPool(
      [{ name: 'Atlas Runner', position: 'RB', adp: 14 }],
      { sport: 'NFL', isDynasty: false },
      { loadCorpora: async () => { throw new Error('db down') } },
    )
    expect(out).toEqual([{ name: 'Atlas Runner', position: 'RB', adp: 14, afAdp: null }])
  })

  it('defaults a missing team count and season the way a real draft context does', () => {
    const ctx = buildMockDraftContext({ sport: 'NBA', isDynasty: false })
    expect(ctx).toMatchObject({ sport: 'NBA', leagueType: 'redraft', teamCount: 12, draftType: 'snake' })
    expect(ctx.season).toBe(String(new Date().getUTCFullYear()))
  })
})
