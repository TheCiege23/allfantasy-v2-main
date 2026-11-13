// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * A commissioner who turns the invite link off expects it to stop working — for every league.
 *
 * validateFantasyInviteCode refused a disabled link only when the league was `invite_only`, so a
 * private (the default) or public league with its link switched off still let anyone holding the
 * code walk in. And every validation read EVERY league with its whole settings JSON to find one
 * code; it now asks the database for the one league whose code matches.
 */

const h = vi.hoisted(() => ({
  queryRaw: vi.fn(),
  findMany: vi.fn(),
  findUnique: vi.fn(),
  roster: vi.fn(),
  seats: vi.fn(),
}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRaw: h.queryRaw,
    league: { findMany: h.findMany, findUnique: h.findUnique },
    roster: { findUnique: h.roster },
  },
}))
vi.mock('@/lib/league/leagueSeats', () => ({ countSeatsHeldByPeople: h.seats }))

import { validateFantasyInviteCode } from '@/lib/league-invite/InviteValidationResolver'

function league(settings: Record<string, unknown>) {
  return { id: 'L1', name: 'Backyard Ballers', sport: 'NFL', leagueSize: 12, settings: { inviteCode: 'Join-Code', ...settings } }
}

beforeEach(() => {
  h.queryRaw.mockReset().mockResolvedValue([{ id: 'L1' }])
  h.findMany.mockReset().mockResolvedValue([])
  h.findUnique.mockReset().mockResolvedValue(league({}))
  h.roster.mockReset().mockResolvedValue(null)
  h.seats.mockReset().mockResolvedValue(3)
})

describe('a turned-off invite link', () => {
  it('is refused for a PRIVATE league (the default visibility)', async () => {
    h.findUnique.mockResolvedValue(league({ league_privacy_visibility: 'private', league_allow_invite_link: false }))
    expect(await validateFantasyInviteCode('join-code', { userId: 'u-new' })).toMatchObject({
      valid: false,
      error: 'INVITE_DISABLED',
    })
  })

  it('is refused for a league with no visibility key at all', async () => {
    h.findUnique.mockResolvedValue(league({ league_allow_invite_link: false }))
    expect(await validateFantasyInviteCode('join-code')).toMatchObject({ valid: false, error: 'INVITE_DISABLED' })
  })

  it('is refused for a PUBLIC league too', async () => {
    h.findUnique.mockResolvedValue(league({ league_privacy_visibility: 'public', league_allow_invite_link: false }))
    expect(await validateFantasyInviteCode('join-code', { userId: 'u-new' })).toMatchObject({
      valid: false,
      error: 'INVITE_DISABLED',
    })
  })

  it('is still refused for an invite-only league (unchanged)', async () => {
    h.findUnique.mockResolvedValue(league({ league_privacy_visibility: 'invite_only', league_allow_invite_link: false }))
    expect(await validateFantasyInviteCode('join-code')).toMatchObject({ valid: false, error: 'INVITE_DISABLED' })
  })

  it('still sends a manager who is already in the league to it', async () => {
    h.findUnique.mockResolvedValue(league({ league_privacy_visibility: 'private', league_allow_invite_link: false }))
    h.roster.mockResolvedValue({ id: 'r1' })
    expect(await validateFantasyInviteCode('join-code', { userId: 'member' })).toMatchObject({
      valid: false,
      error: 'ALREADY_MEMBER',
      preview: { leagueId: 'L1' },
    })
  })

  it('a link that is on (or never set) still joins', async () => {
    h.findUnique.mockResolvedValue(league({ league_privacy_visibility: 'private' }))
    expect(await validateFantasyInviteCode('join-code', { userId: 'u-new' })).toMatchObject({ valid: true })
    h.findUnique.mockResolvedValue(league({ league_privacy_visibility: 'private', league_allow_invite_link: true }))
    expect(await validateFantasyInviteCode('join-code', { userId: 'u-new' })).toMatchObject({ valid: true })
  })
})

describe('finding the league a code points at', () => {
  it('asks the database for that one league instead of reading every league', async () => {
    await validateFantasyInviteCode('  Join-Code  ')
    expect(h.findMany).not.toHaveBeenCalled()
    expect(h.queryRaw).toHaveBeenCalledTimes(1)
    const [strings, ...values] = h.queryRaw.mock.calls[0] as [TemplateStringsArray, ...unknown[]]
    const sql = strings.join('?')
    // Trimmed and case-insensitive, the same comparison the in-memory scan made.
    expect(sql).toContain("lower(btrim(settings->>'inviteCode')) = lower(?)")
    expect(sql).toContain('LIMIT 1')
    // Parameterised, never interpolated into the SQL text.
    expect(values).toEqual(['Join-Code'])
    expect(sql).not.toContain('Join-Code')
    expect(h.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'L1' } }))
  })

  it('a code no league has is INVALID_CODE without loading any league', async () => {
    h.queryRaw.mockResolvedValue([])
    expect(await validateFantasyInviteCode('nope')).toEqual({ valid: false, error: 'INVALID_CODE' })
    expect(h.findUnique).not.toHaveBeenCalled()
  })

  it('an empty code never reaches the database', async () => {
    expect(await validateFantasyInviteCode('   ')).toEqual({ valid: false, error: 'INVALID_CODE' })
    expect(h.queryRaw).not.toHaveBeenCalled()
  })
})
