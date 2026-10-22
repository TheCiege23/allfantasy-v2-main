import { describe, expect, it } from 'vitest'
import { apnsCollapseId } from '@/lib/push-notifications/apns'
describe('APNs event identity', () => {
 it('keeps distinct plays distinct when their first 64 bytes match', () => {
  const prefix = 'x'.repeat(70)
  expect(apnsCollapseId(prefix+'play1')).not.toBe(apnsCollapseId(prefix+'play2'))
  expect(Buffer.byteLength(apnsCollapseId(prefix+'play1'))).toBeLessThanOrEqual(64)
 })
})

describe('live game alerts are grouped per game', () => {
 it('re-alerts when a play replaces the last one from the same game, and only for game tags or chat', async () => {
  const { shouldRenotify } = await import('@/lib/push-notifications/push-service')
  const { gamePushTag } = await import('@/lib/engagement-alerts/gameAlertService')
  expect(gamePushTag('nfl', '401')).toBe('game:NFL:401')
  expect(shouldRenotify('game_scoring_play', gamePushTag('NFL', '401'))).toBe(true)
  expect(shouldRenotify('live_score_swing', 'live-play:G1')).toBe(true)
  expect(shouldRenotify('direct_message', 'dm-1')).toBe(true)
  expect(shouldRenotify('weekly_story', 'weekly-story')).toBe(false)
  expect(shouldRenotify('game_final', null)).toBe(false)
 })
})
