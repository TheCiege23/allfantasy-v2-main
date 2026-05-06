import { describe, expect, it } from 'vitest'
import {
  buildTheSportsDbV1Url,
  buildTheSportsDbV2Path,
  buildTheSportsDbV2Url,
  getTheSportsDbImagePreviewUrl,
} from '@/lib/providers/theSportsDbUrls'

describe('TheSportsDB URL builders', () => {
  it('v1 URL includes API key segment in path', () => {
    const u = buildTheSportsDbV1Url('lookupPlayer', { apiKey: 'abc', params: { id: '123' } })
    expect(u).toContain('/api/v1/json/abc/lookupplayer.php')
    expect(u).toContain('id=123')
  })

  it('v2 path does not embed API key', () => {
    const p = buildTheSportsDbV2Path('lookupPlayer', { idPlayer: '456' })
    expect(p).toBe('/api/v2/json/lookup/player/456')
    expect(p.toLowerCase()).not.toContain('apikey')
  })

  it('v2 absolute URL combines host + path', () => {
    expect(buildTheSportsDbV2Url('/api/v2/json/livescore/all')).toBe(
      'https://www.thesportsdb.com/api/v2/json/livescore/all',
    )
  })

  it('image preview helper appends size segment', () => {
    const base = 'https://www.thesportsdb.com/images/media/player/cutout/x.png'
    expect(getTheSportsDbImagePreviewUrl(base, 'medium')).toContain('/medium')
    expect(getTheSportsDbImagePreviewUrl(`${base}/small`, 'tiny')).toContain('/tiny')
  })
})
