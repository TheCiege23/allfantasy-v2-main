import { describe, expect, it } from 'vitest'
import { isFinderPeriodPilotLeague } from '@/lib/core-app/playerFinderPeriodPilot'

describe('Player Finder period advice pilot', () => {
  it('keeps unconfigured leagues off and enables only an explicitly listed league', () => {
    expect(isFinderPeriodPilotLeague('pilot', '')).toBe(false)
    expect(isFinderPeriodPilotLeague('pilot', 'other, pilot ')).toBe(true)
    expect(isFinderPeriodPilotLeague('other-pilot', 'other, pilot ')).toBe(false)
  })
})
