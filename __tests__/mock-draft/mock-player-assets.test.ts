import { describe, expect, it } from 'vitest'

import { mockPlayerAssetUrls } from '@/lib/mock-draft/mockPlayerAssets'

describe('mock draft player assets', () => {
  it('keeps a real headshot and logo from the pool API', () => {
    const r = mockPlayerAssetUrls({
      id: 'x1',
      name: 'Nikola Jokic',
      team: 'DEN',
      sport: 'NBA',
      headshotUrl: 'https://cdn.example.com/headshots/nba/203999.png',
      teamLogoUrl: 'https://cdn.example.com/logos/den.png',
    })
    expect(r.headshotUrl).toBe('https://cdn.example.com/headshots/nba/203999.png')
    expect(r.teamLogoUrl).toBe('https://cdn.example.com/logos/den.png')
  })

  it('derives the Sleeper headshot for an NFL Sleeper id when none is stored', () => {
    const r = mockPlayerAssetUrls({ id: '4034', name: 'Christian McCaffrey', team: 'SF', sport: 'NFL' })
    expect(r.headshotUrl).toMatch(/sleepercdn\.com.*\/4034\.jpg$/)
  })

  it('never builds a Sleeper URL from a non-NFL numeric id (it would be a different person)', () => {
    const r = mockPlayerAssetUrls({ id: '4034', name: 'Some Center', team: 'DEN', sport: 'NBA' })
    expect(r.headshotUrl).toBeNull()
  })

  it('rejects a data-URI placeholder as a headshot so the avatar falls back to initials', () => {
    const r = mockPlayerAssetUrls({ id: 'n1', name: 'X Y', team: 'BOS', sport: 'NBA', headshotUrl: 'data:image/svg+xml;base64,AAAA' })
    expect(r.headshotUrl).toBeNull()
  })

  it('fills the logo from the team registry, and gives a free agent none', () => {
    expect(mockPlayerAssetUrls({ id: 'a', name: 'A', team: 'KC', sport: 'NFL' }).teamLogoUrl).toBeTruthy()
    expect(mockPlayerAssetUrls({ id: 'b', name: 'B', team: '', sport: 'NFL' }).teamLogoUrl).toBeNull()
  })
})
