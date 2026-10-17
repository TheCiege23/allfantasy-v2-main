import { describe, it, expect } from 'vitest'
import {
  decidePlayerNewsEligibility,
  isConfirmedTrade,
  isNegatedTransaction,
} from '@/lib/notifications/playerNewsEligibility'

/**
 * N5 — ordinary signing alerts were filtered out by construction.
 *
 * `lib/workers/x-news-ingestion.ts` scores `signed` and `extension` as MEDIUM impact — both are
 * literally in `MEDIUM_IMPACT_KEYWORDS` — and the pending dispatcher accepted only
 * `impact === 'high'` unless the item was an injury. So a normal contract signing never
 * dispatched, and was then stamped `notificationDispatchedAt`, which removed it from every
 * later scan. The only signings that got through were the ones whose text happened to contain
 * an unrelated high-impact word.
 */

const decide = (over: Parameters<typeof decidePlayerNewsEligibility>[0]) =>
  decidePlayerNewsEligibility(over)

describe('signings and extensions', () => {
  it('lets a medium-impact signing through', () => {
    // The reproduction, as a one-liner: this returned `false` before the policy existed.
    expect(
      decide({
        category: 'signing',
        impact: 'medium',
        headline: 'Falcons sign WR to a two-year extension',
        body: 'Terms were not disclosed.',
      }),
    ).toEqual({ eligible: true, reason: 'material-roster-event' })
  })

  it('lets a LOW-impact signing through too — the category is what qualifies it', () => {
    expect(
      decide({ category: 'signing', impact: 'low', headline: 'Team signs kicker', body: null })
        .eligible,
    ).toBe(true)
  })

  it.each(['injury', 'suspension', 'release', 'roster_move'] as const)(
    'treats %s as material regardless of impact',
    (category) => {
      expect(decide({ category, impact: 'low', headline: 'x', body: null }).eligible).toBe(true)
    },
  )
})

describe('impact is a tiebreak, not the gate', () => {
  it('still requires high impact for non-material categories', () => {
    expect(
      decide({ category: 'team_news', impact: 'medium', headline: 'New OC hired', body: null }),
    ).toEqual({ eligible: false, reason: 'not-material-and-not-high-impact' })
  })

  it('accepts a high-impact non-material item', () => {
    expect(
      decide({ category: 'coaching', impact: 'high', headline: 'Head coach fired', body: null }),
    ).toEqual({ eligible: true, reason: 'high-impact' })
  })

  it('does not notify on unclassified low-impact chatter', () => {
    expect(
      decide({ category: 'player_news', impact: 'low', headline: 'looked good in warmups', body: null })
        .eligible,
    ).toBe(false)
  })
})

describe('real trades notify only on confirmed completion', () => {
  it('accepts a completed trade', () => {
    expect(
      decide({
        category: 'trade',
        impact: 'medium',
        headline: 'RB has been traded to the Bears',
        body: 'The deal is official.',
      }),
    ).toEqual({ eligible: true, reason: 'confirmed-trade' })
  })

  it.each([
    'Sources: team expected to trade the veteran WR',
    'Reportedly acquired in a three-team deal',
    'The two sides have agreed to terms on a trade',
    'Team is exploring a trade for the QB',
    'Club nearing a deal to trade its starting corner',
  ])('holds hedged wording: %s', (headline) => {
    expect(decide({ category: 'trade', impact: 'high', headline, body: null })).toEqual({
      eligible: false,
      reason: 'unconfirmed-trade',
    })
  })

  it('lets a hedge override a confirmation word in the same sentence', () => {
    // "reportedly acquired" contains "acquired"; a confirmation list read alone promotes it.
    expect(isConfirmedTrade('Star WR reportedly acquired by Denver', null)).toBe(false)
  })

  it('does not let a high impact score bypass the confirmation rule', () => {
    // 'traded' is a HIGH_IMPACT_KEYWORD, so impact alone would have promoted this rumour.
    expect(
      decide({
        category: 'trade',
        impact: 'high',
        headline: 'Star RB could be traded before the deadline',
        body: null,
      }).eligible,
    ).toBe(false)
  })
})

/* ========================================================================================= *
 * Round-4: the negation list, conjugated in full.
 * ========================================================================================= */

describe('a club denying a transaction is not a confirmed transaction', () => {
  it('reads the BASE FORM, which the pattern missed', () => {
    /*
     * `\bdenie[sd]\b` covered "denies" and "denied" and not "deny", so this was read as a
     * confirmed trade and pushed as a completed move the club was publicly denying. The
     * docstring's own worked example was written from the pattern, not from the language.
     */
    expect(isConfirmedTrade('Titans deny the trade is done', null)).toBe(false)
  })

  it.each(['deny', 'denies', 'denied', 'denying'])('covers every form: %s', (verb) => {
    expect(isConfirmedTrade(`Titans ${verb} the trade is done`, null)).toBe(false)
  })
})

describe('the neighbours that had the identical gap', () => {
  it.each([
    'Trade falls through',
    'Trade fell through',
    'Deal falling through, per sources',
    // NOT bare "void" — excluded on purpose, see the "void of" case below.
    'Titans voids the trade',
    'Titans voided the trade',
    'Titans rescind the trade',
    'Titans call off the trade',
    'Titans called off the trade',
  ])('reads %s as not confirmed', (headline) => {
    // Each was covered in exactly one tense before this pass.
    expect(isConfirmedTrade(`${headline}. The trade has been completed.`, null)).toBe(false)
  })

  it('does not swallow "void of" as a negated transaction', () => {
    /*
     * Bare `void` is deliberately excluded: negation is the TERMINAL direction, so widening it
     * costs silence. "A roster void of depth" is a real headline and is not a non-event.
     */
    expect(isNegatedTransaction('Roster void of proven depth after the trade', null, true)).toBe(
      false,
    )
  })
})

describe('a real confirmed trade still gets through', () => {
  it('is not caught by any of the widened patterns', () => {
    // The control for the whole batch: widening negation must not silence the true positive.
    expect(isConfirmedTrade('WR has been traded to Cleveland', null)).toBe(true)
  })
})

describe('the headline form of a completed trade', () => {
  it.each(['Gibbs traded to Dallas', 'Lions RB Jahmyr Gibbs traded to Cowboys for two firsts'])(
    '%s is a confirmed trade',
    (headline) => {
      expect(isConfirmedTrade(headline, null)).toBe(true)
    },
  )

  it.each([
    'Gibbs wants to be traded to Dallas',
    'Gibbs will be traded to Dallas, sources expect',
    'Gibbs was nearly traded to Dallas at the deadline',
    'Gibbs almost traded to Dallas',
    'Gibbs could be traded to Dallas',
    'Gibbs reportedly traded to Dallas',
    'Gibbs will not be traded to Dallas',
  ])('%s is not', (headline) => {
    expect(isConfirmedTrade(headline, null)).toBe(false)
  })
})
