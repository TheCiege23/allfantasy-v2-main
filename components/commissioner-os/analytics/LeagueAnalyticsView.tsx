'use client'

import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { InfoCard } from '@/components/commissioner-os/cards'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { ErrorState } from '@/components/commissioner-os/states'
import { downloadAnalyticsCsv } from '@/lib/commissioner-os/analytics/exportCsv'
import {
  TIME_RANGES,
  applyTimeRange,
  describeRange,
  type AnalyticsTimeRange,
} from '@/lib/commissioner-os/analytics/timeRange'
import type { CommissionerDataMode } from '@/lib/commissioner-os/demo-mode/constants'
import type {
  LeagueAnalyticsSnapshot,
  LeagueHealthWeek,
  ManagerActivityEntry,
  TeamPointsEntry,
  TransactionWeek,
} from '@/lib/commissioner-os/analytics/decision-os-client/types'
import './analytics-sheet.css'

/**
 * 30a — Commissioner OS analytics, as spreadsheet charts.
 *
 * ⚠ THESE CHARTS ARE DELIBERATELY NOT "CLEAN". Gridlines, axis labels, legends
 * and inline data labels are all present on purpose. The reader is a
 * commissioner checking real numbers against their own memory of the season,
 * and a chart stripped down for elegance is a chart they cannot read a value
 * off. If a future design pass wants to remove the gridlines or the inline
 * labels, that is a change to the handoff, not a tidy-up.
 *
 * ⚠ THE MANAGER CALL-OUT IS COMPARATIVE OR IT IS NOTHING. "Two managers below
 * five actions a week — both were above twelve in September" is the whole
 * point. It is computed from `priorActionsPerWeek`, and if that comparison is
 * unavailable the call-out is not rendered at all rather than degrading into a
 * bare ranking, which the reader already has directly beneath it.
 *
 * ⚠ THE TARGET LINE IS LABELLED ON THE CHART, NOT IN THE LEGEND. A target a
 * reader has to look up in a legend is a target they read past.
 *
 * ⚠ THE CSV IS THE FILTERED SNAPSHOT, LITERALLY. `view` is what renders and
 * `view` is what exports — there is no second path that could fall out of step
 * with the time-range switcher.
 *
 * ⚠ EMPTY IS SAID, NOT DRAWN. The live client returns honestly-empty arrays for
 * the sections Decision OS has no analog for. Each section renders an explicit
 * "not wired" note in that case; an empty chart frame reads as "this league has
 * no activity", which is a different and much worse claim.
 */

export interface LeagueAnalyticsViewProps {
  snapshot: LeagueAnalyticsSnapshot | null
  dataMode: CommissionerDataMode
  errorMessage?: string | null
}

const W = 760
const H = 280
const PAD = { top: 20, right: 18, bottom: 38, left: 44 }
const PW = W - PAD.left - PAD.right
const PH = H - PAD.top - PAD.bottom

/** The threshold the call-out speaks about. Named so the copy cannot drift from it. */
const LOW_ACTIVITY_THRESHOLD = 5

function Panel({
  title,
  note,
  children,
  action,
}: {
  title: string
  note?: string
  children: React.ReactNode
  action?: React.ReactNode
}) {
  return (
    <section className="cos-sheet-panel" aria-labelledby={`${title.replace(/\W+/g, '-')}-h`}>
      <header className="cos-sheet-panel-head">
        <div>
          <h2 id={`${title.replace(/\W+/g, '-')}-h`} className="cos-sheet-panel-title">
            {title}
          </h2>
          {note ? <p className="cos-sheet-panel-note">{note}</p> : null}
        </div>
        {action}
      </header>
      {children}
    </section>
  )
}

function NotWired({ what }: { what: string }) {
  return (
    <p className="cos-sheet-empty">
      No {what} for this league yet. This section reads from the live platform and is left blank
      rather than filled with an example — an empty chart here would read as “no activity”, which is
      a different thing.
    </p>
  )
}

/* ── League health by week ───────────────────────────────────────────────── */

function HealthChart({ weeks, target }: { weeks: LeagueHealthWeek[]; target: number | null }) {
  const x = (i: number) => PAD.left + (weeks.length === 1 ? PW / 2 : (i / (weeks.length - 1)) * PW)
  const y = (v: number) => PAD.top + PH - (v / 100) * PH

  const path = (key: 'thisSeason' | 'lastSeason') => {
    const pts = weeks
      .map((w, i) => ({ i, v: w[key] }))
      .filter((p): p is { i: number; v: number } => p.v !== null)
    if (!pts.length) return ''
    return pts.map((p, n) => `${n === 0 ? 'M' : 'L'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  }

  const hasLast = weeks.some((w) => w.lastSeason !== null)

  return (
    <>
      <div className="cos-sheet-legend">
        <span className="cos-key cos-key--a">This season</span>
        {hasLast ? <span className="cos-key cos-key--b">Last season</span> : null}
        {target !== null ? <span className="cos-key cos-key--target">Target {target}</span> : null}
      </div>
      <div className="cos-sheet-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="cos-sheet-svg"
          role="img"
          aria-label={`League health by week. This season runs ${weeks[0]?.thisSeason} to ${
            weeks[weeks.length - 1]?.thisSeason
          }${target !== null ? `, against a target of ${target}` : ''}.`}
        >
          {[0, 25, 50, 75, 100].map((v) => (
            <g key={v}>
              <line x1={PAD.left} x2={PAD.left + PW} y1={y(v)} y2={y(v)} className="cos-grid" />
              <text x={PAD.left - 7} y={y(v) + 4} className="cos-axis" textAnchor="end">
                {v}
              </text>
            </g>
          ))}
          {weeks.map((w, i) => (
            <text key={w.weekLabel} x={x(i)} y={H - 14} className="cos-axis" textAnchor="middle">
              {w.weekLabel}
            </text>
          ))}

          {/* The target overlay, labelled inline on the chart itself. */}
          {target !== null ? (
            <g>
              <line x1={PAD.left} x2={PAD.left + PW} y1={y(target)} y2={y(target)} className="cos-target" />
              <rect x={PAD.left + PW - 74} y={y(target) - 17} width={74} height={15} className="cos-target-chip" />
              <text x={PAD.left + PW - 70} y={y(target) - 6} className="cos-target-label">
                TARGET {target}
              </text>
            </g>
          ) : null}

          {hasLast ? <path d={path('lastSeason')} className="cos-line cos-line--b" /> : null}
          <path d={path('thisSeason')} className="cos-line cos-line--a" />

          {/* Inline data labels — a commissioner reads values, not shapes. */}
          {weeks.map((w, i) => (
            <text key={`v-${w.weekLabel}`} x={x(i)} y={y(w.thisSeason) - 9} className="cos-inline" textAnchor="middle">
              {w.thisSeason}
            </text>
          ))}
        </svg>
      </div>
    </>
  )
}

/* ── Transactions, grouped columns ───────────────────────────────────────── */

function TransactionsChart({ weeks }: { weeks: TransactionWeek[] }) {
  const max = Math.max(4, ...weeks.flatMap((w) => [w.tradeCount, w.waiverClaimCount]))
  const baseY = H - 44
  const group = PW / weeks.length
  const barW = Math.min(24, group / 3)

  const y = (v: number) => baseY - (v / max) * (PH - 18)

  return (
    <>
      <div className="cos-sheet-legend">
        <span className="cos-key cos-key--a">Waiver claims</span>
        <span className="cos-key cos-key--c">Trades</span>
      </div>
      <div className="cos-sheet-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="cos-sheet-svg"
          role="img"
          aria-label={`Weekly transactions: ${weeks
            .map((w) => `${w.weekLabel}, ${w.waiverClaimCount} waiver claims and ${w.tradeCount} trades`)
            .join('; ')}.`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const v = Math.round(max * f)
            return (
              <g key={f}>
                <line x1={PAD.left} x2={PAD.left + PW} y1={y(v)} y2={y(v)} className="cos-grid" />
                <text x={PAD.left - 7} y={y(v) + 4} className="cos-axis" textAnchor="end">
                  {v}
                </text>
              </g>
            )
          })}
          {weeks.map((w, i) => {
            const cx = PAD.left + i * group + group / 2
            return (
              <g key={w.weekLabel}>
                <rect
                  x={cx - barW - 2}
                  y={y(w.waiverClaimCount)}
                  width={barW}
                  height={baseY - y(w.waiverClaimCount)}
                  className="cos-bar cos-bar--a"
                />
                <text x={cx - barW / 2 - 2} y={y(w.waiverClaimCount) - 5} className="cos-inline" textAnchor="middle">
                  {w.waiverClaimCount}
                </text>
                <rect
                  x={cx + 2}
                  y={y(w.tradeCount)}
                  width={barW}
                  height={baseY - y(w.tradeCount)}
                  className="cos-bar cos-bar--c"
                />
                <text x={cx + barW / 2 + 2} y={y(w.tradeCount) - 5} className="cos-inline" textAnchor="middle">
                  {w.tradeCount}
                </text>
                <text x={cx} y={H - 14} className="cos-axis" textAnchor="middle">
                  {w.weekLabel}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </>
  )
}

/* ── Manager activity leaderboard ────────────────────────────────────────── */

function buildActivityCallout(rows: ManagerActivityEntry[]): string | null {
  const low = rows.filter((r) => r.actionsPerWeek < LOW_ACTIVITY_THRESHOLD)
  if (!low.length) return null
  // Comparative, or not shown at all — a bare count is already in the bars.
  const wereHigher = low.filter((r) => r.priorActionsPerWeek > r.actionsPerWeek)
  if (!wereHigher.length) return null
  const floor = Math.min(...wereHigher.map((r) => r.priorActionsPerWeek))
  const noun = low.length === 1 ? 'manager is' : 'managers are'
  const they = wereHigher.length === 1 ? 'They were' : 'Both were'
  const named = wereHigher.map((r) => r.managerName).join(' and ')
  return `${low.length} ${noun} below ${LOW_ACTIVITY_THRESHOLD} actions a week. ${they} above ${floor} earlier this season — ${named}.`
}

function ManagerActivity({ rows }: { rows: ManagerActivityEntry[] }) {
  const max = Math.max(...rows.map((r) => r.actionsPerWeek), 1)
  const callout = buildActivityCallout(rows)

  return (
    <>
      {callout ? (
        <p className="cos-sheet-callout" role="note">
          {callout}
        </p>
      ) : null}
      <ol className="cos-lb">
        {rows.map((r, i) => {
          const delta = r.actionsPerWeek - r.priorActionsPerWeek
          const down = delta < 0
          const low = r.actionsPerWeek < LOW_ACTIVITY_THRESHOLD
          return (
            <li key={r.managerName} className="cos-lb-row" data-low={low ? 'true' : undefined}>
              <span className="cos-lb-rank">{i + 1}</span>
              <span className="cos-lb-name">{r.managerName}</span>
              <span className="cos-lb-track">
                <span
                  className="cos-lb-fill"
                  data-low={low ? 'true' : undefined}
                  style={{ width: `${(r.actionsPerWeek / max) * 100}%` }}
                />
              </span>
              <span className="cos-lb-val">{r.actionsPerWeek}</span>
              <span className="cos-lb-delta" data-dir={down ? 'down' : delta > 0 ? 'up' : 'flat'}>
                {delta === 0 ? '—' : `${down ? '▼' : '▲'} ${Math.abs(delta)}`}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="cos-sheet-foot">
        Actions a week: lineup changes, waiver claims, trade offers and messages. The arrow compares
        against the same manager earlier this season, not against the league.
      </p>
    </>
  )
}

/* ── Points for / against ────────────────────────────────────────────────── */

function PointsChart({ teams }: { teams: TeamPointsEntry[] }) {
  const max = Math.max(...teams.flatMap((t) => [t.pointsFor, t.pointsAgainst]), 1)
  const ceil = Math.ceil(max / 200) * 200
  const baseY = H - 52
  const group = PW / teams.length
  const barW = Math.min(15, group / 3)
  const y = (v: number) => baseY - (v / ceil) * (PH - 22)

  return (
    <>
      <div className="cos-sheet-legend">
        <span className="cos-key cos-key--a">Points for</span>
        <span className="cos-key cos-key--d">Points against</span>
      </div>
      <div className="cos-sheet-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="cos-sheet-svg cos-sheet-svg--wide"
          role="img"
          aria-label={`Points for and against per team: ${teams
            .map((t) => `${t.teamName}, ${t.pointsFor} for and ${t.pointsAgainst} against`)
            .join('; ')}.`}
        >
          {[0, 0.25, 0.5, 0.75, 1].map((f) => {
            const v = Math.round(ceil * f)
            return (
              <g key={f}>
                <line x1={PAD.left} x2={PAD.left + PW} y1={y(v)} y2={y(v)} className="cos-grid" />
                <text x={PAD.left - 7} y={y(v) + 4} className="cos-axis" textAnchor="end">
                  {v}
                </text>
              </g>
            )
          })}
          {teams.map((t, i) => {
            const cx = PAD.left + i * group + group / 2
            return (
              <g key={t.teamName}>
                <rect x={cx - barW - 1} y={y(t.pointsFor)} width={barW} height={baseY - y(t.pointsFor)} className="cos-bar cos-bar--a" />
                <rect x={cx + 1} y={y(t.pointsAgainst)} width={barW} height={baseY - y(t.pointsAgainst)} className="cos-bar cos-bar--d" />
                <text
                  x={cx}
                  y={H - 30}
                  className="cos-axis cos-axis--rot"
                  textAnchor="end"
                  transform={`rotate(-42 ${cx} ${H - 30})`}
                >
                  {t.teamName.length > 16 ? `${t.teamName.slice(0, 15)}…` : t.teamName}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
      <p className="cos-sheet-foot">
        Season totals. A team high on both bars is playing a hard schedule, not a bad one — read the
        pair, not either bar alone.
      </p>
    </>
  )
}

/* ── The view ────────────────────────────────────────────────────────────── */

export function LeagueAnalyticsView({ snapshot, dataMode, errorMessage }: LeagueAnalyticsViewProps) {
  const [range, setRange] = useState<AnalyticsTimeRange>('season')

  /*
   * ONE filtered object. It is what renders and what exports — see
   * lib/commissioner-os/analytics/timeRange.ts.
   */
  const view = useMemo(() => (snapshot ? applyTimeRange(snapshot, range) : null), [snapshot, range])

  if (errorMessage || !snapshot || !view) {
    return (
      <div>
        <PreviewDataBanner mode={dataMode} />
        <ErrorState message={errorMessage ?? "Couldn't load league analytics right now."} />
      </div>
    )
  }

  return (
    <div className="cos-sheet">
      <PreviewDataBanner mode={dataMode} />

      <div className="cos-sheet-bar">
        <div className="cos-sheet-ranges" role="group" aria-label="Time range">
          {TIME_RANGES.map((r) => (
            <button
              key={r.id}
              type="button"
              className="cos-sheet-range"
              aria-pressed={range === r.id}
              title={r.hint}
              onClick={() => setRange(r.id)}
            >
              {r.label}
            </button>
          ))}
        </div>
        <div className="cos-sheet-bar-right">
          <span className="cos-sheet-scope">{describeRange(range, view)}</span>
          <Button size="sm" variant="outline" onClick={() => downloadAnalyticsCsv(view, `league-analytics-${range}.csv`)}>
            <Download size={14} aria-hidden /> Export CSV
          </Button>
        </div>
      </div>

      {/* Stat row */}
      <section aria-label="Headline numbers" className="cos-sheet-stats">
        {view.kpis.map((kpi) => (
          <div key={kpi.id} className="cos-stat">
            <span className="cos-stat-label">{kpi.label}</span>
            <span className="cos-stat-value">{kpi.value}</span>
            {kpi.trend ? (
              <span className="cos-stat-trend" data-dir={kpi.trend.direction}>
                {kpi.trend.direction === 'up' ? '▲' : kpi.trend.direction === 'down' ? '▼' : '—'} {kpi.trend.label}
              </span>
            ) : null}
          </div>
        ))}
      </section>

      <Panel title="League health by week" note="This season against last, with the target this league set.">
        {view.healthByWeek.length ? (
          <HealthChart weeks={view.healthByWeek} target={view.healthTarget} />
        ) : (
          <NotWired what="weekly health history" />
        )}
      </Panel>

      <Panel title="Transactions by week" note="Waiver claims and trades, counted separately.">
        {view.transactionsByWeek.length ? (
          <TransactionsChart weeks={view.transactionsByWeek} />
        ) : (
          <NotWired what="transaction history" />
        )}
      </Panel>

      <Panel title="Manager activity" note="Ranked by actions a week, with the change against earlier in the season.">
        {view.managerActivity.length ? (
          <ManagerActivity rows={view.managerActivity} />
        ) : (
          <NotWired what="per-manager activity" />
        )}
      </Panel>

      <Panel title="Points for and against" note="Season totals per team.">
        {view.pointsForAgainst.length ? <PointsChart teams={view.pointsForAgainst} /> : <NotWired what="scoring totals" />}
      </Panel>

      {view.competitiveBalance.length ? (
        <Panel title="Competitive balance">
          <div className="cos-sheet-cards">
            {view.competitiveBalance.map((m) => (
              <InfoCard key={m.label} title={m.label}>
                <strong className="cos-sheet-cardval">{m.value}</strong>
                {m.interpretation}
              </InfoCard>
            ))}
          </div>
        </Panel>
      ) : null}

      <p className="cos-sheet-generated">
        Snapshot generated {new Date(view.generatedAt).toLocaleString()}. The export carries exactly
        the range shown above.
      </p>
    </div>
  )
}
