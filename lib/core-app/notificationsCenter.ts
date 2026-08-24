import 'server-only'

import { prisma } from '@/lib/prisma'
import type { CoreIssue } from '@/lib/core-app/outstandingIssues'

/**
 * 22c — the notifications centre, and the push suppression rule behind it.
 *
 * ⚠ THE DESIGN PRINCIPLE IS SUPPRESSION, NOT DELIVERY, AND IT IS THE HARD PART.
 * At 61 leagues, sending every event is the same as sending none: the user stops
 * looking. So the engineering problem this file exists to solve is deciding what
 * gets through and what collapses into "N more" — see `selectPushNotifications`.
 * The copy must reinforce it too, which is why `PushSelection.suppressedReason`
 * is a sentence and not a count.
 *
 * ⚠ ONE URGENCY ENGINE, NOT THREE. The "Act today" tier is built from
 * `deriveOutstandingIssues` — the same detectors behind the /core home queue and
 * the Tools hub's live lines. Three surfaces with three notions of "urgent" is
 * how a product ends up telling a user something is critical in one place and
 * routine in another.
 *
 * ⚠ EVERY ACT-TODAY ITEM NAMES ITS DEADLINE OR ITS CAUSE. `CoreIssue.meta`
 * already reads "Sleeper › Lineup · locks in 1h 04m", and it is passed straight
 * through. There is no branch in this file that can emit "you have an update".
 *
 * ⚠ ACTION LABELS ARE VERBS TIED TO THE REAL NEXT STEP — Fix, View, Queue —
 * never a generic "Open". `verbFor` is the only place that decides, so the rule
 * holds everywhere.
 */

export type NotificationFilter =
  | 'all'
  | 'trades'
  | 'waivers'
  | 'mentions'
  | 'lineups'
  | 'drafts'

export type NotificationRow = {
  id: string
  /** Which filter chip this falls under. */
  kind: NotificationFilter
  title: string
  /** The specific reason or deadline. Never generic. */
  detail: string
  leagueId: string | null
  leagueName: string | null
  platform: string | null
  createdAt: string
  read: boolean
  severity: 'bad' | 'warn' | 'info'
  /** Verb + destination. Null only when there is genuinely nowhere to go. */
  action: { label: string; href: string; external: boolean } | null
}

export type NotificationsCenterData = {
  /** Urgent, deadline-bound. Rendered first, with a direct action per item. */
  actToday: NotificationRow[]
  /** Everything else, newest first. */
  rest: NotificationRow[]
  /** Live counts per chip. Never static. */
  counts: Record<NotificationFilter, number>
  unread: number
  /** What the phone would have shown, and what it held back. */
  push: PushSelection
}

// ── Push selection ─────────────────────────────────────────────────────

/**
 * How many notifications may reach a lock screen at once before the rest
 * collapse. Three is the handoff's number and it is a product decision, not a
 * platform limit: past three, a stack stops being read and starts being swiped.
 */
const PUSH_SLOTS = 3

export type PushNotification = {
  id: string
  /** League name always leads — a reason with no league is unactionable. */
  leagueName: string | null
  title: string
  /** The specific deadline or cause. */
  detail: string
  action: { label: string; href: string } | null
  /** Higher surfaces first. See `priorityOf`. */
  priority: number
}

export type PushSelection = {
  /** What actually gets sent to the device. */
  delivered: PushNotification[]
  /** How many were held back. */
  suppressedCount: number
  /** Distinct leagues those suppressed items came from. */
  suppressedLeagues: number
  /**
   * The collapsed summary line, phrased to reinforce that suppression is
   * deliberate — never "you have 14 unread".
   */
  suppressedReason: string | null
}

/**
 * Priority score for a candidate push.
 *
 * The ordering is: how soon it locks, then how bad it is if you miss it. A lock
 * timer beats a severity flag because a severity flag with no clock can wait
 * until the user next opens the app, and a clock cannot.
 *
 * Returns a number where higher wins. Deliberately a pure function of the issue
 * so the same input always produces the same slate.
 */
export function priorityOf(issue: CoreIssue, now: Date): number {
  let score = 0

  if (issue.deadline) {
    const minutes = (issue.deadline.getTime() - now.getTime()) / 60_000
    if (minutes <= 0) score += 0 // already passed — nothing to act on
    else if (minutes <= 60) score += 1000
    else if (minutes <= 6 * 60) score += 700
    else if (minutes <= 24 * 60) score += 400
    else score += 100
  }

  // Severity is the tiebreak, not the driver.
  score += issue.severity === 'bad' ? 60 : issue.severity === 'warn' ? 30 : 0

  // An item with somewhere to go outranks one that is only informational —
  // a push the user cannot act on is a push that should have waited.
  if (issue.action) score += 15

  return score
}

/**
 * Decide the lock-screen slate.
 *
 * ⚠ NOTHING WITHOUT A LIVE DEADLINE REACHES THE LOCK SCREEN. That is the whole
 * suppression rule: the stack is for things that lock today. Everything else is
 * counted into the collapsed line and waits in the in-app centre, which is a
 * different surface with different economics.
 */
export function selectPushNotifications(issues: CoreIssue[], now: Date): PushSelection {
  const candidates = issues
    .map((i) => ({ issue: i, priority: priorityOf(i, now) }))
    .filter((c) => c.issue.deadline != null && c.issue.deadline.getTime() > now.getTime())
    .sort((a, b) => b.priority - a.priority)

  const delivered = candidates.slice(0, PUSH_SLOTS).map(({ issue, priority }) => ({
    id: issue.id,
    leagueName: issue.leagueName,
    title: issue.title,
    detail: issue.meta,
    action: issue.action ? { label: issue.action.label, href: issue.action.href } : null,
    priority,
  }))

  // Everything not delivered — including the items with no deadline at all,
  // because from the user's side those are still notifications that did not ring.
  const suppressed = [
    ...candidates.slice(PUSH_SLOTS).map((c) => c.issue),
    ...issues.filter((i) => i.deadline == null || i.deadline.getTime() <= now.getTime()),
  ]

  const leagues = new Set(
    suppressed.map((i) => i.leagueId).filter((v): v is string => typeof v === 'string'),
  )

  return {
    delivered,
    suppressedCount: suppressed.length,
    suppressedLeagues: leagues.size,
    suppressedReason:
      suppressed.length > 0
        ? `Only ${delivered.length} got through. The other ${suppressed.length} are stacked ` +
          `because nothing in ${leagues.size === 1 ? 'that league' : `those ${leagues.size} leagues`} locks today.`
        : null,
  }
}

// ── In-app centre ──────────────────────────────────────────────────────

/**
 * The action verb. Never "Open".
 *
 * Each branch names the actual next step, which is what makes the label useful
 * on a lock screen where there is no surrounding context to explain it.
 */
function verbFor(kind: NotificationFilter): string {
  switch (kind) {
    case 'lineups':
      return 'Fix'
    case 'waivers':
      return 'Queue'
    case 'drafts':
      return 'Draft'
    case 'trades':
      return 'Review'
    case 'mentions':
      return 'Reply'
    default:
      return 'View'
  }
}

/** Classify a stored notification, or a derived issue, into a filter chip. */
function classify(text: string): NotificationFilter {
  const t = text.toLowerCase()
  if (/trade/.test(t)) return 'trades'
  if (/waiver|faab|claim/.test(t)) return 'waivers'
  if (/mention|@|chat|message/.test(t)) return 'mentions'
  if (/lineup|start|bench|slot|flex|inactive|questionable|out\b/.test(t)) return 'lineups'
  if (/draft|pick|clock/.test(t)) return 'drafts'
  return 'all'
}

function severityOf(raw: string | null | undefined): 'bad' | 'warn' | 'info' {
  const s = (raw ?? '').toLowerCase()
  if (s === 'high' || s === 'critical' || s === 'bad') return 'bad'
  if (s === 'medium' || s === 'warn') return 'warn'
  return 'info'
}

export async function getNotificationsCenter(input: {
  userId: string
  /** From deriveOutstandingIssues — the shared urgency engine. */
  issues: CoreIssue[]
  now?: Date
}): Promise<NotificationsCenterData> {
  const now = input.now ?? new Date()

  /*
   * ⚠ THE ACT-TODAY TIER IS DERIVED, NOT STORED. PlatformNotification rows are a
   * log of things that already happened; an unmet deadline is a thing that has
   * NOT happened yet, and nothing writes a row for it. Building this tier from
   * the table would silently produce an empty "Act today" on an account with a
   * lineup locking in an hour.
   */
  const actToday: NotificationRow[] = input.issues
    .filter((i) => i.deadline != null && i.deadline.getTime() > now.getTime())
    .map((i) => {
      const kind = classify(`${i.title} ${i.meta}`)
      return {
        id: `issue:${i.id}`,
        kind,
        title: i.title,
        detail: i.meta,
        leagueId: i.leagueId,
        leagueName: i.leagueName,
        platform: i.platform,
        createdAt: now.toISOString(),
        read: false,
        severity: i.severity,
        action: i.action
          ? {
              // The stored label may be "Open in Sleeper", which is correct for a
              // platform hand-off. Anything else gets the specific verb.
              label: i.action.external ? i.action.label : `${verbFor(kind)} it`,
              href: i.action.href,
              external: i.action.external,
            }
          : null,
      }
    })

  const stored = await prisma.platformNotification
    .findMany({
      where: { userId: input.userId },
      orderBy: { createdAt: 'desc' },
      take: 60,
      select: {
        id: true,
        type: true,
        title: true,
        body: true,
        severity: true,
        createdAt: true,
        readAt: true,
        leagueId: true,
        league: { select: { name: true, platform: true } },
      },
    })
    .catch(() => [])

  const rest: NotificationRow[] = stored.map((n) => {
    const kind = classify(`${n.type} ${n.title} ${n.body ?? ''}`)
    return {
      id: n.id,
      kind,
      title: n.title,
      /*
       * A stored notification with no body still names its type rather than
       * rendering an empty line — "Trade" is thinner than we would like but it
       * is true, and a blank detail is the generic message this screen forbids.
       */
      detail: n.body?.trim() || n.type,
      leagueId: n.leagueId,
      leagueName: n.league?.name ?? null,
      platform: n.league?.platform ? String(n.league.platform).toLowerCase() : null,
      createdAt: n.createdAt.toISOString(),
      read: n.readAt != null,
      severity: severityOf(n.severity),
      action: n.leagueId
        ? {
            label: `${verbFor(kind)} it`,
            href: `/core?league=${encodeURIComponent(n.leagueId)}`,
            external: false,
          }
        : null,
    }
  })

  const all = [...actToday, ...rest]
  const counts: Record<NotificationFilter, number> = {
    all: all.length,
    trades: all.filter((r) => r.kind === 'trades').length,
    waivers: all.filter((r) => r.kind === 'waivers').length,
    mentions: all.filter((r) => r.kind === 'mentions').length,
    lineups: all.filter((r) => r.kind === 'lineups').length,
    drafts: all.filter((r) => r.kind === 'drafts').length,
  }

  return {
    actToday,
    rest,
    counts,
    unread: rest.filter((r) => !r.read).length + actToday.length,
    push: selectPushNotifications(input.issues, now),
  }
}
