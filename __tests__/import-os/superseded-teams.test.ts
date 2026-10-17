import { describe, expect, it } from 'vitest'
import { planSupersededTeams } from '@/lib/import-os/collector/supersededTeams'

/**
 * A claimed team the provider stopped listing: departed, or the same seat under a new id?
 * The production case (2026-10-08): Fantrax re-keyed `fantrax-team:ciege82` to `789336590`.
 */
const STALE = { id: 'old', externalId: 'fantrax-team:ciege82', platformUserId: 'fantrax-user:Ciege82', claimedByUserId: 'me' }

describe('planSupersededTeams', () => {
  it('the production re-key: the live row already holds the claim -> archive the old one', () => {
    const plan = planSupersededTeams([STALE], [
      { id: 'new', externalId: '789336590', platformUserId: 'fantrax-user:Ciege82', claimedByUserId: 'me' },
      { id: 'x', externalId: '106189420', platformUserId: 'fantrax-manager:tq-trojans', claimedByUserId: null },
    ])
    expect(plan).toEqual([{ kind: 'archive', staleId: 'old', staleExternalId: 'fantrax-team:ciege82', liveExternalId: '789336590' }])
  })

  it('same provider user, live row unclaimed -> move the claim, then archive (the user keeps their seat)', () => {
    const plan = planSupersededTeams([STALE], [{ id: 'new', externalId: '789336590', platformUserId: 'fantrax-user:Ciege82', claimedByUserId: null }])
    expect(plan[0]).toMatchObject({ kind: 'move_claim_and_archive', liveId: 'new', userId: 'me' })
  })

  it('same provider user, live row claimed by SOMEONE ELSE -> conflict, touch nothing', () => {
    const plan = planSupersededTeams([STALE], [{ id: 'new', externalId: '789336590', platformUserId: 'fantrax-user:Ciege82', claimedByUserId: 'them' }])
    expect(plan[0]).toMatchObject({ kind: 'conflict', liveExternalId: '789336590' })
  })

  it('no live team for that seat -> a real departure (today’s orphan rule applies)', () => {
    const plan = planSupersededTeams([STALE], [{ id: 'x', externalId: '106189420', platformUserId: 'fantrax-manager:tq-trojans', claimedByUserId: null }])
    expect(plan[0]).toMatchObject({ kind: 'departed' })
  })

  it('🛑 one person holding TWO different teams: the one that left is a departure, not a duplicate', () => {
    const plan = planSupersededTeams([STALE], [{ id: 'mine2', externalId: '555', platformUserId: 'fantrax-user:SecondTeam', claimedByUserId: 'me' }])
    expect(plan[0]).toMatchObject({ kind: 'departed' })
  })

  it('a claim match with no provider user id on either side still counts as the same seat', () => {
    const plan = planSupersededTeams([{ ...STALE, platformUserId: null }], [{ id: 'new', externalId: '789', platformUserId: null, claimedByUserId: 'me' }])
    expect(plan[0]).toMatchObject({ kind: 'archive' })
  })
})
