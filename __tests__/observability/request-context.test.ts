// @vitest-environment node
import { describe, expect, it } from 'vitest'

import {
  classifyDevice,
  classifyRequest,
  parseRequestUrl,
  readHeader,
  requestTags,
  routeKeyFor,
} from '@/lib/observability/requestContext'

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'
const ANDROID_PHONE =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36'
const ANDROID_TABLET = 'Mozilla/5.0 (Linux; Android 13; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const IPAD = 'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1'
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'
const WINDOWS_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0'

describe('classifyDevice', () => {
  it.each([
    [IPHONE, 'mobile'],
    [ANDROID_PHONE, 'mobile'],
    [ANDROID_TABLET, 'tablet'],
    [IPAD, 'tablet'],
    [MAC_CHROME, 'desktop'],
    [WINDOWS_EDGE, 'desktop'],
    ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)', 'bot'],
    ['facebookexternalhit/1.1', 'bot'],
    ['curl/8.4.0', 'bot'],
    ['node', 'bot'],
    // The two cron dispatchers (scripts/cron-dispatch.mjs, scripts/cron-fast-tier-loop.mjs).
    ['allfantasy-cron-dispatch/1', 'bot'],
    ['allfantasy-cron-fast-loop/1', 'bot'],
    ['', 'unknown'],
  ])('%s → %s', (ua, expected) => {
    expect(classifyDevice(ua)).toBe(expected)
  })

  it('lets the Sec-CH-UA-Mobile client hint override an ambiguous user-agent', () => {
    expect(classifyDevice(MAC_CHROME, '?1')).toBe('mobile')
    // …but a bot never becomes a phone because it sent the hint.
    expect(classifyDevice('curl/8.4.0', '?1')).toBe('bot')
  })
})

describe('classifyRequest — surfaces and /core screens', () => {
  it('reads the /core screen and whether a league scope was requested', () => {
    const c = classifyRequest({ url: 'https://www.allfantasy.ai/core/trades?league=cm123abc', headers: { 'user-agent': IPHONE } })
    expect(c).toMatchObject({ surface: 'core', screen: 'trades', leagueScoped: true, device: 'mobile', nav: 'document' })
    expect(c.routeKey).toBe('core:trades')
  })

  it('treats bare /core as the home screen, unscoped', () => {
    expect(classifyRequest({ url: '/core' })).toMatchObject({ surface: 'core', screen: 'home', leagueScoped: false })
    expect(classifyRequest({ url: '/core/?league=' })).toMatchObject({ screen: 'home', leagueScoped: false })
  })

  it('collapses a screen segment that is not a safe, bounded name to `other` (cardinality guard)', () => {
    expect(classifyRequest({ url: '/core/%3Cscript%3E' }).screen).toBe('other')
    expect(classifyRequest({ url: `/core/${'x'.repeat(60)}` }).screen).toBe('other')
    // Case is normalised rather than multiplied.
    expect(classifyRequest({ url: '/core/Trades' }).screen).toBe('trades')
  })

  it.each([
    ['/api/af-debug/sha', 'health'],
    ['/api/health', 'health'],
    ['/_next/static/chunks/main.js', 'asset'],
    ['/favicon.ico', 'asset'],
    ['/api/leagues/abc/standings', 'api'],
    ['/', 'landing'],
    ['/login', 'auth'],
    ['/admin/production-health', 'admin'],
    ['/league/abc123', 'league'],
    ['/players/josh-allen', 'players'],
    ['/pricing', 'page'],
  ])('%s → %s', (url, surface) => {
    expect(classifyRequest({ url }).surface).toBe(surface)
  })
})

describe('classifyRequest — jobs', () => {
  it('names a /api/cron job from its path', () => {
    const c = classifyRequest({ url: '/api/cron/draft-tick', headers: { 'user-agent': 'allfantasy-cron-fast-loop/1' } })
    expect(c).toMatchObject({ surface: 'job', job: 'draft-tick', nav: 'api', routeKey: 'job:draft-tick' })
  })

  it('recognises scheduled targets outside /api/cron by path, even from a hand-run curl', () => {
    expect(classifyRequest({ url: '/api/redraft/score-sync' })).toMatchObject({ surface: 'job', job: 'score-sync' })
    expect(classifyRequest({ url: '/api/brackets/playoffs/cron/refresh-schedule?sport=all' })).toMatchObject({
      surface: 'job',
      job: 'refresh-schedule',
    })
  })

  it('trusts the dispatcher user-agent for a path the list does not know', () => {
    expect(classifyRequest({ url: '/api/some/new-target', headers: { 'User-Agent': 'allfantasy-cron-dispatch/1' } }).surface).toBe('job')
  })
})

describe('classifyRequest — navigation kind', () => {
  it('distinguishes a document load, an RSC navigation and a prefetch', () => {
    expect(classifyRequest({ url: '/core/week' }).nav).toBe('document')
    expect(classifyRequest({ url: '/core/week', headers: { RSC: '1' } }).nav).toBe('rsc')
    expect(classifyRequest({ url: '/core/week?_rsc=1a2b3' }).nav).toBe('rsc')
    expect(classifyRequest({ url: '/core/week', headers: { rsc: '1', 'next-router-prefetch': '1' } }).nav).toBe('prefetch')
    expect(classifyRequest({ url: '/core/week', headers: { 'sec-purpose': 'prefetch;prerender' } }).nav).toBe('prefetch')
  })
})

describe('routeKeyFor', () => {
  it('keeps only the first segment for pages, so a crawl of slugs shares one budget', () => {
    expect(routeKeyFor('players', '/players/josh-allen', null, null)).toBe('players:/players')
    expect(routeKeyFor('players', '/players/c-j-stroud', null, null)).toBe('players:/players')
  })

  it('keeps three segments for API routes, collapsing id-looking ones', () => {
    expect(routeKeyFor('api', '/api/leagues/cm1a2b3c4d5e6f7g8h9i0/standings', null, null)).toBe('api:/api/leagues/:id')
    expect(routeKeyFor('api', '/api/leagues/import/commit', null, null)).toBe('api:/api/leagues/import')
  })
})

describe('helpers', () => {
  it('reads headers case-insensitively and tolerates arrays and missing bags', () => {
    expect(readHeader({ 'User-Agent': 'x' }, 'user-agent')).toBe('x')
    expect(readHeader({ accept: ['text/html', 'x'] }, 'Accept')).toBe('text/html')
    expect(readHeader(undefined, 'accept')).toBeNull()
  })

  it('never throws on a malformed URL', () => {
    expect(() => parseRequestUrl('http://[::1')).not.toThrow()
    expect(parseRequestUrl(null).pathname).toBe('/')
  })

  it('emits only the dimensions that apply, as strings', () => {
    expect(requestTags(classifyRequest({ url: '/core/players?league=x', headers: { 'user-agent': MAC_CHROME } }))).toEqual({
      'af.surface': 'core',
      'af.screen': 'players',
      'af.device': 'desktop',
      'af.nav': 'document',
      'af.league_scoped': 'yes',
    })
    const job = requestTags(classifyRequest({ url: '/api/cron/waivers' }))
    expect(job['af.job']).toBe('waivers')
    expect(job).not.toHaveProperty('af.screen')
  })
})
