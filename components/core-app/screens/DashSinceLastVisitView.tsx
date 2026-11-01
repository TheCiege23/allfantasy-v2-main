'use client'

import Link from 'next/link'
import type { BriefHandoff, BriefStanding, SinceLastVisitBrief } from '@/lib/core-app/sinceLastVisit'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { alertGroupText, briefTradeSummaryText, handoffText } from '@/lib/core-app/homeBandsCopy'
import { dashSinceLastVisitMessages } from '@/lib/core-app/messages/dashSinceLastVisit'

/**
 * The words of DashSinceLastVisit, in the reader's language (2026-10-04).
 *
 * The brief is a SERVER component: it works out how far back the window reaches against the server's
 * `now` and builds every link, and this says it. A designation goes through `coreUiCopy`; a trade
 * summary is rebuilt from the parts `tradesSince` now writes (whole English without them); an alert
 * group is named by its notification TYPE, not its English label.
 */

/** A span of time the server measured: "5h", "3d". */
export type BriefSpan = { n: number; unit: 'm' | 'h' | 'd' }

export type SinceLastVisitViewProps = {
  /** "last 7 days" (a first visit, or a capped window) or "since <span> ago". */
  when: { kind: 'week' } | { kind: 'since'; span: BriefSpan }
  /** How much further back the trade line reaches than the header, when it does. */
  tradeReach: BriefSpan | null
  trades: {
    count: number
    atLeast: boolean
    items: Array<{ key: string; href: string; leagueName: string; summary: string; parts: SinceLastVisitBrief['trades']['items'][number]['parts'] | null; handoff: BriefHandoff | null }>
  }
  injuries: Array<{
    key: string
    name: string
    position: string | null
    from: string | null
    to: string | null
    leagues: string[]
    handoff: BriefHandoff | null
  }>
  injuryCount: number
  anyFollowedOnly: boolean
  standings: Array<{ key: string; href: string; standing: BriefStanding }>
  alerts: { total: number; groups: Array<{ type: string; label: string; count: number }> }
  comparisonPending: boolean
}

type SinceLastVisitMessages = typeof dashSinceLastVisitMessages.en

function spanText(s: BriefSpan, m: SinceLastVisitMessages): string {
  return m.span(s.n, s.unit)
}

function statusText(status: string | null, language: string, m: SinceLastVisitMessages): string {
  if (status == null) return m.noDesignation
  return coreUiCopy(status, language)
}

function resultText(s: BriefStanding, m: SinceLastVisitMessages): string {
  const parts: string[] = []
  const games = s.won + s.lost + s.tied
  if (games > 0) {
    const tie = s.tied > 0 ? `–${s.tied}` : ''
    const record = `${s.wins}–${s.losses}${s.ties > 0 ? `–${s.ties}` : ''}`
    parts.push(m.went(s.won, s.lost, tie, record))
  }
  if (s.rank != null && s.previousRank != null && s.rank !== s.previousRank) {
    const up = s.rank < s.previousRank
    parts.push(m.moved(up, s.rank, s.previousRank))
  }
  return parts.join(', ')
}

function Handoff({ handoff, language }: { handoff: BriefHandoff; language: string }) {
  const h = handoffText(handoff.label, handoff.screen, language)
  return (
    <>
      {' '}
      <a className="af-brief-handoff" href={handoff.href} target="_blank" rel="noopener noreferrer" title={h.title}>
        {h.label} <span aria-hidden>↗</span>
      </a>
    </>
  )
}

export function DashSinceLastVisitView(props: SinceLastVisitViewProps) {
  const { when, tradeReach, trades, injuries, injuryCount, anyFollowedOnly, standings, alerts, comparisonPending } = props
  const { language } = useOptionalLanguage()
  const m = useMessages(dashSinceLastVisitMessages)
  const whenText = when.kind === 'week' ? m.lastWeek : m.since(spanText(when.span, m))
  const reachText = tradeReach ? m.reaches(spanText(tradeReach, m)) : null
  const one = trades.count === 1 && !trades.atLeast

  return (
    <section className="af-core af-brief" aria-label={m.title}>
      <details open>
        <summary className="af-brief-head">
          <span className="af-label af-brief-kicker">{m.title}</span>
          {/* Inside the <summary> on purpose: a button there opens its popover without toggling the details. */}
          <TopicTip topic="sinceLastVisit" />
          <span className="af-brief-when af-num">{whenText}</span>
        </summary>

        <ul className="af-brief-list">
          {trades.count > 0 ? (
            <li className="af-brief-row" data-kind="trades">
              <span className="af-brief-what">
                {trades.atLeast ? `${trades.count}+` : trades.count}{' '}
                {one ? m.newTrade : m.newTrades}
                {reachText ? <span className="af-brief-reach"> ({reachText})</span> : null}
              </span>
              <ul className="af-brief-sub">
                {trades.items.map((t) => (
                  <li key={t.key}>
                    <Link href={t.href} className="af-brief-link">
                      {t.leagueName}
                    </Link>
                    <span className="af-brief-detail"> — {m.tradeSummary(t.summary, briefTradeSummaryText(t.parts))}</span>
                    {t.handoff ? <Handoff handoff={t.handoff} language={language} /> : null}
                  </li>
                ))}
              </ul>
            </li>
          ) : null}

          {injuryCount > 0 ? (
            <li className="af-brief-row" data-kind="injuries">
              <span className="af-brief-what">
                {m.injuryChanges(injuryCount, anyFollowedOnly)}
              </span>
              <ul className="af-brief-sub">
                {injuries.map((i) => (
                  <li key={i.key}>
                    <b>{i.name}</b>
                    {i.position ? <span className="af-brief-pos af-num"> {i.position}</span> : null}
                    <span className="af-brief-detail">
                      {' '}
                      {statusText(i.from, language, m)} → <b>{statusText(i.to, language, m)}</b> ·{' '}
                      {/* A followed player on none of your rosters has no league to name (2026-09-14). */}
                      {i.leagues.length === 0 ? m.following : i.leagues.length === 1 ? i.leagues[0] : m.ofYourLeagues(i.leagues.length)}
                    </span>
                    {i.handoff ? <Handoff handoff={i.handoff} language={language} /> : null}
                  </li>
                ))}
                {injuryCount > injuries.length ? (
                  <li className="af-brief-more">{m.more(injuryCount - injuries.length)}</li>
                ) : null}
              </ul>
            </li>
          ) : null}

          {standings.length > 0 ? (
            <li className="af-brief-row" data-kind="standings">
              <span className="af-brief-what">
                {m.results(standings.length)}
              </span>
              <ul className="af-brief-sub">
                {standings.map((s) => (
                  <li key={s.key}>
                    <Link href={s.href} className="af-brief-link">
                      {s.standing.leagueName}
                    </Link>
                    <span className="af-brief-detail"> — {resultText(s.standing, m)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}

          {alerts.total > 0 ? (
            <li className="af-brief-row" data-kind="alerts">
              <span className="af-brief-what">
                {m.unreadAlerts(alerts.total)}
              </span>
              <span className="af-brief-detail">
                {' '}
                {alerts.groups.map((g) => `${g.count} ${alertGroupText(g.type, g.label, language)}`).join(', ')}
              </span>{' '}
              <Link href="/core/notifications" className="af-brief-link">
                {m.openAlerts}
              </Link>
            </li>
          ) : null}
        </ul>

        {comparisonPending ? (
          <p className="af-brief-note">
            {m.comparisonPending}
          </p>
        ) : null}
      </details>
    </section>
  )
}

export default DashSinceLastVisitView
