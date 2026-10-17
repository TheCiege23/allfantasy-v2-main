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
 * The band is a SERVER component: it works out each trade's age against the server's `now`, which
 * trades fall in the home's 24-hour window, which side the verdict names, and whether the viewer may
 * see the "why" — and this says it. The age goes through shellCopy's `ageText`, the grade moment
 * through `gradeMoment` (EN/ES), a side's grade line through `homeBandsCopy` from the parts
 * recentTrades writes — a line without parts (a withheld reason, a market read) stays whole English.
 */
type Side = RecentTrade['sides'][number]

export type TradeBandCard = {
  key: string
  /** The league's Trades page on /core — built by the band. */
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
    /** Empty when the viewer has no AF Pro — the band strips it on the server. */
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

/**
 * The "why this grade" line is AF Pro's trade depth. Locked, the band never receives the reasons at
 * all (DashTradeBand strips them server-side), so this only decides what the lock row says.
 */
export type TradeBandWhy = {
  unlocked: boolean
  upgradePath: string
  planName: string
}

/** No trade in the window, but there were some recently: one quiet row that still points somewhere. */
export type TradeBandQuiet = {
  leagueName: string
  href: string
  ago: string | null
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

/** A letter's tone: A/B read good, C neutral, D/F bad. */
function gradeTone(grade: string | null): 'good' | 'mid' | 'bad' | 'none' {
  const g = String(grade ?? '').trim().toUpperCase()[0]
  if (!g) return 'none'
  if (g === 'A' || g === 'B') return 'good'
  if (g === 'C') return 'mid'
  return 'bad'
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')
}

/*
 * ⚠ SLEEPER'S SHAPE, ON PURPOSE (2026-10-08). The old band stacked each side as a column of labels —
 * "RECEIVED", a basis word, a paragraph of grade reasoning — and on a phone the two sides stacked
 * too, so one trade was a screen tall and read stiff. A manager already knows how a trade card reads
 * from Sleeper: two teams side by side, each with what it got, a swap mark between. This keeps that
 * and adds the one thing Sleeper does not have — the letter — as a badge on each team.
 *
 * Only the last 24 hours show here; older trades live on the league's Trades page, which every card
 * and the quiet row link to. The "why" is one short clamped line per side, and only for AF Pro.
 */
export function DashTradeBandView({
  trades,
  visibleAssets,
  why = { unlocked: false, upgradePath: '/upgrade?plan=pro', planName: 'AF Pro' },
  quiet = null,
}: {
  trades: TradeBandCard[]
  visibleAssets: number
  why?: TradeBandWhy
  quiet?: TradeBandQuiet | null
}) {
  const { language } = useOptionalLanguage()
  const es = language === 'es'
  const title = es ? 'Intercambios' : 'Trades'

  return (
    <section className="af-core af-trade" aria-label={title}>
      <div className="af-trade-head">
        <span className="af-trade-kicker">{title}</span>
        <TopicTip topic="completedTradeGrade" />
        <span className="af-trade-count af-num">
          {trades.length > 0
            ? es
              ? `${trades.length} en las últimas 24 h`
              : `${trades.length} in the last 24h`
            : es
              ? 'últimas 24 h'
              : 'last 24h'}
        </span>
      </div>

      {trades.length === 0 && quiet ? (
        <Link className="af-trade-quiet" href={quiet.href}>
          <span className="af-trade-quiet-text">
            {es ? 'Sin intercambios en las últimas 24 horas.' : 'No trades in the last 24 hours.'}
            <span className="af-trade-quiet-sub">
              {es ? `El último fue en ${quiet.leagueName}` : `Last one was in ${quiet.leagueName}`}
              {quiet.ago ? ` · ${ageText(quiet.ago, language)}` : ''}
            </span>
          </span>
          <span className="af-trade-quiet-cta">{es ? 'Ver intercambios' : 'See trades'} →</span>
        </Link>
      ) : null}

      {trades.length > 0 ? (
        <div className="af-trade-list">
          {trades.map((t) => {
            const reasons = why.unlocked
              ? t.sides
                  .map((s) => ({
                    key: String(s.rosterId),
                    name: s.name,
                    text: es ? (gradeReasonText(s.gradeReason, s.gradeParts) ?? s.gradeReason) : s.gradeReason,
                  }))
                  .filter((r) => r.text)
              : []
            return (
              <article key={t.key} className="af-trade-card">
                <header className="af-trade-meta">
                  {t.leagueAvatarUrl ? <img className="af-trade-league-avatar" src={t.leagueAvatarUrl} alt="" /> : null}
                  <Link className="af-trade-league" href={t.href}>
                    {t.leagueName}
                  </Link>
                  {t.ago ? <span className="af-trade-ago af-num">{ageText(t.ago, language)}</span> : null}
                  {t.status && t.statusLabel ? (
                    <span className="af-trade-status" data-status={t.status}>
                      {tradeStatusText(t.status, t.statusLabel, language)}
                    </span>
                  ) : null}
                </header>

                <div className="af-trade-sides" data-count={t.sides.length}>
                  {t.sides.map((s, index) => (
                    <div key={s.rosterId} className="af-trade-side">
                      {index > 0 && t.sides.length === 2 ? (
                        <span className="af-trade-swap" aria-hidden>
                          ⇄
                        </span>
                      ) : null}
                      <div className="af-trade-manager">
                        {s.avatarUrl ? (
                          <img className="af-trade-avatar" src={s.avatarUrl} alt="" />
                        ) : (
                          <span className="af-trade-avatar af-trade-avatar--initials" aria-hidden>
                            {initialsOf(s.name)}
                          </span>
                        )}
                        <span className="af-trade-mgr">{s.name}</span>
                        <span
                          className="af-trade-grade"
                          data-tone={gradeTone(s.grade)}
                          title={basisText(s.gradeBasis, es)}
                          aria-label={`${es ? 'Calificación' : 'Grade'} ${s.grade ?? '—'}`}
                        >
                          {s.grade ?? '—'}
                        </span>
                      </div>
                      <span className="af-trade-got">
                        {t.status === 'processed' ? (es ? 'Recibió' : 'Received') : es ? 'Recibe' : 'Gets'}
                      </span>
                      <ul className="af-trade-assets">
                        {s.received.map((a, i) => (
                          <li key={`${a.kind}:${a.name}:${i}`} data-kind={a.kind}>
                            {a.kind === 'player' && a.playerId ? (
                              <PlayerImage
                                sleeperId={a.playerId}
                                sport={t.sport}
                                name={a.name}
                                position={a.position ?? undefined}
                                headshotUrl={a.headshotUrl}
                                size={30}
                              />
                            ) : (
                              <span className="af-trade-asset-icon" aria-hidden>
                                {a.kind === 'pick' ? '#' : a.kind === 'faab' ? '$' : '•'}
                              </span>
                            )}
                            <span className="af-trade-asset-text">
                              <span className="af-trade-asset-name">{a.name}</span>
                              {a.position || (a.kind === 'player' && a.team) ? (
                                <span className="af-trade-pos af-num">
                                  {[a.position, a.kind === 'player' ? a.team : null].filter(Boolean).join(' · ')}
                                </span>
                              ) : null}
                            </span>
                            {a.kind === 'player' && a.team ? (
                              <TeamLogo teamAbbr={a.team} sport={t.sport} logoUrl={a.teamLogoUrl} size={16} />
                            ) : null}
                          </li>
                        ))}
                        {s.receivedCount > visibleAssets ? (
                          <li className="af-trade-more">
                            {es ? `+${s.receivedCount - visibleAssets} más` : `+${s.receivedCount - visibleAssets} more`}
                          </li>
                        ) : null}
                        {s.receivedCount === 0 ? (
                          /* Never an empty column with an arrow pointing into it — the Trades board's
                             wording says what it is: a FAAB-only side, or one the import did not capture. */
                          <li className="af-trade-more">{es ? 'Solo FAAB, o no se capturó' : 'FAAB only, or not captured'}</li>
                        ) : null}
                      </ul>
                    </div>
                  ))}
                </div>

                {t.verdict ? (
                  <p className="af-trade-verdict">
                    {/* The engine says "favors A"; the manager's own name is the only version anyone can act on. */}
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

                {why.unlocked ? (
                  reasons.length > 0 ? (
                    <ul className="af-trade-why" aria-label={es ? 'Por qué estas calificaciones' : 'Why these grades'}>
                      {reasons.map((r) => (
                        <li key={r.key}>
                          <strong>{r.name}:</strong> {r.text}
                        </li>
                      ))}
                    </ul>
                  ) : null
                ) : (
                  <Link className="af-trade-why-lock" href={why.upgradePath}>
                    <span aria-hidden>🔒</span>
                    {es ? `Por qué estas calificaciones · ${why.planName}` : `Why these grades · ${why.planName}`}
                  </Link>
                )}

                <Link className="af-trade-open" href={t.href}>
                  {es ? `Todos los intercambios de ${t.leagueName}` : `All ${t.leagueName} trades`} →
                </Link>
              </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}

export default DashTradeBandView
