// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { buildHighlightPosts, buildStoryPosts, hashtagForTeam, xLength } from '@/lib/social-newsroom/postBuilder'
import { classifyBreakingHeadline } from '@/lib/news/breakingNews'

const trade = {
  sport: 'NFL',
  title: 'Sources: Cardinals trade Marvin Harrison Jr. to Texans',
  description: 'Arizona is sending the receiver to Houston.',
  url: 'https://www.espn.com/nfl/story/_/id/123/cardinals-trade-marvin-harrison-jr-texans',
  outletName: 'ESPN',
  outletHandle: '@espn',
  classification: classifyBreakingHeadline('Sources: Cardinals trade Marvin Harrison Jr. to Texans'),
  teamNames: ['Arizona Cardinals', 'Houston Texans'],
}

describe('buildStoryPosts', () => {
  it('every post keeps the verbatim headline and credits the source', () => {
    const posts = buildStoryPosts(trade)
    expect(posts.length).toBeGreaterThanOrEqual(5)
    for (const p of posts) {
      expect(p.text).toContain(trade.title)
      expect(/espn/i.test(p.text)).toBe(true)
    }
    const x = posts.filter((p) => p.platform === 'x')
    expect(x.map((p) => p.tone).sort()).toEqual(['fun', 'straight'])
    for (const p of x) {
      expect(p.text).toContain('via @espn')
      expect(p.text).toContain(trade.url)
      expect(p.withinLimit).toBe(true)
    }
  })
  it('labels a sourced report as a report', () => {
    expect(buildStoryPosts(trade).find((p) => p.platform === 'x' && p.tone === 'straight')!.text).toContain('(report)')
  })
  it('never jokes about injuries or tragedies', () => {
    const injury = { ...trade, title: 'Ravens WR suffers torn ACL, out for season', classification: classifyBreakingHeadline('Ravens WR suffers torn ACL, out for season') }
    expect(buildStoryPosts(injury).every((p) => p.tone === 'straight')).toBe(true)
    const sombre = { ...trade, title: 'Former Pro Bowler dies at 54', classification: null }
    expect(buildStoryPosts(sombre).every((p) => p.tone === 'straight')).toBe(true)
  })
  it('trims a long headline to fit X with the link and credit intact', () => {
    const long = { ...trade, title: 'A'.repeat(400) }
    const x = buildStoryPosts(long).find((p) => p.platform === 'x')!
    expect(xLength(x.text)).toBeLessThanOrEqual(280)
    expect(x.text).toContain(trade.url)
  })
})

describe('highlights and hashtags', () => {
  it('shares the YouTube link rather than a file, and credits it', () => {
    const posts = buildHighlightPosts({ sport: 'NBA', homeTeam: 'Boston Celtics', awayTeam: 'New York Knicks', homeScore: 101, awayScore: 99, videoUrl: 'https://www.youtube.com/watch?v=abcdefghijk' })
    expect(posts[0].text).toContain('https://www.youtube.com/watch?v=abcdefghijk')
    expect(posts[0].text).toContain('#Knicks')
  })
  it('hashtags nicknames', () => {
    expect(hashtagForTeam('Portland Trail Blazers')).toBe('#TrailBlazers')
    expect(hashtagForTeam('Houston Texans')).toBe('#Texans')
  })
})
