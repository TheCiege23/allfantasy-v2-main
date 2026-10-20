import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ observation: vi.fn(), saveObservation: vi.fn(), injuries: vi.fn(), native: vi.fn(), rosters: vi.fn(), profile: vi.fn(), exists: vi.fn(), identity: vi.fn(), recipients: vi.fn(), dispatch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: h.observation, upsert: h.saveObservation }, sportsInjury: { findMany: h.injuries }, redraftRosterPlayer: { findMany: h.native }, roster: { findMany: h.rosters }, userProfile: { findUnique: h.profile }, platformNotification: { findUnique: h.exists } } }))
vi.mock('@/lib/notifications/playerNewsRecipients', () => ({ FINISHED_SEASON_STATUSES: ['completed'], resolvePlayerNewsIdentity: h.identity, resolvePlayerNewsRecipients: h.recipients }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
import { notifySyncedInjuries, importedPlayerIsStarting } from '@/lib/engagement-alerts/injuryAlerts'
beforeEach(() => {
  vi.resetAllMocks()
  h.observation.mockResolvedValue(null); h.saveObservation.mockResolvedValue({})
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
    h.injuries.mockResolvedValue([{ playerName: 'Player', status: 'Out', source: 'espn', date: new Date() }])
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

describe('injury snapshot freshness', () => {
 it('does not fan out old reports merely because a sync refreshed them', async () => {
  h.injuries.mockResolvedValue([{ playerName: 'Player', status: 'Active', source: 'espn', date: new Date('2026-10-19T06:05:00Z') }])
  await notifySyncedInjuries('NFL', new Date('2026-10-20T08:00:00Z'))
  expect(h.dispatch).not.toHaveBeenCalled()
 })
 it('baselines undated snapshots without sending and alerts on an observed change', async () => {
  h.injuries.mockResolvedValue([{ playerName: 'Player', status: 'Out', source: 'rolling_insights' }])
  await notifySyncedInjuries('NFL')
  expect(h.dispatch).not.toHaveBeenCalled()
  expect(h.saveObservation).toHaveBeenCalled()
  h.observation.mockResolvedValue({ data: { status: 'questionable' } })
  await notifySyncedInjuries('NFL')
  expect(h.dispatch).toHaveBeenCalledTimes(1)
 })
 it('does not mark a failed undated transition consumed', async () => {
  h.injuries.mockResolvedValue([{ playerName: 'Player', status: 'Out', source: 'rolling_insights' }])
  h.observation.mockResolvedValue({ data: { status: 'questionable' } })
  h.dispatch.mockResolvedValue({ delivered: 0, failed: 1 })
  await notifySyncedInjuries('NFL')
  expect(h.saveObservation).not.toHaveBeenCalled()
 })
 it('uses the newest report once instead of replaying conflicting historical statuses', async () => {
  const now = new Date()
  h.injuries.mockResolvedValue([{ playerName: 'Player', status: 'Out', source: 'espn', date: new Date(now.getTime()-60000) },{ playerName: 'Player', status: 'Active', source: 'espn', date: now }])
  await notifySyncedInjuries('NFL', now)
  expect(h.dispatch).toHaveBeenCalledTimes(1)
  expect(h.dispatch.mock.calls[0][0].title).toBe('Player: active')
 })
})
