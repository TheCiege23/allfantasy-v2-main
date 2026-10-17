import { describe, expect, it } from 'vitest'
import { nextTorchCeremonyDeadline } from '@/lib/survivor/survivorCeremonySchedule'

describe('system-run Torch Ceremony schedule', () => {
  const settings = { tribalCouncilDay: 'Tuesday', tribalCouncilTime: '20:00' }

  it('releases the vote on the configured Eastern day and hour', () => {
    expect(nextTorchCeremonyDeadline(new Date('2026-10-12T14:00:00Z'), settings).toISOString()).toBe('2026-10-14T00:00:00.000Z')
  })

  it('does not open a one-minute ballot when verified scores arrive just before ceremony', () => {
    expect(nextTorchCeremonyDeadline(new Date('2026-10-13T23:30:00Z'), settings).toISOString()).toBe('2026-10-21T00:00:00.000Z')
  })

  it('respects the daylight-saving switch without shifting the local ceremony hour', () => {
    expect(nextTorchCeremonyDeadline(new Date('2026-11-02T14:00:00Z'), settings).toISOString()).toBe('2026-11-04T01:00:00.000Z')
  })
})
