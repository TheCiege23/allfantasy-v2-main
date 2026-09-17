import 'server-only'

import { prisma } from '@/lib/prisma'
import { listBroadcastLeagues } from '@/lib/commissioner/broadcastAccess'
import { MANAGER_INACTIVE_AFTER_DAYS } from '@/lib/decision-os/behavioral/manager-intelligence'
import type { CoreIssue } from './outstandingIssues'
import { leagueDisplayName } from './leagueHome'
import { platformLabel } from './platformLinks'
import { readFormatMembership, readMentions, HUB_FORMATS, type HubFormat, type HubMention, type HubStat } from './formatHubs'
import { abandonedTeamsFlag } from './commissioner/health'
import { buildTaskCards, type TaskCard } from './commissioner/tasks'
import { NO_REVIEW_SIGNALS } from './commissioner/signals'
import { readReviewSignals } from './commissioner/signalReads'
import { leagueHubArt } from './commissioner/leagueArt'
import {
  ACTIVITY_STALE_AFTER_MS,
  memberActivityFromReads,
  staleActivityReason,
  unownedTeamNames,
} from './commissioner/activity'
import { readMemberActivityInputs } from './commissioner/memberActivityReads'

/**
 * Commissioner Hub, all leagues — `/core/commissioner` with no league picked.
 *
 * ── Five-doors restyle, 2026-09-17 ─────────────────────────────────────────
 *
 * This address used to bounce out to `/commissioner-hub`, a page that did two
 * jobs at once: what needs a commissioner this week, and Commissioner OS-style
 * analytics (a health map, League and Trade OS panels, Manager DNA). The user's
 * calls: both hub views live in /core, the analytics live in Commissioner OS, the
 * six format hubs share one switcher with this page, and the hero art is the
 * robot king. So this page answers one question — what needs you, league by
 * league — and links to Commissioner OS for "how is my league doing".
 *
 * ── Which leagues ──────────────────────────────────────────────────────────
 *
 * The caller passes the leagues the shell already counts as "you run" (the nav
 * badge's `isCommissioner`), and this keeps only those `listBroadcastLeagues`
 * confirms — the head-or-co-commissioner rule the one-league screen's gate
 * applies. So every card opens a screen that admits the reader, and the "All
 * leagues" pill counts the same leagues the nav badge does, less any the gate
 * would refuse.
 *
 * ── What it costs ──────────────────────────────────────────────────────────
 *
 * Review signals are one grouped count each across every league. Manager
 * activity is one read per league, so it runs only for the cards drawn — capped
 * at 12, like the format hubs — and the page says so. Leagues past the cap still
 * contribute their review and sync work to the queue.
 */

const CARD_CAP = 12
/** Past this many stale leagues the queue says it once — see `stale:aggregate` in outstandingIssues. */
const STALE_ROW_LIMIT = 3

export type OverviewTone = 'good' | 'warn' | 'bad' | 'muted'

export type OverviewLeagueCard = {
  leagueId: string
  name: string
  platform: string
  sub: string
  /** Active managers of total, or why it was not measured. */
  activity: { active: number; total: number; tone: OverviewTone } | { reason: string }
  needsYou: number
  worst: TaskCard['severity'] | null
  sync: { label: string; tone: OverviewTone }
  href: string
}

export type OverviewQueueRow = TaskCard & { leagueId: string | null; leagueName: string | null }

export type CommissionerOverviewData = {
  runCount: number
  formatCounts: Record<HubFormat, number>
  leagues: OverviewLeagueCard[]
  stats: HubStat[]
  queue: OverviewQueueRow[]
  /** How many leagues had their manager activity read — the cards drawn. */
  activityChecked: number
  mentions: HubMention[] | null
  broadcastLeagueIds: string[]
  /** Commissioner OS admits league owners only; its link is offered on that basis. */
  ownsAny: boolean
  tournament: { count: number; show: boolean }
  partial: boolean
}

const RANK: Record<TaskCard['severity'], number> = { bad: 0, warn: 1, info: 2 }

type LeagueRow = {
  id: string
  name: string | null
  userId: string
  platform: string | null
  leagueSize: number | null
  leagueType: string | null
  leagueVariant: string | null
  isDynasty: boolean
  guillotineMode: boolean | null
  bestBallMode: boolean | null
  status: string | null
  lifecycleState: string | null
  lastSyncedAt: Date | null
  syncStatus: string | null
}

function worstOf(cards: TaskCard[]): TaskCard['severity'] | null {
  return cards.reduce<TaskCard['severity'] | null>(
    (w, c) => (w == null || RANK[c.severity] < RANK[w] ? c.severity : w),
    null,
  )
}

function syncState(row: LeagueRow, native: boolean, now: Date): { label: string; tone: OverviewTone } {
  if (native) return { label: 'Runs on AllFantasy', tone: 'good' }
  if (!row.lastSyncedAt) return { label: 'Never synced', tone: 'bad' }
  if ((row.syncStatus ?? '').toLowerCase().includes('fail')) return { label: 'Sync failed', tone: 'bad' }
  const age = now.getTime() - row.lastSyncedAt.getTime()
  if (age > ACTIVITY_STALE_AFTER_MS) return { label: `Synced ${Math.floor(age / 86_400_000)}d ago`, tone: 'warn' }
  return { label: 'Synced', tone: 'good' }
}

export async function getCommissionerOverview(input: {
  userId: string
  /** Leagues the shell counts as run by the reader. */
  candidateLeagueIds: string[]
  /** The shell's outstanding issues, every league. */
  issues: CoreIssue[]
  now: Date
}): Promise<CommissionerOverviewData> {
  const { userId, issues, now } = input
  const flags = { partial: false }
  const soft = <T>(label: string, p: Promise<T>, fallback: T): Promise<T> =>
    p.catch((err: unknown) => {
      flags.partial = true
      console.warn(`[commissionerOverview] ${label} read failed`, err instanceof Error ? err.message : err)
      return fallback
    })

  const zeroCounts = Object.fromEntries(HUB_FORMATS.map((f) => [f, 0])) as Record<HubFormat, number>
  type RunLeague = Awaited<ReturnType<typeof listBroadcastLeagues>>[number]
  type Membership = Awaited<ReturnType<typeof readFormatMembership>>
  const [run, membership, tournamentCount] = await Promise.all([
    input.candidateLeagueIds.length === 0
      ? Promise.resolve<RunLeague[]>([])
      : soft<RunLeague[]>('run', listBroadcastLeagues(userId, input.candidateLeagueIds), []),
    soft<Membership | null>('formats', readFormatMembership(userId, flags), null),
    soft<number>('tournaments', prisma.tournamentShell.count({ where: { commissionerId: userId } }), 0),
  ])
  const formatCounts = membership?.counts ?? zeroCounts
  const nativeById = new Map(run.map((l) => [l.id, l.native]))
  const runIds = run.map((l) => l.id)

  const rows: LeagueRow[] =
    runIds.length === 0
      ? []
      : await soft(
          'leagues',
          prisma.league.findMany({
            where: { id: { in: runIds } },
            select: {
              id: true,
              name: true,
              userId: true,
              platform: true,
              leagueSize: true,
              leagueType: true,
              leagueVariant: true,
              isDynasty: true,
              guillotineMode: true,
              bestBallMode: true,
              status: true,
              lifecycleState: true,
              lastSyncedAt: true,
              syncStatus: true,
            },
          }) as Promise<LeagueRow[]>,
          [],
        )

  const signals = await readReviewSignals(
    rows.map((r) => ({ id: r.id, native: nativeById.get(r.id) === true, status: r.status, lifecycleState: r.lifecycleState })),
    now,
  )
  if (signals.partial) flags.partial = true

  /*
   * The shell's own stale rows name a league and its age; when it has collapsed
   * them (more than three stale leagues account-wide) they carry no league, and
   * this page states its own instead.
   */
  const issuesByLeague = new Map<string, CoreIssue[]>()
  for (const i of issues) {
    if (!i.leagueId || !nativeById.has(i.leagueId)) continue
    const list = issuesByLeague.get(i.leagueId) ?? []
    list.push(i)
    issuesByLeague.set(i.leagueId, list)
  }

  type Built = { row: LeagueRow; native: boolean; name: string; stale: string | null; neverSynced: boolean; cards: TaskCard[] }

  const build = (row: LeagueRow, extraFlags: Parameters<typeof buildTaskCards>[0]['flags']): Built => {
    const native = nativeById.get(row.id) === true
    const name = leagueDisplayName(row.name)
    const stale = staleActivityReason({ native, lastSyncedAt: row.lastSyncedAt, now })
    const neverSynced = !native && row.lastSyncedAt == null
    const own = issuesByLeague.get(row.id) ?? []
    const hasShellStale = own.some((i) => i.id.endsWith(':stale'))
    const syncHref = `/core/sync?league=${encodeURIComponent(row.id)}`
    const neverRead: CoreIssue[] =
      neverSynced && !hasShellStale
        ? [
            {
              id: `${row.id}:never-synced`,
              severity: 'warn',
              glyph: '◷',
              title: 'This league has never synced',
              meta: `Nothing has been read from ${platformLabel(row.platform)}, so nothing here has been checked.`,
              leagueId: row.id,
              leagueName: name,
              platform: row.platform,
              deadline: null,
              action: { label: 'Sync now', href: syncHref, external: false },
            },
          ]
        : []
    const days = row.lastSyncedAt ? Math.floor((now.getTime() - row.lastSyncedAt.getTime()) / 86_400_000) : 0
    const { cards, overflow } = buildTaskCards({
      issues: [...own, ...neverRead],
      flags: extraFlags,
      calendar: [],
      workspace: [],
      staleSync: stale ? { days, href: syncHref, platformLabel: platformLabel(row.platform) } : null,
      signals: { leagueId: row.id, values: signals.byLeague.get(row.id) ?? NO_REVIEW_SIGNALS },
      limit: 50,
    })
    return { row, native, name, stale, neverSynced, cards: [...cards, ...overflow] }
  }

  // First pass on the cheap signals decides which leagues get a card (and an activity read).
  const firstPass = rows.map((r) => build(r, []))
  firstPass.sort((a, b) => {
    const wa = worstOf(a.cards)
    const wb = worstOf(b.cards)
    return (
      (wa == null ? 3 : RANK[wa]) - (wb == null ? 3 : RANK[wb]) ||
      b.cards.length - a.cards.length ||
      a.name.localeCompare(b.name)
    )
  })
  const shown = firstPass.slice(0, CARD_CAP)
  const shownIds = shown.map((b) => b.row.id)

  const teams =
    shownIds.length === 0
      ? []
      : await soft(
          'teams',
          prisma.leagueTeam.findMany({
            where: { leagueId: { in: shownIds } },
            select: { leagueId: true, teamName: true, ownerName: true, platformUserId: true, claimedByUserId: true, isOrphan: true },
          }),
          [],
        )
  const teamsByLeague = new Map<string, typeof teams>()
  for (const t of teams) {
    const list = teamsByLeague.get(t.leagueId) ?? []
    list.push(t)
    teamsByLeague.set(t.leagueId, list)
  }

  // One activity read per drawn league, skipped where the data is too old to judge.
  const activity = await Promise.all(
    shown.map(async (b) => {
      if (b.stale || b.neverSynced) return null
      const leagueTeams = teamsByLeague.get(b.row.id) ?? []
      const reads = await readMemberActivityInputs(b.row.id, b.native)
      return memberActivityFromReads(reads, leagueTeams, now, MANAGER_INACTIVE_AFTER_DAYS)
    }),
  )

  const inCard = new Map<string, Built>()
  const leagues: OverviewLeagueCard[] = shown.map((b, i) => {
    const members = activity[i]
    const leagueTeams = teamsByLeague.get(b.row.id) ?? []
    const flag = abandonedTeamsFlag({
      managers: members && members.available ? members.data.rows : null,
      activityReason: members && !members.available ? members.reason : null,
      orphanTeams: unownedTeamNames(leagueTeams),
      totalTeams: leagueTeams.length,
      action: b.native
        ? { label: 'Open orphan teams', href: `/league/${encodeURIComponent(b.row.id)}/orphan-teams`, external: false }
        : { label: 'Replace a manager', href: `/core/commissioner?league=${encodeURIComponent(b.row.id)}#workflow-replace-manager`, external: false },
      // Same guard as the one-league screen: no ownership judgement on data that has stopped arriving.
      stale: b.stale
        ? { reason: b.stale, action: { label: 'Re-sync', href: `/core/sync?league=${encodeURIComponent(b.row.id)}`, external: false } }
        : null,
    })
    const full = members || leagueTeams.length > 0 ? build(b.row, [flag]) : b
    inCard.set(b.row.id, full)

    const art = leagueHubArt(b.row)
    const sub = [platformLabel(b.row.platform), b.row.leagueSize ? `${b.row.leagueSize} managers` : null, art.label]
      .filter(Boolean)
      .join(' · ')
    const measured =
      members && members.available
        ? {
            active: members.data.active,
            total: members.data.total,
            tone: (members.data.inactive === 0 ? 'good' : members.data.inactive * 4 >= members.data.total ? 'bad' : 'warn') as OverviewTone,
          }
        : null
    return {
      leagueId: b.row.id,
      name: b.name,
      platform: String(b.row.platform ?? '').toLowerCase(),
      sub,
      activity:
        measured ??
        {
          reason: b.neverSynced
            ? 'Not measured: this league has never synced'
            : b.stale
              ? 'Not measured: this league’s data is too old to judge'
              : members && !members.available
                ? members.reason
                : 'Not measured yet',
        },
      needsYou: full.cards.length,
      worst: worstOf(full.cards),
      sync: syncState(b.row, b.native, now),
      href: `/core/commissioner?league=${encodeURIComponent(b.row.id)}`,
    }
  })

  // ── The queue: every league's cards, ranked across leagues ─────────────────
  const everyLeague = firstPass.map((b) => inCard.get(b.row.id) ?? b)
  const staleLeagues = everyLeague.filter((b) => b.stale || b.neverSynced)
  const collapseStale = staleLeagues.length > STALE_ROW_LIMIT
  const isSyncCard = (c: TaskCard) => c.id === 'stale-sync' || c.id.endsWith(':stale') || c.id.endsWith(':never-synced')

  const queue: OverviewQueueRow[] = []
  const collapsed: TaskCard[] = []
  for (const b of everyLeague) {
    for (const c of b.cards) {
      if (collapseStale && isSyncCard(c)) {
        collapsed.push(c)
        continue
      }
      queue.push({ ...c, id: `${b.row.id}:${c.id}`, leagueId: b.row.id, leagueName: b.name })
    }
  }
  if (collapseStale) {
    const never = staleLeagues.filter((b) => b.neverSynced).length
    queue.push({
      id: 'sync:aggregate',
      // As urgent as the worst row it stands for — a week-old league is `bad` on its own.
      severity: worstOf(collapsed) ?? 'warn',
      source: 'issue',
      title:
        never === staleLeagues.length
          ? `${staleLeagues.length} leagues you run have never synced`
          : `${staleLeagues.length} leagues you run need a re-sync`,
      detail: 'Until they sync, nothing in them can be checked — inactive managers and lineups included.',
      due: null,
      action: { label: 'Open sync', href: '/core/sync', external: false },
      leagueId: null,
      leagueName: null,
    })
  }
  queue.sort((a, b) => RANK[a.severity] - RANK[b.severity])

  // ── Hero numbers ──────────────────────────────────────────────────────────
  const inactive = activity.reduce((sum, a) => sum + (a && a.available ? a.data.inactive : 0), 0)
  const checked = activity.filter((a) => a && a.available).length
  const trades = rows.reduce((sum, r) => sum + (signals.byLeague.get(r.id)?.tradesAwaitingReview ?? 0), 0)
  const neverSynced = staleLeagues.filter((b) => b.neverSynced).length
  const staleOnly = staleLeagues.length - neverSynced

  const stats: HubStat[] = [
    { value: String(queue.length), label: queue.length === 1 ? 'needs a commissioner' : 'need a commissioner', tone: 'accent' },
    checked > 0
      ? { value: String(inactive), label: inactive === 1 ? 'manager inactive' : 'managers inactive', tone: inactive > 0 ? 'bad' : 'good' }
      : { value: '—', label: 'managers inactive · not measured yet', tone: 'plain' },
    { value: String(trades), label: trades === 1 ? 'trade awaiting review' : 'trades awaiting review', tone: 'plain' },
    neverSynced > 0
      ? { value: String(neverSynced), label: neverSynced === 1 ? 'league never synced' : 'leagues never synced', tone: 'bad' }
      : { value: String(staleOnly), label: staleOnly === 1 ? 'league needs a re-sync' : 'leagues need a re-sync', tone: staleOnly > 0 ? 'bad' : 'good' },
  ]

  const mentions =
    rows.length === 0 ? null : await soft<HubMention[] | null>('mentions', readMentions(userId, rows), null)
  const rowIds = new Set(rows.map((r) => r.id))

  return {
    runCount: rows.length,
    formatCounts,
    leagues,
    stats,
    queue,
    activityChecked: checked,
    mentions,
    // `listBroadcastLeagues`' native subset — exactly what `listSendableLeagueIds` would return.
    broadcastLeagueIds: run.filter((l) => l.native && rowIds.has(l.id)).map((l) => l.id),
    ownsAny: rows.some((r) => r.userId === userId),
    tournament: { count: tournamentCount, show: tournamentCount > 0 || rows.length >= 3 },
    partial: flags.partial,
  }
}
