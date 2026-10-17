import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isApiSportsImageUrl,
  normalizeTheSportsDbImageUrl,
} from '@/lib/player-assets/imageUrlHygiene'

/**
 * Measured 2026-10-01: 106 of 106 sampled stored `www.thesportsdb.com` image URLs
 * returned 404, while the same path on `r2.` served the image. The vendor contract
 * already said to normalize the two hosts at ingestion.
 */
describe('normalizeTheSportsDbImageUrl', () => {
  it('moves a www. image URL onto r2.', () => {
    expect(
      normalizeTheSportsDbImageUrl('https://www.thesportsdb.com/images/media/player/cutout/5py4f01789462453.png'),
    ).toBe('https://r2.thesportsdb.com/images/media/player/cutout/5py4f01789462453.png')
  })

  it('leaves r2. and non-TheSportsDB URLs alone', () => {
    const r2 = 'https://r2.thesportsdb.com/images/media/team/badge/tar4cv1564336761.png'
    const espn = 'https://a.espncdn.com/i/headshots/college-football/players/full/4880203.png'
    expect(normalizeTheSportsDbImageUrl(r2)).toBe(r2)
    expect(normalizeTheSportsDbImageUrl(espn)).toBe(espn)
  })

  it('passes null through', () => {
    expect(normalizeTheSportsDbImageUrl(null)).toBeNull()
    expect(normalizeTheSportsDbImageUrl(undefined)).toBeNull()
  })
})

describe('isApiSportsImageUrl', () => {
  it('recognises the api-sports media host only', () => {
    expect(isApiSportsImageUrl('https://media.api-sports.io/american-football/players/60595.png')).toBe(true)
    expect(isApiSportsImageUrl('https://media.api-sports.io/football/players/657.png')).toBe(true)
    expect(isApiSportsImageUrl('https://sleepercdn.com/content/nfl/players/thumb/1725.jpg')).toBe(false)
    expect(isApiSportsImageUrl(null)).toBe(false)
  })
})

describe('isPlaceholderHeadshot', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('node:crypto')
    vi.resetModules()
  })

  const imageResponse = (status = 200) =>
    ({ ok: status === 200, status, arrayBuffer: async () => new ArrayBuffer(8) }) as unknown as Response

  it('never fetches a non-api-sports URL', async () => {
    const { isPlaceholderHeadshot } = await import('@/lib/player-assets/apiSportsPlaceholder')
    const fetchMock = vi.fn()
    const r = await isPlaceholderHeadshot('https://r2.thesportsdb.com/images/x.png', fetchMock as never)
    expect(r).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reports a real image as not a placeholder', async () => {
    const { isPlaceholderHeadshot } = await import('@/lib/player-assets/apiSportsPlaceholder')
    const r = await isPlaceholderHeadshot(
      'https://media.api-sports.io/american-football/players/40.png',
      vi.fn(async () => imageResponse()) as never,
    )
    expect(r).toBe(false)
  })

  it('reports a known placeholder hash as a placeholder', async () => {
    // Positive control for the true branch: pin the digest to a listed hash.
    vi.doMock('node:crypto', () => {
      const createHash = () => ({ update: () => ({ digest: () => '68ac0d5773da5ee81444ade70d89533d' }) })
      return { createHash, default: { createHash } }
    })
    const { isPlaceholderHeadshot } = await import('@/lib/player-assets/apiSportsPlaceholder')
    const r = await isPlaceholderHeadshot(
      'https://media.api-sports.io/american-football/players/60595.png',
      vi.fn(async () => imageResponse()) as never,
    )
    expect(r).toBe(true)
  })

  it('returns null — "cannot tell" — on a non-200 or a network failure', async () => {
    const { isPlaceholderHeadshot } = await import('@/lib/player-assets/apiSportsPlaceholder')
    const url = 'https://media.api-sports.io/american-football/players/60595.png'
    expect(await isPlaceholderHeadshot(url, vi.fn(async () => imageResponse(503)) as never)).toBeNull()
    expect(
      await isPlaceholderHeadshot(url, vi.fn(async () => { throw new Error('ECONNRESET') }) as never),
    ).toBeNull()
  })
})
