'use client'

/**
 * 11a — the cross-league attention queue.
 *
 * ⚠ ONE RANKED LIST ACROSS EVERY LEAGUE, NEVER GROUPED BY LEAGUE. Build rule 1,
 * and the single most important decision on this screen. A commissioner running
 * three leagues does not want three lists; they want to know what to do next.
 * Severity decides that, not ownership — so `rankQueue` sorts on severity first
 * and the league name lives in the row's own copy. Grouping this by league is
 * how the abandoned team in league three ends up below a cosmetic setting task
 * in league one.
 *
 * ⚠ EVERY ROW CARRIES THE BUTTON THAT FIXES IT. Build rule 2 — Open / Review /
 * Resolve / Set up / Message / Re-sync, never a generic "View". A queue whose
 * rows all say "View" is a list of notifications, and the difference between a
 * notification list and an operations queue is exactly this.
 *
 * ⚠ A FAILED SYNC IS ITS OWN KIND OF ROW. `severity: 'unavailable'` renders
 * dashed, tag-less and tone-less. It is a data problem, not a league problem,
 * and the two must not look alike: an amber "this league is unhealthy" and an
 * amber "we could not read this league" lead to completely different actions.
 */

import Link from 'next/link'

export type QueueSeverity = 'critical' | 'high' | 'medium' | 'low' | 'unavailable'

export type AttentionItem = {
  key: string
  severity: QueueSeverity
  icon: string
  title: string
  desc: string
  actionLabel: string
  href?: string
  onAction?: () => void
}

const RANK: Record<QueueSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  /*
   * Last, deliberately. An unreadable league is important but it is not urgent
   * in the way an abandoned team is, and floating it to the top would push real
   * problems below a plumbing failure.
   */
  unavailable: 4,
}

export function rankQueue(items: AttentionItem[]): AttentionItem[] {
  return [...items].sort((a, b) => RANK[a.severity] - RANK[b.severity])
}

export function AttentionQueue({ items }: { items: AttentionItem[] }) {
  const ranked = rankQueue(items)

  if (ranked.length === 0) {
    return (
      <p className="af-cm-empty">
        Nothing needs you right now. Abandoned teams, lopsided trades, unresolved disputes and failed syncs all surface
        here, ranked by severity.
      </p>
    )
  }

  return (
    <ul className="af-cm-queue" data-testid="attention-queue">
      {ranked.map((item) => (
        <li key={item.key} className="af-cm-qrow" data-sev={item.severity}>
          <span className="af-cm-qicon" aria-hidden>
            {item.icon}
          </span>
          <span className="af-cm-qtext">
            <span className="af-cm-qtitle">
              {item.title}
              {/* No tag on an unavailable row — it has no severity to report. */}
              {item.severity !== 'unavailable' ? (
                <span className="af-cm-sev af-num" data-sev={item.severity}>
                  {item.severity}
                </span>
              ) : null}
            </span>
            <span className="af-cm-qdesc">{item.desc}</span>
          </span>
          {item.href ? (
            <Link className="af-btn af-btn--ghost" href={item.href}>
              {item.actionLabel}
            </Link>
          ) : (
            <button type="button" className="af-btn af-btn--ghost" onClick={item.onAction}>
              {item.actionLabel}
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

export default AttentionQueue
