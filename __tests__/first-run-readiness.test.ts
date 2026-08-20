import { describe, expect, it } from 'vitest'
import {
  computeLeagueReadiness,
  readCanonicalPaidFreeLabel,
  readHeroVisibilityLabel,
  stripCreatedQueryParam,
} from '@/lib/league/first-run-readiness'

const base = {
  isCommissioner: true,
  isOwner: true,
  userTeamId: 't1' as string | null,
  inviteTokenPresent: true,
  draftScheduled: true,
  settings: {} as Record<string, unknown>,
}

describe('computeLeagueReadiness', () => {
  it('returns ready_to_draft when all must-haves pass', () => {
    const r = computeLeagueReadiness(base)
    expect(r.tier).toBe('ready_to_draft')
    expect(r.badgeLabel).toBe('Ready to draft')
    expect(r.mustComplete).toBe(3)
    expect(r.checklist.filter((c) => c.tier === 'must')).toHaveLength(3)
  })

  it('returns ready_to_invite when draft missing', () => {
    const r = computeLeagueReadiness({ ...base, draftScheduled: false })
    expect(r.tier).toBe('ready_to_invite')
    expect(r.badgeLabel).toBe('Ready to invite')
  })

  it('returns almost_ready when invite missing', () => {
    const r = computeLeagueReadiness({ ...base, inviteTokenPresent: false, draftScheduled: false })
    expect(r.tier).toBe('almost_ready')
  })

  it('returns not_ready when commissioner seat/team gate fails', () => {
    const r = computeLeagueReadiness({
      ...base,
      isCommissioner: true,
      isOwner: false,
      userTeamId: null,
      inviteTokenPresent: true,
      draftScheduled: true,
    })
    expect(r.tier).toBe('not_ready')
  })

  it('includes payment nice row only for canonical paid leagues', () => {
    const free = computeLeagueReadiness({
      ...base,
      settings: { canonical_monetization: { isPaidLeague: false, paymentEnabled: false } },
    })
    expect(free.checklist.some((c) => c.id === 'nice_payment')).toBe(false)

    const paid = computeLeagueReadiness({
      ...base,
      settings: { canonical_monetization: { isPaidLeague: true, paymentEnabled: true } },
    })
    const row = paid.checklist.find((c) => c.id === 'nice_payment')
    expect(row?.done).toBe(true)
  })

  it('omits welcome/scoring nice rows without evidence flags', () => {
    const r = computeLeagueReadiness(base)
    expect(r.checklist.some((c) => c.id === 'nice_welcome')).toBe(false)
    expect(r.checklist.some((c) => c.id === 'nice_scoring')).toBe(false)
  })

  it('includes welcome nice row when boolean evidence provided', () => {
    const r = computeLeagueReadiness({ ...base, welcomeMessagePostedEvidence: true })
    const row = r.checklist.find((c) => c.id === 'nice_welcome')
    expect(row?.done).toBe(true)
  })

  it('includes welcome nice row with done false when evidence is false', () => {
    const r = computeLeagueReadiness({ ...base, welcomeMessagePostedEvidence: false })
    const row = r.checklist.find((c) => c.id === 'nice_welcome')
    expect(row).toBeTruthy()
    expect(row?.done).toBe(false)
  })

  it('includes scoring nice row only when scoring evidence is defined', () => {
    const r = computeLeagueReadiness({ ...base, scoringReviewedEvidence: false })
    const row = r.checklist.find((c) => c.id === 'nice_scoring')
    expect(row?.done).toBe(false)
  })
})

describe('readCanonicalPaidFreeLabel', () => {
  it('returns null when block missing', () => {
    expect(readCanonicalPaidFreeLabel({})).toBeNull()
  })

  it('returns Paid/Free only when isPaidLeague is boolean in canonical block', () => {
    expect(readCanonicalPaidFreeLabel({ canonical_monetization: { isPaidLeague: true, paymentEnabled: false } })).toBe(
      'Paid',
    )
    expect(readCanonicalPaidFreeLabel({ canonical_monetization: { isPaidLeague: false, paymentEnabled: false } })).toBe(
      'Free',
    )
  })
})

describe('readHeroVisibilityLabel', () => {
  it('prefers canonical_visibility when present', () => {
    expect(readHeroVisibilityLabel({ canonical_visibility: 'invite_only' })).toBe('Invite-only')
  })

  it('returns null when no persisted visibility', () => {
    expect(readHeroVisibilityLabel({})).toBeNull()
  })
})

describe('stripCreatedQueryParam', () => {
  it('removes created and preserves other keys', () => {
    expect(stripCreatedQueryParam('created=1&guide=settings&openChat=league')).toBe('?guide=settings&openChat=league')
  })

  it('preserves showInvite and playIntro when stripping created', () => {
    expect(
      stripCreatedQueryParam('created=1&guide=settings&openChat=league&showInvite=1&playIntro=1'),
    ).toBe('?guide=settings&openChat=league&showInvite=1&playIntro=1')
  })

  it('returns empty string when nothing left', () => {
    expect(stripCreatedQueryParam('created=1')).toBe('')
  })
})
