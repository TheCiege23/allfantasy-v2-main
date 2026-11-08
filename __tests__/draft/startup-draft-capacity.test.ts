import { describe, expect, it } from 'vitest'
import { computeDraftRoundsFromSlots, computeStartupDraftCapacity } from '@/lib/draft/draftSettingsPolicy'

/**
 * A startup draft must not hand a team more players than its active roster holds. The form's NFL dynasty
 * defaults drafted 28 rounds into a 24-player active limit (10 starters + 14 bench), so every team was
 * 4 over after the draft and every trade — even 1-for-1 — was refused. Found by the dynasty simulation.
 */

// The effective template a default NFL dynasty league saved (custom-NFL-<id>), as the draft reads it —
// including the TAXI row that stores its five spots as BOTH reserveCount and taxiCount.
const nflDynastyDefault = [
  { slotName: 'QB', starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
  { slotName: 'RB', starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
  { slotName: 'WR', starterCount: 3, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
  { slotName: 'TE', starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
  { slotName: 'FLEX', starterCount: 2, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
  { slotName: 'SUPERFLEX', starterCount: 1, benchCount: 0, reserveCount: 0, taxiCount: 0, devyCount: 0 },
  { slotName: 'BN', starterCount: 0, benchCount: 14, reserveCount: 0, taxiCount: 0, devyCount: 0 },
  { slotName: 'IR', starterCount: 0, benchCount: 0, reserveCount: 3, taxiCount: 0, devyCount: 0 },
  { slotName: 'TAXI', starterCount: 0, benchCount: 0, reserveCount: 5, taxiCount: 5, devyCount: 0 },
]

describe('computeStartupDraftCapacity', () => {
  it('is starters + bench for the default NFL dynasty roster — the active limit the trade check uses', () => {
    expect(computeStartupDraftCapacity(nflDynastyDefault)).toBe(24)
  })

  it('never counts IR or taxi, however the row stores its counts', () => {
    const withoutReserve = nflDynastyDefault.filter((s) => s.slotName !== 'IR' && s.slotName !== 'TAXI')
    expect(computeStartupDraftCapacity(nflDynastyDefault)).toBe(computeStartupDraftCapacity(withoutReserve))
  })

  it('counts devy spots (devy rounds place there), once even when mirrored in another count', () => {
    const withDevy = [...nflDynastyDefault, { slotName: 'DEVY', starterCount: 0, benchCount: 0, reserveCount: 2, taxiCount: 0, devyCount: 2 }]
    expect(computeStartupDraftCapacity(withDevy)).toBe(26)
  })

  it('stays below the dynasty draft-room count, which includes taxi', () => {
    // The draft-room rule keeps counting taxi for dynasty (rookie drafts fill it); only the STARTUP is capped.
    expect(computeDraftRoundsFromSlots(nflDynastyDefault, true).rounds).toBeGreaterThan(computeStartupDraftCapacity(nflDynastyDefault))
  })

  it('is zero for an empty template, so the caller keeps its previous capacity', () => {
    expect(computeStartupDraftCapacity([])).toBe(0)
  })
})
