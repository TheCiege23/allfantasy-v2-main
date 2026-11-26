'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import '@/components/core-app/af-decisions.css'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { CoreDepthLock } from '@/components/core-app/CoreDepthLock'
import { decideCoreDepth } from '@/lib/core-app/coreDepthAccess'
import { decisionLogCopy, type DecisionLogCopy } from '@/lib/core-app/messages/decisionLog'
import {
  decisionDetail,
  decisionHeadline,
  decisionTypesPresent,
  filterDecisions,
  outcomeRecord,
  outcomeView,
  tradeGradeView,
  type DecisionLogRow,
  type DecisionLogSummary,
} from '@/lib/core-app/decisionLogView'

/**
 * /core/decisions — "My decisions" (2026-11-26). The decision log the analyzers have written for months,
 * shown for the first time: each call with its TRADE GRADE (the deal's one grade, when it was asked
 * about) and its OUTCOME grade (how the roster moved N weeks later), always labelled apart.
 *
 * 🛑 AF PRO AND AF SUPREME ONLY, AND THIS COMPONENT IS NOT THE GATE. The page draws the lock from the
 * server's paywall read and does not mount this screen for a locked viewer; GET /api/legacy/decision-log
 * refuses the same viewers itself (`decision_log_history`). `locked` is that server read; the route's own
 * 403 draws the same lock for the case the two disagree (a plan that lapsed between page and read).
 *
 * Reads the EXISTING route, `scope=mine`: every row under either of the caller's own keys, which the
 * server resolves. The league filter goes to the route (so the summary is that league's); the type
 * filter is applied here, over the rows already read.
 */

export type DecisionLogPayload = { decisions: DecisionLogRow[]; summary: DecisionLogSummary }
export type DecisionLogLoadResult = { ok: true; data: DecisionLogPayload } | { ok: false; locked: boolean }
export type DecisionLogLoader = (leagueId: string | null) => Promise<DecisionLogLoadResult>

async function readJson(res: Response): Promise<Record<string, unknown> | null> {
  try {
    return (await res.json()) as Record<string, unknown>
  } catch {
    return null
  }
}

/** The default loader: the list and the summary from the one route, in parallel. */
export const loadDecisionLog: DecisionLogLoader = async (leagueId) => {
  const q = (view: string) => {
    const p = new URLSearchParams({ scope: 'mine', view })
    if (view === 'list') p.set('limit', '100')
    if (leagueId) p.set('leagueId', leagueId)
    return `/api/legacy/decision-log?${p.toString()}`
  }
  try {
    const [listRes, sumRes] = await Promise.all([
      fetch(q('list'), { cache: 'no-store' }),
      fetch(q('summary'), { cache: 'no-store' }),
    ])
    if (listRes.status === 403 || sumRes.status === 403) {
      const body = await readJson(listRes.status === 403 ? listRes : sumRes)
      return { ok: false, locked: body?.code === 'feature_not_entitled' }
    }
    if (!listRes.ok || !sumRes.ok) return { ok: false, locked: false }
    const list = await readJson(listRes)
    const sum = await readJson(sumRes)
    if (!Array.isArray(list?.decisions) || !sum?.summary || typeof sum.summary !== 'object') return { ok: false, locked: false }
    return { ok: true, data: { decisions: list.decisions as DecisionLogRow[], summary: sum.summary as DecisionLogSummary } }
  } catch {
    return { ok: false, locked: false }
  }
}

function formatDay(iso: string, language: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(language === 'es' ? 'es-US' : 'en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(d)
}

function GradePills({ row, c }: { row: DecisionLogRow; c: DecisionLogCopy }) {
  const trade = tradeGradeView(row)
  const outcome = outcomeView(row.outcome)
  return (
    <div className="af-dl-grades">
      {trade.kind === 'graded' ? (
        <span className="af-dl-pill" data-kind="trade" data-testid="decision-trade-grade">{c.tradeGrade(trade.letter)}</span>
      ) : trade.kind === 'withheld' ? (
        <span className="af-dl-pill" data-kind="trade" data-muted="" data-testid="decision-trade-grade" title={trade.reason}>
          {c.tradeNotGraded}
        </span>
      ) : trade.kind === 'not_recorded' ? (
        <span className="af-dl-pill" data-kind="trade" data-muted="" data-testid="decision-trade-grade">{c.tradeGradeNone}</span>
      ) : null}
      <span className="af-dl-pill" data-kind="outcome" data-muted={outcome.kind === 'awaiting' ? '' : undefined} data-testid="decision-outcome-grade">
        {outcome.kind === 'graded' ? c.outcomeAfter(outcome.weeks, outcome.grade) : c.outcomeAwaiting}
      </span>
      {trade.kind === 'withheld' ? <span className="af-dl-why" data-testid="decision-trade-withheld">{c.tradeNotGradedWhy(trade.reason)}</span> : null}
    </div>
  )
}

function Summary({ summary, rows, c }: { summary: DecisionLogSummary; rows: DecisionLogRow[]; c: DecisionLogCopy }) {
  const coverage = summary.tradeGradeCoverage
  const record = outcomeRecord(rows)
  const gradedOutcomes = record.reduce((n, r) => n + r.count, 0)
  return (
    <section className="af-dl-summary" aria-label={c.summaryTitle} data-testid="decision-summary">
      <h2 className="af-dl-h2">{c.summaryTitle}</h2>
      <div className="af-dl-stats">
        <p className="af-dl-stat"><b className="af-num">{summary.total}</b><span>{c.summaryDecisions(summary.total)}</span></p>
        {coverage ? (
          <p className="af-dl-stat" data-testid="decision-summary-coverage">
            <b className="af-num">{coverage.graded}</b>
            <span>{c.summaryTradeGrades(coverage.graded, coverage.tradeDecisions)}</span>
          </p>
        ) : null}
        <p className="af-dl-stat"><b className="af-num">{gradedOutcomes}</b><span>{c.summaryOutcomes(gradedOutcomes)}</span></p>
      </div>
      {record.length > 0 ? (
        <div className="af-dl-record" data-testid="decision-outcome-record">
          <span className="af-dl-record-label">{c.summaryOutcomeRecord}</span>
          {record.map((r) => (
            <span key={r.grade} className="af-dl-record-chip"><b>{r.grade}</b> <span className="af-num">×{r.count}</span></span>
          ))}
        </div>
      ) : (
        <p className="af-dl-note">{c.summaryNoOutcomes}</p>
      )}
      {summary.followed + summary.ignored > 0 ? (
        <ul className="af-dl-rates">
          {summary.followed > 0 ? <li>{c.followedRecord(summary.followedWinRate)}</li> : null}
          {summary.ignored > 0 ? <li>{c.ignoredRecord(summary.ignoredWinRate)}</li> : null}
        </ul>
      ) : null}
      {coverage && coverage.tradeDecisions > coverage.graded ? <p className="af-dl-note">{c.summaryTradeGradesNote}</p> : null}
    </section>
  )
}

/** A load that never runs: the locked screen reads nothing. */
const NO_LOAD: DecisionLogLoader = () => new Promise(() => {})

export function DecisionLogScreen({
  leagueNames,
  initialLeagueId = null,
  load = loadDecisionLog,
  locked = false,
}: {
  leagueNames: Record<string, string>
  initialLeagueId?: string | null
  load?: DecisionLogLoader
  /** The server's paywall read said locked: draw the lock and fetch nothing. */
  locked?: boolean
}) {
  const { language } = useOptionalLanguage()
  const c = decisionLogCopy(language)
  const [leagueId, setLeagueId] = useState<string>(initialLeagueId ?? '')
  const [type, setType] = useState<string>('')
  const [state, setState] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'locked' } | { status: 'ready'; data: DecisionLogPayload }>(
    locked ? { status: 'locked' } : { status: 'loading' },
  )
  const read = locked ? NO_LOAD : load
  /** Every league the unfiltered list touched, so the league filter keeps its options while one is picked. */
  const [knownLeagues, setKnownLeagues] = useState<string[]>(initialLeagueId ? [initialLeagueId] : [])
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (locked) return
    let live = true
    setState({ status: 'loading' })
    read(leagueId || null).then((r) => {
      if (!live) return
      if (!r.ok) {
        setState({ status: r.locked ? 'locked' : 'error' })
        return
      }
      setState({ status: 'ready', data: r.data })
      setKnownLeagues((prev) => Array.from(new Set([...prev, ...r.data.decisions.map((d) => d.leagueId)])))
    })
    return () => {
      live = false
    }
  }, [leagueId, read, locked, attempt])

  const rows = state.status === 'ready' ? state.data.decisions : []
  const shown = useMemo(() => filterDecisions(rows, { type, leagueId: '' }), [rows, type])
  const types = useMemo(() => decisionTypesPresent(rows), [rows])
  const leagueName = useCallback((id: string) => leagueNames[id] ?? `${c.unknownLeague} ${id.slice(-4)}`, [leagueNames, c.unknownLeague])
  const leagueOptions = useMemo(
    () => [...knownLeagues].sort((a, b) => leagueName(a).localeCompare(leagueName(b))),
    [knownLeagues, leagueName],
  )

  return (
    <div className="af-dl" data-testid="decision-log-screen">
      <header className="af-dl-head">
        <h1 className="af-dl-title">{c.title}</h1>
        <p className="af-dl-sub">{c.sub}</p>
      </header>

      {state.status === 'locked' ? (
        <CoreDepthLock
          access={decideCoreDepth('decision_history', { live: true, startsAt: new Date(0), hasPlan: false })}
          lang={language}
          what={c.lockSubject}
          benefit={c.lockBenefit}
        />
      ) : (
        <>
          <div className="af-dl-filters" role="group">
            <label className="af-dl-filter">
              <span>{c.filterType}</span>
              <select value={type} onChange={(e) => setType(e.target.value)} data-testid="decision-filter-type">
                <option value="">{c.allTypes}</option>
                {(types.includes(type) || !type ? types : [...types, type]).map((t) => (
                  <option key={t} value={t}>{c.typeLabel(t)}</option>
                ))}
              </select>
            </label>
            <label className="af-dl-filter">
              <span>{c.filterLeague}</span>
              <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)} data-testid="decision-filter-league">
                <option value="">{c.allLeagues}</option>
                {leagueOptions.map((id) => (
                  <option key={id} value={id}>{leagueName(id)}</option>
                ))}
              </select>
            </label>
          </div>

          {state.status === 'loading' ? (
            <div className="af-dl-loading" role="status" aria-live="polite" data-testid="decision-log-loading">
              <span className="af-dl-skel" />
              <span className="af-dl-skel" />
              <span className="af-dl-skel" />
              <span className="af-dl-sr">{c.loading}</span>
            </div>
          ) : state.status === 'error' ? (
            <div className="af-dl-empty" role="alert" data-testid="decision-log-error">
              <p>{c.error}</p>
              <button type="button" className="af-dl-retry" onClick={() => setAttempt((n) => n + 1)}>{c.retry}</button>
            </div>
          ) : (
            <>
              {rows.length > 0 ? <Summary summary={state.data.summary} rows={rows} c={c} /> : null}
              {shown.length > 0 ? (
                <ol className="af-dl-list" data-testid="decision-list">
                  {shown.map((row) => {
                    const headline = decisionHeadline(row) ?? c.typeLabel(row.decisionType)
                    const detail = decisionDetail(row)
                    return (
                      <li key={row.id} className="af-dl-row" data-type={row.decisionType} data-testid="decision-row">
                        <p className="af-dl-meta">
                          <span className="af-dl-type">{c.typeLabel(row.decisionType)}</span>
                          <span className="af-num">{formatDay(row.createdAt, language)}</span>
                          <span className="af-dl-league">{leagueName(row.leagueId)}</span>
                        </p>
                        <p className="af-dl-headline">{headline}</p>
                        {detail ? <p className="af-dl-detail">{detail}</p> : null}
                        <GradePills row={row} c={c} />
                        <p className="af-dl-followed" data-followed={row.userFollowed === null ? 'pending' : String(row.userFollowed)}>
                          {row.userFollowed === true ? c.followed : row.userFollowed === false ? c.ignored : c.pendingChoice}
                        </p>
                      </li>
                    )
                  })}
                </ol>
              ) : (
                <div className="af-dl-empty" data-testid="decision-log-empty">
                  {rows.length === 0 && !leagueId ? (
                    <>
                      <p className="af-dl-empty-title">{c.emptyTitle}</p>
                      <p>{c.emptyBody}</p>
                    </>
                  ) : (
                    <p>{c.emptyFiltered}</p>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

export default DecisionLogScreen
