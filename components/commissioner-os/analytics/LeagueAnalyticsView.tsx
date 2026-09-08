'use client'

import { Download } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  ActivityMixDonut,
  AllTimeRecordChart,
  InfoCard,
  ManagerFingerprintRadar,
} from '@/components/commissioner-os/cards'
import { PreviewDataBanner } from '@/components/commissioner-os/PreviewDataBanner'
import { ErrorState } from '@/components/commissioner-os/states'
import { downloadAnalyticsCsv } from '@/lib/commissioner-ui/analytics/exportCsv'
import {
  TIME_RANGES,
  applyTimeRange,
  describeRange,
  type AnalyticsTimeRange,
} from '@/lib/commissioner-ui/analytics/timeRange'
import type { CommissionerDataMode } from '@/lib/commissioner-ui/demo-mode/constants'
import type {
  AnalyticsDataWindow,
  LeagueAnalyticsSnapshot,
  LeagueHealthWeek,
  ManagerActivityEntry,
  TeamPointsEntry,
  TransactionWeek,
} from '@/lib/commissioner-ui/analytics/decision-os-client/types'
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

/**
 * `because` is optional and carries the SPECIFIC reason a panel is blank.
 *
 * The generic sentence was written when every panel was unwired for one shared reason. Now that
 * most read real data, the two that stay blank are blank for reasons a commissioner would
 * otherwise assume were bugs — and "we could draw this and it would mislead you" is a materially
 * different statement from "we have no data".
 */
function NotWired({ what, because }: { what: string; because?: string }) {
  return (
    <p className="cos-sheet-empty">
      No {what} for this league yet. This section reads from the live platform and is left blank
      rather than filled with an example — an empty chart here would read as “no activity”, which is
      a different thing.
      {because ? <> {because}</> : null}
    </p>
  )
}

/* ── Data freshness ──────────────────────────────────────────────────────── */

function daysLabel(days: number): string {
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/**
 * Says how old the numbers above it are, and only when that changes how they should be read.
 *
 * 🛑 THE STAT ROW IS ENTIRELY WINDOW-DERIVED AND USED TO PRESENT ITSELF AS FACT. On the league
 * this was built for, it read "Active Managers 0 of 7" and "Trade Activity: None" — both
 * arithmetically correct, both taken as statements about the league. What they meant was that
 * the newest event we hold is 18 days old, past the 14-day inactivity threshold, so every
 * manager flipped inactive at once. The league has 12 rostered teams and six seasons of history.
 *
 * Three states, because they need three different sentences:
 *   - stale     — data older than the inactivity threshold, so the KPIs above are describing our
 *                 feed rather than the league. This is the one that was missing.
 *   - no data   — we have never recorded an event, which is not the same as a quiet league.
 *   - current   — a quiet, factual line. Deliberately not a green success badge: freshness is
 *                 the expected state, and celebrating it trains people to ignore the banner.
 */
function FreshnessNote({ window: w }: { window: AnalyticsDataWindow | null }) {
  if (!w) return null

  if (w.lastActivityAt === null) {
    return (
      <p className="cos-sheet-freshness" data-state="none">
        <strong>No activity recorded for this league.</strong> Every number below is measured over
        the last {w.lookbackDays} days of league activity, and we hold none — so they describe our
        data, not your league.
      </p>
    )
  }

  const stale = w.daysSinceLastActivity !== null && w.daysSinceLastActivity > w.inactiveAfterDays
  const asOf = new Date(w.lastActivityAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })

  if (stale) {
    return (
      <p className="cos-sheet-freshness" data-state="stale">
        <strong>
          Newest league activity is from {asOf} ({daysLabel(w.daysSinceLastActivity as number)}).
        </strong>{' '}
        Managers count as inactive after {w.inactiveAfterDays} days without an action, so the
        participation and activity numbers below reflect how old this data is, not how quiet the
        league is. We hold {w.allTime.eventCount.toLocaleString()} events for it all-time.
      </p>
    )
  }

  return (
    <p className="cos-sheet-freshness" data-state="current">
      Measured over the last {w.lookbackDays} days. Newest activity {asOf} (
      {daysLabel(w.daysSinceLastActivity as number)}).
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

/** "A", "A and B", "A, B and C" — a naive join produced "A and B and C" on real data. */
function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  if (names.length === 2) return `${names[0]} and ${names[1]}`
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * The comparative call-out under the activity bars.
 *
 * ⚠ THREE COPY BUGS HERE WERE UNREACHABLE UNTIL THIS PANEL HAD REAL DATA. The demo fixture happens
 * to contain exactly two lapsed managers, so `'Both were'` and a bare `' and '` join both read
 * correctly and neither was wrong on screen. With a real league the panel produced "Both were
 * above 0 earlier this season — A and B and C and D". Wiring live data into copy shaped around one
 * fixture is how a fixture's assumptions ship as product.
 *
 * The threshold guard is the third: `LOW_ACTIVITY_THRESHOLD` is calibrated for in-season play, and
 * a dynasty league in August is legitimately below it across the board. Firing "7 managers are
 * below 5 actions a week" every offseason day would train the reader to ignore this line, so the
 * call-out only speaks when someone has genuinely fallen off against their OWN prior rate.
 */
function buildActivityCallout(rows: ManagerActivityEntry[]): string | null {
  const low = rows.filter((r) => r.actionsPerWeek < LOW_ACTIVITY_THRESHOLD)
  if (!low.length) return null
  // Comparative, or not shown at all — a bare count is already in the bars.
  const wereHigher = low.filter((r) => r.priorActionsPerWeek > r.actionsPerWeek)
  if (!wereHigher.length) return null
  /*
   * Past a handful of names the list stops being a call-out and becomes a second copy of the
   * leaderboard directly beneath it. A league-wide drop is also a different finding from two
   * managers going quiet — it is about the league, not about them — so it gets its own sentence
   * rather than eight names the reader has to re-scan.
   */
  if (wereHigher.length > 3) {
    const topPrior = round1(Math.max(...rows.map((r) => r.priorActionsPerWeek)))
    const topNow = round1(Math.max(...rows.map((r) => r.actionsPerWeek)))
    return `${wereHigher.length} of ${rows.length} managers are doing less than they were. The most active manager is down from ${topPrior} to ${topNow} actions a week.`
  }

  const floor = round1(Math.min(...wereHigher.map((r) => r.priorActionsPerWeek)))
  const noun = low.length === 1 ? 'manager is' : 'managers are'
  const named = nameList(wereHigher.map((r) => r.managerName))
  /*
   * The subject of the second clause is the managers who actually declined, which is not always
   * the same set as those below the threshold — saying "They" after a count of 10 while naming 8
   * asserts something false about the other two.
   */
  const subject = wereHigher.length === low.length ? (wereHigher.length === 1 ? 'They were' : 'They were each') : `${wereHigher.length} of them were`
  return `${low.length} ${noun} below ${LOW_ACTIVITY_THRESHOLD} actions a week. ${subject} above ${floor} earlier — ${named}.`
}

function roundTo(value: number, dp: number): number {
  const f = 10 ** dp
  return Math.round(value * f) / f
}

/** Prose reads better at one decimal; a rate printed beside its own delta must match that column. */
function round1(value: number): number {
  return roundTo(value, 1)
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
                {/*
                  Rounded at the point of display: `0.31 - 1.4` is `1.0899999999999999` in binary
                  floating point, and the leaderboard rendered exactly that. It was intermittent —
                  the same 1.09 computed from different operands printed cleanly two rows below —
                  which is why the fix belongs here rather than at whichever subtraction happened
                  to be caught.
                */}
                {delta === 0 ? '—' : `${down ? '▼' : '▲'} ${roundTo(Math.abs(delta), 2)}`}
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
   * lib/commissioner-ui/analytics/timeRange.ts.
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

      {/* Sits above the stat row, not below it: it changes how those numbers should be read. */}
      <FreshnessNote window={view.dataWindow} />

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
          <NotWired
            what="weekly health history"
            because="A weekly engagement line is computable from league activity, but a dynasty league's activity is mostly offseason — it would draw a near-zero line for most of the year and read as a collapsing league rather than a normal August."
          />
        )}
      </Panel>

      <Panel title="Transactions by week" note="Waiver claims and trades, counted separately. Calendar weeks — most dynasty movement happens outside the NFL season.">
        {view.transactionsByWeek.length ? (
          <TransactionsChart weeks={view.transactionsByWeek} />
        ) : (
          <NotWired what="transaction history" />
        )}
      </Panel>

      <Panel title="Manager activity" note="Ranked by actions a week, against each manager's own rate over the previous window.">
        {view.managerActivity.length ? (
          <ManagerActivity rows={view.managerActivity} />
        ) : (
          <NotWired what="per-manager activity" />
        )}
      </Panel>

      {/*
        The season is named rather than implied. These panels show the newest SCORED season, which
        in preseason is last year — twelve bars at zero under "this season" would read as a league
        that scored nothing.
      */}
      <Panel
        title="Points for and against"
        note={view.seasonLabel ? `Season totals per team — ${view.seasonLabel}.` : 'Season totals per team.'}
      >
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

      {/*
        The three panels below are ALL-TIME, not windowed, and sit after the season-scoped ones on
        purpose. They answer "what kind of league is this" and "who has been good" — standing
        characteristics. Windowing them would collapse each to near-nothing every offseason, which
        is the failure the freshness banner at the top exists to stop.
      */}
      {view.activityMix.length ? (
        <Panel
          title="What this league does"
          note="Every recorded action since the import began, by kind."
        >
          <ActivityMixDonut
            slices={view.activityMix.map((a) => ({ label: a.label, value: a.count }))}
            ariaLabel={`Share of league actions by type: ${view.activityMix
              .map((a) => `${a.label}, ${a.count}`)
              .join('; ')}.`}
          />
        </Panel>
      ) : null}

      {view.allTimeRecords.length ? (
        <Panel
          title="All-time records"
          note="Wins and losses across every season on record. ★ marks a championship."
        >
          <AllTimeRecordChart
            records={view.allTimeRecords}
            ariaLabel={`All-time records: ${view.allTimeRecords
              .map((r) => `${r.teamName}, ${r.wins} wins and ${r.losses} losses over ${r.seasons} seasons, ${r.titles} titles`)
              .join('; ')}.`}
          />
        </Panel>
      ) : null}

      {view.managerFingerprints.length ? (
        <Panel
          title="Manager fingerprints"
          note="Four behavioural scores per manager, each 0–100 against the outer ring. Real scores cluster low, so most shapes sit well inside it — compare them to each other, not to the edge."
        >
          <ManagerFingerprintRadar
            managers={view.managerFingerprints}
            ariaLabel={`Behavioural fingerprints for ${view.managerFingerprints.length} managers across aggression, activity, trading and risk.`}
          />
        </Panel>
      ) : null}

      <p className="cos-sheet-generated">
        Snapshot generated {new Date(view.generatedAt).toLocaleString()}. The export carries exactly
        the range shown above.
      </p>
    </div>
  )
}
