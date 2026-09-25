import { describe, expect, it } from 'vitest'
import { toImageUrl } from '@/lib/media/imageUrl'
import { buildEnrichedPlayer, resolveHeadshotCandidates } from '@/lib/players/buildPlayerMap'

describe('toImageUrl', () => {
  it('keeps real URLs', () => {
    expect(toImageUrl('https://a.espncdn.com/x.png')).toBe('https://a.espncdn.com/x.png')
    expect(toImageUrl('http://x.test/a.jpg')).toBe('http://x.test/a.jpg')
    expect(toImageUrl('//cdn.test/a.jpg')).toBe('//cdn.test/a.jpg')
    expect(toImageUrl('/brand/af.png')).toBe('/brand/af.png')
    expect(toImageUrl('  https://x.test/a.png  ')).toBe('https://x.test/a.png')
  })

  it("drops Rolling Insights' `contact_support` placeholder and other non-URLs", () => {
    // Production 2026-09-25: 9,555 NFL rows carried this literal as imageUrl.
    expect(toImageUrl('contact_support')).toBeNull()
    expect(toImageUrl('N/A')).toBeNull()
    expect(toImageUrl('')).toBeNull()
    expect(toImageUrl(null)).toBeNull()
    expect(toImageUrl(42)).toBeNull()
  })
})

describe('headshot candidates', () => {
  it('never offers a placeholder word as an <img src>, and still offers the Sleeper fallback', () => {
    const player = buildEnrichedPlayer({
      sleeper_id: '1373',
      full_name: 'Geno Smith',
      position: 'QB',
      team: 'NYJ',
      sport: 'NFL',
      headshot_url: 'contact_support',
    })
    const chain = resolveHeadshotCandidates(player)
    expect(chain).not.toContain('contact_support')
    expect(chain.length).toBeGreaterThan(0)
    expect(chain.every((u) => /^https?:\/\//.test(u) || u.startsWith('/'))).toBe(true)
  })
})
