import { describe, expect, it } from 'vitest'

import { validatePickSubmission } from '@/lib/live-draft-engine/PickValidation'

const base = { position: 'G', rosterId: 'r1', currentOnClockRosterId: 'r1', sessionStatus: 'in_progress' }

describe('draft duplicate check with player ids', () => {
  it('refuses the same player id again, even under another spelling of the name', () => {
    const result = validatePickSubmission({
      ...base, playerName: 'Jalen Williams Jr', playerId: 'p-1',
      existingPicks: [{ playerName: 'Jalen Williams', position: 'G', playerId: 'p-1' }],
    })
    expect(result.valid).toBe(false)
  })

  it('lets two different players who share a name both be drafted', () => {
    const result = validatePickSubmission({
      ...base, playerName: 'Jalen Williams', playerId: 'p-2',
      existingPicks: [{ playerName: 'Jalen Williams', position: 'G', playerId: 'p-1' }],
    })
    expect(result).toEqual({ valid: true })
  })

  it('still goes by name when either pick has no id', () => {
    expect(validatePickSubmission({
      ...base, playerName: 'Jalen Williams', playerId: 'p-2',
      existingPicks: [{ playerName: 'jalen williams', position: 'G' }],
    }).valid).toBe(false)
    expect(validatePickSubmission({
      ...base, playerName: 'Jalen Williams',
      existingPicks: [{ playerName: 'Jalen Williams', position: 'G', playerId: 'p-1' }],
    }).valid).toBe(false)
  })
})
