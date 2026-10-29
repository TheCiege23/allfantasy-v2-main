import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ impacts: vi.fn(), observation: vi.fn(), saveObservation: vi.fn(), injuries: vi.fn(), native: vi.fn(), rosters: vi.fn(), profile: vi.fn(), exists: vi.fn(), identity: vi.fn(), recipients: vi.fn(), dispatch: vi.fn() }))
vi.mock('@/lib/prisma', () => ({ prisma: { sportsDataCache: { findUnique: h.observation, upsert: h.saveObservation }, sportsInjury: { findMany: h.injuries }, redraftRosterPlayer: { findMany: h.native }, roster: { findMany: h.rosters }, userProfile: { findUnique: h.profile }, platformNotification: { findUnique: h.exists } } }))
vi.mock('@/lib/notifications/playerNewsRecipients', () => ({ FINISHED_SEASON_STATUSES: ['completed'], resolvePlayerNewsIdentity: h.identity, resolvePlayerNewsRecipients: h.recipients }))
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: h.dispatch }))
/*
 * The lineup read (the Player Finder's picker) is stubbed: by default it answers the way its own
 * fallback does — starter or not, from the roster slot — so these tests pin the routing, and the
 * swap cases set their own answer.
 */
vi.mock('@/lib/notifications/lineupImpact', () => ({ resolveLineupImpacts: h.impacts }))
import { lineupImpactKind } from '@/lib/notifications/lineupImpactCopy'
import { notifySyncedInjuries, importedPlayerIsStarting } from '@/lib/engagement-alerts/injuryAlerts'
beforeEach(() => {
  vi.resetAllMocks()
  h.observation.mockResolvedValue(null); h.saveObservation.mockResolvedValue({})
  h.rosters.mockResolvedValue([]); h.profile.mockResolvedValue(null); h.exists.mockResolvedValue(null)
  h.native.mockResolvedValue([{ roster: { leagueId: 'league' } }])
  h.identity.mockImplementation(async ({ playerName, sport }) => ({ status: 'resolved', identity: { identityId: playerName, sport, sleeperId: '1' } }))
  h.recipients.mockResolvedValue({ byUser: new Map([['u', ['league']]]), degraded: false })
  h.dispatch.mockResolvedValue({ delivered: 1, failed: 0 })
  h.impacts.mockImplementation(async (a: { leagueIds: string[]; startingLeagueIds: string[]; bucket: never; prior: never }) =>
    a.leagueIds.map((leagueId) => ({ leagueId, leagueName: 'League', kind: lineupImpactKind({ bucket: a.bucket, prior: a.prior, isStarting: a.startingLeagueIds.includes(leagueId), call: null }),
      startName: null, benchName: null, delta: null, freeAgent: null, fixHref: null })))
})
describe('injury alerts', () => {
  it.each(['NFL', 'NBA', 'NHL', 'MLB', 'NCAAF', 'NCAAB', 'SOCCER'])('a ruled-out starter is a lineup alert, one per player, by push and email in %s', async sport => {
    h.injuries.mockResolvedValue(Array.from({ length: 3 }, (_, i) => ({ playerName: `Player ${i}`, status: 'Out', source: 'espn', externalId: String(i), date: new Date(), team: 'Team' })))
    const result = await notifySyncedInjuries(sport)
    expect(result.delivered).toBe(3)
    expect(h.dispatch).toHaveBeenCalledTimes(3)
    expect(h.dispatch.mock.calls[0][0]).toMatchObject({ category: 'lineup_alerts', type: 'injured_starter', skipChannels: { sms: true }, severity: 'high' })
    expect(h.dispatch.mock.calls[0][0].title).toMatch(/is OUT — your lineup options/)
  })
  it('keeps bench injuries as injury updates', async () => {
    h.native.mockResolvedValue([])
    h.injuries.mockResolvedValue([{ playerName: 'Player', team: 'Team', status: 'Out', source: 'espn', date: new Date() }])
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
  h.injuries.mockResolvedValue([{ playerName: 'Player', team: 'Team', status: 'Active', source: 'espn', date: new Date('2026-10-19T06:05:00Z') }])
  await notifySyncedInjuries('NFL', new Date('2026-10-20T08:00:00Z'))
  expect(h.dispatch).not.toHaveBeenCalled()
 })
 it('baselines undated snapshots without sending and alerts on an observed change', async () => {
  h.injuries.mockResolvedValue([{ playerName: 'Player', team: 'Team', status: 'Out', source: 'rolling_insights' }])
  await notifySyncedInjuries('NFL')
  expect(h.dispatch).not.toHaveBeenCalled()
  expect(h.saveObservation).toHaveBeenCalled()
  h.observation.mockResolvedValue({ data: { status: 'questionable' } })
  await notifySyncedInjuries('NFL')
  expect(h.dispatch).toHaveBeenCalledTimes(1)
 })
 it('does not mark a failed undated transition consumed', async () => {
  h.injuries.mockResolvedValue([{ playerName: 'Player', team: 'Team', status: 'Out', source: 'rolling_insights' }])
  h.observation.mockResolvedValue({ data: { status: 'questionable' } })
  h.dispatch.mockResolvedValue({ delivered: 0, failed: 1 })
  await notifySyncedInjuries('NFL')
  expect(h.saveObservation).not.toHaveBeenCalled()
 })
 it('uses the newest report once instead of replaying conflicting historical statuses', async () => {
  const now = new Date()
  h.injuries.mockResolvedValue([{ playerName: 'Player', team: 'Team', status: 'Out', source: 'espn', date: new Date(now.getTime()-60000) },{ playerName: 'Player', team: 'Team', status: 'Active', source: 'espn', date: now }])
  await notifySyncedInjuries('NFL', now)
  expect(h.dispatch).not.toHaveBeenCalled()
  expect(h.saveObservation).toHaveBeenCalled()
 })
})

describe('healthy recaps are not injury events', () => {
 it.each(['Active','Healthy','Available'])('baselines a fresh %s recap without email/push fanout', async status => {
  h.injuries.mockResolvedValue([{playerName:'Elijah Higgins',status,source:'espn',date:new Date(),description:"Higgins caught all three targets during Sunday's win."}])
  await notifySyncedInjuries('NFL')
  expect(h.dispatch).not.toHaveBeenCalled()
  expect(h.recipients).not.toHaveBeenCalled()
 })
 it('preserves a confirmed recovery and consumes it only after successful dispatch', async () => {
  h.observation.mockResolvedValue({data:{status:'questionable'}})
  h.injuries.mockResolvedValue([{playerName:'Player',team:'Team',status:'Active',source:'espn',date:new Date()}])
  await notifySyncedInjuries('NFL')
  expect(h.dispatch).toHaveBeenCalledTimes(1)
  expect(h.saveObservation.mock.calls.at(-1)[0].update.data.status).toBe('active')
 })
 it('does not consume a failed dated recovery', async () => {
  h.observation.mockResolvedValue({data:{status:'out'}})
  h.injuries.mockResolvedValue([{playerName:'Player',team:'Team',status:'Active',source:'espn',date:new Date()}])
  h.dispatch.mockResolvedValue({delivered:0,failed:1})
  await notifySyncedInjuries('NFL')
  expect(h.saveObservation).not.toHaveBeenCalled()
 })
})

it('bell-only updates are grouped per team and not repeated once delivered', async () => {
 h.native.mockResolvedValue([])
 h.injuries.mockResolvedValue([
  {playerName:'One',team:'ARI',status:'Out',source:'espn',date:new Date()},
  {playerName:'Two',team:'ARI',status:'Out',source:'espn',date:new Date()},
  {playerName:'Three',team:'BUF',status:'Out',source:'espn',date:new Date()},
 ])
 await notifySyncedInjuries('NFL')
 expect(h.dispatch).toHaveBeenCalledTimes(2)
 const arizona=h.dispatch.mock.calls.find(c=>c[0].meta.team==='ARI')![0]
 expect(arizona.body).toContain('One: out')
 expect(arizona.body).toContain('Two: out')
 h.dispatch.mockClear()
 h.observation.mockImplementation(async ({where})=>where.cacheKey.startsWith('injury-team-member:')?{data:{delivered:true}}:null)
 await notifySyncedInjuries('NFL')
 expect(h.dispatch).not.toHaveBeenCalled()
})

it('names the player and says they are still in the starting lineup', async () => {
 const { lineupAlertTitle } = await import('@/lib/engagement-alerts/injuryAlerts')
 expect(lineupAlertTitle([{ playerName: 'Bijan Robinson', status: 'out' }])).toBe('🚨 Bijan Robinson is OUT — still in your starting lineup')
 expect(lineupAlertTitle([{ playerName: 'A', status: 'injured reserve' }])).toContain('is on IR')
 expect(lineupAlertTitle([{ playerName: 'A', status: 'out' }, { playerName: 'B', status: 'out' }])).toBe('🚨 2 of your starters are out — fix your lineup')
})

describe('only lineup changes are pushed and emailed (owner, 2026-10-25)', () => {
 it('a starter ruled out gets push + email with the options; a bench player hurt is the bell only and never in the digest', async () => {
  h.impacts.mockResolvedValueOnce([{ leagueId: 'league', leagueName: 'Dynasty', kind: 'starter_out', startName: 'Backup Guy', benchName: null, delta: null, freeAgent: null, fixHref: '/fix' }])
  h.injuries.mockResolvedValue([{ playerName: 'Player', team: 'Team', status: 'Out', source: 'espn', date: new Date() }])
  await notifySyncedInjuries('NFL')
  const out = h.dispatch.mock.calls[0][0]
  expect(out.skipChannels).toEqual({ sms: true })
  expect(out.body).toBe('Dynasty: start Backup Guy in place of Player.')
  expect(out.actionHref).toBe('/fix')
  expect(out.meta.playerNews).toMatchObject({ delivery: 'instant', digest: false })
  h.dispatch.mockClear(); h.native.mockResolvedValue([])
  h.injuries.mockResolvedValue([{ playerName: 'Bench Guy', team: 'Team', status: 'Out', source: 'espn', date: new Date() }])
  await notifySyncedInjuries('NFL')
  expect(h.dispatch.mock.calls[0][0].skipChannels).toEqual({ sms: true, email: true, push: true })
  expect(h.dispatch.mock.calls[0][0].meta.playerNews).toMatchObject({ delivery: 'bell', digest: false, starter: false })
 })
 it('a bench player back healthy who out-projects a starter is told who to swap', async () => {
  h.native.mockResolvedValue([])
  h.observation.mockImplementation(async ({ where }) => where.cacheKey.startsWith('injury-observation:') ? { data: { status: 'questionable' } } : null)
  h.impacts.mockResolvedValueOnce([{ leagueId: 'league', leagueName: 'Dynasty', kind: 'bench_should_start', startName: 'Healthy Guy', benchName: 'Weak Starter', delta: 4.2, freeAgent: null, fixHref: null }])
  h.injuries.mockResolvedValue([{ playerName: 'Healthy Guy', team: 'Team', status: 'Active', source: 'espn', date: new Date() }])
  await notifySyncedInjuries('NFL')
  const out = h.dispatch.mock.calls[0][0]
  expect(out.title).toBe('💪 Healthy Guy is healthy — start him over Weak Starter')
  expect(out.body).toBe('Dynasty: start Healthy Guy over Weak Starter (+4.2 projected).')
  expect(out.skipChannels).toEqual({ sms: true })
 })
 it('a starter cleared from questionable is told he stays in', async () => {
  h.observation.mockImplementation(async ({ where }) => where.cacheKey.startsWith('injury-observation:') ? { data: { status: 'questionable' } } : null)
  h.injuries.mockResolvedValue([{ playerName: 'Player', team: 'Team', status: 'Active', source: 'espn', date: new Date() }])
  await notifySyncedInjuries('NFL')
  expect(h.dispatch.mock.calls[0][0]).toMatchObject({ title: '✅ Player is cleared to play', skipChannels: { sms: true } })
 })
 it('a player already on IR listed Out again is recorded and not sent', async () => {
  h.observation.mockImplementation(async ({ where }) => where.cacheKey.startsWith('injury-observation:') ? { data: { status: 'Injured Reserve' } } : null)
  h.injuries.mockResolvedValue([{ playerName: 'Player', team: 'Team', status: 'Out', source: 'espn', date: new Date() }])
  await notifySyncedInjuries('NFL')
  expect(h.dispatch).not.toHaveBeenCalled()
 })
})
