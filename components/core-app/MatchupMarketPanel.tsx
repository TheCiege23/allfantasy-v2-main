'use client'

import { useEffect, useMemo, useState } from 'react'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { InfoTip } from '@/components/core-app/InfoTip'
import type { MatchupData } from '@/lib/core-app/matchup'
import {
  buildMarketRows,
  isMarketSport,
  marketStarters,
  type MarketRow,
  type MatchupMarketResponse,
} from '@/lib/core-app/matchupMarket'

/**
 * "Scoring environment" on /core Matchup — the betting market read as a FORECAST: for each of your
 * starters, the points his team's offense is expected to score, and the game script around it.
 *
 * Built 2026-09-10 inside `MatchupPrepModal`, which nothing had mounted since July, so it never
 * rendered for anyone; restored here 2026-10-06. The data comes from the stored `game_odds` rows via
 * `/api/core/matchup-market` (DB-first — no provider call on this path).
 *
 * 🛑 THIS IS NOT A BETTING CARD, AND THE WORDING IS THE BOUNDARY. The read layer refuses to return
 * prices or sportsbook names, so no odd can render even by mistake; what this file must still get
 * right is the language, in both languages:
 *   - the headline is EXPECTED POINTS for that player's offense, not a line;
 *   - the spread is game script in words — "favored by 3.5" / «favorito por 3.5» — never "-3.5";
 *   - the total is "combined" / «entre ambos», never "O/U".
 *
 * ⚠ AN EMPTY PANEL IS A NORMAL STATE, NOT A FAULT. Only fixtures inside roughly two days of kickoff
 * carry a market read, so early in a week most starters have none. That is said as "not yet", and a
 * starter without a read is counted, never shown as "—" or "0.0".
 *
 * Renders nothing for a finished week, a non-NFL league (no feed), or a board with no lineups.
 */

type Copy = {
  title: string
  tipLabel: string
  tip: string[]
  expected: (pts: string) => string
  where: (home: boolean, opponent: string) => string
  favored: (n: number) => string
  underdog: (n: number) => string
  even: string
  combined: (t: string) => string
  stale: string
  partial: (n: number) => string
  empty: string
  footer: string
  failed: string
}

const COPY: Record<'en' | 'es', Copy> = {
  en: {
    title: 'Scoring environment',
    tipLabel: 'How to read the scoring environment',
    tip: [
      'Each of your starters, with the points the betting market expects his team’s offense to score this week — a forecast of the game, read the way a projection is.',
      '“Favored by 3.5” means the market expects his team to win by about that much; “combined” is the points it expects both teams to score together.',
      'It is not the win probability above, which is your fantasy matchup, and it is not a wager: no prices and no sportsbooks are shown.',
      'A market read posts about two days before kickoff, so early in the week most starters have none yet.',
    ],
    expected: (pts) => `${pts} expected pts`,
    where: (home, opponent) => `${home ? 'vs' : 'at'} ${opponent}`,
    favored: (n) => `favored by ${n}`,
    underdog: (n) => `underdog by ${n}`,
    even: 'even game',
    combined: (t) => `${t} combined`,
    stale: 'Past its refresh window — re-check before locking.',
    partial: (n) => `No market read yet for ${n} of your starters — it posts closer to kickoff.`,
    empty: 'No market read yet — expected team scoring posts closer to kickoff.',
    footer: 'Market-implied team scoring. Not a wager, and not your matchup win chance.',
    failed: 'The scoring environment did not load. Reload the page to try again.',
  },
  es: {
    title: 'Entorno de anotación',
    tipLabel: 'Cómo leer el entorno de anotación',
    tip: [
      'Cada uno de tus titulares, con los puntos que el mercado de apuestas espera que anote la ofensiva de su equipo esta semana: un pronóstico del partido, leído como una proyección.',
      '«Favorito por 3.5» significa que el mercado espera que su equipo gane por más o menos esa diferencia; «entre ambos» son los puntos que espera que anoten los dos equipos juntos.',
      'No es la probabilidad de ganar de arriba, que es la de tu enfrentamiento de fantasía, ni es una apuesta: no se muestran cuotas ni casas de apuestas.',
      'La lectura del mercado se publica unos dos días antes del inicio, así que al principio de la semana la mayoría de los titulares aún no la tiene.',
    ],
    expected: (pts) => `${pts} pts esperados`,
    where: (home, opponent) => `${home ? 'vs' : 'en'} ${opponent}`,
    favored: (n) => `favorito por ${n}`,
    underdog: (n) => `no favorito por ${n}`,
    even: 'partido parejo',
    combined: (t) => `${t} entre ambos`,
    stale: 'Fuera de su ventana de actualización: vuelve a revisarla antes de cerrar tu alineación.',
    partial: (n) => `Aún no hay lectura del mercado para ${n} de tus titulares: se publica más cerca del inicio.`,
    empty: 'Aún no hay lectura del mercado: la anotación esperada de cada equipo se publica más cerca del inicio.',
    footer: 'Anotación por equipo implícita en el mercado. No es una apuesta ni tu probabilidad de ganar el enfrentamiento.',
    failed: 'El entorno de anotación no se cargó. Recarga la página para intentarlo de nuevo.',
  },
}

/** Game script in words, from the starter's own side. Never betting notation. */
function scriptText(spread: number | null, c: Copy): string | null {
  if (spread == null || !Number.isFinite(spread)) return null
  if (spread < 0) return c.favored(Math.abs(spread))
  if (spread > 0) return c.underdog(spread)
  return c.even
}

function rowDetail(r: MarketRow, c: Copy): string {
  const parts: string[] = []
  if (r.opponent) parts.push(c.where(r.isHome, r.opponent))
  const script = scriptText(r.spread, c)
  if (script) parts.push(script)
  if (r.gameTotal != null && Number.isFinite(r.gameTotal)) parts.push(c.combined(r.gameTotal.toFixed(1)))
  return parts.join(' · ')
}

export type MarketPanelState =
  | { status: 'ready'; rows: MarketRow[]; withoutRead: number }
  | { status: 'failed' }

/** The panel itself, given a settled state. Exported for its tests. */
export function MarketEnvironmentView({ state }: { state: MarketPanelState }) {
  const { language } = useOptionalLanguage()
  const c = COPY[language === 'es' ? 'es' : 'en']

  return (
    <section className="af-frame af-mu-section af-mu-market" aria-labelledby="af-mu-market-h">
      <header className="af-mu-section-head">
        <h2 className="af-label" id="af-mu-market-h">
          {c.title}
        </h2>
        <InfoTip label={c.tipLabel} title={c.tipLabel}>
          {c.tip.map((p) => (
            <span className="af-info-para" key={p}>
              {p}
            </span>
          ))}
        </InfoTip>
      </header>

      {state.status === 'failed' ? (
        <p className="af-mu-unavailable" role="status">
          {c.failed}
        </p>
      ) : state.rows.length === 0 ? (
        <p className="af-mu-unavailable">{c.empty}</p>
      ) : (
        <>
          <ul className="af-mu-missing">
            {state.rows.map((r) => {
              const detail = rowDetail(r, c)
              return (
                <li key={r.key} data-stale={r.isStale || undefined}>
                  <span className="af-mu-missing-key">
                    {r.name} <span className="af-mu-missing-caveat">({r.team})</span>
                  </span>
                  <span className="af-mu-missing-value af-num">
                    {c.expected(r.impliedTeamTotal.toFixed(1))}
                    {detail ? <em className="af-mu-missing-caveat"> — {detail}</em> : null}
                  </span>
                </li>
              )
            })}
          </ul>
          {state.withoutRead > 0 ? <p className="af-mu-note">{c.partial(state.withoutRead)}</p> : null}
          {state.rows.some((r) => r.isStale) ? <p className="af-mu-note">{c.stale}</p> : null}
          <p className="af-mu-note">{c.footer}</p>
        </>
      )}
    </section>
  )
}

/**
 * Mounted once on the Matchup screen. Works out which of your starters can have a market read, asks
 * the DB-first route for their clubs, and renders the view once the answer is in.
 */
export function MatchupMarketPanel({ data }: { data: MatchupData }) {
  const week = data.week.available && !data.week.data.isFinal ? data.week.data : null
  const slots = data.lineups.available ? data.lineups.data : null
  const starters = useMemo(
    () => (week && slots && isMarketSport(slots) ? marketStarters(slots) : []),
    [week, slots],
  )
  const teams = useMemo(() => [...new Set(starters.map((s) => s.team))].sort(), [starters])
  const query =
    week && teams.length > 0
      ? `season=${week.season}&week=${week.week}&${teams.map((t) => `team=${encodeURIComponent(t)}`).join('&')}`
      : null

  const [answer, setAnswer] = useState<{ query: string; result: MatchupMarketResponse | 'failed' } | null>(null)

  useEffect(() => {
    if (!query || typeof fetch !== 'function') return
    const ctrl = new AbortController()
    fetch(`/api/core/matchup-market?${query}`, { cache: 'no-store', credentials: 'same-origin', signal: ctrl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(String(res.status))
        const body = (await res.json()) as MatchupMarketResponse
        if (!body || typeof body.teams !== 'object' || body.teams == null) throw new Error('bad body')
        setAnswer({ query, result: body })
      })
      .catch(() => {
        if (!ctrl.signal.aborted) setAnswer({ query, result: 'failed' })
      })
    return () => ctrl.abort()
  }, [query])

  if (!query || !answer || answer.query !== query) return null
  if (answer.result === 'failed') return <MarketEnvironmentView state={{ status: 'failed' }} />
  const { rows, withoutRead } = buildMarketRows(starters, answer.result.teams)
  return <MarketEnvironmentView state={{ status: 'ready', rows, withoutRead }} />
}

export default MatchupMarketPanel
