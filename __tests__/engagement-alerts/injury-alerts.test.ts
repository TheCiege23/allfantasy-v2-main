import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ injuries: vi.fn(), native: vi.fn(), rosters: vi.fn(), profile: vi.fn(), exists: vi.fn(), identity: vi.fn(), recipients: vi.fn(), dispatch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsInjury: { findMany: h.injuries }, redraftRosterPlayer: { findMany: h.native }, roster: { findMany: h.rosters }, userProfile: { findUnique: h.profile }, platformNotification: { findUnique: h.exists } } }))
vi.mock('@/lib/notifications/playerNewsRecipients', () => ({ FINISHED_SEASON_STATUSES: ['completed'], resolvePlayerNewsIdentity: h.identity, resolvePlayerNewsRecipients: h.recipients }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
import { notifySyncedInjuries, importedPlayerIsStarting } from '@/lib/engagement-alerts/injuryAlerts'
beforeEach(() => {
  vi.resetAllMocks()
  h.rosters.mockResolvedValue([]); h.profile.mockResolvedValue(null); h.exists.mockResolvedValue(null)
  h.native.mockResolvedValue([{ roster: { leagueId: 'league' } }])
  h.identity.mockImplementation(async ({ playerName, sport }) => ({ status: 'resolved', identity: { identityId: playerName, sport, sleeperId: '1' } }))
  h.recipients.mockResolvedValue({ byUser: new Map([['u', ['league']]]), degraded: false })
  h.dispatch.mockResolvedValue({ delivered: 1, failed: 0 })
})
describe('injury alerts', () => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'])('delivers actionable out-starter alerts in %s without a five-player cap', async sport => {
    h.injuries.mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ playerName: `Player ${i}`, status: 'Out', source: 'espn', externalId: String(i), date: new Date(), team: 'Team' })))
    const result = await notifySyncedInjuries(sport)
    expect(result.delivered).toBe(8)
    expect(h.dispatch).toHaveBeenCalledTimes(8)
    expect(h.dispatch.mock.calls[0][0]).toMatchObject({ category: 'lineup_alerts', type: 'injured_starter', skipChannels: { sms: true }, severity: 'high' })
  })
  it('keeps bench injuries as injury updates', async () => {
    h.native.mockResolvedValue([])
    h.injuries.mockResolvedValue([{ playerName: 'Player', status: 'Out', source: 'espn' }])
    await notifySyncedInjuries('NBA')
    expect(h.dispatch.mock.calls[0][0].category).toBe('injury_alerts')
  })
  it('recognizes imported starter shapes and excludes bench players', () => {
    expect(importedPlayerIsStarting({ starters: ['42'] }, '42')).toBe(true)
    expect(importedPlayerIsStarting({ starters: [{ playerId: 42 }] }, '42')).toBe(true)
    expect(importedPlayerIsStarting({ lineup_sections: { starters: [{ id: '42' }] } }, '42')).toBe(true)
    expect(importedPlayerIsStarting({ starters: ['24'], players: ['42', '24'] }, '42')).toBe(false)
  })
  it('does not substitute an ambiguous athlete', async () => {
    h.injuries.mockResolvedValue([{ playerName: 'Josh Allen', status: 'Out' }])
    h.identity.mockResolvedValue({ status: 'held', reason: 'ambiguous-identity' })
    await notifySyncedInjuries('NFL')
    expect(h.dispatch).not.toHaveBeenCalled()
  })
})
