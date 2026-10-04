'use client'

import Link from 'next/link'
import type { RecentTrade } from '@/lib/core-app/recentTrades'
import { gradeMoment, type GradeMomentInput } from '@/lib/decision-os/trade/gradeMoment'
import { PlayerImage } from '@/app/components/PlayerImage'
import { TeamLogo } from '@/app/components/TeamLogo'
import { TopicTip } from '@/components/core-app/TopicTip'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { ageText } from '@/lib/core-app/shellCopy'
import { gradeReasonText, tradeStatusText } from '@/lib/core-app/homeBandsCopy'

/**
 * The words of DashTradeBand, in the reader's language (2026-10-04).
 *
 * The band is a SERVER component: it works out each trade's age against the server's `now` and which
 * side the verdict names, and this says it. The age goes through shellCopy's `ageText`, the grade moment
 * through `gradeMoment` (EN/ES), a side's grade line through `homeBandsCopy` from the parts recentTrades
 * now writes — a line without parts (a withheld reason, a market read) stays whole English.
 */
type Side = RecentTrade['sides'][number]

export type TradeBandCard = {
  key: string
  /** The league's trade history — built by the band. */
  href: string
  leagueName: string
  leagueAvatarUrl: string | null
  sport: string
  /** describeAge-style English ("3h ago", "just now"), from the server's `now`. */
  ago: string | null
  status: string | null
  /** The status's English label, from the band's table. */
  statusLabel: string | null
  sides: Array<{
    rosterId: Side['rosterId']
    name: string
    avatarUrl: string | null
    received: Side['received']
    receivedCount: number
    grade: Side['grade']
    gradeBasis: Side['gradeBasis']
    gradeReason: string
    gradeParts: Side['gradeParts'] | null
  }>
  verdict:
    | { kind: 'even' }
    | { kind: 'favours'; strongly: boolean; who: string }
    | { kind: 'unnamed' }
    | null
  confidence: number
  moment: GradeMomentInput
}

function verdictText(v: NonNullable<TradeBandCard['verdict']>, es: boolean): string {
  if (v.kind === 'even') return es ? 'Un intercambio equilibrado sobre el papel' : 'An even deal on paper'
  /* No name resolved: say the shape of the verdict, never a placeholder. */
  if (v.kind === 'unnamed') return es ? 'Un lado sale ganando' : 'One side comes out ahead'
  if (es) return `${v.strongly ? 'Favorece claramente a' : 'Favorece ligeramente a'} ${v.who}`
  return `${v.strongly ? 'Clearly favours' : 'Slightly favours'} ${v.who}`
}

function basisText(basis: Side['gradeBasis'], es: boolean): string {
  if (basis === 'League') return es ? 'Calificación de liga' : 'League grade'
  if (basis == null) return es ? 'Calificación contextual no disponible' : 'Contextual grade withheld'
  if (!es) return basis
  return basis === 'Market' ? 'Mercado' : 'Real'
}

export function DashTradeBandView({ trades, visibleAssets }: { trades: TradeBandCard[]; visibleAssets: number }) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const title = es ? 'Últimos intercambios de tus ligas' : 'Latest league trades'

  return (
    <section className="af-core af-trade" aria-label={title}>
      <div className="af-trade-head">
        <span className="af-label af-trade-kicker">{title}</span>
        <TopicTip topic="completedTradeGrade" />
        <span className="af-trade-count af-num">
          {es ? `${trades.length} recientes · últimas 2 semanas` : `${trades.length} latest · past 2 weeks`}
        </span>
      </div>

      <div className="af-trade-list">
        {trades.map((t) => (
          <article key={t.key} className="af-trade-card">
            <div className="af-trade-meta">
              {t.leagueAvatarUrl ? <img className="af-trade-league-avatar" src={t.leagueAvatarUrl} alt="" /> : null}
              <Link className="af-trade-league" href={t.href}>
                {t.leagueName}
              </Link>
              {t.ago ? <span className="af-trade-ago af-num">{ageText(t.ago, language)}</span> : null}
              {t.status && t.statusLabel ? (
                <span className="af-trade-ago af-num">{tradeStatusText(t.status, t.statusLabel, language)}</span>
              ) : null}
            </div>

            <div className="af-trade-sides">
              {t.sides.map((s) => {
                const reason = es ? (gradeReasonText(s.gradeReason, s.gradeParts) ?? s.gradeReason) : s.gradeReason
                return (
                  <div key={s.rosterId} className="af-trade-side">
                    <span className="af-trade-manager">
                      {s.avatarUrl ? <img className="af-trade-avatar" src={s.avatarUrl} alt="" /> : null}
                      <span className="af-trade-mgr">{s.name}</span>
                    </span>
                    <span className="af-trade-got af-num">
                      {t.status === 'processed' ? (es ? 'RECIBIÓ' : 'RECEIVED') : es ? 'EN ESTE INTERCAMBIO' : 'IN THIS TRADE'}
                    </span>
                    <ul className="af-trade-assets">
                      {s.received.map((a, i) => (
                        <li key={`${a.kind}:${a.name}:${i}`} data-kind={a.kind}>
                          {a.kind === 'player' && a.playerId ? (
                            <PlayerImage sleeperId={a.playerId} sport={t.sport} name={a.name} position={a.position ?? undefined} headshotUrl={a.headshotUrl} size={26} />
                          ) : null}
                          <span>
                            {a.name}
                            {a.position ? <span className="af-trade-pos af-num"> {a.position}</span> : null}
                          </span>
                          {a.kind === 'player' && a.team ? <TeamLogo teamAbbr={a.team} sport={t.sport} logoUrl={a.teamLogoUrl} size={18} /> : null}
                        </li>
                      ))}
                      {s.receivedCount > visibleAssets ? (
                        <li className="af-trade-more">
                          {es ? `+${s.receivedCount - visibleAssets} más` : `+${s.receivedCount - visibleAssets} more`}
                        </li>
                      ) : null}
                      {s.receivedCount === 0 ? (
                        /* Never an empty column with an arrow pointing into it. "Nothing we can name" read
                           as a defect under a real trade; the Trades board's wording says what it is —
                           a FAAB-only side, or one the import did not capture. */
                        <li className="af-trade-more">
                          {es
                            ? 'No hay jugadores ni selecciones registrados: solo FAAB, o no se capturaron'
                            : 'No players or picks on record — FAAB only, or not captured'}
                        </li>
                      ) : null}
                    </ul>
                    {s.gradeBasis || s.gradeReason ? (
                      <div className="af-trade-side-grade" data-ungraded={!s.grade}>
                        <span className="af-trade-side-letter">{s.grade ?? '—'}</span>
                        <span>
                          <strong>{basisText(s.gradeBasis, es)}</strong> · {reason}
                        </span>
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>

            {t.verdict ? (
              <p className="af-trade-verdict">
                {/*
                  ⚠ THE ENGINE SAYS "favors A" AND A READER HAS NO IDEA WHO A
                  IS. Its vocabulary is positional — team A versus team B —
                  and that leaked straight onto the card. The manager's own
                  name is the only version of this sentence anyone can act on,
                  and the roster id needed to say it was already on the
                  verdict.
                */}
                <span className="af-trade-verdict-word" data-fair={t.verdict.kind === 'even' ? 'true' : 'false'}>
                  {verdictText(t.verdict, es)}
                </span>
                <span className="af-trade-conf af-num">
                  {' '}
                  · {es ? 'con los valores de esta liga' : 'on this league’s values'} {gradeMoment(t.moment, language)}
                  {t.confidence > 0 ? (es ? ` · ${t.confidence}% de confianza` : ` · ${t.confidence}% confidence`) : ''}
                </span>
              </p>
            ) : null}

            <Link className="af-trade-open" href={t.href}>
              {es ? 'Abrir los intercambios de esta liga' : 'Open this league’s trades'}
            </Link>
          </article>
        ))}
      </div>
    </section>
  )
}

export default DashTradeBandView
