import { describe, expect, it } from 'vitest'
import {
  CHIMMY_PAGE_SOURCE,
  initialChatScope,
  readChatPageSport,
  shouldGoBackInHistory,
  toChatPageLeagues,
} from '@/lib/chimmy/chatPage'

/*
 * The /chimmy/chat decisions that do not need a DOM: which leagues the scope picker offers, which
 * scope the page opens in, which `?sport=` is kept, and where "Back" goes.
 */

describe('toChatPageLeagues', () => {
  it('shapes a dashboard league the way /core shapes it for the drawer', () => {
    expect(
      toChatPageLeagues([
        { id: 'L1', name: 'KBFL', platform: 'Sleeper', platformLeagueId: '1180', isCommissioner: 1, teamCount: '12', extra: true },
      ]),
    ).toEqual([
      { id: 'L1', name: 'KBFL', platform: 'sleeper', platformLeagueId: '1180', isCommissioner: true, teamCount: 12 },
    ])
  })

  it('defaults the platform, the platform id and the counts rather than inventing them', () => {
    expect(toChatPageLeagues([{ id: 'L2', name: 'Home league' }])).toEqual([
      { id: 'L2', name: 'Home league', platform: 'manual', platformLeagueId: null, isCommissioner: false, teamCount: 0 },
    ])
  })

  it('drops rows the picker could not show or scope to', () => {
    expect(toChatPageLeagues([null, 'x', { id: '', name: 'No id' }, { id: 'L3', name: '  ' }, { id: 'L4', name: 'Kept' }])).toEqual([
      expect.objectContaining({ id: 'L4', name: 'Kept' }),
    ])
  })
})

describe('initialChatScope', () => {
  const leagues = [{ id: 'L1' }, { id: 'L2' }]

  it('opens in ?leagueId= when it is one of the viewer\'s leagues', () => {
    expect(initialChatScope('L2', leagues)).toBe('L2')
  })

  it('opens on All leagues for a league id anyone could have typed', () => {
    expect(initialChatScope('not-mine', leagues)).toBeNull()
    expect(initialChatScope('', leagues)).toBeNull()
    expect(initialChatScope(null, leagues)).toBeNull()
    expect(initialChatScope(undefined, [])).toBeNull()
  })
})

describe('readChatPageSport', () => {
  it('keeps a supported sport, uppercased', () => {
    expect(readChatPageSport('nba')).toBe('NBA')
    expect(readChatPageSport(' NFL ')).toBe('NFL')
    expect(readChatPageSport('ncaaf')).toBe('NCAAF')
  })

  it('drops anything else instead of guessing (normalizing would turn it into NFL)', () => {
    expect(readChatPageSport('cricket')).toBeNull()
    expect(readChatPageSport('')).toBeNull()
    expect(readChatPageSport(null)).toBeNull()
    expect(readChatPageSport(undefined)).toBeNull()
  })
})

describe('the page names itself the way it always has', () => {
  it('asks as messages_ai, the /chimmy/chat entry in the question row\'s vocabulary', () => {
    expect(CHIMMY_PAGE_SOURCE).toBe('messages_ai')
  })
})

describe('shouldGoBackInHistory', () => {
  const origin = 'https://allfantasy.ai'
  const base = { currentPath: '/chimmy/chat', origin, historyLength: 3, documentUrl: `${origin}/chimmy/chat?prompt=x`, referrer: '' }

  it('steps back after an in-app, client-side hop — even when the first load came from elsewhere', () => {
    expect(shouldGoBackInHistory({ ...base, documentUrl: `${origin}/core?league=L1`, referrer: 'https://mail.example.com/' })).toBe(true)
  })

  it('steps back after a full load from one of our pages', () => {
    expect(shouldGoBackInHistory({ ...base, referrer: `${origin}/player/123` })).toBe(true)
  })

  it('goes to /core from an email, another site, or a typed URL', () => {
    expect(shouldGoBackInHistory({ ...base, referrer: 'https://mail.example.com/inbox' })).toBe(false)
    expect(shouldGoBackInHistory({ ...base, referrer: '' })).toBe(false)
    expect(shouldGoBackInHistory({ ...base, referrer: 'not a url at all' })).toBe(false)
  })

  it('goes to /core when there is no history to step back through', () => {
    expect(shouldGoBackInHistory({ ...base, referrer: `${origin}/player/123`, historyLength: 1 })).toBe(false)
    expect(shouldGoBackInHistory({ ...base, documentUrl: `${origin}/core`, historyLength: 1 })).toBe(false)
  })

  it('never steps back into the sign-in round trip or onto this page again', () => {
    expect(shouldGoBackInHistory({ ...base, referrer: `${origin}/login?callbackUrl=%2Fchimmy%2Fchat` })).toBe(false)
    expect(shouldGoBackInHistory({ ...base, referrer: `${origin}/chimmy/chat?prompt=old` })).toBe(false)
    expect(shouldGoBackInHistory({ ...base, documentUrl: `${origin}/login`, referrer: '' })).toBe(false)
    expect(shouldGoBackInHistory({ ...base, documentUrl: `${origin}/auth/callback`, referrer: '' })).toBe(false)
  })

  it('does not treat a lookalike path as the sign-in page', () => {
    expect(shouldGoBackInHistory({ ...base, referrer: `${origin}/login-help` })).toBe(true)
  })
})
