'use client'

import {
  VERDICT_LABEL,
  VERDICT_SOURCE_LABEL,
  type ChimmyFaabCard,
  type ChimmyVerdict,
} from '@/lib/chimmy/answerPolish'

/**
 * The three pieces of "answer polish" on a Chimmy answer (`lib/chimmy/answerPolish.ts`):
 *
 *   - `ChimmyVerdictChip` — HOLD / BID / START / YES / NO / COUNTER at the top of the answer.
 *   - `ChimmyFaabBidCard` — the `get_faab_bid_plan` result as a card instead of bullet prose.
 *   - `ChimmyNewerAnswerTag` — "Newer answer below" on an answer a later one re-ran.
 *
 * 🛑 ALL THREE RENDER ENGINE DATA ONLY. Nothing here looks at the answer's text, and there is no
 * fallback that would: an answer whose engine stated no verdict shows no chip.
 *
 * Same `af-cm-*` idiom and tokens as `ChimmyScenario` / `ChimmyEvidence` — this drawer has no
 * Tailwind. Tone is colour AND words, so a monochrome render still reads HOLD vs BID.
 */

export function ChimmyVerdictChip({ verdict }: { verdict: ChimmyVerdict }) {
  const { label, tone } = VERDICT_LABEL[verdict.key]
  return (
    <span
      className="af-cm-verdict"
      data-tone={tone}
      data-testid="chimmy-verdict"
      title={VERDICT_SOURCE_LABEL[verdict.source]}
    >
      <span className="af-cm-verdict-label">{label}</span>
      {verdict.detail ? <span className="af-cm-verdict-detail">{verdict.detail}</span> : null}
    </span>
  )
}

const money = (n: number) => `$${Math.round(n)}`

export function ChimmyFaabBidCard({ card }: { card: ChimmyFaabCard }) {
  const budget =
    card.remaining != null
      ? `${money(card.remaining)} left${card.seasonBudget != null ? ` of ${money(card.seasonBudget)}` : ''}`
      : 'Remaining FAAB not on file'

  return (
    <section className="af-cm-faab" data-testid="chimmy-faab-card" data-outcome={card.outcome} aria-label="FAAB bid plan">
      <div className="af-cm-faab-head">
        <span className="af-cm-scn-title">FAAB bid plan · {card.leagueName}</span>
        <span className="af-cm-faab-budget af-num">{budget}</span>
      </div>

      {card.outcome === 'save' ? (
        <p className="af-cm-faab-save">
          Hold your FAAB: none of the {card.pricedCount} valued unrostered players would improve your starting lineup.
        </p>
      ) : (
        <>
          {card.outcome === 'rank' ? (
            <p className="af-cm-faab-note">Not an elimination league, so these are ranked with no dollar amounts.</p>
          ) : null}
          <ol className="af-cm-faab-list">
            {card.bids.map((b, i) => (
              <li key={`${b.name}-${i}`} className="af-cm-faab-row">
                <span className="af-cm-faab-name">
                  {b.name}
                  {b.position ? <span className="af-cm-faab-pos"> {b.position}</span> : null}
                </span>
                {card.outcome === 'bid' ? (
                  <span className="af-cm-faab-bid af-num">
                    {b.ceiling != null ? `bid up to ${money(b.ceiling)}` : `${b.sharePct}% of this week's share`}
                  </span>
                ) : null}
                <span className="af-cm-faab-effect">
                  {card.lineupAssumed
                    ? 'upgrade over your weakest starter at his spot'
                    : b.displacedName
                      ? `benches ${b.displacedName}`
                      : 'fills an empty starting seat'}
                  {` · ${b.sharePct}% of the upgrade value`}
                </span>
              </li>
            ))}
          </ol>
          {card.moreCount > 0 ? (
            <p className="af-cm-faab-note">{card.moreCount} smaller upgrades not listed.</p>
          ) : null}
        </>
      )}

      {card.outcome !== 'save' && card.nonUpgrades > 0 ? (
        <p className="af-cm-faab-note">{card.nonUpgrades} other valued players would not improve your lineup: bid nothing on them.</p>
      ) : null}
      {card.lineupAssumed ? (
        <p className="af-cm-scn-note">Your league&apos;s starting slots are not on file, so a standard lineup was assumed.</p>
      ) : null}
      <p className="af-cm-faab-note">
        Unrostered is not the same as claimable — confirm waiver periods and pending claims on your platform.
        {card.valuesAsOf ? ` Values as of ${card.valuesAsOf}.` : ''}
      </p>
      {card.waiverLink ? (
        <a className="af-cm-handoff" href={card.waiverLink.href} target="_blank" rel="noopener noreferrer">
          {card.waiverLink.label} ↗
        </a>
      ) : null}
    </section>
  )
}

export function ChimmyNewerAnswerTag({ onJump }: { onJump: () => void }) {
  return (
    <button type="button" className="af-cm-newer" data-testid="chimmy-newer-answer" onClick={onJump}>
      Newer answer below ↓
    </button>
  )
}
