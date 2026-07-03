import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  normalizeLeagueRuntimeEventType,
  toCanonicalLeagueRuntimeEvent,
} from '@/lib/league-runtime/leagueRuntimeEvents'
import {
  buildNflRedraftCommunicationPlan,
  NFL_REDRAFT_COMMUNICATION_RUNTIME_VERSION,
} from '@/lib/league-notifications/nflRedraftCommunicationRuntime'
import {
  getLeagueSystemNoticeLabel,
  isLeagueSystemNotice,
} from '@/lib/league-chat'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

function event(type: string, payload: Record<string, unknown> = {}) {
  return toCanonicalLeagueRuntimeEvent({
    leagueId: 'league-1',
    eventType: type,
    createdAt: '2026-07-02T12:00:00.000Z',
    actorUserId: 'commissioner-1',
    payload,
  })
}

describe('G42 NFL redraft communication runtime mapping', () => {
  it('maps draft events into unread notifications, feed, chat, and Discord intents', () => {
    const plan = buildNflRedraftCommunicationPlan({
      event: event('draft_started'),
      leagueName: 'Guap Bowl',
      audience: [{ userId: 'u1', teamId: 'team-1' }, { userId: 'u2' }],
      now: new Date('2026-07-02T12:00:00.000Z'),
    })

    expect(plan.version).toBe(NFL_REDRAFT_COMMUNICATION_RUNTIME_VERSION)
    expect(plan.category).toBe('draft')
    expect(plan.deliveryChannels).toEqual(
      expect.arrayContaining(['in_app', 'league_feed', 'league_chat', 'discord']),
    )
    expect(plan.notifications).toHaveLength(2)
    expect(plan.notifications[0]).toMatchObject({
      leagueId: 'league-1',
      userId: 'u1',
      teamId: 'team-1',
      eventType: 'draft.started',
      title: 'Draft started',
      priority: 'high',
      readAt: null,
      actionHref: '/league/league-1/draft',
    })
    expect(plan.feed).toMatchObject({
      eventType: 'draft_started',
      category: 'draft',
      importance: 'high',
    })
    expect(plan.chat).toMatchObject({
      messageType: 'draft_notice',
      source: null,
      metadata: {
        isSystem: true,
        g42Communication: true,
        relatedRuntimeEventType: 'draft.started',
      },
    })
    expect(plan.discord).toMatchObject({
      enabled: true,
      channel: 'league_event_announcement',
    })
  })

  it('covers waiver, trade, scoring, matchup, playoff, and commissioner announcements', () => {
    const cases = [
      ['waiver.processed', { succeeded: 3, failed: 1, week: 4 }, 'waivers', 'waiver_notice'],
      ['trade.proposed', { summary: 'Team A offered Team B a deal.' }, 'trades', 'trade_notice'],
      ['scoring.updated', { homeScore: 101.2, awayScore: 99.8 }, 'scoring', 'scoring_notice'],
      ['matchup.finalized', { homeScore: 121, awayScore: 108 }, 'matchups', 'matchup_notice'],
      ['playoffs.bracket.generated', {}, 'playoffs', 'playoff_notice'],
      ['commissioner.announcement.created', { body: 'Lineups lock at 1 PM ET.' }, 'commissioner', 'commissioner_notice'],
    ] as const

    for (const [type, payload, category, chatType] of cases) {
      const plan = buildNflRedraftCommunicationPlan({
        event: event(type, payload),
        audience: [{ userId: 'u1' }],
      })
      expect(plan.category).toBe(category)
      expect(plan.notifications[0]?.readAt).toBeNull()
      expect(plan.notifications[0]?.meta.relatedRuntimeEventType).toBe(normalizeLeagueRuntimeEventType(type))
      expect(plan.chat?.messageType).toBe(chatType)
      expect(plan.feed?.details.relatedRuntimeEventType).toBe(normalizeLeagueRuntimeEventType(type))
    }
  })

  it('normalizes G42 announcement and chat event aliases', () => {
    expect(normalizeLeagueRuntimeEventType('commissioner_announcement')).toBe('commissioner.announcement.created')
    expect(normalizeLeagueRuntimeEventType('league_chat_message')).toBe('league.chat.message')
    expect(normalizeLeagueRuntimeEventType('system_chat_message')).toBe('league.chat.system_message')
  })
})
describe('G42 league chat system notice support', () => {
  it('labels communication runtime system message types', () => {
    expect(isLeagueSystemNotice('draft_notice')).toBe(true)
    expect(isLeagueSystemNotice('lineup_notice')).toBe(true)
    expect(isLeagueSystemNotice('champion_announcement')).toBe(true)
    expect(getLeagueSystemNoticeLabel('draft_summary')).toBe('Draft')
    expect(getLeagueSystemNoticeLabel('scoring_notice')).toBe('Scoring')
    expect(getLeagueSystemNoticeLabel('champion_announcement')).toBe('Champion')
  })
})

describe('G42 persistence, API, UI, and Discord wiring contracts', () => {
  it('persists through existing platform notification, feed, chat, and Discord primitives', () => {
    const src = read('lib/league-notifications/nflRedraftCommunicationPersistence.ts')
    expect(src).toMatch(/createPlatformNotification/)
    expect(src).toMatch(/createLeagueFeedEvent/)
    expect(src).toMatch(/createLeagueChatMessage/)
    expect(src).toMatch(/syncNflRedraftCommunicationToDiscord/)
    expect(src).toMatch(/NOT_NFL_REDRAFT/)
    expect(src).toMatch(/sourceKey: notification\.sourceKey/)
    expect(src).toMatch(/globalBroadcastId: dedupeKey/)
  })

  it('exposes required redraft communication API routes with auth checks', () => {
    const announcements = read('app/api/redraft/communication/announcements/route.ts')
    const events = read('app/api/redraft/communication/events/route.ts')
    const chat = read('app/api/redraft/communication/chat/route.ts')
    const notifications = read('app/api/redraft/communication/notifications/route.ts')
    const readAll = read('app/api/redraft/communication/notifications/read-all/route.ts')
    const feed = read('app/api/redraft/communication/feed/route.ts')

    expect(announcements).toMatch(/assertCommissioner/)
    expect(events).toMatch(/persistNflRedraftCommunicationForEvent/)
    expect(chat).toMatch(/createLeagueChatMessage/)
    expect(chat).toMatch(/getLeagueChatMessages/)
    expect(notifications).toMatch(/getPlatformNotifications/)
    expect(readAll).toMatch(/markAllPlatformNotificationsRead/)
    expect(feed).toMatch(/formatLeagueEventRow/)
  })

  it('wires a user-facing communication panel into the NFL redraft home dashboard', () => {
    const panel = read('components/redraft/RedraftCommunicationPanel.tsx')
    const dashboard = read('components/league-home/NflRedraftLeagueHomeDashboard.tsx')

    expect(panel).toMatch(/data-testid="g42-communication-panel"/)
    expect(panel).toMatch(/data-testid="g42-unread-badge"/)
    expect(panel).toMatch(/data-testid="g42-announcement-input"/)
    expect(panel).toMatch(/data-testid="g42-chat-system-message"/)
    expect(panel).toMatch(/\/api\/redraft\/communication\/announcements/)
    expect(panel).toMatch(/\/api\/redraft\/communication\/chat/)
    expect(dashboard).toMatch(/<RedraftCommunicationPanel/)
  })

  it('keeps Discord best-effort and non-blocking', () => {
    const src = read('lib/league-notifications/nflRedraftDiscordBridge.ts')
    expect(src).toMatch(/syncOutboundLeagueChat/)
    expect(src).toMatch(/not_configured/)
    expect(src).toMatch(/failure must never block/i)
    expect(src).toMatch(/catch \(error\)/)
  })
})
