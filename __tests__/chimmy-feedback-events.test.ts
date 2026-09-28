import { describe, expect, it } from 'vitest'

import { buildChimmyFeedbackEvent, drawerFeedbackSurface } from '@/lib/chimmy-chat/feedback-events'

describe('buildChimmyFeedbackEvent', () => {
  it('builds helpful feedback payload with thumbs_up action', () => {
    const event = buildChimmyFeedbackEvent({
      messageId: 'msg-1',
      feedback: 'helpful',
      leagueId: 'league-1',
      surface: 'league',
      mode: 'deep_analysis',
      source: 'messages_ai',
      topic: 'trade',
    })

    expect(event.event_name).toBe('feedback_submit')
    expect(event.action).toBe('thumbs_up')
    expect(event.league_id).toBe('league-1')
    expect(event.mode).toBe('deep_analysis')
    expect(event.topic).toBe('trade')
    expect(event.metadata).toMatchObject({
      messageId: 'msg-1',
      feedbackValue: 'helpful',
      assistantMode: 'deep_analysis',
      surface: 'league',
      source: 'messages_ai',
    })
  })

  it('builds unhelpful payload with thumbs_down and nullable fields', () => {
    const event = buildChimmyFeedbackEvent({
      messageId: 'msg-2',
      feedback: 'unhelpful',
      surface: 'dashboard',
      mode: 'fast_take',
    })

    expect(event.action).toBe('thumbs_down')
    expect(event.league_id).toBeNull()
    expect(event.topic).toBeUndefined()
    expect(event.metadata).toMatchObject({
      messageId: 'msg-2',
      feedbackValue: 'unhelpful',
      source: null,
    })
  })
})

describe('what a rating is about', () => {
  it('carries the tools the answer used and where it was asked', () => {
    const event = buildChimmyFeedbackEvent({
      messageId: 'a-1',
      feedback: 'unhelpful',
      surface: 'waiver',
      mode: 'deep_analysis',
      source: 'core_comms',
      entry: 'drawer:waivers',
      tools: ['get_waivers', '', 'compare_players'],
    })
    expect(event.metadata).toMatchObject({ entry: 'drawer:waivers', tools: ['get_waivers', 'compare_players'], source: 'core_comms' })
  })

  it('defaults to no tools and no entry, and caps a runaway list', () => {
    const bare = buildChimmyFeedbackEvent({ messageId: 'a', feedback: 'helpful', surface: 'dashboard', mode: 'fast_take' })
    expect(bare.metadata).toMatchObject({ entry: null, tools: [] })
    const many = buildChimmyFeedbackEvent({
      messageId: 'a',
      feedback: 'helpful',
      surface: 'dashboard',
      mode: 'fast_take',
      tools: Array.from({ length: 40 }, (_, i) => `t${i}`),
    })
    expect(many.metadata?.tools).toHaveLength(12)
  })
})

describe('drawerFeedbackSurface', () => {
  it('maps the screens the analytics schema names, and buckets the rest by league scope', () => {
    expect(drawerFeedbackSurface('waivers', true)).toBe('waiver')
    expect(drawerFeedbackSurface('trades', false)).toBe('trade')
    expect(drawerFeedbackSurface('war-room', true)).toBe('war_room')
    expect(drawerFeedbackSurface('draft-hq', true)).toBe('draft_room')
    expect(drawerFeedbackSurface('matchup', true)).toBe('league')
    expect(drawerFeedbackSurface('home', false)).toBe('dashboard')
    expect(drawerFeedbackSurface(null, false)).toBe('dashboard')
  })
})
