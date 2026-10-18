/**
 * survivor-core §5: the eight Survivor notifications go through the existing Survivor queue and the
 * shared dispatcher. Copy never carries a voter, a tally before the reveal or another manager's idol;
 * the idol email never names the idol; vote reminders reach only managers who have not voted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  renderSurvivorNotificationEmail,
  SURVIVOR_NOTIFICATION_KINDS,
  SURVIVOR_NOTIFICATION_SPECS,
  survivorNotificationCopy,
  type SurvivorNotificationInput,
} from '@/lib/survivor/survivorNotificationCatalog'
import idolCatalog from '@/lib/survivor/idols/catalog.json'

const db = vi.hoisted(() => ({
  survivorNotification: { findMany: vi.fn(), updateMany: vi.fn(), update: vi.fn(), create: vi.fn() },
  leagueTeam: { findMany: vi.fn(), findFirst: vi.fn() },
  survivorPlayer: { findMany: vi.fn() },
  survivorTribalCouncil: { findFirst: vi.fn() },
  survivorVote: { findMany: vi.fn() },
  league: { findUnique: vi.fn() },
}))
vi.mock('@/lib/prisma', () => ({ prisma: db }))
const dispatch = vi.hoisted(() => vi.fn())
vi.mock('@/lib/notifications/NotificationDispatcher', () => ({ dispatchNotification: dispatch }))
vi.mock('@/lib/site-public-origin', () => ({ getPublicSiteOrigin: () => 'https://www.allfantasy.ai' }))

import { enqueueSurvivorCoreNotification, notifyIdolAssigned, processNotificationQueue, resolveVoteReminderRecipients, scheduleTribalReminders } from '@/lib/survivor/notificationEngine'

const inputs: SurvivorNotificationInput[] = [
  { kind: 'votes_close_soon' }, { kind: 'immunity_won', week: 6 }, { kind: 'idol_found' }, { kind: 'torch_out', week: 6, next: 'exile' },
  { kind: 'tribe_swap' }, { kind: 'back_from_exile' }, { kind: 'jury_vote_open' }, { kind: 'season_champion', championName: 'TheCiege26', leagueName: 'Blah Survivor' },
]

describe('catalogue', () => {
  it('has all eight notifications with a trigger and channels', () => {
    expect(SURVIVOR_NOTIFICATION_KINDS).toHaveLength(8)
    for (const kind of SURVIVOR_NOTIFICATION_KINDS) expect(SURVIVOR_NOTIFICATION_SPECS[kind].trigger.length).toBeGreaterThan(5)
  })

  it('never carries votes, tallies or idol names in push copy', () => {
    const idolNames = (idolCatalog as { name: string }[]).map(i => i.name).filter(n => n && n.length > 3)
    for (const input of inputs) {
      const { title, body } = survivorNotificationCopy(input)
      const text = `${title} ${body}`
      expect(text).not.toMatch(/voted for|\d+\s*[–-]\s*\d+|ballot from|tally/i)
      for (const name of idolNames) expect(text.toLowerCase()).not.toContain(name.toLowerCase())
      expect(text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u)
    }
  })

  it('renders a 600px email from the push copy with a settings link, escaping everything', () => {
    const { subject, html } = renderSurvivorNotificationEmail('idol_found', { title: 'You found an idol', body: 'Body <script>x</script>', leagueId: 'L1', leagueName: 'A & B', sport: 'NFL', baseUrl: 'https://www.allfantasy.ai' })
    expect(subject).toBe('You found an idol')
    expect(html).toContain('width="600"')
    expect(html).toContain('https://www.allfantasy.ai/settings?tab=notifications')
    expect(html).toContain('Cinzel')
    expect(html).toContain('A &amp; B')
    expect(html).not.toContain('<script>x')
    const idolNames = (idolCatalog as { name: string }[]).map(i => i.name).filter(n => n && n.length > 3)
    for (const name of idolNames) expect(html.toLowerCase()).not.toContain(name.toLowerCase())
  })
})

describe('queue and dispatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.survivorNotification.updateMany.mockResolvedValue({ count: 1 })
    db.survivorNotification.update.mockResolvedValue({})
    db.survivorNotification.create.mockResolvedValue({ id: 'n1' })
    db.league.findUnique.mockResolvedValue({ name: 'Blah Survivor', sport: 'NFL' })
    db.survivorTribalCouncil.findFirst.mockResolvedValue({ id: 'c6', attendingTribeId: 'vela' })
    db.survivorPlayer.findMany.mockResolvedValue([{ userId: 'u-voted', redraftRosterId: 'r-voted' }, { userId: 'u-not', redraftRosterId: 'r-not' }])
    db.survivorVote.findMany.mockResolvedValue([{ voterRosterId: 'r-voted' }])
  })

  it('sends vote reminders only to managers at the open council who have not voted', async () => {
    expect(await resolveVoteReminderRecipients('L1')).toEqual(['u-not'])
    expect(db.survivorPlayer.findMany.mock.calls[0][0].where).toEqual({ leagueId: 'L1', playerState: 'active', tribeId: 'vela' })
    db.survivorTribalCouncil.findFirst.mockResolvedValue(null)
    expect(await resolveVoteReminderRecipients('L1')).toEqual([])
  })

  it('dispatches a catalogue notification with the designed email', async () => {
    db.survivorNotification.findMany.mockResolvedValue([{ id: 'n1', leagueId: 'L1', type: 'votes_close_soon', recipientUserId: null, recipientRole: 'active', title: 'Votes close in 2 hours', body: 'b', deepLinkPath: '/survivor/L1/tribal', isSpoilerSafe: true, urgency: 'high', status: 'pending', scheduledFor: new Date() }])
    await processNotificationQueue('L1')
    const call = dispatch.mock.calls[0][0]
    expect(call.userIds).toEqual(['u-not'])
    expect(call.type).toBe('survivor:votes_close_soon')
    expect(call.emailOverride.html).toContain('Votes close in 2 hours')
  })

  it('keeps the plain email for other Survivor notifications', async () => {
    db.leagueTeam.findMany.mockResolvedValue([{ claimedByUserId: 'u1' }])
    db.survivorNotification.findMany.mockResolvedValue([{ id: 'n2', leagueId: 'L1', type: 'merge_announced', recipientUserId: null, recipientRole: 'all', title: 't', body: 'b', deepLinkPath: null, isSpoilerSafe: false, urgency: 'high', status: 'pending', scheduledFor: new Date() }])
    await processNotificationQueue('L1')
    expect(dispatch.mock.calls[0][0].emailOverride).toBeUndefined()
  })

  it('queues the catalogue copy for the idol and the 2-hour vote reminder', async () => {
    await notifyIdolAssigned('L1', 'u1')
    expect(db.survivorNotification.create.mock.calls[0][0].data).toMatchObject({ type: 'idol_found', recipientUserId: 'u1', title: 'You found an idol', isSpoilerSafe: true })
    await scheduleTribalReminders('L1', new Date(Date.now() + 5 * 60 * 60 * 1000))
    expect(db.survivorNotification.create.mock.calls.map(c => c[0].data.type)).toContain('votes_close_soon')
  })

  it('addresses a juror-only notification to the jury role', async () => {
    await enqueueSurvivorCoreNotification('L1', { kind: 'jury_vote_open' }, { role: 'jury' })
    expect(db.survivorNotification.create.mock.calls[0][0].data).toMatchObject({ type: 'jury_vote_open', recipientRole: 'jury', deepLinkPath: '/survivor/L1/jury' })
  })
})
