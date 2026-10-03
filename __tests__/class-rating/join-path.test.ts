// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/prisma', () => ({ prisma: {} }))

import { isOpenLeague, joinPathFor } from '@/lib/league-join/joinDivisionGate'

const publicLeague = { inviteCode: 'AbC123', league_privacy_visibility: 'public' }

describe('isOpenLeague — does this league hand its code to anyone who looks?', () => {
  it('a private league is not open; a public, public-dashboard or orphan-seeking one is', () => {
    expect(isOpenLeague({ inviteCode: 'x' })).toBe(false)
    expect(isOpenLeague(publicLeague)).toBe(true)
    expect(isOpenLeague({ inviteCode: 'x', publicDashboard: true })).toBe(true)
    // /api/discover/orphans publishes the code of every orphan-seeking league, public or not.
    expect(isOpenLeague({ inviteCode: 'x', orphanSeeking: true })).toBe(true)
  })

  it('a public league with its invite link switched off publishes no code', () => {
    expect(isOpenLeague({ ...publicLeague, league_allow_invite_link: false })).toBe(false)
  })

  it('reads junk settings as private', () => {
    expect(isOpenLeague(null)).toBe(false)
    expect(isOpenLeague('nope')).toBe(false)
    expect(isOpenLeague([1, 2])).toBe(false)
  })
})

describe('joinPathFor', () => {
  it('🛑 the league code is an OPEN join only when the league publishes it', () => {
    expect(joinPathFor(publicLeague, { kind: 'league_code' })).toBe('open')
    expect(joinPathFor({ inviteCode: 'x' }, { kind: 'league_code' })).toBe('invited')
  })

  it('🛑 an invite token is open only when it IS the published code — case-insensitively', () => {
    expect(joinPathFor(publicLeague, { kind: 'invite_token', token: 'abc123' })).toBe('open')
    expect(joinPathFor(publicLeague, { kind: 'invite_token', token: ' ABC123 ' })).toBe('open')
    expect(joinPathFor(publicLeague, { kind: 'invite_token', token: 'personal-token-9' })).toBe('invited')
    expect(joinPathFor({ inviteCode: 'abc123' }, { kind: 'invite_token', token: 'abc123' })).toBe('invited')
  })
})
