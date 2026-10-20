import { describe, expect, it } from 'vitest'
import { idolTimingRuleLines } from '@/lib/survivor/survivorSettings'

describe('idol timing rules shown to managers', () => {
  it('names the expiry week when set, and always the remaining-players cutoff that every play enforces', () => {
    expect(idolTimingRuleLines({ expiryWeek: 9, invalidRemainingPlayers: 4 })).toEqual(['Idols expire after Week 9', 'Idols stop working once 4 players remain'])
    expect(idolTimingRuleLines({ expiryWeek: null, invalidRemainingPlayers: 5 })).toEqual(['No week limit on idols (some expire at the merge)', 'Idols stop working once 5 players remain'])
  })

  it('adds the play cutoff when the commissioner set one, and reads it from league settings', async () => {
    const { normalizeSurvivorFoundationSettings, idolPlayDeadline } = await import('@/lib/survivor/survivorSettings')
    expect(idolTimingRuleLines({ expiryWeek: null, invalidRemainingPlayers: 4, playCutoffHours: 2 })).toContain('Idols must be played at least 2 hours before votes close.')
    expect(idolTimingRuleLines({ expiryWeek: null, invalidRemainingPlayers: 4, playCutoffHours: 0 })).toHaveLength(2)
    expect(normalizeSurvivorFoundationSettings({}).idolPlayCutoffHours).toBe(0)
    expect(normalizeSurvivorFoundationSettings({ idolPlayCutoffHours: 12 }).idolPlayCutoffHours).toBe(12)
    expect(normalizeSurvivorFoundationSettings({ idolPlayCutoffHours: 500 }).idolPlayCutoffHours).toBe(72)
    const close = new Date('2026-10-20T00:00:00Z')
    expect(idolPlayDeadline({ voteDeadlineAt: close }, 3).toISOString()).toBe('2026-10-19T21:00:00.000Z')
    expect(idolPlayDeadline({ voteDeadlineAt: close }, 0)).toBe(close)
  })
})
