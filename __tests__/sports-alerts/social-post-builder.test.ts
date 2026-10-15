// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  buildGameFinalPosts,
  buildGamePreviewPosts,
  buildHighlightPosts,
  buildStoryPosts,
  hashtagForTeam,
  xLength,
} from '@/lib/social-newsroom/postBuilder'
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
    expect(x.map((p) => p.tone).sort()).toEqual(['fun', 'straight', 'viral'])
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

describe('viral story prompts', () => {
  it('a trade gets an engagement prompt that keeps the credit and link', () => {
    const viral = buildStoryPosts(trade).find((p) => p.tone === 'viral')!
    expect(viral.platform).toBe('x')
    expect(viral.text).toMatch(/👇/)
    expect(viral.text).toContain('via @espn')
    expect(viral.text).toContain(trade.url)
    expect(viral.withinLimit).toBe(true)
  })
  it('injuries get no viral prompt', () => {
    const injury = { ...trade, title: 'Ravens WR suffers torn ACL, out for season', classification: classifyBreakingHeadline('Ravens WR suffers torn ACL, out for season') }
    expect(buildStoryPosts(injury).some((p) => p.tone === 'viral')).toBe(false)
  })
})

describe('game posts', () => {
  const knicks = {
    sport: 'NBA',
    awayTeam: 'Toronto Raptors',
    homeTeam: 'New York Knicks',
    startTime: '2026-10-15T23:30:00.000Z',
    venue: 'Madison Square Garden',
  }

  it('preview: straight, fun and viral posts, all from schedule facts only', () => {
    const posts = buildGamePreviewPosts(knicks)
    expect(posts.map((p) => p.tone)).toEqual(expect.arrayContaining(['straight', 'fun', 'viral']))
    const poll = posts.find((p) => p.text.includes('Repost for'))!
    expect(poll.text).toContain('🔁 Repost for Raptors')
    expect(poll.text).toContain('❤️ Like for Knicks')
    expect(poll.text).toContain('Tip-off: 7:30 PM ET')
    for (const p of posts) {
      expect(p.withinLimit).toBe(true)
      // No numbers beyond the clock — no invented stats or records.
      expect(p.text.replace(/\d{1,2}:\d{2} PM ET/g, '')).not.toMatch(/\d/)
    }
  })

  it('uses the right word for the start in each sport', () => {
    expect(buildGamePreviewPosts({ ...knicks, sport: 'MLB' }).some((p) => p.text.includes('First pitch:'))).toBe(true)
    expect(buildGamePreviewPosts({ ...knicks, sport: 'NHL' }).some((p) => p.text.includes('Puck drop:'))).toBe(true)
  })

  it('final: a close game is called close, and fans of both sides are addressed', () => {
    const posts = buildGameFinalPosts({ ...knicks, final: true, homeScore: 101, awayScore: 99 })
    expect(posts[0].text).toContain('FINAL')
    expect(posts[0].text).toContain('Toronto Raptors 99, New York Knicks 101')
    expect(posts.find((p) => p.tone === 'fun')!.text).toMatch(/FINISH|Heart rate|sweat|classic/)
    expect(posts.some((p) => p.text.includes('Knicks fans, how we feeling?') && p.text.includes('Raptors fans'))).toBe(true)
  })

  it('final: an overtime finish says so, in the sport’s own words', () => {
    const hockey = buildGameFinalPosts({ ...knicks, sport: 'NHL', final: true, homeScore: 3, awayScore: 2, overtime: true })
    expect(hockey.some((p) => p.text.includes('BONUS HOCKEY') && p.text.includes('FINAL/OT'))).toBe(true)
    const shootout = buildGameFinalPosts({ ...knicks, sport: 'NHL', final: true, homeScore: 2, awayScore: 3, overtime: true, shootout: true })
    expect(shootout.some((p) => p.text.includes('FINAL/SO'))).toBe(true)
    const baseball = buildGameFinalPosts({ ...knicks, sport: 'MLB', final: true, homeScore: 5, awayScore: 4, overtime: true })
    expect(baseball.some((p) => p.text.includes('FREE BASEBALL') && p.text.includes('extra innings'))).toBe(true)
  })

  it('no final posts without both scores', () => {
    expect(buildGameFinalPosts({ ...knicks, final: true, homeScore: null, awayScore: 3 })).toEqual([])
  })
})
