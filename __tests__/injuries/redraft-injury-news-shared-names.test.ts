import { describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: { playerNewsRecord: { findFirst: async () => null, count: async () => 0 } },
}))
const at = new Date('2026-10-11T12:00:00Z')
vi.mock('@/lib/injuries/injuryReadPort', () => ({
  listInjuryFacts: async () => ({
    facts: [
      { playerName: 'Justin Jefferson', team: 'Minnesota Vikings', position: 'WR', status: 'Questionable', fetchedAt: at },
      { playerName: 'Justin Jefferson', team: 'Cleveland Browns', position: 'LB', status: 'Active', fetchedAt: at },
      { playerName: 'Rome Odunze', team: 'Chicago Bears', position: 'WR', status: 'Out', fetchedAt: at },
      { playerName: 'Rome Odunze', team: 'CHI', position: null, status: 'Out', fetchedAt: at },
    ],
  }),
}))

import { fetchRedraftInjuryNews } from '@/lib/redraft-war-room/redraftInjuryNews'

/* The war room reads this map by NAME; a name two athletes share used to keep whichever came first. */
describe('fetchRedraftInjuryNews', () => {
  it('🛑 drops a name two athletes share instead of keeping whichever came first', async () => {
    const news = await fetchRedraftInjuryNews('NFL')
    expect(news.injuryByName.has('justin jefferson')).toBe(false)
  })
  it('keeps one athlete reported under two team spellings', async () => {
    const news = await fetchRedraftInjuryNews('NFL')
    expect(news.injuryByName.get('rome odunze')?.status).toBe('Out')
  })
})
