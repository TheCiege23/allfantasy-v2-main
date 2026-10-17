import { describe, expect, it } from 'vitest'
import { projectSGHostedHistory } from '@/lib/survivor-guillotine/hosted-presentation'

const result = { '2': { mode: 'match_play', immuneTribeId: 'tribe-a', savedTeamIds: ['r2'],
  choppedTeamIds: ['r3'], placements: [], scores: { r3: 75 }, teams: [{ id: 'r3' }],
  protectedTeamIds: ['r2'], hostedCeremony: { stage: 0 } } }

describe('hosted Chop Night projection', () => {
  it('conceals the result until the host reveals each stage', () => {
    const first = projectSGHostedHistory(result, 2)
    expect(first.hiddenChopRosterIds).toEqual(['r3'])
    expect(first.history['2']).toMatchObject({ immuneTribeId: null, savedTeamIds: [],
      choppedTeamIds: [], scores: {} })
    const immunity = projectSGHostedHistory({ '2': { ...result['2'], hostedCeremony: { stage: 1 } } }, 2)
    expect(immunity.history['2']).toMatchObject({ immuneTribeId: 'tribe-a', savedTeamIds: [], choppedTeamIds: [] })
    const idols = projectSGHostedHistory({ '2': { ...result['2'], hostedCeremony: { stage: 2 } } }, 2)
    expect(idols.history['2']).toMatchObject({ savedTeamIds: ['r2'], protectedTeamIds: ['r2'], choppedTeamIds: [] })
    const final = projectSGHostedHistory({ '2': { ...result['2'], hostedCeremony: { stage: 3 } } }, 2)
    expect(final.hiddenHostedChop).toBe(false)
    expect(final.history['2'].choppedTeamIds).toEqual(['r3'])
  })
})
