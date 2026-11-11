'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'

import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import styles from './TradeMarketMovers.module.css'

/**
 * The AllFantasy trade market board: biggest risers and fallers in player value, measured from trades
 * that actually happened in AllFantasy-connected leagues (`/api/trade-value/market`), ONE FORMAT AT A
 * TIME — a superflex trade is only evidence about superflex values, so the board never mixes them.
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

type Qb = 'sf' | '1qb'
type Format = 'dynasty' | 'redraft'

const STRINGS = {
  en: {
    kicker: 'AllFantasy trade market',
    lede: (n: number | null) =>
      `Values from trades managers actually made${n ? ` — ${n.toLocaleString('en-US')} completed trades on file` : ''}, not votes. Each format is measured only from trades in that format, against its own chart, capped and updated daily.`,
    loading: 'Loading the market…',
    failed: 'The trade market could not be loaded right now.',
    rebuilding: 'This format’s market is rebuilding from the latest completed trades. Grades use chart values until it is back.',
    rising: 'Rising',
    falling: 'Falling',
    none: 'No big moves yet.',
    trades: 'trades',
    market: 'market',
    sf: 'Superflex',
    oneQb: '1QB',
    dynasty: 'Dynasty',
    redraft: 'Redraft',
    formatLabel: 'Market format',
    foot: (n: number, updated: string | null) =>
      `${n.toLocaleString('en-US')} players priced from completed trades in this format${updated ? ` · updated ${updated}` : ''}.`,
  },
  es: {
    kicker: 'Mercado de intercambios AllFantasy',
    lede: (n: number | null) =>
      `Valores de intercambios que los managers hicieron de verdad${n ? ` — ${n.toLocaleString('es-US')} intercambios completados` : ''}, no votos. Cada formato se mide solo con intercambios de ese formato, frente a su propia tabla, con límite y actualizado a diario.`,
    loading: 'Cargando el mercado…',
    failed: 'No se pudo cargar el mercado de intercambios.',
    rebuilding: 'El mercado de este formato se está reconstruyendo con los últimos intercambios. Las notas usan valores de tabla hasta entonces.',
    rising: 'Suben',
    falling: 'Bajan',
    none: 'Aún no hay grandes movimientos.',
    trades: 'intercambios',
    market: 'mercado',
    sf: 'Superflex',
    oneQb: '1QB',
    dynasty: 'Dynasty',
    redraft: 'Redraft',
    formatLabel: 'Formato del mercado',
    foot: (n: number, updated: string | null) =>
      `${n.toLocaleString('es-US')} jugadores valorados con intercambios de este formato${updated ? ` · actualizado ${updated}` : ''}.`,
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

function Segmented<T extends string>({ value, options, onChange, label, testId }: {
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (v: T) => void
  label: string
  testId: string
}) {
  return (
    <div className={styles.segment} role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} className={value === o.value ? styles.segOn : styles.segOff} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
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
  defaultQb = 'sf',
  defaultFormat = 'dynasty',
}: {
  limit?: number
  ctaHref?: string
  ctaLabel?: string
  heading?: string
  testId?: string
  /** Explicit language (the landing page passes its own). Otherwise the app's language, English fallback. */
  lang?: 'en' | 'es'
  /** The format shown first — a league's own, where there is one. */
  defaultQb?: Qb
  defaultFormat?: Format
}) {
  const appLanguage = useOptionalLanguage().language
  const t: Strings = STRINGS[lang ?? (appLanguage === 'es' ? 'es' : 'en')]
  const [qb, setQb] = useState<Qb>(defaultQb)
  const [format, setFormat] = useState<Format>(defaultFormat)
  const [board, setBoard] = useState<Board | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    setBoard(null)
    setFailed(false)
    fetch(`/api/trade-value/market?limit=${limit}&format=${format}&qb=${qb}`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<Board>) : Promise.reject(new Error(String(r.status)))))
      .then((b) => setBoard(b))
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true)
      })
    return () => controller.abort()
  }, [limit, qb, format])

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

      <div className={styles.controls} aria-label={t.formatLabel}>
        <Segmented value={qb} onChange={setQb} label={t.formatLabel} testId={`${testId}-qb`} options={[{ value: 'sf', label: t.sf }, { value: '1qb', label: t.oneQb }]} />
        <Segmented value={format} onChange={setFormat} label={t.formatLabel} testId={`${testId}-format`} options={[{ value: 'dynasty', label: t.dynasty }, { value: 'redraft', label: t.redraft }]} />
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
