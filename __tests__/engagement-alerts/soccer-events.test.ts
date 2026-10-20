import { describe, expect, it, vi } from 'vitest'
vi.mock('@/lib/sports-live-scores-service', () => ({ getEspnGameSummary: vi.fn(), ESPN_SPORT_SITE_PATH: { SOCCER: 'soccer/usa.1' } }))
import { soccerScoringPlays } from '@/lib/engagement-alerts/gameDetail'
describe('soccer goal events', () => {
  it('uses provider identities and excludes goal kicks and missing event text', () => {
    const raw = { keyEvents: [{ id: 'goal1', type: { text: 'Goal' }, text: 'Goal! Home 1, Away 0' }, { id: 'kick1', type: { text: 'Goal Kick' }, text: 'Goal kick' }, { id: 'own1', type: { text: 'Own Goal' }, shortText: 'Own goal' }, { id: 'empty', type: { text: 'Goal' } }] }
    expect(soccerScoringPlays(raw).map(p => p.id)).toEqual(['goal1', 'own1'])
  })
})
