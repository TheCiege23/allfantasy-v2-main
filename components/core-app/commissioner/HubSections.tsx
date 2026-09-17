import Link from 'next/link'
import type { ReactNode } from 'react'
import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'
import type { TaskCard } from '@/lib/core-app/commissioner/tasks'
import type { HealthFlag } from '@/lib/core-app/commissioner/health'
import type { CalendarEvent } from '@/lib/core-app/commissioner/calendar'
import type { HubChart } from '@/lib/core-app/commissioner/charts'
import type { HubLink } from '@/lib/core-app/commissioner/areas'
import { CalendarExportButton } from './CalendarExportButton'

/**
 * The Commissioner Hub's server-rendered sections. No client state lives here;
 * the three interactive pieces (workflows, recipes, calendar export) are their
 * own client islands.
 */

export function HubAnchor({ link, className }: { link: HubLink; className?: string }) {
  if (link.external) {
    return (
      <a className={className} href={link.href} target="_blank" rel="noopener noreferrer">
        {link.label} ↗
      </a>
    )
  }
  if (link.href.startsWith('#')) {
    return (
      <a className={className} href={link.href}>
        {link.label}
      </a>
    )
  }
  return (
    <Link className={className} href={link.href}>
      {link.label}
    </Link>
  )
}

export function HubSection({
  id,
  title,
  note,
  children,
  className,
}: {
  id: string
  title: string
  note?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={`af-card af-ch-section${className ? ` ${className}` : ''}`} aria-labelledby={`${id}-h`}>
      <header className="af-ch-section-head">
        <h2 id={`${id}-h`} className="af-label">
          {title}
        </h2>
        {note != null ? <span className="af-ch-section-note">{note}</span> : null}
      </header>
      {children}
    </section>
  )
}

const NAV: Array<{ id: string; label: string }> = [
  { id: 'ch-tasks', label: 'Tasks' },
  { id: 'ch-health', label: 'Health' },
  { id: 'ch-calendar', label: 'Calendar' },
  { id: 'ch-workflows', label: 'Guides' },
  { id: 'ch-areas', label: 'League areas' },
  { id: 'ch-reports', label: 'Charts' },
  { id: 'ch-recipes', label: 'Automations' },
  { id: 'ch-communities', label: 'Connections' },
  { id: 'ch-timeline', label: 'Audit log' },
]

/** In-page jump links. The hub is long on purpose; nothing on it should be hard to reach. */
export function HubNav() {
  return (
    <nav className="af-ch-nav" aria-label="Commissioner hub sections">
      {NAV.map((n) => (
        <a key={n.id} href={`#${n.id}`} className="af-ch-nav-chip">
          {n.label}
        </a>
      ))}
    </nav>
  )
}

// ── Task cards (items 1, 10) ────────────────────────────────────────────────

const SEVERITY_GLYPH: Record<TaskCard['severity'], string> = { bad: '!', warn: '◆', info: '◷' }
const SOURCE_LABEL: Record<TaskCard['source'], string> = {
  issue: 'League',
  health: 'Health',
  deadline: 'Deadline',
  workspace: 'Check-up',
  review: 'Review',
}

function TaskCardView({ card }: { card: TaskCard }) {
  return (
    <li className="af-ch-task" data-severity={card.severity}>
      <div className="af-ch-task-top">
        <span className="af-ch-task-mark" aria-hidden>
          {SEVERITY_GLYPH[card.severity]}
        </span>
        <span className="af-label af-ch-task-source">{SOURCE_LABEL[card.source]}</span>
        {card.due ? <span className="af-ch-task-due af-num">{card.due}</span> : null}
      </div>
      <p className="af-ch-task-title">{card.title}</p>
      <p className="af-ch-task-detail">{card.detail}</p>
      {card.action ? <HubAnchor link={card.action} className="af-btn af-ch-task-action" /> : null}
    </li>
  )
}

export function TaskCards({ data }: { data: CommissionerHubData }) {
  const { cards, overflow } = data.tasks
  return (
    <HubSection
      id="ch-tasks"
      title="Needs you now"
      note={cards.length > 0 ? 'Most urgent first' : 'Nothing outstanding'}
      className="af-ch-tasks-section"
    >
      {cards.length > 0 ? (
        <ul className="af-ch-tasks">
          {cards.map((c) => (
            <TaskCardView key={c.id} card={c} />
          ))}
        </ul>
      ) : (
        <div className="af-ch-empty">
          <span className="af-ch-empty-mark af-num" aria-hidden>
            —
          </span>
          <p>{data.tasksEmptyReason}</p>
        </div>
      )}
      {overflow.length > 0 ? (
        <details className="af-ch-more">
          <summary>
            {overflow.length} more {overflow.length === 1 ? 'task' : 'tasks'}
          </summary>
          <ul className="af-ch-tasks">
            {overflow.map((c) => (
              <TaskCardView key={c.id} card={c} />
            ))}
          </ul>
        </details>
      ) : null}
    </HubSection>
  )
}

// ── Health flags (item 7) ───────────────────────────────────────────────────

function FlagRow({ flag }: { flag: HealthFlag }) {
  if (!flag.measured) {
    return (
      <li className="af-ch-flag" data-state="unmeasured">
        <span className="af-ch-flag-dot" aria-hidden />
        <div className="af-ch-flag-body">
          <p className="af-ch-flag-label">
            {flag.label} <span className="af-ch-flag-tag">Not measured</span>
          </p>
          <p className="af-ch-flag-detail">{flag.reason}</p>
        </div>
        {flag.action ? <HubAnchor link={flag.action} className="af-btn af-ch-flag-action" /> : null}
      </li>
    )
  }
  return (
    <li className="af-ch-flag" data-state={flag.severity}>
      <span className="af-ch-flag-dot" aria-hidden />
      <div className="af-ch-flag-body">
        <p className="af-ch-flag-label">
          {flag.label} <span className="af-ch-flag-count af-num">{flag.count}</span>
        </p>
        <p className="af-ch-flag-headline">{flag.headline}</p>
        <p className="af-ch-flag-detail">{flag.detail}</p>
      </div>
      {flag.action ? <HubAnchor link={flag.action} className="af-btn af-ch-flag-action" /> : null}
    </li>
  )
}

export function HealthPanel({ data }: { data: CommissionerHubData }) {
  const { score, flags } = data.health
  const measured = flags.filter((f) => f.measured).length
  return (
    <HubSection id="ch-health" title="League health" note={`${measured} of ${flags.length} checks measured`}>
      <div className="af-ch-health-score" data-available={score.available}>
        {score.available ? (
          <>
            <span className="af-ch-health-num af-num">{Math.round(score.data.score)}</span>
            <div>
              <p className="af-ch-health-status">{score.data.summary}</p>
              <p className="af-ch-health-note">
                AllFantasy’s league health score · {Math.round(score.data.confidencePct)}% confidence.
              </p>
            </div>
          </>
        ) : (
          <>
            <span className="af-ch-health-num af-num">—</span>
            <p className="af-ch-health-note">{score.reason}</p>
          </>
        )}
      </div>
      <ul className="af-ch-flags">
        {flags.map((f) => (
          <FlagRow key={f.key} flag={f} />
        ))}
      </ul>
    </HubSection>
  )
}

// ── Member activity (item 1) ────────────────────────────────────────────────

const STATUS_LABEL = { active: 'Active', at_risk: 'Slowing down', inactive: 'Inactive', unknown: 'Can’t tell' } as const

export function MemberActivity({ data }: { data: CommissionerHubData }) {
  const m = data.members
  return (
    <HubSection
      id="ch-members"
      title="Member activity"
      note={m.available ? `${m.data.active} of ${m.data.total} active` : undefined}
    >
      {m.available ? (
        <>
          <ul className="af-ch-members">
            {m.data.rows.slice(0, 8).map((r, i) => (
              <li key={`${r.name}-${i}`} data-status={r.status}>
                <span className="af-ch-member-name">{r.name}</span>
                <span className="af-ch-member-when">{r.detail}</span>
                <span className="af-ch-member-status af-label" data-status={r.status}>
                  {STATUS_LABEL[r.status]}
                </span>
              </li>
            ))}
          </ul>
          <p className="af-ch-muted">
            Judged by {m.data.basis}.
            {m.data.rows.length > 8 ? ` Showing the 8 managers most in need of attention, of ${m.data.rows.length}.` : ''}
          </p>
        </>
      ) : (
        <p className="af-ch-muted">{m.reason}</p>
      )}
    </HubSection>
  )
}

// ── Calendar (item 3) ───────────────────────────────────────────────────────

const KIND_GLYPH: Record<CalendarEvent['kind'], string> = {
  draft: '◎',
  waivers: '◷',
  trade_deadline: '⇄',
  playoffs: '★',
  dues: '$',
  vote: '✓',
  renewal: '↻',
}

const STATUS_WORD: Record<CalendarEvent['status'], string> = {
  soon: 'This week',
  upcoming: 'Coming up',
  unscheduled: 'No date',
  past: 'Passed',
}

export function HubCalendar({ data }: { data: CommissionerHubData }) {
  const { events, gaps, ics } = data.calendar
  return (
    <HubSection
      id="ch-calendar"
      title="League calendar"
      note={ics ? <CalendarExportButton ics={ics} leagueName={data.league.name} /> : undefined}
    >
      {events.length > 0 ? (
        <ol className="af-ch-cal">
          {events.map((e) => (
            <li key={e.id} data-status={e.status}>
              <span className="af-ch-cal-mark" aria-hidden>
                {KIND_GLYPH[e.kind]}
              </span>
              <div className="af-ch-cal-body">
                <p className="af-ch-cal-title">{e.title}</p>
                <p className="af-ch-cal-detail">{e.detail}</p>
              </div>
              <div className="af-ch-cal-when">
                <span className="af-num">{e.whenLabel}</span>
                <span className="af-label">{STATUS_WORD[e.status]}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="af-ch-muted">Nothing on this league’s calendar has a date or a week yet.</p>
      )}
      {gaps.length > 0 ? (
        <div className="af-ch-gaps">
          <span className="af-label">Not on the calendar</span>
          <ul>
            {gaps.map((g) => (
              <li key={g}>{g}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </HubSection>
  )
}

// ── League areas (item 2) ───────────────────────────────────────────────────

export function LeagueAreas({ data }: { data: CommissionerHubData }) {
  return (
    <HubSection
      id="ch-areas"
      title="Every part of the league"
      note={data.league.native ? 'Runs on AllFantasy' : `Imported · changes are made on the platform`}
    >
      <ul className="af-ch-areas">
        {data.areas.map((a) => (
          <li key={a.key}>
            <p className="af-ch-area-label">{a.label}</p>
            <p className="af-ch-area-desc">{a.description}</p>
            {a.note ? <p className="af-ch-area-note">{a.note}</p> : null}
            <div className="af-ch-area-links">
              <HubAnchor link={a.link} className="af-ch-area-link" />
              {a.changeOn ? <HubAnchor link={a.changeOn} className="af-ch-area-link" /> : null}
            </div>
          </li>
        ))}
      </ul>
    </HubSection>
  )
}

// ── Charts (item 5) ─────────────────────────────────────────────────────────

/**
 * Horizontal bars, server-rendered, no chart library.
 *
 * Horizontal because most of these charts are labelled by team name, which does
 * not fit under a vertical bar at phone width, and uncapped because a 12-team
 * league has 12 teams — the shared WorkbookBarChart stops at ten.
 */
export function HubBars({ chart, footer }: { chart: HubChart; footer?: ReactNode }) {
  const max = Math.max(1, ...chart.bars.map((b) => Math.max(0, b.value)))
  return (
    <figure className="af-ch-chart" data-chart={chart.key}>
      <figcaption>
        <b>{chart.title}</b>
        <small>{chart.subtitle}</small>
      </figcaption>
      <ol
        className="af-ch-bars"
        aria-label={`${chart.title}. ${chart.bars.map((b) => `${b.label}: ${b.display}`).join('; ')}`}
      >
        {chart.bars.map((b, i) => (
          <li key={`${b.label}-${i}`}>
            <span className="af-ch-bar-label" title={b.label}>
              {b.label}
            </span>
            <span className="af-ch-bar-track" aria-hidden>
              <span
                className="af-ch-bar-fill"
                data-tone={b.tone ?? 'accent'}
                style={{ width: `${b.value > 0 ? Math.max(3, (b.value / max) * 100) : 0}%` }}
              />
            </span>
            <span className="af-ch-bar-value af-num">{b.display}</span>
          </li>
        ))}
      </ol>
      {chart.takeaway ? <p className="af-ch-chart-takeaway">{chart.takeaway}</p> : null}
      {footer}
    </figure>
  )
}

// ── External communities (item 9) ───────────────────────────────────────────

const CHANNEL_STATUS: Record<'connected' | 'available' | 'unavailable', string> = {
  connected: 'Connected',
  available: 'Available',
  unavailable: 'Not available',
}

export function CommunityLinks({ data, announce }: { data: CommissionerHubData; announce?: ReactNode }) {
  return (
    <HubSection id="ch-communities" title="Connections">
      <ul className="af-ch-channels">
        {data.communities.map((c) => (
          <li key={c.key} data-status={c.status}>
            <div className="af-ch-channel-head">
              <p className="af-ch-channel-label">{c.label}</p>
              <span className="af-label af-ch-channel-status" data-status={c.status}>
                {CHANNEL_STATUS[c.status]}
              </span>
            </div>
            <p className="af-ch-channel-detail">{c.detail}</p>
            <div className="af-ch-channel-actions">
              {c.key === 'calendar' && data.calendar.ics ? (
                <CalendarExportButton ics={data.calendar.ics} leagueName={data.league.name} />
              ) : null}
              {c.key === 'announcements' ? announce : null}
              {c.link ? <HubAnchor link={c.link} className="af-btn af-ch-channel-action" /> : null}
            </div>
          </li>
        ))}
      </ul>
    </HubSection>
  )
}
