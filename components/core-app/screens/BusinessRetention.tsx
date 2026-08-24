'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import '@/components/core-app/af-core.css'
import '@/components/core-app/af-landing.css'
import '@/components/core-app/af-business.css'
import {
  CALCULATOR_ASSUMPTIONS,
  CALCULATOR_DEFAULTS,
  CHURN_BY_LEAGUE_COUNT,
  COHORT_REVENUE,
  MODEL_PROVENANCE,
  OFFSEASON_SESSIONS,
  RETENTION_CALLOUT_MONTH,
  RETENTION_CURVES,
  projectRetentionImpact,
  type CalculatorInputs,
} from '@/lib/core-app/b2bRetentionModel'

/**
 * 30b — B2B, the retention case.
 *
 * ⚠ NO NEW ROUTE. The repo sits at Vercel's hard 2048-route ceiling, where going
 * over yields a deployment that fails while still building green locally. This
 * screen is served by the existing `/core/[[...screen]]` catch-all as the
 * `business` segment, dispatched BEFORE the session gate and outside
 * AfCoreShell — same placement as `partners` and the landing, because a
 * partner-facing page exists for people who are NOT signed in and carries its
 * own nav.
 *
 * ⚠ THE MODEL BANNER IS STRUCTURAL, NOT DECORATION. It states that every number
 * here is a projection AND prints the provenance status from the model module.
 * While `MODEL_PROVENANCE.status` is 'PROVISIONAL' the banner says no owner has
 * signed the numbers off. Do not soften that into "estimates" — an unowned
 * projection shown to a partner as a result is the failure this page is built
 * to avoid.
 *
 * ⚠ EVERY CHART PRINTS ITS OWN ASSUMPTION SET, DIRECTLY BENEATH IT. That comes
 * from the dataset, not from this file — see `lib/core-app/b2bRetentionModel.ts`.
 * `<Figure>` takes `assumptions` as a required prop so a chart cannot be added
 * without one.
 *
 * ⚠ ONE 3D CHART, AND ONLY THIS ONE. Revenue-by-cohort is isometric because it
 * is a four-bar comparison on a single axis where depth cannot change a reading,
 * and every bar carries its number. Any other chart on this page is flat.
 *
 * ⚠ THE DEMO CTA POINTS AT THE REAL FORM. `/core/partners#demo` is a working
 * form that POSTs to /api/early-access with kind 'business-demo'. This page does
 * not grow a second one — two demo forms means two inboxes and one of them
 * eventually stops being read.
 */

const CHART_W = 720
const CHART_H = 300
const PAD = { top: 22, right: 22, bottom: 40, left: 46 }

const PLOT_W = CHART_W - PAD.left - PAD.right
const PLOT_H = CHART_H - PAD.top - PAD.bottom

function Figure({
  title,
  caption,
  assumptions,
  children,
}: {
  title: string
  caption: string
  /** Required: the copy contract forbids a chart without its assumption set. */
  assumptions: string
  children: React.ReactNode
}) {
  return (
    <figure className="af-biz-fig">
      <figcaption className="af-biz-fig-head">
        <h3 className="af-biz-fig-title">{title}</h3>
        <p className="af-biz-fig-caption">{caption}</p>
      </figcaption>
      <div className="af-biz-fig-plot">{children}</div>
      <p className="af-biz-assume">
        <span className="af-biz-assume-tag">ASSUMPTIONS</span>
        {assumptions}
      </p>
    </figure>
  )
}

/* ── 1. Retention curves ─────────────────────────────────────────────────── */

function RetentionChart() {
  const pts = RETENTION_CURVES.points
  const maxMonth = pts[pts.length - 1].month
  const x = (m: number) => PAD.left + (m / maxMonth) * PLOT_W
  const y = (v: number) => PAD.top + PLOT_H - (v / 100) * PLOT_H

  const line = (key: 'crossLeague' | 'singleLeague') =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.month).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')

  const callout = pts[RETENTION_CALLOUT_MONTH]
  const gap = callout.crossLeague - callout.singleLeague

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="af-biz-svg"
      role="img"
      aria-label={`Projected retention after season end. Cross-league managers fall to ${callout.crossLeague}% by month ${RETENTION_CALLOUT_MONTH}; single-league managers fall to ${callout.singleLeague}%, a gap of ${gap} points.`}
    >
      {[0, 25, 50, 75, 100].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(v)} y2={y(v)} className="af-biz-grid" />
          <text x={PAD.left - 8} y={y(v) + 4} className="af-biz-axis" textAnchor="end">
            {v}%
          </text>
        </g>
      ))}
      {pts.map((p) => (
        <text key={p.month} x={x(p.month)} y={CHART_H - 16} className="af-biz-axis" textAnchor="middle">
          M{p.month}
        </text>
      ))}

      <path d={line('singleLeague')} className="af-biz-line af-biz-line--single" />
      <path d={line('crossLeague')} className="af-biz-line af-biz-line--cross" />

      {/* The callout: the month the gap is widest, stated on the chart. */}
      <line
        x1={x(callout.month)}
        x2={x(callout.month)}
        y1={y(callout.crossLeague)}
        y2={y(callout.singleLeague)}
        className="af-biz-callout-rule"
      />
      <circle cx={x(callout.month)} cy={y(callout.crossLeague)} r={4} className="af-biz-dot af-biz-dot--cross" />
      <circle cx={x(callout.month)} cy={y(callout.singleLeague)} r={4} className="af-biz-dot af-biz-dot--single" />
      <text x={x(callout.month) + 10} y={y(callout.crossLeague) - 10} className="af-biz-callout-text">
        {gap} points apart at month {callout.month}
      </text>
      <text x={x(callout.month) + 10} y={y(callout.crossLeague) + 6} className="af-biz-callout-sub">
        {callout.crossLeague}% vs {callout.singleLeague}%
      </text>
    </svg>
  )
}

/* ── 2. Revenue by cohort — the one isometric chart ──────────────────────── */

function CohortRevenueChart() {
  const pts = COHORT_REVENUE.points
  const max = Math.max(...pts.map((p) => p.index))
  const baseY = CHART_H - 54
  const barW = 78
  const gap = 46
  const depth = 20
  const scale = (PLOT_H - 30) / max
  const startX = PAD.left + 24

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="af-biz-svg"
      role="img"
      aria-label={`Projected revenue per user indexed to the single-league cohort at 100: ${pts
        .map((p) => `${p.label} ${p.index}`)
        .join(', ')}.`}
    >
      {/* The front face carries the scale. Depth is decoration only. */}
      {[0, 50, 100, 150, 200].map((v) => (
        <g key={v}>
          <line
            x1={startX - 14}
            x2={startX + pts.length * (barW + gap)}
            y1={baseY - v * scale}
            y2={baseY - v * scale}
            className="af-biz-grid"
          />
          <text x={startX - 20} y={baseY - v * scale + 4} className="af-biz-axis" textAnchor="end">
            {v}
          </text>
        </g>
      ))}

      {pts.map((p, i) => {
        const h = p.index * scale
        const bx = startX + i * (barW + gap)
        const by = baseY - h
        return (
          <g key={p.label}>
            {/* top face */}
            <polygon
              points={`${bx},${by} ${bx + depth},${by - depth} ${bx + barW + depth},${by - depth} ${bx + barW},${by}`}
              className="af-biz-iso-top"
            />
            {/* side face */}
            <polygon
              points={`${bx + barW},${by} ${bx + barW + depth},${by - depth} ${bx + barW + depth},${baseY - depth} ${bx + barW},${baseY}`}
              className="af-biz-iso-side"
            />
            {/* front face — the one the axis measures */}
            <rect x={bx} y={by} width={barW} height={h} className="af-biz-iso-front" />
            {/* every value labelled, always */}
            <text x={bx + barW / 2} y={by - depth - 8} className="af-biz-barval" textAnchor="middle">
              {p.index}
            </text>
            <text x={bx + barW / 2} y={baseY + 20} className="af-biz-axis" textAnchor="middle">
              {p.label}
            </text>
          </g>
        )
      })}
      <text x={startX - 20} y={PAD.top - 6} className="af-biz-axis-title">
        INDEX · 1 league = 100
      </text>
    </svg>
  )
}

/* ── 3. Offseason sessions ───────────────────────────────────────────────── */

function OffseasonSessionsChart() {
  const pts = OFFSEASON_SESSIONS.points
  const max = 16
  const x = (i: number) => PAD.left + (i / (pts.length - 1)) * PLOT_W
  const y = (v: number) => PAD.top + PLOT_H - (v / max) * PLOT_H

  const area = (key: 'crossLeague' | 'singleLeague') =>
    `${pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join(' ')} L${x(
      pts.length - 1,
    ).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="af-biz-svg"
      role="img"
      aria-label={`Projected sessions per active user per month through the offseason. Cross-league runs from ${pts[0].crossLeague} down to ${pts[4].crossLeague}; single-league from ${pts[0].singleLeague} down to ${pts[4].singleLeague}.`}
    >
      {[0, 4, 8, 12, 16].map((v) => (
        <g key={v}>
          <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(v)} y2={y(v)} className="af-biz-grid" />
          <text x={PAD.left - 8} y={y(v) + 4} className="af-biz-axis" textAnchor="end">
            {v}
          </text>
        </g>
      ))}
      {pts.map((p, i) => (
        <text key={p.label} x={x(i)} y={CHART_H - 16} className="af-biz-axis" textAnchor="middle">
          {p.label}
        </text>
      ))}

      <path d={area('crossLeague')} className="af-biz-area af-biz-area--cross" />
      <path d={area('singleLeague')} className="af-biz-area af-biz-area--single" />
      <text x={PAD.left - 8} y={PAD.top - 6} className="af-biz-axis-title" textAnchor="start">
        SESSIONS / ACTIVE USER / MONTH
      </text>
    </svg>
  )
}

/* ── 4. Churn by league count ────────────────────────────────────────────── */

function ChurnChart() {
  const pts = CHURN_BY_LEAGUE_COUNT.points
  const max = 70
  const baseY = CHART_H - 54
  const barW = 84
  const gap = 44
  const scale = (PLOT_H - 20) / max
  const startX = PAD.left + 30

  return (
    <svg
      viewBox={`0 0 ${CHART_W} ${CHART_H}`}
      className="af-biz-svg"
      role="img"
      aria-label={`Projected share of each cohort churned by month six: ${pts
        .map((p) => `${p.label} ${p.churnPct}%`)
        .join(', ')}. Correlational, not causal.`}
    >
      {[0, 20, 40, 60].map((v) => (
        <g key={v}>
          <line
            x1={startX - 14}
            x2={startX + pts.length * (barW + gap)}
            y1={baseY - v * scale}
            y2={baseY - v * scale}
            className="af-biz-grid"
          />
          <text x={startX - 20} y={baseY - v * scale + 4} className="af-biz-axis" textAnchor="end">
            {v}%
          </text>
        </g>
      ))}
      {pts.map((p, i) => {
        const h = p.churnPct * scale
        const bx = startX + i * (barW + gap)
        return (
          <g key={p.label}>
            <rect x={bx} y={baseY - h} width={barW} height={h} className="af-biz-bar" />
            <text x={bx + barW / 2} y={baseY - h - 9} className="af-biz-barval" textAnchor="middle">
              {p.churnPct}%
            </text>
            <text x={bx + barW / 2} y={baseY + 20} className="af-biz-axis" textAnchor="middle">
              {p.label}
            </text>
          </g>
        )
      })}
      <text x={startX - 20} y={PAD.top - 6} className="af-biz-axis-title">
        CHURNED BY MONTH 6
      </text>
    </svg>
  )
}

/* ── 5. The calculator ───────────────────────────────────────────────────── */

const usd = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
      ? `$${Math.round(n / 1_000)}K`
      : `$${Math.round(n)}`

const int = (n: number) => Math.round(n).toLocaleString('en-US')

function Calculator() {
  const [inputs, setInputs] = useState<CalculatorInputs>(CALCULATOR_DEFAULTS)
  const result = useMemo(() => projectRetentionImpact(inputs), [inputs])

  const set = (key: keyof CalculatorInputs) => (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value.replace(/[^0-9.]/g, ''))
    setInputs((prev) => ({ ...prev, [key]: Number.isFinite(raw) ? raw : 0 }))
  }

  return (
    <section className="af-biz-calc" id="calculator" aria-labelledby="calc-heading">
      <div className="af-biz-calc-head">
        <span className="af-label">Your numbers</span>
        <h2 id="calc-heading" className="af-biz-calc-title">
          Run it on your own platform
        </h2>
        <p className="af-biz-calc-sub">
          Three numbers you already know. Everything recomputes as you type — nothing is sent anywhere.
        </p>
      </div>

      <div className="af-biz-calc-grid">
        <label className="af-biz-field">
          <span className="af-biz-field-label">Users at season end</span>
          <input
            className="af-biz-input"
            inputMode="numeric"
            value={inputs.seasonEndUsers.toLocaleString('en-US')}
            onChange={set('seasonEndUsers')}
            aria-describedby="calc-assume"
          />
        </label>
        <label className="af-biz-field">
          <span className="af-biz-field-label">Your month-6 retention</span>
          <div className="af-biz-input-wrap">
            <input
              className="af-biz-input"
              inputMode="decimal"
              value={String(inputs.currentM6RetentionPct)}
              onChange={set('currentM6RetentionPct')}
              aria-describedby="calc-assume"
            />
            <span className="af-biz-input-suffix">%</span>
          </div>
        </label>
        <label className="af-biz-field">
          <span className="af-biz-field-label">Value per retained user / yr</span>
          <div className="af-biz-input-wrap">
            <span className="af-biz-input-prefix">$</span>
            <input
              className="af-biz-input af-biz-input--prefixed"
              inputMode="decimal"
              value={String(inputs.valuePerRetainedUser)}
              onChange={set('valuePerRetainedUser')}
              aria-describedby="calc-assume"
            />
          </div>
        </label>
      </div>

      <div className="af-biz-calc-out" role="status" aria-live="polite">
        <div className="af-biz-calc-headline">
          <span className="af-biz-calc-headline-v af-num">{usd(result.annualImpactUsd)}</span>
          <span className="af-biz-calc-headline-l">projected annual impact</span>
        </div>
        <dl className="af-biz-calc-breakdown">
          <div>
            <dt>Retained today at M6</dt>
            <dd className="af-num">{int(result.retainedUsersToday)}</dd>
          </div>
          <div>
            <dt>Projected at M6</dt>
            <dd className="af-num">
              {int(result.projectedRetainedUsers)}{' '}
              <span className="af-biz-calc-pct">({result.projectedM6RetentionPct.toFixed(1)}%)</span>
            </dd>
          </div>
          <div>
            <dt>Incremental users</dt>
            <dd className="af-num af-biz-calc-delta">+{int(result.incrementalUsers)}</dd>
          </div>
        </dl>
      </div>

      <p className="af-biz-assume" id="calc-assume">
        <span className="af-biz-assume-tag">ASSUMPTIONS</span>
        {CALCULATOR_ASSUMPTIONS}
      </p>
    </section>
  )
}

/* ── The page ────────────────────────────────────────────────────────────── */

export function BusinessRetention() {
  const provisional = MODEL_PROVENANCE.status === 'PROVISIONAL'

  return (
    <div className="af-lp af-biz">
      {/*
       * The MODEL banner is persistent and sticky by design — a reader who
       * scrolls to a chart three screens down must still be able to see that
       * what they are reading is a projection.
       */}
      <div className="af-biz-modelbar" role="note">
        <span className="af-biz-modelbar-tag">MODEL</span>
        <p className="af-biz-modelbar-text">
          Every number on this page is a projection from stated assumptions — not a measured customer
          result.{' '}
          {provisional ? (
            <strong className="af-biz-modelbar-strong">
              These curves have not yet been signed off by a model owner.
            </strong>
          ) : (
            <>
              Reviewed by {MODEL_PROVENANCE.owner} on {MODEL_PROVENANCE.reviewedOn}.
            </>
          )}
        </p>
      </div>

      <header className="af-biz-hero">
        <p className="af-label af-biz-hero-eyebrow">AllFantasy for Business</p>
        <h1 className="af-display af-biz-hero-title">
          A single-league user has no reason to open your app in March.
        </h1>
        <p className="af-biz-hero-body">
          Fantasy churn is not a satisfaction problem — it is a calendar problem. When a manager&apos;s one
          league ends, so does the product. A manager who can see every league they play, in one place, has
          something to come back to in the eight months nobody is scoring points.
        </p>
        <div className="af-biz-hero-cta">
          <Link href="/core/partners#demo" className="af-btn af-biz-btn-primary">
            Book a demo
          </Link>
          <a href="#calculator" className="af-btn af-biz-btn-ghost">
            Run your numbers
          </a>
        </div>
      </header>

      <div className="af-biz-body">
        <Figure
          title="Retention after season end"
          caption="Share of the season-end cohort still active, by month. The gap opens in the offseason and never fully closes."
          assumptions={RETENTION_CURVES.assumptions}
        >
          <div className="af-biz-legend">
            <span className="af-biz-key af-biz-key--cross">Cross-league</span>
            <span className="af-biz-key af-biz-key--single">Single-league baseline</span>
          </div>
          <RetentionChart />
        </Figure>

        <Figure
          title="Revenue by cohort"
          caption="Indexed to the single-league cohort. More leagues connected, more retained months, more revenue per user."
          assumptions={COHORT_REVENUE.assumptions}
        >
          <CohortRevenueChart />
        </Figure>

        <Figure
          title="Offseason sessions"
          caption="What the eight quiet months actually look like for each cohort."
          assumptions={OFFSEASON_SESSIONS.assumptions}
        >
          <div className="af-biz-legend">
            <span className="af-biz-key af-biz-key--cross">Cross-league</span>
            <span className="af-biz-key af-biz-key--single">Single-league baseline</span>
          </div>
          <OffseasonSessionsChart />
        </Figure>

        <Figure
          title="Churn by league count"
          caption="How much of each cohort is gone by month six."
          assumptions={CHURN_BY_LEAGUE_COUNT.assumptions}
        >
          <ChurnChart />
        </Figure>

        <Calculator />

        <section className="af-biz-close">
          <h2 className="af-biz-close-title">Worth a conversation?</h2>
          <p className="af-biz-close-body">
            Bring your own retention curve. We will run this model against it and tell you where it does
            not hold — that is a more useful first meeting than a deck.
          </p>
          <div className="af-biz-hero-cta">
            <Link href="/core/partners#demo" className="af-btn af-biz-btn-primary">
              Book a demo
            </Link>
            <Link href="/core/partners" className="af-btn af-biz-btn-ghost">
              What we actually do
            </Link>
          </div>
        </section>
      </div>
    </div>
  )
}

export default BusinessRetention
