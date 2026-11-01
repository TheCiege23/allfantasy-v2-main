import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import {
  COMMUNITY_CHANNELS,
  clubhouseChannelHref,
  clubhousePostHref,
  getChannel,
  isChannelSlug,
} from '@/lib/community/channels'
import {
  createPostSchema,
  NEW_ACCOUNT_DAILY_POSTS,
  NEW_ACCOUNT_DAILY_REPLIES,
  newAccountLimitMessage,
  normalizeTags,
  replySchema,
} from '@/lib/community/validation'
import { linkifySegments, timeAgo } from '@/lib/community/format'
import { mentionedUsernames } from '@/lib/community/notify'
import { badgesFor, excerptOf, staffEmailSet } from '@/lib/community/service'

/**
 * Clubhouse rules that need no database: what a post may contain, who counts as new,
 * which badges a name gets, and what a stranger's text can and cannot become on screen.
 */

const NOW = new Date('2026-10-30T12:00:00Z')
const HOUR = 60 * 60 * 1000

describe('channels', () => {
  it('slugs are unique, because every post stores one', () => {
    const slugs = COMMUNITY_CHANNELS.map((c) => c.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('no slug can collide with a static /clubhouse route', () => {
    for (const c of COMMUNITY_CHANNELS) expect(['new', 'post', 'moderation']).not.toContain(c.slug)
  })

  it('resolves known slugs only', () => {
    expect(getChannel('commish-corner')?.label).toBe('Commish Corner')
    expect(getChannel('nope')).toBeNull()
    expect(isChannelSlug('league-lab')).toBe(true)
    expect(isChannelSlug(42)).toBe(false)
  })

  it('builds hrefs, including a reply anchor', () => {
    expect(clubhouseChannelHref('other-apps')).toBe('/clubhouse/other-apps')
    expect(clubhousePostHref('p1')).toBe('/clubhouse/post/p1')
    expect(clubhousePostHref('p1', 'r9')).toBe('/clubhouse/post/p1#reply-r9')
  })

  it('introductions starts people off with a prompt', () => {
    expect(getChannel('introductions')?.starter?.body).toMatch(/weirdest rule/)
  })
})

describe('post validation', () => {
  it('accepts a normal post and trims it', () => {
    const r = createPostSchema.safeParse({ channel: 'commish-corner', title: '  Keeper deadlines?  ', body: ' When? ' })
    expect(r.success && r.data.title).toBe('Keeper deadlines?')
    expect(r.success && r.data.tags).toEqual([])
  })

  it('rejects an unknown channel, a too-short title and an empty body', () => {
    expect(createPostSchema.safeParse({ channel: 'random', title: 'Hello', body: 'x' }).success).toBe(false)
    expect(createPostSchema.safeParse({ channel: 'commish-corner', title: 'Hi', body: 'x' }).success).toBe(false)
    expect(createPostSchema.safeParse({ channel: 'commish-corner', title: 'Hello', body: '   ' }).success).toBe(false)
  })

  it('tags: known sports only, upper-cased, deduped, capped at three', () => {
    expect(normalizeTags(['nfl', 'NFL', 'cricket', 'nba', 'mlb', 'nhl'])).toEqual(['NFL', 'NBA', 'MLB'])
    expect(normalizeTags('NFL')).toEqual([])
  })

  it('replies need text', () => {
    expect(replySchema.safeParse({ body: '' }).success).toBe(false)
    expect(replySchema.safeParse({ body: 'Agreed' }).success).toBe(true)
  })
})

describe('new-account limits', () => {
  const fresh = new Date(NOW.getTime() - 2 * HOUR)
  const old = new Date(NOW.getTime() - 25 * HOUR)

  it('a day-old account is not limited at all', () => {
    expect(newAccountLimitMessage({ kind: 'post', accountCreatedAt: old, countInLastDay: 99, now: NOW })).toBeNull()
  })

  it('a brand-new account gets three posts and fifteen replies', () => {
    const post = (n: number) => newAccountLimitMessage({ kind: 'post', accountCreatedAt: fresh, countInLastDay: n, now: NOW })
    const reply = (n: number) => newAccountLimitMessage({ kind: 'reply', accountCreatedAt: fresh, countInLastDay: n, now: NOW })
    expect(post(NEW_ACCOUNT_DAILY_POSTS - 1)).toBeNull()
    expect(post(NEW_ACCOUNT_DAILY_POSTS)).toMatch(/first day/)
    expect(reply(NEW_ACCOUNT_DAILY_REPLIES - 1)).toBeNull()
    expect(reply(NEW_ACCOUNT_DAILY_REPLIES)).toMatch(/first day/)
  })
})

describe('badges', () => {
  const staff = staffEmailSet('founder@allfantasy.ai, other@x.com')
  const base = { id: 'u1', email: 'someone@gmail.com', createdAt: new Date(NOW.getTime() - 30 * 24 * HOUR) }

  it('staff comes from ADMIN_EMAILS, case-insensitively', () => {
    expect(badgesFor({ ...base, email: 'Founder@AllFantasy.ai' }, { staff, commish: new Set(), now: NOW.getTime() })).toEqual(['staff'])
  })

  it('an empty ADMIN_EMAILS makes nobody staff', () => {
    expect(staffEmailSet('').size).toBe(0)
  })

  it('commish and new stack', () => {
    const newbie = { ...base, createdAt: new Date(NOW.getTime() - 2 * 24 * HOUR) }
    expect(badgesFor(newbie, { staff, commish: new Set(['u1']), now: NOW.getTime() })).toEqual(['commish', 'new'])
    expect(badgesFor(base, { staff, commish: new Set(), now: NOW.getTime() })).toEqual([])
  })
})

describe('rendering untrusted text', () => {
  it('links http(s) URLs and leaves trailing punctuation outside the link', () => {
    const segs = linkifySegments('See https://allfantasy.ai/clubhouse. Thoughts?')
    expect(segs).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://allfantasy.ai/clubhouse', href: 'https://allfantasy.ai/clubhouse' },
      { kind: 'text', text: '. Thoughts?' },
    ])
  })

  it('never links javascript: or data: URLs', () => {
    for (const text of ['javascript:alert(1)', 'data:text/html,<b>x</b>', 'www.example.com']) {
      expect(linkifySegments(text).every((s) => s.kind === 'text')).toBe(true)
    }
  })

  it('keeps everything else as text, markup included', () => {
    expect(linkifySegments('<img src=x onerror=alert(1)>')).toEqual([{ kind: 'text', text: '<img src=x onerror=alert(1)>' }])
  })

  it('excerpts flatten whitespace and cut with an ellipsis', () => {
    expect(excerptOf('a\n\n  b')).toBe('a b')
    expect(excerptOf('x'.repeat(300), 10)).toBe(`${'x'.repeat(9)}…`)
  })

  it('relative time', () => {
    expect(timeAgo(new Date(NOW.getTime() - 30_000).toISOString(), NOW.getTime())).toBe('just now')
    expect(timeAgo(new Date(NOW.getTime() - 3 * HOUR).toISOString(), NOW.getTime())).toBe('3h ago')
  })
})

describe('mentions', () => {
  it('dedupes case-insensitively and drops @all, @global and @chimmy', () => {
    expect(mentionedUsernames('@Guap thoughts? @guap @all @chimmy @global @sam_1')).toEqual(['guap', 'sam_1'])
  })

  it('caps how many people one post can ping', () => {
    const many = Array.from({ length: 30 }, (_, i) => `@user${i}`).join(' ')
    expect(mentionedUsernames(many)).toHaveLength(10)
  })
})
