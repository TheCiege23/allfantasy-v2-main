/**
 * `lib/sleeper/players-cache` binds mock-draft board rows to Sleeper ids, and that id becomes the
 * CDN headshot. It used to be a first-wins name map over the whole dictionary; production
 * `draft_pool_cache` (2026-10-12) showed QB Josh Allen BUF on 2212 (Josh Allen, G, FA), WR DJ
 * Moore on a CB, RB Kenneth Walker on a WR, devy WR Mike Matthews on a retired C.
 *
 * The dictionary below lists each namesake BEFORE the real player, because that is the order that
 * made first-wins pick the wrong one.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/sleeper-client', () => ({
  getAllPlayers: vi.fn(async () => ({
    '2212': { full_name: 'Josh Allen', position: 'G', team: null },
    '9999': { full_name: 'Josh Allen', position: 'DE', team: 'JAX', fantasy_positions: ['DL'] },
    '4984': { full_name: 'Josh Allen', position: 'QB', team: 'BUF', fantasy_positions: ['QB'] },
    '4961': { full_name: 'DJ Moore', position: 'CB', team: null },
    '4983': { full_name: 'DJ Moore', position: 'WR', team: 'BUF' },
    '4634': { full_name: 'Kenneth Walker', position: 'WR', team: null },
    '8151': { full_name: 'Kenneth Walker III', position: 'RB', team: 'KC' },
    '3544': { full_name: 'Mike Matthews', position: 'C', team: null },
    '12530': { full_name: 'Travis Hunter', position: 'CB', team: 'JAX', fantasy_positions: ['WR', 'DB'] },
    '4227': { full_name: 'Harrison Butker', position: 'K', team: 'KC' },
    '6794': { full_name: 'Justin Jefferson', position: 'WR', team: 'MIN' },
    BUF: { first_name: 'Buffalo', last_name: 'Bills', position: 'DEF', team: 'BUF' },
  })),
}))

import { resolveSleeperIds, resolveSleeperIdsBatch } from '@/lib/sleeper/players-cache'

describe('resolveSleeperIdsBatch — position-verified binding', () => {
  it('binds each skill player to himself, not to the namesake listed first', async () => {
    const ids = await resolveSleeperIdsBatch([
      { name: 'Josh Allen', position: 'QB', team: 'BUF' },
      { name: 'DJ Moore', position: 'WR', team: 'BUF' },
      { name: 'Kenneth Walker', position: 'RB', team: 'KC' },
    ])
    expect(ids).toEqual(['4984', '4983', '8151'])
  })

  it('refuses a lone namesake at a different position (devy WR vs retired C)', async () => {
    expect(await resolveSleeperIdsBatch([{ name: 'Mike Matthews', position: 'WR', team: null }])).toEqual([null])
  })

  it('accepts a two-way player under either label, and folds PK/K and DEF', async () => {
    const ids = await resolveSleeperIdsBatch([
      { name: 'Travis Hunter', position: 'WR', team: 'JAX' },
      { name: 'Harrison Butker', position: 'PK', team: 'KC' },
      { name: 'Buffalo Bills', position: 'DEF', team: 'BUF' },
      { name: 'Justin Jefferson', position: 'WR', team: 'Minnesota Vikings' },
    ])
    expect(ids).toEqual(['12530', '4227', 'BUF', '6794'])
  })

  it('aligns results with the input, so two Josh Allens in one pool keep their own ids', async () => {
    const ids = await resolveSleeperIdsBatch([
      { name: 'Josh Allen', position: 'QB' },
      { name: 'Josh Allen', position: 'DE' },
    ])
    expect(ids).toEqual(['4984', '9999'])
  })

  it('refuses a collision that position cannot settle', async () => {
    // Two non-QB Josh Allens and no QB asked for: nothing verifies either, so neither binds.
    expect(await resolveSleeperIdsBatch([{ name: 'Josh Allen', position: 'TE' }])).toEqual([null])
  })
})

describe('resolveSleeperIds — name only', () => {
  it('refuses any name shared by more than one dictionary entry, and binds a unique one', async () => {
    const out = await resolveSleeperIds(['Josh Allen', 'DJ Moore', 'Kenneth Walker', 'Justin Jefferson'])
    expect(out).toEqual({ 'Justin Jefferson': '6794' })
  })
})
