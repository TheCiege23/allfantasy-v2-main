/**
 * The waiver wire showed no headshots anywhere (owner report, 2026-11-28). SportPlayerPoolResolver
 * emits each row's chosen photo as top-level `image_url` (it ranks them: a current-team ESPN headshot
 * over TheSportsDB's old jersey), with only `{ source }` in `metadata`; the pool normalizer read the
 * photo from `metadata.imageUrl` / `metadata.headshotUrl` alone, so every pool row lost it.
 */
import { describe, expect, it } from 'vitest'
import { normalizePoolRowToUnified } from '@/lib/player-data/normalizeProviderPlayer'
import { serializeUnifiedPlayerForApi } from '@/lib/player-data/serializeUnifiedPlayerForApi'
import type { PoolPlayerRecord } from '@/lib/sport-teams/types'

const row = (extra: Partial<PoolPlayerRecord> & Record<string, unknown>): PoolPlayerRecord =>
  ({
    player_id: 'p1', sport_type: 'NBA', team_id: null, team_abbreviation: 'MIA', team: 'MIA', full_name: 'Bam Adebayo',
    position: 'C', status: 'active', injury_status: null, external_source_id: '1234', metadata: { source: 'rolling_insights' },
    ...extra,
  }) as PoolPlayerRecord

const headshotOf = (r: PoolPlayerRecord) => serializeUnifiedPlayerForApi(normalizePoolRowToUnified(r, 'NBA')).headshotUrl

describe('a pool row keeps the photo the resolver chose', () => {
  it('reads the top-level image_url', () => {
    expect(headshotOf(row({ image_url: 'https://a.espncdn.com/i/headshots/nba/players/full/4066261.png' }))).toBe(
      'https://a.espncdn.com/i/headshots/nba/players/full/4066261.png',
    )
  })

  it('still reads a photo carried in metadata', () => {
    expect(headshotOf(row({ metadata: { source: 'x', imageUrl: 'https://r2.thesportsdb.com/images/a.png' } }))).toBe('https://r2.thesportsdb.com/images/a.png')
  })

  it('CONTROL: a row with no photo anywhere has none', () => {
    expect(headshotOf(row({}))).toBeNull()
  })
})
