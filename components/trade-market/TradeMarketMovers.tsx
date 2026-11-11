'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import styles from './TradeMarketMovers.module.css'

/**
 * The AllFantasy trade market board: biggest risers and fallers in player value, measured from
 * trades that actually happened in AllFantasy-connected leagues (`/api/trade-value/market`).
 *
 * It never shows an old board as if it were current: when the latest rebuild is not fresh the API
 * returns no movers, and this says the market is rebuilding instead.
 */

type Mover = {
  playerId: string
  name: string
  position: string | null
  adjustmentPercent: number
  chartValue: number
  marketValue: number
  trades: number
}

type Board = {
  fresh: boolean
  generatedAt: string | null
  playersPriced: number
  tradesOnFile: number | null
  rising: Mover[]
  falling: Mover[]
}

const STRINGS = {
  en: {
    kicker: 'AllFantasy trade market',
    lede: (n: number | null) =>
      `Values from trades managers actually made${n ? ` — ${n.toLocaleString('en-US')} completed trades on file` : ''}, not votes. Each move is what the market paid for a player against his chart value, capped and updated daily.`,
    loading: 'Loading the market…',
    failed: 'The trade market could not be loaded right now.',
    rebuilding: 'The trade market is rebuilding from the latest completed trades. Grades use chart values until it is back.',
    rising: 'Rising',
    falling: 'Falling',
    none: 'No big moves yet.',
    trades: 'trades',
    market: 'market',
    foot: (n: number, updated: string | null) =>
      `Dynasty · 1QB · NFL. ${n.toLocaleString('en-US')} players priced from completed trades${updated ? ` · updated ${updated}` : ''}.`,
  },
  es: {
    kicker: 'Mercado de intercambios AllFantasy',
    lede: (n: number | null) =>
      `Valores de intercambios que los managers hicieron de verdad${n ? ` — ${n.toLocaleString('es-US')} intercambios completados` : ''}, no votos. Cada movimiento es lo que el mercado pagó por un jugador frente a su valor de tabla, con límite y actualizado a diario.`,
    loading: 'Cargando el mercado…',
    failed: 'No se pudo cargar el mercado de intercambios.',
    rebuilding: 'El mercado se está reconstruyendo con los últimos intercambios. Las notas usan valores de tabla hasta entonces.',
    rising: 'Suben',
    falling: 'Bajan',
    none: 'Aún no hay grandes movimientos.',
    trades: 'intercambios',
    market: 'mercado',
    foot: (n: number, updated: string | null) =>
      `Dynasty · 1QB · NFL. ${n.toLocaleString('es-US')} jugadores valorados con intercambios completados${updated ? ` · actualizado ${updated}` : ''}.`,
  },
} as const

type Strings = (typeof STRINGS)['en'] | (typeof STRINGS)['es']

function MoverList({ title, rows, tone, t }: { title: string; rows: Mover[]; tone: 'up' | 'down'; t: Strings }) {
  return (
    <div className={styles.col}>
      <h3 className={styles.colTitle}>{title}</h3>
      {rows.length === 0 ? (
        <p className={styles.empty}>{t.none}</p>
      ) : (
        <ol className={styles.list}>
          {rows.map((r) => (
            <li key={r.playerId} className={styles.row}>
              <span className={styles.name}>
                {r.name}
                {r.position ? <small className={styles.pos}>{r.position}</small> : null}
              </span>
              <span className={tone === 'up' ? styles.up : styles.down}>
                {r.adjustmentPercent > 0 ? '+' : ''}
                {r.adjustmentPercent}%
              </span>
              <small className={styles.meta}>
                {r.trades} {t.trades} · {r.marketValue.toLocaleString()} {t.market}
              </small>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

export function TradeMarketMovers({
  limit = 5,
  ctaHref,
  ctaLabel = 'Grade a trade',
  heading = 'What real trades say',
  testId = 'trade-market-movers',
  lang,
}: {
  limit?: number
  ctaHref?: string
  ctaLabel?: string
  heading?: string
  testId?: string
  /** Explicit language (the landing page passes its own). Otherwise the app's language, English fallback. */
  lang?: 'en' | 'es'
}) {
  const appLanguage = useOptionalLanguage().language
  const t: Strings = STRINGS[lang ?? (appLanguage === 'es' ? 'es' : 'en')]
  const [board, setBoard] = useState<Board | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/trade-value/market?limit=${limit}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Board>) : Promise.reject(new Error(String(r.status)))))
      .then((b) => setBoard(b))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [limit])

  const updated = board?.generatedAt ? new Date(board.generatedAt).toLocaleDateString() : null

  return (
    <section className={styles.card} aria-labelledby={`${testId}-title`} data-testid={testId}>
      <div className={styles.head}>
        <div>
          <div className={styles.kicker}>{t.kicker}</div>
          <h2 id={`${testId}-title`} className={styles.title}>{heading}</h2>
          <p className={styles.lede}>{t.lede(board?.tradesOnFile ?? null)}</p>
        </div>
        {ctaHref ? (
          <Link href={ctaHref} className={styles.cta} data-testid={`${testId}-cta`}>
            {ctaLabel}
          </Link>
        ) : null}
      </div>

      {!board && !failed ? <p className={styles.empty}>{t.loading}</p> : null}
      {failed ? <p className={styles.empty}>{t.failed}</p> : null}
      {board && !board.fresh ? (
        <p className={styles.empty} data-testid={`${testId}-rebuilding`}>{t.rebuilding}</p>
      ) : null}
      {board?.fresh ? (
        <>
          <div className={styles.cols}>
            <MoverList title={t.rising} rows={board.rising} tone="up" t={t} />
            <MoverList title={t.falling} rows={board.falling} tone="down" t={t} />
          </div>
          <p className={styles.foot}>{t.foot(board.playersPriced, updated)}</p>
        </>
      ) : null}
    </section>
  )
}
