'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import { splitDecisionQueue, TOP_DECISION_LIMIT } from '@/lib/core-app/decisionQueue'
import { usePersistentDisclosure } from '@/components/core-app/home/homeViewState'
import '@/components/core-app/af-dash-3a.css'
import '@/components/core-app/home/af-core-home.css'

/**
 * The top of the /core home: the five most urgent decisions across the leagues in view.
 *
 * It replaced "Outstanding issues", which sat below the weekly routine and five bands and showed
 * three large rows, five small ones, and a "See all N" link that pointed at the page it was already
 * on. The rows are the same (`mergeDash34Issues` → `rankDecisions`); what changed is that the most
 * urgent five come first on the page, the rest wait behind one control that remembers it was
 * opened, and the card says which leagues it covers and how old its data is.
 *
 * ⚠ EVERY ROW IS A DECISION WITH SOMEWHERE TO GO, OR IT SAYS WHY NOT. Rows whose action leaves
 * AllFantasy open the provider in a new tab — this product is read-only, so the change happens
 * there.
 */

const SEV_CLASS: Record<CoreIssue['severity'], string> = {
  bad: 'af3a-bad',
  warn: 'af3a-warn',
  info: 'af3a-accent',
}

/** "in 1h 04m" / "in 3D" / "now". Relative while close; the server's clock until hydration. */
function deadlineLabel(deadline: Date | string | null, nowMs: number): string | null {
  if (!deadline) return null
  const ms = new Date(deadline).getTime() - nowMs
  if (Number.isNaN(ms)) return null
  if (ms <= 0) return 'now'
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ${String(mins % 60).padStart(2, '0')}m`
  return `${Math.floor(hrs / 24)}D`
}

function ActionLink({ action, severity }: { action: NonNullable<CoreIssue['action']>; severity: CoreIssue['severity'] }) {
  const className = `af3a-btn ${severity === 'info' ? '' : 'af3a-btn-accent'}`
  if (action.external) {
    return (
      <a className={className} href={action.href} target="_blank" rel="noopener noreferrer">
        {action.label}
        <span className="af-sr-only"> (opens the league&rsquo;s platform in a new tab)</span>
      </a>
    )
  }
  return (
    <Link className={className} href={action.href}>
      {action.label}
    </Link>
  )
}

export function DecisionQueue({
  issues,
  scopeLabel,
  scopeKey,
  nowIso,
  help,
  freshness,
  children,
}: {
  issues: CoreIssue[]
  /** "All leagues", "NFL leagues"… — the queue always says what it covers. */
  scopeLabel: string
  /** Separates the remembered "show all" per scope. */
  scopeKey: string
  /** The server's clock, so deadlines render identically on both sides of hydration. */
  nowIso: string
  help?: ReactNode
  freshness?: ReactNode
  /** Non-visual companions (the prewarm), rendered inside the section so they stream with it. */
  children?: ReactNode
}) {
  const [nowMs, setNowMs] = useState(() => Date.parse(nowIso))
  useEffect(() => {
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const [showAll, setShowAll] = usePersistentDisclosure('decisions', scopeKey)
  const { top, rest, total } = splitDecisionQueue(issues)
  const restId = 'af-decisions-rest'

  return (
    <section className="af3a-sec af-decisions" aria-labelledby="af-decisions-title">
      <header className="af3a-sechead">
        <h2 id="af-decisions-title">Top decisions</h2>
        {help}
        {total > 0 ? <span className="af3a-open">{total} OPEN</span> : null}
        <span className="af3a-note">
          Most urgent first · <b>{scopeLabel}</b>
        </span>
      </header>

      {total === 0 ? (
        <div className="af3a-card af3a-empty">
          <h3>Nothing is waiting on you.</h3>
          <p>No empty slots, injured starters, drafts or stale leagues in {scopeLabel.toLowerCase()} we can read.</p>
        </div>
      ) : (
        <>
          <ol className="af-decisions-top" aria-label={`The ${Math.min(total, TOP_DECISION_LIMIT)} most urgent`}>
            {top.map((issue) => {
              const when = deadlineLabel(issue.deadline, nowMs)
              return (
                <li key={issue.id} className={`af3a-urgent af-decision ${SEV_CLASS[issue.severity]}`}>
                  <span className="af3a-glyph" aria-hidden="true">
                    {issue.glyph}
                  </span>
                  <div className="af3a-urgent-body">
                    <h3>
                      {issue.title}
                      {issue.leagueName && !issue.title.includes(issue.leagueName) ? (
                        <span className="af3a-dash"> — {issue.leagueName}</span>
                      ) : null}
                    </h3>
                    <p className="af-decision-meta">
                      {when ? <b className="af3a-mono af-decision-when">{when === 'now' ? 'NOW' : `IN ${when}`}</b> : null}
                      {issue.meta}
                    </p>
                  </div>
                  {issue.action ? <ActionLink action={issue.action} severity={issue.severity} /> : null}
                </li>
              )
            })}
          </ol>

          {rest.length > 0 ? (
            <>
              <button
                type="button"
                className="af-decisions-toggle"
                aria-expanded={showAll}
                aria-controls={restId}
                onClick={() => setShowAll(!showAll)}
              >
                {showAll ? 'Show fewer' : `Show ${rest.length} more`}
              </button>
              <ol id={restId} className="af3a-card af3a-rows af-decisions-rest" hidden={!showAll} start={top.length + 1}>
                {rest.map((issue) => (
                  <li key={issue.id} className="af3a-row">
                    <span className={`af3a-dot ${SEV_CLASS[issue.severity]}`} aria-hidden="true" />
                    <span className="af3a-row-title">
                      {issue.action ? (
                        issue.action.external ? (
                          <a href={issue.action.href} target="_blank" rel="noopener noreferrer">
                            {issue.title}
                          </a>
                        ) : (
                          <Link href={issue.action.href}>{issue.title}</Link>
                        )
                      ) : (
                        issue.title
                      )}
                    </span>
                    <span className="af3a-row-league">{issue.leagueName ?? 'Across your leagues'}</span>
                    <span className="af3a-row-when af3a-mono">{deadlineLabel(issue.deadline, nowMs) ?? '—'}</span>
                  </li>
                ))}
              </ol>
            </>
          ) : null}
        </>
      )}
      {freshness}
      {children}
    </section>
  )
}

export default DecisionQueue
