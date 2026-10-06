'use client'

import Link from 'next/link'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import type { SectionState } from '@/lib/core-app/leagueHome'
import type { PlayerTradeVisual, TradeVisualAsset, TradeVisualGrade, TradeVisualPackage } from '@/lib/core-app/playerTradeVisual'
import { platformLabel, tradeLink } from '@/lib/core-app/platformLinks'
import {
  bidReasonText,
  gradeLabelText,
  gradeRecommendationText,
  packageReasonText,
  scoringAdjustmentText,
  tradeBanText,
  tradeValueCopy,
  tradeValueReasonText,
  type TradeValueCopy,
} from '@/lib/core-app/finderTradeValueCopy'

/**
 * The trade visual — what it takes to get him, and what we recommend.
 *
 * Give on the left, get on the right, the value totals under each, then THE
 * trade grade — the one letter the Trade Center gives the same deal. The hand-off
 * to the platform sits inside the card (Guap, 2026-09-02): AllFantasy never sends
 * a trade, so the last thing the card does is point at the screen that can.
 *
 * 🛑 ONE VERDICT (2026-09-29). This card used to print the package finder's
 * fairness band AND a second engine's "Engine: accept/reject", starter points and
 * acceptance odds — none of them the Trade Center's letter. Only the one grade is
 * printed now; see `lib/core-app/playerTradeVisual.ts`.
 *
 * Spanish (2026-10-05): the card's words, the grade label and every loader sentence come from
 * finderTradeValueCopy.ts, which reuses the Trade Center's own Spanish for trade and value wording.
 */

function fmtValue(n: number | null): string {
  if (n == null) return '—'
  return n.toLocaleString('en-US')
}

/** Your letter's tone: even or better reads good, a slight overpay warns, a big one is bad. */
function letterTone(letter: TradeVisualGrade['letter']): 'good' | 'warn' | 'bad' {
  if (letter === 'A' || letter === 'B' || letter === 'C') return 'good'
  return letter === 'D' ? 'warn' : 'bad'
}

function GradeChip({ grade, language }: { grade: TradeVisualPackage['grade']; language: string }) {
  if (!grade.available) return null
  return (
    <span className="af-chip af-num af-pf-tv-grade" data-tone={letterTone(grade.data.letter)}>
      {grade.data.letter} · {gradeLabelText(grade.data.label, language)}
    </span>
  )
}

function AssetList({ assets, empty, t }: { assets: TradeVisualAsset[]; empty: string; t: TradeValueCopy }) {
  if (assets.length === 0) return <p className="af-pf-tv-empty">{empty}</p>
  return (
    <ul className="af-pf-tv-assets">
      {assets.map((a, i) => (
        <li key={`${a.playerId ?? a.name}-${i}`} className="af-pf-tv-asset">
          <span className="af-pf-tv-asset-name">{a.name}</span>
          <span className="af-pf-tv-asset-meta af-num">{a.position ?? ''}</span>
          <span className="af-pf-tv-asset-value af-num" title={t.marketValueTitle}>
            {fmtValue(a.value)}
          </span>
        </li>
      ))}
    </ul>
  )
}

export function TradeVisual({ state, playerName }: { state: SectionState<PlayerTradeVisual>; playerName: string }) {
  const { language } = useOptionalLanguage()
  const t = tradeValueCopy(language)
  const last = playerName.trim().split(/\s+/).slice(-1)[0] ?? playerName

  if (!state.available) {
    return (
      <section className="af-card af-pf-tv af-pf-tv--empty" aria-labelledby="af-pf-tv-h">
        <header className="af-pf-tv-head">
          <span className="af-label">{t.tradeFor(last)}</span>
        </header>
        <p className="af-pf-unavailable">{tradeValueReasonText(state.reason, language)}.</p>
      </section>
    )
  }

  const v = state.data

  /*
   * 🛑 A NO-TRADE LEAGUE GETS A DIFFERENT CARD ENTIRELY, NOT A TRADE CARD WITH A NOTE ON IT.
   * The heading, the give/get columns and the "send it on the platform" hand-off all describe an
   * action this manager cannot take. Rendering them under a caveat is how a caveat gets skimmed.
   */
  if (v.bidInstead) {
    const b = v.bidInstead
    return (
      <section className="af-card af-pf-tv af-pf-tv--bid" aria-labelledby="af-pf-tv-h">
        <header className="af-pf-tv-head">
          <span className="af-label">{t.bidFor(last)}</span>
          <h3 className="af-pf-h3" id="af-pf-tv-h">
            {b.marginalValue > 0 ? t.bidUpgrade(last) : t.bidNoUpgrade(last)}
          </h3>
        </header>
        {b.marginalValue > 0 ? (
          <p className="af-pf-tv-bidline">
            <strong>
              {b.ceilingAtRemaining != null ? t.bidUpTo(b.ceilingAtRemaining) : t.bidShareOfBudget(Math.round(b.shareOfSupply * 100))}
            </strong>
            {t.bidShareTail(Math.round(b.shareOfSupply * 100))}
          </p>
        ) : null}
        <p className="af-pf-readonly-note">{bidReasonText(b, language)}</p>
        <div className="af-pf-tv-actions">
          <Link className="af-btn af-pf-tv-btn" href={`/core/trades?league=${v.leagueId}`}>
            {t.openTradeCenter}
          </Link>
        </div>
      </section>
    )
  }

  /*
   * A no-trade league with no bid to offer (a tournament, or an elimination league whose bid could
   * not be worked out). Without this it fell through to "No balanced package right now", which reads
   * as "try again later" in a league where no package can ever be sent.
   */
  if (v.tradesAllowed === false) {
    return (
      <section className="af-card af-pf-tv af-pf-tv--notrade" aria-labelledby="af-pf-tv-h">
        <header className="af-pf-tv-head">
          <span className="af-label">{t.tradeFor(last)}</span>
          <h3 className="af-pf-h3" id="af-pf-tv-h">{t.noTradesHeading}</h3>
        </header>
        <p className="af-pf-readonly-note">{v.tradeBan ? tradeBanText(v.tradeBan, language) : t.noTradesFallback}</p>
      </section>
    )
  }

  const rec = v.recommended
  const links = tradeLink({
    id: v.leagueId,
    platform: v.platform,
    platformLeagueId: v.platformLeagueId,
    season: v.season,
    name: v.leagueName,
    teamId: v.you.externalId,
    partnerTeamId: v.partner.externalId,
  })
  const others = v.packages.filter((p) => p.id !== rec?.id)
  /*
   * The recommended package's own grade. `v.grade` is the same object — the loader sets it from the
   * recommended package — and is the fallback for a payload built before packages carried a grade.
   */
  const recGrade: TradeVisualPackage['grade'] = rec?.grade ?? v.grade

  return (
    <section className="af-card af-pf-tv" aria-labelledby="af-pf-tv-h" data-grade={recGrade.available ? recGrade.data.letter : 'none'}>
      <header className="af-pf-tv-head">
        <span className="af-label">{t.tradeFor(last)}</span>
        <h3 className="af-pf-h3" id="af-pf-tv-h">
          {rec ? t.whatItTakes(last, v.partner.teamName) : t.noBalanced(last, v.partner.teamName)}
        </h3>
        <p className="af-pf-block-sub">
          {v.partner.teamName}
          {v.partner.ownerName ? ` · @${v.partner.ownerName}` : ''} ·{' '}
          {v.partner.stanceSettled === false ? t.tooEarlyStance : t.stance(v.partner.stance)}
          {v.partner.needs.length > 0 ? t.needs(v.partner.needs.join(', ')) : ''}
          {v.partner.surpluses.length > 0 ? t.deepAt(v.partner.surpluses.join(', ')) : ''}
        </p>
      </header>

      {rec ? (
        <>
          <div className="af-pf-tv-sides">
            <div className="af-pf-tv-side" data-side="give">
              <span className="af-label">{t.youGive}</span>
              <AssetList assets={rec.give} empty={t.nothing} t={t} />
              <span className="af-pf-tv-total af-num">{fmtValue(rec.giveTotal)}</span>
            </div>
            <div className="af-pf-tv-arrow" aria-hidden>
              ⇄
            </div>
            <div className="af-pf-tv-side" data-side="get">
              <span className="af-label">{t.youGet}</span>
              <AssetList assets={rec.receive} empty={t.nothing} t={t} />
              <span className="af-pf-tv-total af-num">{fmtValue(rec.receiveTotal)}</span>
            </div>
          </div>

          <div className="af-pf-tv-verdict">
            {recGrade.available ? (
              <GradeChip grade={recGrade} language={language} />
            ) : (
              <span className="af-pf-nothing">{t.gradePrefix(tradeValueReasonText(recGrade.reason, language))}</span>
            )}
            <span className="af-pf-tv-delta af-num">{t.deltaToYou(`${rec.delta >= 0 ? '+' : ''}${fmtValue(rec.delta)}`)}</span>
          </div>

          {rec.reasons.length > 0 || recGrade.available ? (
            <ul className="af-pf-tv-reasons">
              {recGrade.available ? <li>{gradeRecommendationText(recGrade.data.recommendation, language)}</li> : null}
              {rec.reasons.map((r) => (
                <li key={r}>{packageReasonText(r, language)}</li>
              ))}
            </ul>
          ) : null}

          {others.length > 0 ? (
            <div className="af-pf-tv-others">
              <span className="af-label">{t.otherPackages}</span>
              <ul className="af-pf-tv-other-list">
                {others.map((p) => (
                  <li key={p.id} className="af-pf-tv-other">
                    <span className="af-pf-tv-other-text">
                      {t.packageFor(p.give.map((a) => a.name).join(' + '), p.receive.map((a) => a.name).join(' + '))}
                    </span>
                    {p.grade ? <GradeChip grade={p.grade} language={language} /> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : (
        <p className="af-pf-unavailable">{t.nothingBalanced}</p>
      )}

      <div className="af-pf-tv-actions">
        {links.there ? (
          <a className="af-btn af-pf-tv-btn" href={links.there.href} target="_blank" rel="noopener noreferrer">
            {t.sendItOn(links.there.platformLabel)}
          </a>
        ) : null}
        <Link className={`af-btn af-pf-tv-btn${links.there ? ' af-btn--ghost' : ''}`} href={links.here.href}>
          {t.openTradeCenter}
        </Link>
      </div>

      <p className="af-pf-readonly-note">
        {t.valuesFoot(v.values.mode, v.values.ppr, v.values.numQbs)}
        {v.values.scoringAdjustment ? ` ${scoringAdjustmentText(v.values.scoringAdjustment, language)}` : ''}
        {' '}
        {t.neverSends(platformLabel(v.platform))}
      </p>
    </section>
  )
}

export default TradeVisual
