import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'
import { gameAlertDeadline, pushRetentionSeconds } from '@/lib/notifications/gameAlertFreshness'

describe('game alert freshness', () => {
  const created = new Date('2026-10-20T20:00:00Z')
  it.each(['game_scoring_play','game_big_play','game_period_end','game_halftime','game_final','game_close','game_moment_end_period','game_moment_final','live_score_swing'])('expires %s and prevents offline provider replay', type => {
    expect(gameAlertDeadline(type, created)).toBe(Date.parse('2026-10-20T20:05:00Z'))
    expect(pushRetentionSeconds(type)).toBe(0)
    expect(gameAlertDeadline(type, created, '2026-10-21T20:00:00Z')).toBe(Date.parse('2026-10-20T20:05:00Z'))
  })
  it('preserves an earlier deadline across retries', () => {
    expect(gameAlertDeadline('game_final', created, '2026-10-20T20:01:00Z')).toBe(Date.parse('2026-10-20T20:01:00Z'))
  })
  it('preserves unrelated notifications', () => {
    expect(gameAlertDeadline('direct_message', created)).toBeUndefined()
    expect(pushRetentionSeconds('direct_message')).toBe(86400)
  })
})

it('the installed service worker drops expired pushes but still shows fresh updates', () => {
  const handlers: Record<string, (event: unknown) => void> = {}
  const shown: string[] = []
  runInNewContext(readFileSync('public/sw.js','utf8'), {self:{
    addEventListener:(name:string, fn:(event: unknown)=>void)=>{handlers[name]=fn},
    registration:{showNotification:(title:string)=>{shown.push(title);return Promise.resolve()}},
  }, URL, Date, console})
  const push=(expiresAt:string)=>handlers.push({data:{json:()=>({title:'Final',expiresAt})},waitUntil:()=>{}})
  push(new Date(Date.now()-1000).toISOString())
  expect(shown).toEqual([])
  push(new Date(Date.now()+60000).toISOString())
  expect(shown).toEqual(['Final'])
})
