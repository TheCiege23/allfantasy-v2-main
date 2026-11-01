'use client'

/**
 * Commissioner Hub — weekly activity, manager activity and the two pies (redesign, 2026-10-31).
 *
 * A client island inside the streamed "League at a glance" section: the toggles and the hover
 * readouts need state, nothing else here does. Every number arrives computed (healthCharts.ts);
 * this file only draws. No chart library — inline SVG and HTML, like the rest of /core.
 *
 * Colours are theme tokens (`--chart-1..3` for the three move kinds, the status tokens for
 * engagement), defined per mode in af-core.css. Text is never drawn in a series colour: the
 * swatch carries the colour, the label stays in the text tokens.
 */

import { useId, useMemo, useState } from 'react'
import { messagesFor } from '@/lib/i18n/messages'
import { commissionerHealthChartsMessages } from '@/lib/core-app/messages/commissionerHealthCharts'
import { pie3dGeometry, lastWeeks, type ManagerActivity, type MixSlice, type MoveKind, type WeekPoint } from '@/lib/core-app/commissioner/healthCharts'

export type LeagueHealthChartsProps = {
  language?: string
  weeks: WeekPoint[]
  managers: ManagerActivity[] | null
  managersReason: string | null
  mix: MixSlice[]
  engagement: MixSlice[] | null
  engagementReason: string | null
}

const SERIES: Array<{ key: MoveKind; color: string }> = [
  { key: 'waiver', color: 'var(--chart-1)' },
  { key: 'fa', color: 'var(--chart-3)' },
  { key: 'trade', color: 'var(--chart-2)' },
]
const SERIES_COLOR: Record<string, string> = { waiver: 'var(--chart-1)', trade: 'var(--chart-2)', fa: 'var(--chart-3)' }
const STATUS_COLOR: Record<string, string> = { active: 'var(--good)', at_risk: 'var(--warn)', inactive: 'var(--bad)', unknown: 'var(--muted)' }

export function LeagueHealthCharts(props: LeagueHealthChartsProps) {
  const m = messagesFor(commissionerHealthChartsMessages, props.language)
  return (
    <div className="af-ch-lh" data-testid="league-health-charts">
      <WeeklyActivity weeks={props.weeks} m={m} />
      <ManagerActivityChart rows={props.managers} reason={props.managersReason} m={m} language={props.language} />
      <div className="af-ch-lh-pies">
        <Pie
          title={m.mixTitle}
          subtitle={m.mixSubtitle}
          slices={props.mix}
          empty={m.mixNone}
          label={(k) => (k === 'waiver' ? m.seriesWaiver : k === 'trade' ? m.seriesTrade : m.seriesFa)}
          color={(k) => SERIES_COLOR[k] ?? 'var(--muted)'}
          m={m}
        />
        <Pie
          title={m.engagementTitle}
          subtitle={m.engagementSubtitle}
          slices={props.engagement ?? []}
          empty={props.engagementReason ?? m.notMeasured}
          label={(k) =>
            k === 'active' ? m.engagementActive : k === 'at_risk' ? m.engagementSlowing : k === 'inactive' ? m.engagementInactive : m.engagementUnknown
          }
          color={(k) => STATUS_COLOR[k] ?? 'var(--muted)'}
          m={m}
        />
      </div>
    </div>
  )
}

type M = typeof commissionerHealthChartsMessages.en

function Segmented<T extends string>({ label, value, options, onChange }: {
  label: string
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (v: T) => void
}) {
  return (
    <div className="af-ch-lh-seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ── Weekly activity ────────────────────────────────────────────────────────

function WeeklyActivity({ weeks, m }: { weeks: WeekPoint[]; m: M }) {
  const [range, setRange] = useState<'season' | 'last4'>('season')
  const [hover, setHover] = useState<number | null>(null)
  const shown = range === 'season' ? weeks : lastWeeks(weeks)
  const max = Math.max(1, ...shown.flatMap((w) => [w.waiver, w.trade, w.fa]))
  // A little headroom so the top line never sits on the frame.
  const yMax = Math.ceil(max * 1.15)
  const x = (i: number) => (shown.length <= 1 ? 50 : (i / (shown.length - 1)) * 100)
  const y = (v: number) => 100 - (v / yMax) * 100
  const totals = shown.reduce((t, w) => ({ waiver: t.waiver + w.waiver, trade: t.trade + w.trade, fa: t.fa + w.fa }), { waiver: 0, trade: 0, fa: 0 })
  const empty = totals.waiver + totals.trade + totals.fa === 0
  const seriesLabel = (k: MoveKind) => (k === 'waiver' ? m.seriesWaiver : k === 'trade' ? m.seriesTrade : m.seriesFa)
  const at = hover != null && hover < shown.length ? shown[hover] : null
  const step = shown.length > 10 ? 2 : 1
  const last = shown[shown.length - 1]

  return (
    <figure className="af-ch-chart af-ch-lh-weekly" data-chart="weekly">
      <figcaption className="af-ch-lh-head">
        <span>
          <b>{m.weeklyTitle}</b>
          <small>{m.weeklySubtitle}</small>
        </span>
        <Segmented
          label={m.rangeLabel}
          value={range}
          onChange={(v) => { setRange(v); setHover(null) }}
          options={[{ value: 'season', label: m.rangeSeason }, { value: 'last4', label: m.rangeLast4 }]}
        />
      </figcaption>
      <ul className="af-ch-lh-legend">
        {SERIES.map((s) => (
          <li key={s.key}>
            <span className="af-ch-lh-swatch" style={{ background: s.color }} aria-hidden />
            {seriesLabel(s.key)} <span className="af-num">{totals[s.key]}</span>
          </li>
        ))}
      </ul>
      {empty ? (
        <p className="af-ch-muted">{m.weeklyNone}</p>
      ) : (
        <div className="af-ch-lh-plot" onMouseLeave={() => setHover(null)}>
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="af-ch-lh-svg"
            role="img"
            aria-label={m.weeklyAria(shown.length, totals.waiver, totals.fa, totals.trade)}
          >
            {[0, 25, 50, 75, 100].map((g) => (
              <line key={g} x1="0" x2="100" y1={g} y2={g} className="af-ch-lh-grid" vectorEffect="non-scaling-stroke" />
            ))}
            {at ? (
              <line x1={x(hover!)} x2={x(hover!)} y1="0" y2="100" className="af-ch-lh-cross" vectorEffect="non-scaling-stroke" />
            ) : null}
            {SERIES.map((s) => (
              <polyline
                key={s.key}
                fill="none"
                stroke={s.color}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                points={shown.map((w, i) => `${x(i)},${y(w[s.key])}`).join(' ')}
              />
            ))}
          </svg>
          {/* Markers and end labels sit in HTML so they stay round and readable at any width. */}
          {at
            ? SERIES.map((s) => (
                <span
                  key={s.key}
                  className="af-ch-lh-dot"
                  style={{ left: `${x(hover!)}%`, top: `${y(at[s.key])}%`, background: s.color }}
                  aria-hidden
                />
              ))
            : null}
          {last
            ? SERIES.map((s) => (
                <span key={s.key} className="af-ch-lh-end af-num" style={{ top: `${y(last[s.key])}%` }} aria-hidden>
                  {last[s.key]}
                </span>
              ))
            : null}
          <div className="af-ch-lh-hits">
            {shown.map((w, i) => (
              <button
                key={w.start}
                type="button"
                className="af-ch-lh-hit"
                aria-label={`${m.weekOf(w.label)}: ${m.seriesWaiver} ${w.waiver}, ${m.seriesFa} ${w.fa}, ${m.seriesTrade} ${w.trade}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
            ))}
          </div>
          {at ? (
            <div
              className="af-ch-lh-tip"
              role="status"
              style={{ left: `${Math.min(78, Math.max(22, x(hover!)))}%` }}
            >
              <b>{m.weekOf(at.label)}</b>
              {SERIES.map((s) => (
                <span key={s.key}>
                  <i className="af-ch-lh-swatch" style={{ background: s.color }} aria-hidden />
                  {seriesLabel(s.key)} <span className="af-num">{at[s.key]}</span>
                </span>
              ))}
            </div>
          ) : null}
        </div>
      )}
      {!empty ? (
        <ol className="af-ch-lh-axis" aria-hidden>
          {shown.map((w, i) => (
            <li key={w.start}>{i % step === 0 || i === shown.length - 1 ? w.label : ''}</li>
          ))}
        </ol>
      ) : null}
    </figure>
  )
}

// ── Manager activity ───────────────────────────────────────────────────────

function ManagerActivityChart({ rows, reason, m, language }: { rows: ManagerActivity[] | null; reason: string | null; m: M; language?: string }) {
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [hover, setHover] = useState<number | null>(null)
  const readoutId = useId()
  const max = Math.max(1, ...(rows ?? []).map((r) => r.total))
  const any = (rows ?? []).some((r) => r.total > 0)
  const at = hover != null && rows ? rows[hover] : null
  const dateFmt = useMemo(() => {
    try {
      return new Intl.DateTimeFormat(language === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric' })
    } catch {
      return null
    }
  }, [language])
  const lastActive = (iso: string | null) => (iso && dateFmt ? dateFmt.format(new Date(iso)) : m.never)
  const chip = (r: ManagerActivity) =>
    r.status === 'inactive' ? (
      <span className="af-ch-lh-chip" data-tone="bad">{m.inactive}</span>
    ) : r.status === 'at_risk' ? (
      <span className="af-ch-lh-chip" data-tone="warn">{m.slowing}</span>
    ) : null

  return (
    <figure className="af-ch-chart af-ch-lh-managers" data-chart="managers">
      <figcaption className="af-ch-lh-head">
        <span>
          <b>{m.managersTitle}</b>
          <small>{m.managersSubtitle}</small>
        </span>
        {rows && rows.length > 0 ? (
          <Segmented
            label={m.viewLabel}
            value={view}
            onChange={setView}
            options={[{ value: 'chart', label: m.viewChart }, { value: 'table', label: m.viewTable }]}
          />
        ) : null}
      </figcaption>
      {!rows || rows.length === 0 ? (
        <p className="af-ch-muted">{reason ?? m.managersNone}</p>
      ) : view === 'table' ? (
        <div className="af-ch-lh-table-wrap">
          <table className="af-ch-lh-table">
            <thead>
              <tr>
                <th scope="col">{m.colManager}</th>
                <th scope="col">{m.colClaims}</th>
                <th scope="col">{m.colTrades}</th>
                <th scope="col">{m.colAdds}</th>
                <th scope="col">{m.colLastActive}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <th scope="row">
                    {r.name} {chip(r)}
                  </th>
                  <td className="af-num">{r.waiver}</td>
                  <td className="af-num">{r.trade}</td>
                  <td className="af-num">{r.fa}</td>
                  <td className="af-num">{lastActive(r.lastActionAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <>
          <ul className="af-ch-lh-legend">
            {SERIES.map((s) => (
              <li key={s.key}>
                <span className="af-ch-lh-swatch" style={{ background: s.color }} aria-hidden />
                {s.key === 'waiver' ? m.seriesWaiver : s.key === 'trade' ? m.seriesTrade : m.seriesFa}
              </li>
            ))}
          </ul>
          {!any ? <p className="af-ch-muted">{m.managersNone}</p> : null}
          <ol className="af-ch-lh-stack" onMouseLeave={() => setHover(null)} aria-describedby={readoutId}>
            {rows.map((r, i) => (
              <li
                key={r.name}
                tabIndex={0}
                aria-label={m.managerAria(r.name, r.waiver, r.trade, r.fa)}
                data-active={hover === i || undefined}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              >
                <span className="af-ch-lh-stack-name" title={r.name}>
                  {r.name} {chip(r)}
                </span>
                <span className="af-ch-lh-stack-track" aria-hidden>
                  {SERIES.map((s) =>
                    r[s.key] > 0 ? (
                      <span key={s.key} style={{ width: `${(r[s.key] / max) * 100}%`, background: s.color }} />
                    ) : null,
                  )}
                </span>
                <span className="af-ch-lh-stack-total af-num">{r.total}</span>
              </li>
            ))}
          </ol>
          <p id={readoutId} className="af-ch-lh-readout" role="status">
            {at ? m.managerAria(at.name, at.waiver, at.trade, at.fa) : ''}
          </p>
        </>
      )}
    </figure>
  )
}

// ── Pies ───────────────────────────────────────────────────────────────────

function Pie({ title, subtitle, slices, empty, label, color, m }: {
  title: string
  subtitle: string
  slices: MixSlice[]
  empty: string
  label: (key: string) => string
  color: (key: string) => string
  m: M
}) {
  const geo = useMemo(() => pie3dGeometry(slices.map((s) => s.value)), [slices])
  const total = slices.reduce((n, s) => n + s.value, 0)
  return (
    <figure className="af-ch-chart af-ch-lh-pie">
      <figcaption>
        <b>{title}</b>
        <small>{subtitle}</small>
      </figcaption>
      {total === 0 ? (
        <p className="af-ch-muted">{empty}</p>
      ) : (
        <div className="af-ch-lh-pie-body">
          <svg viewBox="0 0 300 166" className="af-ch-lh-pie-svg" role="img" aria-label={slices.map((s) => m.sliceAria(label(s.key), s.value, s.pct)).join('; ')}>
            {/* Walls first, then the tops over them. The darker overlay is what reads as depth. */}
            {geo.map((g, i) =>
              g.side ? (
                <g key={`side-${slices[i].key}`}>
                  <path d={g.side} fill={color(slices[i].key)} />
                  <path d={g.side} className="af-ch-lh-pie-shade" />
                </g>
              ) : null,
            )}
            {geo.map((g, i) =>
              g.top ? <path key={`top-${slices[i].key}`} d={g.top} fill={color(slices[i].key)} className="af-ch-lh-pie-top" /> : null,
            )}
          </svg>
          <ul className="af-ch-lh-pie-legend">
            {slices.map((s) => (
              <li key={s.key}>
                <span className="af-ch-lh-swatch" style={{ background: color(s.key) }} aria-hidden />
                <span className="af-ch-lh-pie-label">{label(s.key)}</span>
                <span className="af-num">{s.value}</span>
                <span className="af-num af-ch-lh-pct">{s.pct}%</span>
              </li>
            ))}
            <li className="af-ch-lh-pie-total">{m.total(total)}</li>
          </ul>
        </div>
      )}
    </figure>
  )
}
