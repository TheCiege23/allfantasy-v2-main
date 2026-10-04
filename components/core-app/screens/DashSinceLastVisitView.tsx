'use client'

import Link from 'next/link'
import type { BriefHandoff, BriefStanding, SinceLastVisitBrief } from '@/lib/core-app/sinceLastVisit'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { coreUiCopy } from '@/lib/core-app/coreUiCopy'
import { alertGroupText, briefTradeSummaryText, handoffText } from '@/lib/core-app/homeBandsCopy'

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

function spanText(s: BriefSpan, es: boolean): string {
  if (!es) return `${s.n}${s.unit}`
  return `${s.n} ${s.unit === 'm' ? 'min' : s.unit}`
}

function statusText(status: string | null, language: string): string {
  if (status == null) return language === 'es' ? 'sin designación' : 'no designation'
  return coreUiCopy(status, language)
}

function resultText(s: BriefStanding, es: boolean): string {
  const parts: string[] = []
  const games = s.won + s.lost + s.tied
  if (games > 0) {
    const tie = s.tied > 0 ? `–${s.tied}` : ''
    const record = `${s.wins}–${s.losses}${s.ties > 0 ? `–${s.ties}` : ''}`
    parts.push(es ? `quedó ${s.won}–${s.lost}${tie}, ahora ${record}` : `went ${s.won}–${s.lost}${tie}, now ${record}`)
  }
  if (s.rank != null && s.previousRank != null && s.rank !== s.previousRank) {
    const up = s.rank < s.previousRank
    parts.push(
      es
        ? `${up ? 'sube' : 'baja'} al #${s.rank} (antes #${s.previousRank})`
        : `${up ? 'up' : 'down'} to #${s.rank} (was #${s.previousRank})`,
    )
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
  const es = language === 'es'
  const title = es ? 'Desde tu última visita' : 'Since your last visit'
  const whenText =
    when.kind === 'week' ? (es ? 'últimos 7 días' : 'last 7 days') : es ? `desde hace ${spanText(when.span, true)}` : `since ${spanText(when.span, false)} ago`
  const reachText = tradeReach ? (es ? `llega ${spanText(tradeReach, true)} más atrás` : `reaches ${spanText(tradeReach, false)} further back`) : null
  const one = trades.count === 1 && !trades.atLeast

  return (
    <section className="af-core af-brief" aria-label={title}>
      <details open>
        <summary className="af-brief-head">
          <span className="af-label af-brief-kicker">{title}</span>
          {/* Inside the <summary> on purpose: a button there opens its popover without toggling the details. */}
          <TopicTip topic="sinceLastVisit" />
          <span className="af-brief-when af-num">{whenText}</span>
        </summary>

        <ul className="af-brief-list">
          {trades.count > 0 ? (
            <li className="af-brief-row" data-kind="trades">
              <span className="af-brief-what">
                {trades.atLeast ? `${trades.count}+` : trades.count}{' '}
                {es ? (one ? 'intercambio nuevo' : 'intercambios nuevos') : one ? 'new trade' : 'new trades'}
                {reachText ? <span className="af-brief-reach"> ({reachText})</span> : null}
              </span>
              <ul className="af-brief-sub">
                {trades.items.map((t) => (
                  <li key={t.key}>
                    <Link href={t.href} className="af-brief-link">
                      {t.leagueName}
                    </Link>
                    <span className="af-brief-detail"> — {es ? (briefTradeSummaryText(t.parts) ?? t.summary) : t.summary}</span>
                    {t.handoff ? <Handoff handoff={t.handoff} language={language} /> : null}
                  </li>
                ))}
              </ul>
            </li>
          ) : null}

          {injuryCount > 0 ? (
            <li className="af-brief-row" data-kind="injuries">
              <span className="af-brief-what">
                {es
                  ? `${injuryCount} ${injuryCount === 1 ? 'cambio de lesión' : 'cambios de lesión'} ${
                      anyFollowedOnly ? 'en tus plantillas y jugadores que sigues' : 'en tus plantillas'
                    }`
                  : `${injuryCount} injury change${injuryCount === 1 ? '' : 's'} ${
                      anyFollowedOnly ? 'on your rosters and players you follow' : 'on your rosters'
                    }`}
              </span>
              <ul className="af-brief-sub">
                {injuries.map((i) => (
                  <li key={i.key}>
                    <b>{i.name}</b>
                    {i.position ? <span className="af-brief-pos af-num"> {i.position}</span> : null}
                    <span className="af-brief-detail">
                      {' '}
                      {statusText(i.from, language)} → <b>{statusText(i.to, language)}</b> ·{' '}
                      {/* A followed player on none of your rosters has no league to name (2026-09-14). */}
                      {i.leagues.length === 0
                        ? es
                          ? 'Siguiendo'
                          : 'Following'
                        : i.leagues.length === 1
                          ? i.leagues[0]
                          : es
                            ? `${i.leagues.length} de tus ligas`
                            : `${i.leagues.length} of your leagues`}
                    </span>
                    {i.handoff ? <Handoff handoff={i.handoff} language={language} /> : null}
                  </li>
                ))}
                {injuryCount > injuries.length ? (
                  <li className="af-brief-more">{es ? `+${injuryCount - injuries.length} más` : `+${injuryCount - injuries.length} more`}</li>
                ) : null}
              </ul>
            </li>
          ) : null}

          {standings.length > 0 ? (
            <li className="af-brief-row" data-kind="standings">
              <span className="af-brief-what">
                {es
                  ? `Resultados en ${standings.length} ${standings.length === 1 ? 'liga' : 'ligas'}`
                  : `Results in ${standings.length} league${standings.length === 1 ? '' : 's'}`}
              </span>
              <ul className="af-brief-sub">
                {standings.map((s) => (
                  <li key={s.key}>
                    <Link href={s.href} className="af-brief-link">
                      {s.standing.leagueName}
                    </Link>
                    <span className="af-brief-detail"> — {resultText(s.standing, es)}</span>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}

          {alerts.total > 0 ? (
            <li className="af-brief-row" data-kind="alerts">
              <span className="af-brief-what">
                {es
                  ? `${alerts.total} ${alerts.total === 1 ? 'alerta sin leer' : 'alertas sin leer'}`
                  : `${alerts.total} unread alert${alerts.total === 1 ? '' : 's'}`}
              </span>
              <span className="af-brief-detail">
                {' '}
                {alerts.groups.map((g) => `${g.count} ${alertGroupText(g.type, g.label, language)}`).join(', ')}
              </span>{' '}
              <Link href="/core/notifications" className="af-brief-link">
                {es ? 'Abrir alertas' : 'Open alerts'}
              </Link>
            </li>
          ) : null}
        </ul>

        {comparisonPending ? (
          <p className="af-brief-note">
            {es
              ? 'Los cambios de lesiones y clasificaciones aparecen desde tu próxima visita: es la primera vez que tenemos una referencia con la que comparar.'
              : 'Injury and standings changes appear from your next visit — this is the first time we have a picture to compare against.'}
          </p>
        ) : null}
      </details>
    </section>
  )
}

export default DashSinceLastVisitView
