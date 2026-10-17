import { describe, it, expect } from 'vitest'
import { classifyPlayerNewsCategory } from '@/lib/news/player-news-category'
import { decidePlayerNewsEligibility } from '@/lib/notifications/playerNewsEligibility'

/**
 * The classifier, and the classifier composed with the policy — because the defect was in the
 * COMPOSITION, not in either piece.
 *
 * A signing announced as a "deal" classified as `trade`, and the policy then held every trade
 * until the wording confirmed completion. Each half looked defensible on its own; together they
 * silently deleted the most common phrasing of the most common transaction.
 */

const classify = (headline: string, body: string | null = null) =>
  classifyPlayerNewsCategory(headline, body)

/** The pair the sweep actually runs, at the impact score the X classifier really assigns. */
const decide = (headline: string, body: string | null = null, impact = 'medium') =>
  decidePlayerNewsEligibility({ category: classify(headline, body), impact, headline, body })

describe('signings', () => {
  it.each([
    'Falcons sign RB to a three-year deal',
    'RB signs a three-year deal',
    'Agrees to a contract extension',
    'WR agreed to terms on a two-year deal',
    'Team signing veteran QB',
  ])('classifies as signing: %s', (headline) => {
    expect(classify(headline)).toBe('signing')
  })

  it.each([
    'Falcons sign RB to a three-year deal',
    'Agrees to a contract extension',
  ])('and is eligible at MEDIUM impact: %s', (headline) => {
    // The X classifier scores `signed` and `extension` as medium; the old gate needed high.
    expect(decide(headline).eligible).toBe(true)
  })
})

describe('acronyms that were DEAD in the old table must not be resurrected', () => {
  /*
   * 🛑 THE REWRITE MADE THESE DANGEROUS. The old classifier lower-cased the haystack and
   * compared it against the raw uppercase keyword, so `includes('IL')` / `('IR')` / `('PED')`
   * could never match — dead entries. Adding the `i` flag brought them back, and a leading-only
   * `\b` means `\bIR` matches any word STARTING "ir".
   *
   * Not a cosmetic mislabel: `injury` is in MATERIAL_ROSTER_CATEGORIES so it bypasses the
   * impact gate and pushes at severity `high`, and `lib/workers/x-news-ingestion.ts` calls
   * `persistInjuryFromNews` on it — writing a real injury row for a healthy player.
   */
  it.each([
    'Kyrie Irving returns to the starting lineup',
    'Illinois star declares for the draft',
    'Ireland native joins the practice squad',
    'Iron-man streak intact for veteran LB',
  ])('does not classify as injury: %s', (headline) => {
    expect(classify(headline)).not.toBe('injury')
  })

  it('does not read "Pederson" as a suspension', () => {
    expect(classify('Doug Pederson names Week 1 starter')).not.toBe('suspension')
  })

  it('does not read "running back" as an injury', () => {
    expect(classify('Bijan Robinson leads all running backs in touches')).not.toBe('injury')
  })

  it('still classifies a real injury report', () => {
    // Nothing is lost: a real report says injury / injured / ruled out / questionable.
    expect(classify('RB ruled out with a hamstring injury')).toBe('injury')
    expect(classify('WR questionable for Sunday')).toBe('injury')
  })

  it('still classifies a real suspension', () => {
    expect(classify('LB suspended six games')).toBe('suspension')
  })
})

describe('a trade rumour cannot escape through the word "contract"', () => {
  it('classifies a trade rumour mentioning a contract as a TRADE', () => {
    /*
     * 🛑 `'contract'` was STRONG in `signing`, and `signing` is iterated first, so this won the
     * strong pass — and `signing` is eligible outright, so the confirmed-only trade rule never
     * ran. Nearly every trade rumour mentions the contract.
     */
    expect(
      classify('Report: Jets could trade WR Garrett Wilson', 'He has two years left on his rookie contract.'),
    ).toBe('trade')
  })

  it('and holds it', () => {
    expect(
      decide('Report: Jets could trade WR Garrett Wilson', 'He has two years left on his rookie contract.', 'high'),
    ).toMatchObject({ eligible: false, reason: 'unconfirmed-trade' })
  })

  it.each([
    ['Sources: Jets and Browns agreed to terms on a trade sending WR Garrett Wilson to Cleveland', null],
    ['Report: Jets could acquire WR Garrett Wilson', 'He has two years left on his rookie contract.'],
  ])('classifies trade vocabulary as a TRADE, not a signing: %s', (headline, body) => {
    /*
     * 🛑 `'agreed to terms'` is listed VERBATIM in `TRADE_HEDGE_PATTERNS` as proof a trade is
     * NOT done, and it had been added to `signing.strong` — a category iterated first, and
     * material-roster, so eligible outright. The weak pass had the mirror hole: `signing.weak`'s
     * `contract` beat `trade.weak`'s `acquire`.
     */
    expect(classify(headline, body)).toBe('trade')
    expect(decide(headline, body, 'high').eligible).toBe(false)
  })

  it('still classifies a contract-only signing story as a signing', () => {
    // Weak, not absent: the weak pass still leads with `signing`.
    expect(classify('Player and team finalize contract')).toBe('signing')
  })
})

describe('word-boundary matching', () => {
  it('does not read "Quarterback" as an injury', () => {
    // `injury` is checked first and contains "back".
    expect(classify('Quarterback signs a four-year extension')).toBe('signing')
  })

  it.each([
    ['until', 'Deal will not be official until Monday'],
    ['available', 'Player is available for the opener'],
  ])('does not read "%s" as an IL/injury match', (_word, headline) => {
    expect(classify(headline)).not.toBe('injury')
  })

  it('does not read "haircut" as a release', () => {
    expect(classify('Player debuts a new haircut at camp')).not.toBe('release')
  })
})

describe('incidental historical wording loses to the actual event', () => {
  it('a signing that mentions a healed knee is a signing', () => {
    expect(classify('RB signs extension', 'His knee is fully healed after last season.')).toBe(
      'signing',
    )
  })

  it('a signing that mentions a past trade is a signing', () => {
    expect(
      classify('WR signs an extension', 'He was traded to the club two seasons ago.'),
    ).toBe('signing')
  })

  it('a real injury report is still an injury', () => {
    expect(classify('RB ruled out with a hamstring injury')).toBe('injury')
  })

  it('a real trade is still a trade', () => {
    expect(classify('RB has been traded to the Bears')).toBe('trade')
  })
})

describe('real trades: confirmed only, through classifier and policy together', () => {
  it('a confirmed completed trade is eligible', () => {
    expect(decide('RB has been traded to the Bears', 'The deal is official.', 'high')).toMatchObject(
      { eligible: true, reason: 'confirmed-trade' },
    )
  })

  it.each([
    'RB could be traded before the deadline',
    'Sources: team expected to trade the veteran WR',
    'Club nearing a deal to trade its starting corner',
  ])('a rumour is held: %s', (headline) => {
    expect(decide(headline, null, 'high')).toMatchObject({
      eligible: false,
      reason: 'unconfirmed-trade',
    })
  })

  it.each([
    'Star RB will not be traded, GM says',
    'The trade fell through',
    'Team denies the trade is done',
    'Deal was voided after the physical',
    "Veteran WR won't be traded this week",
  ])('a NEGATED trade is held: %s', (headline) => {
    /*
     * A negation MATCHES the confirmation patterns — "will not be traded" contains "be traded",
     * "the trade fell through" reads as completion to a verb-spotting list. Sending "traded to
     * Chicago" about a player who is staying is worse than sending nothing, because the user
     * acts on it.
     */
    expect(decide(headline, null, 'high').eligible).toBe(false)
  })

  it.each([
    ['Terms were not disclosed.', 'Falcons sign RB to a three-year deal'],
    ['The team did not release financial details.', 'WR agrees to an extension'],
    ['Guarantees have not been reported.', 'QB signs an extension'],
    // ⚠ THE PASSIVE ORDER — the commoner phrasing, and the first strip missed it entirely.
    ['Terms of the contract were not released.', 'QB signs four-year deal'],
    ['Terms were not released.', 'WR signs an extension'],
    ['Financial details were not disclosed.', 'Team signs veteran LB'],
    ['Salary figures have not been revealed.', 'RB agrees to an extension'],
  ])('contract boilerplate is NOT a negation: %s', (body, headline) => {
    /*
     * 🛑 THE FIRST NEGATION RULE MATCHED ANY AUXILIARY + "not" AND DELETED ORDINARY SIGNINGS.
     * "Terms were not disclosed" is boilerplate on roughly every contract story written. A
     * broad negation rule does not fail loudly — it silently removes the category it was added
     * to protect, which is the same shape as the impact gate it replaced.
     */
    expect(decide(headline, body).eligible).toBe(true)
  })

  it('a real injury negation is still delivered — "will not play" IS the news', () => {
    // Negation is scoped to transaction categories precisely so this keeps working.
    expect(decide('RB ruled out, will not play Sunday', null, 'medium').eligible).toBe(true)
  })

  it('"acquired" alone does not confirm anything', () => {
    // It was in the confirmation list, and is genuine trade vocabulary that proves nothing.
    expect(decide('Star WR acquired by Denver', null, 'high')).toMatchObject({
      eligible: false,
      reason: 'unconfirmed-trade',
    })
  })

  it('"officially acquired" does confirm it', () => {
    expect(decide('Star WR officially acquired by Denver', null, 'high').eligible).toBe(true)
  })
})

describe('non-material categories still need high impact', () => {
  it('holds a medium-impact coaching hire', () => {
    expect(decide('Team hires a new coordinator').eligible).toBe(false)
  })

  it('allows a high-impact one', () => {
    expect(decide('Head coach fired', null, 'high').eligible).toBe(true)
  })
})

describe('the classifier batch: headline outranks body, and ambiguous verbs are disqualified', () => {
  it('does not read "released a statement" as a roster move', () => {
    /*
     * 🛑 `release` is material-roster, so it is eligible outright — this pushed
     * "Released: <player>" for a player who had not been released. The object of the verb is
     * what separates the two meanings, and a `disqualifiers` entry names the other one.
     */
    expect(classify("The team released a statement on the quarterback's status")).not.toBe('release')
    expect(classify('Club released its depth chart for Week 1')).not.toBe('release')
    expect(classify('WR released from the injury report')).not.toBe('release')
  })

  it('still reads a real release as a release', () => {
    expect(classify('Team releases veteran LB')).toBe('release')
    expect(classify('RB was released by the Bears')).toBe('release')
    expect(classify('Player waived')).toBe('release')
  })

  it('lets the HEADLINE event outrank a body part mentioned in the body', () => {
    /*
     * The body term and the headline term are in different categories, so under one blob
     * whichever list is examined first wins however the table is sorted. Only headline-first
     * resolves it — and misclassifying this as `injury` made `x-news-ingestion` write a real
     * injury row for a healthy player.
     */
    expect(
      classify('WR and team finalize contract', 'The shoulder that ended his 2025 is fully healed.'),
    ).toBe('signing')
  })

  it('still uses the body when the headline carries no event', () => {
    // Passes 2 and 4 exist precisely so a bare headline over a detailed body still classifies.
    expect(classify('Injury update', 'RB ruled out with a hamstring injury.')).toBe('injury')
    expect(classify('Roster note', 'Team signs veteran QB to a one-year deal.')).toBe('signing')
  })

  it('covers the past tense that removing "agreed to terms" left uncovered', () => {
    // `\bagrees` does not match "agreed"; this fell through to player_news and was ineligible.
    expect(classify('Free agent CB agreed to terms with Denver')).toBe('signing')
    expect(decide('Free agent CB agreed to terms with Denver').eligible).toBe(true)
  })

  it('does not let "acquire" outrank injury vocabulary', () => {
    /*
     * Hoisting `trade` to the FRONT of the weak pass fixed the contract-beats-acquire tie and
     * broke this: an injury headline that mentions an acquisition became an unconfirmed trade,
     * which is a TERMINAL policy skip.
     */
    expect(classify('Vikings acquire depth as Jefferson is out for the season')).toBe('injury')
  })

  it('still breaks the trade/signing tie that the reorder existed for', () => {
    expect(
      classify('Report: Jets could acquire WR Garrett Wilson', 'He has two years left on his rookie contract.'),
    ).toBe('trade')
    expect(
      decide('Report: Jets could acquire WR Garrett Wilson', 'He has two years left on his rookie contract.', 'high')
        .eligible,
    ).toBe(false)
  })
})

describe('negation is scoped to the clause carrying the event', () => {
  it('does not suppress a signing because the body denies an unrelated trade', () => {
    /*
     * 🛑 A denial of a rumour is routinely reported in the same paragraph as the extension that
     * prompted it. Matching a transaction verb anywhere in headline+body ruled the signing
     * `negated-event` — and a policy skip is TERMINAL, so it was stamped and never reconsidered.
     */
    expect(
      decide('WR signs a three-year extension', 'The team confirmed he will not be traded before the deadline.')
        .eligible,
    ).toBe(true)
  })

  it('still holds a negation carried by the headline', () => {
    expect(decide('Star RB will not be traded, GM says', null, 'high').eligible).toBe(false)
    expect(decide('The trade fell through', null, 'high').eligible).toBe(false)
  })

  it('a body-only "fell through" is still held, via the confirmation requirement', () => {
    // Trades need positive completion wording over the whole text, so this stays held anyway.
    expect(decide('Trade update', 'The deal fell through late last night.', 'high').eligible).toBe(false)
  })
})

/* ========================================================================================= *
 * Round-4 classifier batch.
 *
 * Every case below is the reproduction the finding shipped with, kept verbatim so a later
 * rewrite that reintroduces the defect fails on the same sentence that exposed it.
 * ========================================================================================= */

describe('the headline is the event, at BOTH evidence strengths', () => {
  it('does not let a STRONG body word outrank a WEAK headline word', () => {
    /*
     * The rewrite that introduced the four passes claimed this and did not do it: it ran
     * strong-anywhere BEFORE weak-in-headline, so any strong injury word in the body still won.
     * `x-news-ingestion` then wrote a real InjuryReportRecord for a healthy, just-signed player.
     */
    expect(
      classify(
        'WR and team finalize contract',
        'The shoulder injury that ended his 2025 season is fully healed.',
      ),
    ).toBe('signing')
  })

  it.each(['injury', 'ruled out', 'concussion', 'questionable', 'doubtful'])(
    'holds for every strong injury word, not just the weak ones: %s',
    (word) => {
      // The old ordering happened to work when the body term was WEAK. That was the whole bug:
      // it looked fixed against `shoulder` and reproduced exactly against `concussion`.
      expect(classify('WR and team finalize contract', `He is ${word} no longer.`)).toBe('signing')
    },
  )

  it('still reads the body when the headline carries no evidence at all', () => {
    // Passes 3 and 4 must survive the reorder, or a bare headline classifies as nothing.
    expect(classify('Roster update', 'Smith was ruled out for Sunday with a concussion.')).toBe(
      'injury',
    )
  })
})

describe('a disqualifier voids its own clause, not the document', () => {
  it('keeps a real release when the body carries the usual boilerplate', () => {
    /*
     * "released a statement" is on essentially every release story. Voiding the category
     * document-wide dropped the genuine roster move to `player_news` — ineligible, and
     * `policy-skipped` is TERMINAL.
     *
     * 🛑 THE HEADLINE IS BARE ON PURPOSE. Written with "Broncos release veteran LB" as the
     * headline this test PASSES WITH THE FIX REVERTED, because pass 1 matches the headline alone
     * and the body is never consulted — the assertion was true for a reason that had nothing to
     * do with what it claimed to test. A document-wide disqualifier only bites on the
     * headline+body passes, so the headline has to carry no release evidence of its own.
     */
    expect(
      classify(
        'Roster update from Denver',
        'The Broncos will release veteran LB Smith. The team released a statement thanking him.',
      ),
    ).toBe('release')
  })

  it('still rejects a story that is ONLY the boilerplate', () => {
    // The disqualifier must keep doing its job — this is the case it was written for.
    expect(classify('Team released a statement on the QB', 'No further detail was given.')).not.toBe(
      'release',
    )
  })
})

describe('disclosure boilerplate is one rule, not two', () => {
  it('does not turn a re-signing into a release via the PASSIVE word order', () => {
    /*
     * The eligibility module already stripped both word orders; the classifier had its own copy
     * written from the active form only. One sentence, handled correctly in one module and
     * incorrectly in the other, pushing "Released: <player>" for a player who just re-signed.
     */
    expect(classify('Chiefs and WR agree to a four-year deal', 'Terms were not released.')).toBe(
      'signing',
    )
  })
})

describe('keywords match the word, not a word that starts with it', () => {
  it.each([
    // Each of these depends on the END anchor: the keyword really is a live table entry, and a
    // leading-only `\b` matches the longer word. Verified by reverting the anchor — these fail.
    ['Chiefs are cutting practice reps for the starters', 'release', 'cut'],
    // NOT "dealing with a hamstring injury" — that headline carries a strong injury word, so it
    // classifies correctly with the anchor reverted and proves nothing about the `deal` entry.
    ['Coach says the team is dealing with roster churn', 'signing', 'deal'],
    ['Signal caller named the Week 1 starter', 'signing', 'sign'],
    ['Significant snap-count shift for the rookie WR', 'signing', 'sign'],
    ['Team unveils a new trademark for the throwback jersey', 'trade', 'trade'],
  ])('does not classify %s as %s (the %s entry must not match the longer word)', (headline, wrong) => {
    expect(classify(headline)).not.toBe(wrong)
  })

  it.each([
    ['Kyrie Irving returns to the starting lineup', 'injury'],
    ['Illinois star declares for the draft', 'injury'],
    ['Pederson said the team is healthy', 'suspension'],
    ['Panthers conduct workouts for free agent running backs', 'suspension'],
    ['Star running back leads the ground game', 'injury'],
  ])('does not classify %s as %s', (headline, wrong) => {
    /*
     * ⚠ THESE PASS BECAUSE THE ENTRY WAS DELETED, NOT BECAUSE OF THE ANCHOR — `IR`, `PED` and
     * `back` are no longer in the table at all, and `conduct` is now only the noun phrase. Kept
     * as a guard against someone re-adding them, and labelled so the block above is not read as
     * covering them. Reverting the anchor does NOT turn these red; that is the point of the
     * separation.
     */
    expect(classify(headline)).not.toBe(wrong)
  })

  it('keeps the one deliberate PREFIX entry working', () => {
    // `relocat*` is opt-in prefix matching, and must not have been lost to the anchoring change.
    for (const h of ['Ownership explores relocation', 'Team could relocate', 'Relocating in 2027']) {
      expect(classify(h)).toBe('team_news')
    }
  })
})

describe('the bare stem, which is what a plural team name takes', () => {
  it.each([
    ['Broncos release veteran LB', 'release'],
    ['Chiefs sign free-agent WR', 'signing'],
    ['Jets and QB agree to terms', 'signing'],
    ['Rams waive backup TE', 'release'],
  ])('classifies %s as %s', (headline, expected) => {
    // All of these matched nothing, scored low impact, and were policy-skipped — TERMINAL.
    expect(classify(headline)).toBe(expected)
  })

  it('and they reach the policy as material roster events', () => {
    expect(decide('Broncos release veteran LB').eligible).toBe(true)
    expect(decide('Chiefs sign free-agent WR').eligible).toBe(true)
  })

  it('does not match the words end-anchoring was added to exclude', () => {
    for (const h of ['Signal caller named starter', 'Significant snap-count shift for the WR']) {
      expect(classify(h)).not.toBe('signing')
    }
  })
})

describe('injured reserve is a roster designation, not an injury', () => {
  it('reads an activation OFF the list as a roster move', () => {
    // This wrote a fresh injury row for a player who had just been declared available.
    expect(classify('Team activates RB from injured reserve')).toBe('roster_move')
  })

  it('still classifies a placement that names the injury on the injury', () => {
    // The disqualifier voids only the `injured` inside the phrase, so `concussion` still wins.
    expect(classify('RB placed on injured reserve after suffering a concussion')).toBe('injury')
  })
})
