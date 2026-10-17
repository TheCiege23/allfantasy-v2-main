import { describe, expect, it } from 'vitest'
import { redactSurvivorSeasonPayloadForFairPlay } from '@/lib/survivor/survivorFairPlay'

describe('Survivor weekly scores in fair-play mode', () => {
  it('does not reintroduce other tribes through weekly score rows', () => {
    const payload = {
      tribes: [{ id: 'mine', members: [{ userId: 'me' }] }, { id: 'other', members: [{ userId: 'rival' }] }],
      players: [{ userId: 'me', tribeId: 'mine' }, { userId: 'rival', tribeId: 'other' }],
      weeklyScores: [
        { userId: 'me', tribeId: 'mine', finalScore: 90 },
        { userId: 'rival', tribeId: 'other', finalScore: 100 },
      ],
    }
    const visible = redactSurvivorSeasonPayloadForFairPlay(payload, 'me', 'mine')
    expect(visible.weeklyScores).toEqual([{ userId: 'me', tribeId: 'mine', finalScore: 90 }])
    expect(JSON.stringify(visible)).not.toContain('rival')
  })
})
