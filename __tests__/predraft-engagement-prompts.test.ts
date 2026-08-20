import { describe, expect, it } from 'vitest'
import { pickPredraftEngagementPrompts, needsCanonicalPaymentSetup } from '@/lib/league/predraft-engagement-prompts'

describe('pickPredraftEngagementPrompts', () => {
  it('prioritizes invite and draft when missing', () => {
    const p = pickPredraftEngagementPrompts(
      {
        inviteOk: false,
        draftScheduled: false,
        publicListing: false,
        needsPaymentSetup: false,
        scoringNeedsAttention: false,
        hasLeagueArt: true,
        teamsJoined: 0,
        teamCapacity: 12,
      },
      null,
      3,
    )
    expect(p).toContain('invite')
    expect(p).toContain('schedule_draft')
  })

  it('does not add payment without canonical paid incomplete state', () => {
    const p = pickPredraftEngagementPrompts(
      {
        inviteOk: true,
        draftScheduled: true,
        publicListing: true,
        needsPaymentSetup: false,
        scoringNeedsAttention: false,
        hasLeagueArt: true,
        teamsJoined: 12,
        teamCapacity: 12,
      },
      { welcomeMessagePostedEvidence: true },
      5,
    )
    expect(p.includes('payment')).toBe(false)
  })

  it('includes payment only when needsPaymentSetup is true', () => {
    const p = pickPredraftEngagementPrompts(
      {
        inviteOk: true,
        draftScheduled: true,
        publicListing: true,
        needsPaymentSetup: true,
        scoringNeedsAttention: false,
        hasLeagueArt: true,
        teamsJoined: 12,
        teamCapacity: 12,
      },
      { welcomeMessagePostedEvidence: true },
      8,
    )
    expect(p.includes('payment')).toBe(true)
  })
})

describe('needsCanonicalPaymentSetup', () => {
  it('is false when monetization block missing', () => {
    expect(needsCanonicalPaymentSetup({})).toBe(false)
  })
})
