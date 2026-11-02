'use client'

import Link from 'next/link'
import { useEffect, useState, type ReactNode } from 'react'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'
import { splitDecisionQueue, TOP_DECISION_LIMIT } from '@/lib/core-app/decisionQueue'
import { usePersistentDisclosure } from '@/components/core-app/home/homeViewState'
import { useOptionalLanguage } from '@/components/i18n/LanguageProviderClient'
import { useMessages } from '@/components/i18n/useMessages'
import { decisionQueueMessages } from '@/lib/core-app/messages/decisionQueue'
import { scopeLabelText } from '@/lib/core-app/shellCopy'
import { issueText } from '@/lib/core-app/decisionQueueCopy'
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
 *
 * Spanish (2026-10-04): the rows are written on the server in English; each carries `parts`, and
 * `issueText` (lib/core-app/decisionQueueCopy.ts) rebuilds it in the reader's language here. The
 * provider starts at English on server and client alike, so the first paint agrees.
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

/**
 * The countdown block that leads each urgent row (2026-11-01 home redesign). The colour IS the
 * countdown, not the category: past or inside a day is urgent, inside three days is this week, later
 * is quiet — and an `info` row (a draft) keeps the accent whatever its date, because it is an event to
 * prepare for rather than a hole to fill. `figure` null means "now", which the caller says in the
 * reader's language.
 */
type ClockTone = 'now' | 'soon' | 'days' | 'later' | 'event'

const DAY_MS = 86_400_000

function clockOf(issue: CoreIssue, nowMs: number): { figure: string | null; tone: ClockTone } | null {
  if (!issue.deadline) return null
  const ms = new Date(issue.deadline).getTime() - nowMs
  if (Number.isNaN(ms)) return null
  const tone: ClockTone =
    issue.severity === 'info' ? 'event' : ms <= 0 ? 'now' : ms < DAY_MS ? 'soon' : ms < 3 * DAY_MS ? 'days' : 'later'
  if (ms <= 0) return { figure: null, tone }
  const mins = Math.floor(ms / 60000)
  if (mins < 60) return { figure: `${mins}M`, tone }
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return { figure: `${hrs}H`, tone }
  return { figure: `${Math.floor(hrs / 24)}D`, tone }
}

/**
 * "SUN 1:00 PM" under the countdown. ⚠ CLIENT ONLY: a weekday and a clock time are the reader's time
 * zone, which the server does not know, so this renders after hydration and the first paint carries
 * the relative figure alone — the same rule `deadlineLabel` follows with the server's clock.
 */
function clockWhen(deadline: Date | string, language: string): string | null {
  try {
    return new Intl.DateTimeFormat(language === 'es' ? 'es' : 'en-US', {
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
    })
      .format(new Date(deadline))
      .replace(/\./g, '')
      .toUpperCase()
  } catch {
    return null
  }
}

function ActionLink({
  action,
  label,
  severity,
}: {
  action: NonNullable<CoreIssue['action']>
  label: string
  severity: CoreIssue['severity']
}) {
  const t = useMessages(decisionQueueMessages)
  const className = `af3a-btn ${severity === 'info' ? '' : 'af3a-btn-accent'}`
  if (action.external) {
    return (
      <a className={className} href={action.href} target="_blank" rel="noopener noreferrer">
        {label}
        <span className="af-sr-only">{t.opensInNewTab}</span>
      </a>
    )
  }
  return (
    <Link className={className} href={action.href}>
      {label}
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
  noLeagues = false,
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
  /** The viewer has no leagues at all — an empty queue then means "nothing to read", not "all clear". */
  noLeagues?: boolean
}) {
  const [nowMs, setNowMs] = useState(() => Date.parse(nowIso))
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
    setNowMs(Date.now())
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])
  const [showAll, setShowAll] = usePersistentDisclosure('decisions', scopeKey)
  const { top, rest, total } = splitDecisionQueue(issues)
  const restId = 'af-decisions-rest'
  const { language } = useOptionalLanguage()
  const t = useMessages(decisionQueueMessages)
  const scopeText = scopeLabelText(scopeLabel, language)

  return (
    <section className="af3a-sec af-decisions" aria-labelledby="af-decisions-title">
      <header className="af3a-sechead">
        <h2 id="af-decisions-title">{t.title}</h2>
        {help}
        {total > 0 ? <span className="af3a-open">{t.openCount(total)}</span> : null}
        <span className="af3a-note">
          {t.mostUrgentFirst} · <b>{scopeText}</b>
        </span>
      </header>

      {total === 0 && noLeagues ? (
        /*
         * "Nothing is waiting on you" was true and useless to someone with no leagues — it read as
         * "all good" to a user we cannot see anything for. The connect card above says what to do.
         */
        <div className="af3a-card af3a-empty">
          <h3>{t.nothingToDecide}</h3>
          <p>{t.connectALeague}</p>
        </div>
      ) : total === 0 ? (
        <div className="af3a-card af3a-empty">
          <h3>{t.nothingWaiting}</h3>
          {/* The bold scope is `scopeText`, which is `scopeLabel` itself outside Spanish (scopeLabelText). */}
          <p>
            {t.emptyNone}
            {scopeLabel === 'All leagues' ? (
              t.emptyInAnyLeague
            ) : (
              <>
                {t.emptyInYour}
                <b>{scopeText}</b>
              </>
            )}
            {t.emptyWeCanRead}
          </p>
        </div>
      ) : (
        <>
          <ol
            className="af-decisions-top"
            aria-label={t.topUrgentLabel(Math.min(total, TOP_DECISION_LIMIT))}
          >
            {top.map((issue) => {
              const when = deadlineLabel(issue.deadline, nowMs)
              const text = issueText(issue, language)
              const clock = clockOf(issue, nowMs)
              const clockAt = clock && mounted && issue.deadline ? clockWhen(issue.deadline, language) : null
              const platform = issue.platform ? issue.platform.toLowerCase() : null
              return (
                <li
                  key={issue.id}
                  className={`af3a-urgent af-decision ${SEV_CLASS[issue.severity]}`}
                  data-tone={clock?.tone ?? (issue.severity === 'info' ? 'event' : issue.severity === 'bad' ? 'soon' : 'later')}
                >
                  {clock ? (
                    /* The meta line still says "IN 3D" for a screen reader; this is its visual form. */
                    <span className="af-decision-clock" aria-hidden="true">
                      <b>{clock.figure ?? t.now}</b>
                      {clockAt ? <span>{clockAt}</span> : null}
                    </span>
                  ) : (
                    <span className="af3a-glyph af-decision-clock" aria-hidden="true">
                      {issue.glyph}
                    </span>
                  )}
                  {platform ? (
                    /* The meta line names the platform in words; the tile is for scanning a list. */
                    <span className="af-decision-plat" data-platform={platform} aria-hidden="true">
                      {platform.slice(0, 2).toUpperCase()}
                    </span>
                  ) : null}
                  <div className="af3a-urgent-body">
                    <h3>
                      {text.title}
                      {issue.leagueName && !text.title.includes(issue.leagueName) ? (
                        <span className="af3a-dash"> — {issue.leagueName}</span>
                      ) : null}
                    </h3>
                    <p className="af-decision-meta">
                      {/* The trailing space: on a phone the chip runs inline and read "IN 6DSleeper ›". */}
                      {when ? (
                        <>
                          {/* Visually carried by the countdown block; still read aloud here. */}
                          <b className={`af3a-mono af-decision-when${clock ? ' af-sr-only' : ''}`}>
                            {when === 'now' ? t.now : t.inWhen(when)}
                          </b>{' '}
                        </>
                      ) : null}
                      {text.meta}
                    </p>
                  </div>
                  {issue.action ? (
                    <ActionLink action={issue.action} label={text.actionLabel ?? issue.action.label} severity={issue.severity} />
                  ) : null}
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
                {showAll ? t.showFewer : t.showMore(rest.length)}
              </button>
              <ol id={restId} className="af3a-card af3a-rows af-decisions-rest" hidden={!showAll} start={top.length + 1}>
                {rest.map((issue) => {
                  const title = issueText(issue, language).title
                  return (
                    <li key={issue.id} className="af3a-row">
                      <span className={`af3a-dot ${SEV_CLASS[issue.severity]}`} aria-hidden="true" />
                      <span className="af3a-row-title">
                        {issue.action ? (
                          issue.action.external ? (
                            <a href={issue.action.href} target="_blank" rel="noopener noreferrer">
                              {title}
                            </a>
                          ) : (
                            <Link href={issue.action.href}>{title}</Link>
                          )
                        ) : (
                          title
                        )}
                      </span>
                      <span className="af3a-row-league">{issue.leagueName ?? t.acrossYourLeagues}</span>
                      <span className="af3a-row-when af3a-mono">{deadlineLabel(issue.deadline, nowMs) ?? '—'}</span>
                    </li>
                  )
                })}
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
