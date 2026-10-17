/** League activity feed on the native league home (2026-10-14). */
import React from 'react'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { FEED_LIMIT, buildActivityFeed, chatEventItem } from '@/lib/league/activity-feed'
import { LeagueActivityFeedCard, loadActivityFeed } from '@/components/league/native/LeagueActivityFeedCard'

afterEach(() => vi.unstubAllGlobals())

const tradeMsg = (id: string, tradeId: string, at: string, reactions: unknown[] = []) => ({
  id, text: 'Ari sent a WR for a RB.', createdAt: at, messageType: 'trade',
  metadata: { tradeCard: { transactionId: tradeId, manager: 'Ari', partner: 'Bo' }, isSystem: true, reactions },
})
const chopMsg = { id: 'm-chop', text: 'Team Z was chopped.', createdAt: '2026-10-12T12:00:00.000Z', messageType: 'host_announcement', metadata: { guillotineChop: true, weekOrPeriod: 5 } }
const evictMsg = { id: 'm-ev', text: 'Cy has been evicted.', createdAt: '2026-10-11T12:00:00.000Z', messageType: 'text', metadata: { bigBrother: true, event: 'eviction', week: 3 } }
const plainMsg = { id: 'm-hi', text: 'gm', createdAt: '2026-10-13T12:00:00.000Z', messageType: 'text', metadata: {} }
const move = (id: string, at: string, badge = 'WAIVERED') => ({
  id, type: 'waiver', managerName: 'Dee', badge, amountLabel: badge === 'WAIVERED' ? 'BID $12' : null, occurredAt: at,
  lines: [{ type: 'add', playerName: 'New Guy', playerMeta: 'WR - KC' }, { type: 'drop', playerName: 'Old Guy', playerMeta: 'RB - NYJ' }],
})

describe('building the feed', () => {
  it('only league events from chat — trades, chops, evictions — never ordinary messages', () => {
    expect(chatEventItem(plainMsg, 'u1')).toBeNull()
    expect(chatEventItem(chopMsg, 'u1')).toMatchObject({ kind: 'chop', title: 'Week 5 chop', messageId: 'm-chop' })
    expect(chatEventItem(evictMsg, 'u1')).toMatchObject({ kind: 'eviction', title: 'Week 3 eviction', messageId: 'm-ev' })
    expect(chatEventItem(tradeMsg('m-t', 'T1', '2026-10-13T00:00:00.000Z'), 'u1')).toMatchObject({ kind: 'trade', title: 'Ari and Bo traded', messageId: 'm-t' })
  })

  it('a trade Chimmy posted is shown once, from chat (reactable); one it did not post comes from the trades source', () => {
    const feed = buildActivityFeed({
      chat: { messages: [tradeMsg('m-t', 'T1', '2026-10-13T00:00:00.000Z')], viewerUserId: 'u1' },
      shared: [
        { id: 'native-trade:T1', description: 'Ari gets X · Bo gets Y', timestamp: '2026-10-13T00:00:00.000Z' },
        { id: 'native-trade:T2', description: 'Cy gets Z · Dee gets W', timestamp: '2026-10-12T00:00:00.000Z' },
        { id: 'native-waiver:W1', description: 'ignored here', timestamp: '2026-10-12T00:00:00.000Z' },
      ],
    })
    expect(feed.map((i) => [i.kind, i.messageId, i.detail])).toEqual([
      ['trade', 'm-t', 'Ari sent a WR for a RB.'],
      ['trade', null, 'Cy gets Z · Dee gets W'],
    ])
  })

  it('waiver and free-agent moves list the players, and are not reactable', () => {
    const [w, fa] = buildActivityFeed({ moves: [move('a', '2026-10-13T00:00:00.000Z'), move('b', '2026-10-12T00:00:00.000Z', 'FREE AGENCY')] })
    expect(w).toMatchObject({ kind: 'waiver', title: 'Dee won a waiver claim', detail: 'Bid $12', messageId: null })
    expect(w.lines).toEqual([{ verb: 'add', name: 'New Guy', meta: 'WR - KC' }, { verb: 'drop', name: 'Old Guy', meta: 'RB - NYJ' }])
    expect(fa).toMatchObject({ kind: 'free_agent', title: 'Dee made a free-agent move', detail: null })
  })

  it('newest first across every source, capped', () => {
    const many = Array.from({ length: 12 }, (_, i) => move(`m${i}`, new Date(Date.UTC(2026, 9, 1 + i)).toISOString()))
    const feed = buildActivityFeed({ chat: { messages: [chopMsg, evictMsg], viewerUserId: null }, moves: many })
    expect(feed).toHaveLength(FEED_LIMIT)
    const times = feed.map((i) => new Date(i.at).getTime())
    expect([...times].sort((a, b) => b - a)).toEqual(times)
    expect(feed[0].id).toBe('chat:m-chop') // Oct 12 noon beats the newest move, Oct 12 00:00
  })

  it('reactions read for the viewer', () => {
    const [item] = buildActivityFeed({ chat: { messages: [tradeMsg('m-t', 'T1', '2026-10-13T00:00:00.000Z', [{ emoji: '🔥', count: 2, userIds: ['u1', 'u2'] }])], viewerUserId: 'u1' } })
    expect(item.reactions).toEqual([{ emoji: '🔥', count: 2, mine: true }])
  })
})

describe('the card', () => {
  function stub(responses: Record<string, unknown>, reactStatus = 200) {
    const calls: { url: string; method: string; body?: string }[] = []
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method ?? 'GET', body: init?.body as string | undefined })
      if (url.includes('/reactions')) return { ok: reactStatus < 400, status: reactStatus, json: async () => ({}) } as Response
      const key = Object.keys(responses).find((k) => url.includes(k))
      return key && responses[key] != null ? ({ ok: true, json: async () => responses[key] } as Response) : ({ ok: false, status: 429, json: async () => ({}) } as Response)
    }))
    return calls
  }

  it('reads chat without marking it read, plus shared activity and moves', async () => {
    const calls = stub({ '/api/league/chat': { messages: [], viewerUserId: 'u1' }, '/api/shared/activity': null, '/activity': [move('a', '2026-10-13T00:00:00.000Z')] })
    const feed = await loadActivityFeed('L 1')
    expect(calls.map((c) => c.url).sort()).toEqual(['/api/league/chat?leagueId=L%201&limit=100', '/api/leagues/L%201/activity', '/api/shared/activity?leagueId=L%201&limit=20'])
    expect(calls.some((c) => c.url.includes('markRead'))).toBe(false)
    expect(feed).toHaveLength(1)
  })

  it('reacting posts to the chat message and shows it straight away; a failed save is rolled back', async () => {
    const calls = stub({ '/api/league/chat': { messages: [chopMsg], viewerUserId: 'u1' }, '/api/shared/activity': { items: [] }, '/activity': [] })
    render(<LeagueActivityFeedCard leagueId="L1" onOpenChat={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('league-activity-react'))
    fireEvent.click(screen.getAllByTestId('league-activity-pick')[2]) // 🔥
    expect(screen.getByTestId('league-activity-reaction').textContent).toBe('🔥 1')
    await waitFor(() => expect(calls.some((c) => c.method === 'POST')).toBe(true))
    const post = calls.find((c) => c.method === 'POST')!
    expect(post.url).toBe('/api/shared/chat/threads/league%3AL1/messages/m-chop/reactions')
    expect(JSON.parse(post.body!)).toEqual({ emoji: '🔥' })
  })

  it('a reaction that fails to save is undone and says so', async () => {
    stub({ '/api/league/chat': { messages: [chopMsg], viewerUserId: 'u1' }, '/api/shared/activity': { items: [] }, '/activity': [] }, 403)
    render(<LeagueActivityFeedCard leagueId="L1" onOpenChat={vi.fn()} />)
    fireEvent.click(await screen.findByTestId('league-activity-react'))
    fireEvent.click(screen.getAllByTestId('league-activity-pick')[0])
    expect(await screen.findByRole('alert')).toHaveTextContent("didn't save")
    expect(screen.queryByTestId('league-activity-reaction')).toBeNull()
  })

  it('waiver moves have no reaction controls; empty and failed loads say so plainly', async () => {
    stub({ '/api/league/chat': { messages: [], viewerUserId: 'u1' }, '/api/shared/activity': { items: [] }, '/activity': [move('a', '2026-10-13T00:00:00.000Z')] })
    const view = render(<LeagueActivityFeedCard leagueId="L1" onOpenChat={vi.fn()} />)
    const list = await screen.findByTestId('league-activity-list')
    expect(within(list).getByText('New Guy')).toBeTruthy()
    expect(screen.queryByTestId('league-activity-react')).toBeNull()
    view.unmount()

    stub({})
    render(<LeagueActivityFeedCard leagueId="L1" onOpenChat={vi.fn()} />)
    expect(await screen.findByTestId('league-activity-empty')).toBeTruthy()
  })
})
