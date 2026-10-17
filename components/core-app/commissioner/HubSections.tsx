import Link from 'next/link'
import type { ReactNode } from 'react'
import type { CommissionerHubData } from '@/lib/core-app/commissionerHub'
import type { TaskCard } from '@/lib/core-app/commissioner/tasks'
import type { HealthFlag } from '@/lib/core-app/commissioner/health'
import type { CalendarEvent } from '@/lib/core-app/commissioner/calendar'
import type { HubChart } from '@/lib/core-app/commissioner/charts'
import type { HubLink } from '@/lib/core-app/commissioner/areas'
import { CalendarExportButton } from './CalendarExportButton'
import { MemberActivityList } from './MemberActivityList'
import { hubCopy } from '@/lib/core-app/commissionerHubCopy'

/**
 * The Commissioner Hub's server-rendered sections. No client state lives here;
 * the three interactive pieces (workflows, recipes, calendar export) are their
 * own client islands.
 */

export function HubAnchor({ link, className, language = 'en' }: { link: HubLink; className?: string; language?: string }) {
  const label = hubCopy(link.label, language)
  if (link.external) {
    return (
      <a className={className} href={link.href} target="_blank" rel="noopener noreferrer">
        {label} ↗
      </a>
    )
  }
  if (link.href.startsWith('#')) {
    return (
      <a className={className} href={link.href}>
        {label}
      </a>
    )
  }
  return (
    <Link className={className} href={link.href}>
      {label}
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
  { id: 'ch-intelligence', label: 'Intelligence' },
  { id: 'ch-format-ops', label: 'Format operations' },
  { id: 'ch-history', label: 'Trades & drafts' },
  { id: 'ch-health', label: 'Health' },
  { id: 'ch-calendar', label: 'Calendar' },
  { id: 'ch-workflows', label: 'Guides' },
  { id: 'ch-areas', label: 'League areas' },
  { id: 'ch-lineups', label: 'Lineups' },
  { id: 'ch-reports', label: 'Charts' },
  { id: 'ch-recipes', label: 'Automations' },
  { id: 'ch-communities', label: 'Connections' },
  { id: 'ch-timeline', label: 'Audit log' },
]

/** In-page jump links. The hub is long on purpose; nothing on it should be hard to reach. */
export function HubNav({ omit = [], language = 'en' }: { omit?: string[]; language?: string } = {}) {
  return (
    <nav className="af-ch-nav" aria-label={hubCopy('Commissioner hub sections', language)}>
      {NAV.filter((n) => !omit.includes(n.id)).map((n) => (
        <a key={n.id} href={`#${n.id}`} className="af-ch-nav-chip">
          {hubCopy(n.label, language)}
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

function TaskCardView({ card, language }: { card: TaskCard; language: string }) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  return (
    <li className="af-ch-task" data-severity={card.severity}>
      <div className="af-ch-task-top">
        <span className="af-ch-task-mark" aria-hidden>
          {SEVERITY_GLYPH[card.severity]}
        </span>
        <span className="af-label af-ch-task-source">{t(SOURCE_LABEL[card.source])}</span>
        {card.due ? <span className="af-ch-task-due af-num">{t(card.due)}</span> : null}
      </div>
      <p className="af-ch-task-title">{t(card.title)}</p>
      <p className="af-ch-task-detail">{t(card.detail)}</p>
      {card.action ? <HubAnchor link={card.action} className="af-btn af-ch-task-action" language={language} /> : null}
    </li>
  )
}

/**
 * How many task cards a phone shows before "N more". Measured on a 12-team fixture at 375px:
 * nine cards were 1,309px — the section bar and everything after it sat 2½ screens down.
 */
const PHONE_VISIBLE_TASKS = 3

export function TaskCards({ data, language = 'en' }: { data: CommissionerHubData; language?: string }) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const { cards, overflow } = data.tasks
  /*
   * ⚠ CARDS 4–6 ARE RENDERED TWICE, ONE COPY PER WIDTH. Desktop keeps them in the grid; a phone
   * shows them inside the "more" disclosure instead. A server component cannot move nodes by
   * viewport, and CSS cannot put a node into a <details>. Each copy is display:none at the
   * other width, which also takes it out of the accessibility tree — a reader meets each card
   * once.
   */
  const first = cards.slice(0, PHONE_VISIBLE_TASKS)
  const rest = cards.slice(PHONE_VISIBLE_TASKS)
  return (
    <HubSection
      id="ch-tasks"
      title={t('Needs you now')}
      note={cards.length > 0 ? t('Most urgent first') : t('Nothing outstanding')}
      className="af-ch-tasks-section"
    >
      {cards.length > 0 ? (
        <>
          <ul className="af-ch-tasks">
            {first.map((c) => (
              <TaskCardView key={c.id} card={c} language={language} />
            ))}
          </ul>
          {rest.length > 0 ? (
            <ul className="af-ch-tasks af-ch-tasks--wide-only">
              {rest.map((c) => (
                <TaskCardView key={c.id} card={c} language={language} />
              ))}
            </ul>
          ) : null}
        </>
      ) : (
        <div className="af-ch-empty">
          <span className="af-ch-empty-mark af-num" aria-hidden>
            —
          </span>
          <p>{t(data.tasksEmptyReason)}</p>
        </div>
      )}
      {overflow.length > 0 || rest.length > 0 ? (
        <details className="af-ch-more" data-wide-empty={overflow.length === 0 ? 'true' : undefined}>
          <summary>
            <span className="af-ch-more-wide">
              {t(overflow.length === 1 ? '1 more task' : `${overflow.length} more tasks`)}
            </span>
            <span className="af-ch-more-phone">
              {t(overflow.length + rest.length === 1 ? '1 more task' : `${overflow.length + rest.length} more tasks`)}
            </span>
          </summary>
          {rest.length > 0 ? (
            <ul className="af-ch-tasks af-ch-tasks--phone-only">
              {rest.map((c) => (
                <TaskCardView key={c.id} card={c} language={language} />
              ))}
            </ul>
          ) : null}
          {overflow.length > 0 ? (
            <ul className="af-ch-tasks">
              {overflow.map((c) => (
                <TaskCardView key={c.id} card={c} language={language} />
              ))}
            </ul>
          ) : null}
        </details>
      ) : null}
    </HubSection>
  )
}

// ── Health flags (item 7) ───────────────────────────────────────────────────

function FlagRow({ flag, language }: { flag: HealthFlag; language: string }) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  if (!flag.measured) {
    return (
      <li className="af-ch-flag" data-state="unmeasured">
        <span className="af-ch-flag-dot" aria-hidden />
        <div className="af-ch-flag-body">
          <p className="af-ch-flag-label">
            {t(flag.label)} <span className="af-ch-flag-tag">{t('Not measured')}</span>
          </p>
          <p className="af-ch-flag-detail">{t(flag.reason)}</p>
        </div>
        {flag.action ? <HubAnchor link={flag.action} className="af-btn af-ch-flag-action" language={language} /> : null}
      </li>
    )
  }
  return (
    <li className="af-ch-flag" data-state={flag.severity}>
      <span className="af-ch-flag-dot" aria-hidden />
      <div className="af-ch-flag-body">
        <p className="af-ch-flag-label">
          {t(flag.label)} <span className="af-ch-flag-count af-num">{flag.count}</span>
        </p>
        <p className="af-ch-flag-headline">{t(flag.headline)}</p>
        <p className="af-ch-flag-detail">{t(flag.detail)}</p>
      </div>
      {flag.action ? <HubAnchor link={flag.action} className="af-btn af-ch-flag-action" language={language} /> : null}
    </li>
  )
}

export function HealthPanel({ data, language = 'en' }: { data: CommissionerHubData; language?: string }) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const { score, flags } = data.health
  const measured = flags.filter((f) => f.measured).length
  return (
    <HubSection id="ch-health" title={t('League health')} note={t(`${measured} of ${flags.length} checks measured`)}>
      <div className="af-ch-health-score" data-available={score.available}>
        {score.available ? (
          <>
            <span className="af-ch-health-num af-num">{Math.round(score.data.score)}</span>
            <div>
              <p className="af-ch-health-status">{t(score.data.summary)}</p>
              <p className="af-ch-health-note">
                {t(`AllFantasy’s league health score · ${Math.round(score.data.confidencePct)}% confidence.`)}
              </p>
            </div>
          </>
        ) : (
          <>
            <span className="af-ch-health-num af-num">—</span>
            <p className="af-ch-health-note">{t(score.reason)}</p>
          </>
        )}
      </div>
      <ul className="af-ch-flags">
        {flags.map((f) => (
          <FlagRow key={f.key} flag={f} language={language} />
        ))}
      </ul>
    </HubSection>
  )
}

// ── Member activity (item 1) ────────────────────────────────────────────────

export function MemberActivity({ data, language = 'en' }: { data: CommissionerHubData; language?: string }) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const m = data.members
  return (
    <HubSection
      id="ch-members"
      title={t('Member activity')}
      note={m.available ? t(`${m.data.active} of ${m.data.total} active`) : undefined}
    >
      {m.available ? (
        <>
          <MemberActivityList rows={m.data.rows} />
          <p className="af-ch-muted">
            {t(`Judged by ${m.data.basis}.`)}
          </p>
        </>
      ) : (
        <p className="af-ch-muted">{t(m.reason)}</p>
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

export function HubCalendar({ data, language = 'en' }: { data: CommissionerHubData; language?: string }) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const { events, gaps, ics } = data.calendar
  return (
    <HubSection
      id="ch-calendar"
      title={t('League calendar')}
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
                <p className="af-ch-cal-title">{t(e.title)}</p>
                <p className="af-ch-cal-detail">{t(e.detail)}</p>
              </div>
              <div className="af-ch-cal-when">
                <span className="af-num">{t(e.whenLabel)}</span>
                <span className="af-label">{t(STATUS_WORD[e.status])}</span>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="af-ch-muted">{t('Nothing on this league’s calendar has a date or a week yet.')}</p>
      )}
      {gaps.length > 0 ? (
        <div className="af-ch-gaps">
          <span className="af-label">{t('Not on the calendar')}</span>
          <ul>
            {gaps.map((g) => (
              <li key={g}>{t(g)}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </HubSection>
  )
}

// ── League areas (item 2) ───────────────────────────────────────────────────

export function LeagueAreas({ data, language = 'en' }: { data: CommissionerHubData; language?: string }) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  return (
    <HubSection
      id="ch-areas"
      title={t('Every part of the league')}
      note={data.league.native ? t('Runs on AllFantasy') : t('Imported · changes are made on the platform')}
    >
      <ul className="af-ch-areas">
        {data.areas.map((a) => (
          <li key={a.key}>
            <p className="af-ch-area-label">{t(a.label)}</p>
            <p className="af-ch-area-desc">{t(a.description)}</p>
            {a.note ? <p className="af-ch-area-note">{t(a.note)}</p> : null}
            <div className="af-ch-area-links">
              <HubAnchor link={a.link} className="af-ch-area-link" language={language} />
              {a.changeOn ? <HubAnchor link={a.changeOn} className="af-ch-area-link" language={language} /> : null}
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
export function HubBars({ chart, footer, language = 'en' }: { chart: HubChart; footer?: ReactNode; language?: string }) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  const max = Math.max(1, ...chart.bars.map((b) => Math.max(0, b.value)))
  return (
    <figure className="af-ch-chart" data-chart={chart.key}>
      <figcaption>
        <b>{t(chart.title)}</b>
        <small>{t(chart.subtitle)}</small>
      </figcaption>
      <ol
        className="af-ch-bars"
        aria-label={`${t(chart.title)}. ${chart.bars.map((b) => `${b.label}: ${b.display}`).join('; ')}`}
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
      {chart.takeaway ? <p className="af-ch-chart-takeaway">{t(chart.takeaway)}</p> : null}
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

export function CommunityLinks({
  data,
  announce,
  language = 'en',
}: {
  data: CommissionerHubData
  announce?: ReactNode
  language?: string
}) {
  const t = (english: string | null | undefined) => hubCopy(english, language)
  return (
    <HubSection id="ch-communities" title={t('Connections')}>
      <ul className="af-ch-channels">
        {data.communities.map((c) => (
          <li key={c.key} data-status={c.status}>
            <div className="af-ch-channel-head">
              <p className="af-ch-channel-label">{t(c.label)}</p>
              <span className="af-label af-ch-channel-status" data-status={c.status}>
                {t(CHANNEL_STATUS[c.status])}
              </span>
            </div>
            <p className="af-ch-channel-detail">{t(c.detail)}</p>
            <div className="af-ch-channel-actions">
              {c.key === 'calendar' && data.calendar.ics ? (
                <CalendarExportButton ics={data.calendar.ics} leagueName={data.league.name} />
              ) : null}
              {c.key === 'announcements' ? announce : null}
              {c.link ? <HubAnchor link={c.link} className="af-btn af-ch-channel-action" language={language} /> : null}
            </div>
          </li>
        ))}
      </ul>
    </HubSection>
  )
}
