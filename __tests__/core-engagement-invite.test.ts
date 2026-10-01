import { describe, expect, it } from 'vitest'
import { inviteLinkForFocus, joinedLeagueDestination, readLeagueInviteFocus } from '@/lib/league-invite/engagementInvite'

describe('league invitation activity focus', () => {
  it('keeps the original join code while selecting an activity', () => {
    const base = 'https://allfantasy.ai/join?code=ABC123'
    expect(inviteLinkForFocus(base, 'league')).toBe(base)
    expect(inviteLinkForFocus(base, 'rivalry')).toBe(`${base}&focus=rivalry`)
    expect(inviteLinkForFocus(base, 'chat')).toBe(`${base}&focus=chat`)
  })

  it('accepts only supported activities and uses the joined league id', () => {
    expect(readLeagueInviteFocus('https://evil.example')).toBe('league')
    expect(readLeagueInviteFocus('chat')).toBe('chat')
    expect(joinedLeagueDestination('league 1', 'league')).toBe('/league/league%201')
    expect(joinedLeagueDestination('league 1', 'rivalry')).toBe('/core/week?league=league%201&view=rivalries')
    expect(joinedLeagueDestination('league 1', 'chat')).toBe('/league/league%201?tab=league_chat')
  })
})
