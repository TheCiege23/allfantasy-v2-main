'use client'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'

import { CoreDepthLockCta } from '@/components/core-app/CoreDepthLockCta'
import {
  CHIMMY_PRO_TOOL_UPGRADE_PATH,
  VERDICT_LABEL,
  chimmyLockSource,
  VERDICT_SOURCE_LABEL,
  proUpsellLine,
  type ChimmyFaabCard,
  type ChimmyProOnlyTool,
  type ChimmyVerdict,
} from '@/lib/chimmy/answerPolish'

/**
 * "From your past chats" — this answer quoted the user's own earlier Chimmy conversations
 * (`recall_past_chats`, AF Pro). Shown so a "last week you asked…" reads as remembered, not invented.
 */
export function ChimmyPastChatsChip() {
  return (
    <span className="af-cm-pastchats" data-testid="chimmy-past-chats" title="Chimmy searched your earlier conversations for this answer">
      From your past chats
    </span>
  )
}

/**
 * Under a free user's answer whose question needed an AF Pro tool the executor refused
 * (`meta.proUpsell`). One line and one button; never shown on an AF Pro answer.
 */
export function ChimmyProUpsell({ tools }: { tools: readonly ChimmyProOnlyTool[] }) {
  const { language } = useOptionalLanguage()
  const es = String(language ?? '').toLowerCase().startsWith('es')
  return (
    <div className="af-cm-proupsell" data-testid="chimmy-pro-upsell">
      <span className="af-cm-proupsell-line">{proUpsellLine(tools, language)}</span>
      {/*
        Tracked like every /core lock (2026-11-22): seen and clicked are recorded, and `from=lock_chimmy_<tool>` names
        which paid tool sold the plan on the growth page — it was one untracked link for every tool. Hidden in an iOS
        build that sells nothing (CoreDepthLockCta's `data-ios-purchase`).
      */}
      <CoreDepthLockCta
        href={CHIMMY_PRO_TOOL_UPGRADE_PATH}
        source={chimmyLockSource(tools)}
        requiredPlan="AF Pro"
        className="af-cm-outofanswers-btn"
        testId="chimmy-pro-upsell-cta"
      >
        {es ? 'Obtener AF Pro' : 'Get AF Pro'}
      </CoreDepthLockCta>
    </div>
  )
}

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
