/**
 * Commissioner Hub — the five league health flags (brief item 7).
 *
 * Abandoned teams, missing lineups, unequal schedules, unpaid dues and
 * unresolved votes. Each flag is either MEASURED — a count read off real rows —
 * or it says why it could not be measured. There is no third state.
 *
 * ⚠ THIS IS NOT A SECOND HEALTH SCORE. The headline number on the hub is the
 * canonical `monitorLeagueHealth` score, read through
 * `getCommissionerHubHealthForUser`, so the per-league screen and the
 * all-leagues `/commissioner-hub` cannot disagree about one league. These flags
 * are the named, actionable conditions underneath it, and they carry no score.
 *
 * ⚠ AN UNMEASURED FLAG IS NEVER A GREEN ONE. "0 unpaid" off a league that does
 * not track dues, or "0 missing lineups" off an MFL roster whose starters are
 * blank because MFL did not say, are the two most confident wrong answers this
 * panel could give. Both come back `measured: false` with the reason.
 *
 * Client-safe: no Prisma. The loader reads the rows and passes them in, so every
 * rule here is testable without a database.
 */

import { isPollClosed, type ViewerPoll } from '@/lib/chat-core/messagePolls'
import { unnamedTeamLabel } from './activity'
import { commissionerToolsMessages } from '@/lib/core-app/messages/commissionerTools'
import { messagesFor } from '@/lib/i18n/messages'

export type HealthFlagKey = 'abandoned' | 'lineups' | 'schedule' | 'dues' | 'votes'

export type HealthFlagAction = { label: string; href: string; external: boolean }

export type HealthFlag =
  | {
      key: HealthFlagKey
      label: string
      measured: true
      severity: 'bad' | 'warn' | 'good'
      count: number
      headline: string
      detail: string
      /** Who or what the count is made of — a commissioner cannot message a number. */
      names: string[]
      action: HealthFlagAction | null
    }
  | {
      key: HealthFlagKey
      label: string
      measured: false
      reason: string
      action: HealthFlagAction | null
    }

/** Sleeper's marker for a starting slot nobody filled, in a lineup read straight off its API. */
const EMPTY_SLOT = '0'

function isEmptySlot(value: unknown): boolean {
  if (value == null) return true
  const s = String(value).trim()
  return s === '' || s === EMPTY_SLOT
}

/**
 * How many of a lineup's starting slots are empty.
 *
 * 🛑 A STORED LINEUP DOES NOT CONTAIN THE `"0"` MARKER. Every importer drops it before storing
 * (`SleeperRosterMapper` `starter_ids`), so on production an empty slot shows up only as a starters
 * list shorter than the league requires. Measured 2026-09-17: 0 of 4,027 stored rosters hold a
 * `"0"`; 241 in-season Sleeper rosters are short. Counting markers alone reported "Every lineup is
 * full" for all of them, and the lineup-reminder recipe could never fire.
 *
 * So, when the league's required starter count is known, empty = required − filled. When it is
 * not (0), only explicit markers count, which is all that can honestly be said.
 */
export function emptyStarterSlots(starters: unknown[], requiredStarters: number): number {
  const markers = starters.filter(isEmptySlot).length
  if (!(requiredStarters > 0)) return markers
  return Math.max(0, requiredStarters - (starters.length - markers))
}

/**
 * Spanish when the reader asked for it (2026-10-05). Every flag is a sentence composed from league
 * data — counts, name lists, "and 3 more" — so it is written in the reader's language HERE rather
 * than translated by pattern at render, where it would come out half Spanish. The default is
 * English, so every other caller of these builders reads exactly what it always did. The sentences
 * live in the catalog (lib/core-app/messages/commissionerTools.ts), one block per language.
 */
const copy = (language: string | undefined) => messagesFor(commissionerToolsMessages, language)

/**
 * A name list for a sentence. Repeated placeholders are COUNTED, not repeated: "No owner: Unnamed
 * team, Unnamed team, Unnamed team" says nothing three times. A single placeholder stays as it is,
 * and every other list reads exactly as before. The overflow still counts TEAMS, not list items,
 * so "and 2 more" never hides that the counted phrase stood for several.
 */
function namesPreview(names: string[], max = 4, language?: string): string {
  if (names.length === 0) return ''
  const m = copy(language)
  const blank = unnamedTeamLabel(language)
  const blanks = names.filter((n) => n === blank).length
  const items: Array<{ text: string; teams: number }> =
    blanks > 1
      ? [
          ...names.filter((n) => n !== blank).map((text) => ({ text, teams: 1 })),
          { text: m.healthUnnamedTeams(blanks), teams: blanks },
        ]
      : names.map((text) => ({ text, teams: 1 }))
  const shownItems = items.slice(0, max)
  const shown = shownItems.map((i) => i.text).join(', ')
  if (items.length <= max) return shown
  const rest = names.length - shownItems.reduce((n, i) => n + i.teams, 0)
  return m.healthAndMore(shown, rest)
}

// ── Abandoned teams ─────────────────────────────────────────────────────────

export type AbandonedInput = {
  /**
   * Per-manager status from `resolveMemberActivity` (./activity.ts). Null when
   * activity could not be judged — `activityReason` then says why, which is not
   * the same thing as a league with no managers.
   */
  managers: Array<{ name: string; status: 'active' | 'at_risk' | 'inactive' | 'unknown' }> | null
  activityReason?: string | null
  /** Teams the platform itself reports with no owner (`LeagueTeam.isOrphan`). */
  orphanTeams: string[]
  totalTeams: number
  action: HealthFlagAction | null
  /**
   * Set when the league's data has stopped arriving. Idle time is read from
   * `Roster.updatedAt`, which every sync touches — so when syncs stop, every
   * manager drifts past the 14-day window together and the whole league reads
   * as abandoned. Measured on a real Sleeper league whose last sync was 14 days
   * old: "12 teams with nobody running them". The honest answer is "we can't
   * tell until it syncs", with the re-sync as the action.
   */
  stale?: { reason: string; action: HealthFlagAction } | null
  language?: string
}

export function abandonedTeamsFlag(input: AbandonedInput): HealthFlag {
  const m = copy(input.language)
  const label = m.healthAbandonedLabel
  if (input.stale) {
    return { key: 'abandoned', label, measured: false, reason: input.stale.reason, action: input.stale.action }
  }
  if (input.managers == null && input.orphanTeams.length === 0) {
    return {
      key: 'abandoned',
      label,
      measured: false,
      reason:
        input.activityReason ?? m.healthActivityUnreadable,
      action: input.action,
    }
  }
  if (input.totalTeams === 0) {
    return {
      key: 'abandoned',
      label,
      measured: false,
      reason: m.healthNoTeamsInLeague,
      action: null,
    }
  }

  /*
   * Two different facts, kept apart on purpose.
   *
   *   unowned  a seat with nobody in it — genuinely abandoned. One entry per team,
   *            so two teams both named "Unknown" count as two.
   *   quiet    a manager with no trade, waiver claim or roster move in 14 days.
   *            Early in a season that is common and says nothing about whether
   *            they set a lineup, so it is a warning, never "nobody is running it".
   */
  const unowned = input.orphanTeams
  const managers = input.managers ?? []
  const quiet = managers.filter((m) => m.status === 'inactive').map((m) => m.name)
  const count = unowned.length + quiet.length

  // Everyone quiet in a league whose feed is current is a fact about the league.
  if (unowned.length === 0 && managers.length > 1 && quiet.length === managers.length) {
    return {
      key: 'abandoned',
      label,
      measured: true,
      severity: 'warn',
      count,
      headline: m.healthNoMovesHeadline,
      detail: m.healthLeagueQuietDetail(managers.length),
      names: [],
      action: null,
    }
  }

  const headline =
    count === 0
      ? m.healthAllOwnedActiveHeadline
      : [
          unowned.length > 0 ? m.healthUnownedHeadline(unowned.length) : null,
          quiet.length > 0 ? m.healthQuietHeadline(quiet.length) : null,
        ]
          .filter(Boolean)
          .join(' · ')

  const detail =
    count === 0
      ? managers.length > 0
        ? m.healthAllOwnedActiveDetail
        : m.healthAllOwnedDetail
      : [
          unowned.length > 0 ? m.healthUnownedDetail(namesPreview(unowned, 4, input.language)) : null,
          quiet.length > 0 ? m.healthQuietDetail(namesPreview(quiet, 4, input.language)) : null,
        ]
          .filter(Boolean)
          .join(' ')

  return {
    key: 'abandoned',
    label,
    measured: true,
    severity: unowned.length >= 2 ? 'bad' : count > 0 ? 'warn' : 'good',
    count,
    headline,
    detail,
    names: [...unowned, ...quiet],
    action: count > 0 ? input.action : null,
  }
}

// ── Missing lineups ─────────────────────────────────────────────────────────

export type LineupsInput = {
  platform: string
  /** Only an in-season league has a lineup anyone is expected to have set. */
  inSeason: boolean
  rosters: Array<{
    name: string
    /**
     * The roster's starting slots as the platform stored them, or null when the
     * roster's shape could not be read at all.
     */
    starters: unknown[] | null
  }>
  /** Starting slots the league's rules require (`readRequiredStarterCount`); 0 when unknown. */
  requiredStarters?: number
  action: HealthFlagAction | null
  /** Rosters from a sync that has stopped are last week's lineups — see `AbandonedInput.stale`. */
  stale?: { reason: string; action: HealthFlagAction } | null
  language?: string
}

/**
 * ⚠ MFL AND FANTRAX STORE AN EMPTY STARTER LIST WHEN THE LINEUP IS UNKNOWN, not
 * when it is empty (`MflLeagueFetchService` writes `[]` when the platform did not
 * return starters). On those platforms a blank lineup is an absence of data, and
 * accusing a manager on it would be wrong most of the time.
 */
const LINEUP_UNKNOWABLE = new Set(['mfl', 'fantrax'])

export function missingLineupsFlag(input: LineupsInput): HealthFlag {
  const m = copy(input.language)
  const label = m.healthLineupsLabel
  const platform = input.platform.trim().toLowerCase()
  if (LINEUP_UNKNOWABLE.has(platform)) {
    return {
      key: 'lineups',
      label,
      measured: false,
      reason: m.healthLineupsUnknowable(platform === 'mfl' ? 'MFL' : 'Fantrax'),
      action: input.action,
    }
  }
  if (input.inSeason && input.stale) {
    return { key: 'lineups', label, measured: false, reason: input.stale.reason, action: input.stale.action }
  }
  if (!input.inSeason) {
    return {
      key: 'lineups',
      label,
      measured: false,
      reason: m.healthLineupsOffSeason,
      action: null,
    }
  }

  const readable = input.rosters.filter(
    (r): r is { name: string; starters: unknown[] } => Array.isArray(r.starters) && r.starters.length > 0,
  )
  if (readable.length === 0) {
    return {
      key: 'lineups',
      label,
      measured: false,
      reason: m.healthLineupsNoneReadable,
      action: input.action,
    }
  }

  const holes = readable
    .map((r) => ({ name: r.name, empty: emptyStarterSlots(r.starters, input.requiredStarters ?? 0) }))
    .filter((r) => r.empty > 0)
    .sort((a, b) => b.empty - a.empty || a.name.localeCompare(b.name))

  const unread = input.rosters.length - readable.length
  const suffix =
    unread === 0
      ? ''
      : m.healthLineupsUnread(unread)

  return {
    key: 'lineups',
    label,
    measured: true,
    severity: holes.length >= 2 ? 'bad' : holes.length === 1 ? 'warn' : 'good',
    count: holes.length,
    headline:
      holes.length === 0
        ? m.healthLineupsFullHeadline
        : m.healthLineupsHolesHeadline(holes.length),
    detail:
      (holes.length === 0
        ? m.healthLineupsFullDetail(readable.length)
        : holes
            .slice(0, 4)
            .map((h) => m.healthLineupsHole(h.name, h.empty))
            .join(', ') +
          (holes.length > 4 ? m.healthLineupsMore(holes.length - 4) : '.')) + suffix,
    names: holes.map((h) => h.name),
    action: holes.length > 0 ? input.action : null,
  }
}

// ── Unequal schedules ───────────────────────────────────────────────────────

export type ScheduleInput = {
  /** WeeklyMatchup rows for the current season. */
  games: Array<{ rosterId: string; week: number; matchupId: number | null }>
  /** Every roster id in the league, so a team with no games at all is still seen. */
  rosterIds: string[]
  teamName: (rosterId: string) => string
  /** Count games through this week (the league's latest played week). */
  throughWeek: number | null
  /** Guillotine / survivor formats are MEANT to leave teams with fewer games. */
  eliminationFormat: boolean
  action: HealthFlagAction | null
  language?: string
}

export function unequalSchedulesFlag(input: ScheduleInput): HealthFlag {
  const m = copy(input.language)
  const label = m.healthScheduleLabel
  if (input.eliminationFormat) {
    return {
      key: 'schedule',
      label,
      measured: false,
      reason: m.healthScheduleElimination,
      action: null,
    }
  }
  if (input.games.length === 0 || input.throughWeek == null || input.throughWeek < 1) {
    return {
      key: 'schedule',
      label,
      measured: false,
      reason: m.healthScheduleNoWeeks,
      action: null,
    }
  }

  const through = input.throughWeek
  const games = new Map<string, Set<number>>()
  for (const id of input.rosterIds) games.set(id, new Set())
  for (const g of input.games) {
    if (g.matchupId == null || g.week < 1 || g.week > through) continue
    const set = games.get(g.rosterId) ?? new Set<number>()
    set.add(g.week)
    games.set(g.rosterId, set)
  }

  const counts = [...games.entries()].map(([rosterId, weeks]) => ({ rosterId, n: weeks.size }))
  if (counts.length === 0) {
    return { key: 'schedule', label, measured: false, reason: m.healthScheduleNoTeams, action: null }
  }
  const most = Math.max(...counts.map((c) => c.n))
  const behind = counts
    .filter((c) => c.n < most)
    .map((c) => ({ name: input.teamName(c.rosterId), n: c.n }))
    .sort((a, b) => a.n - b.n || a.name.localeCompare(b.name))

  return {
    key: 'schedule',
    label,
    measured: true,
    severity: behind.length > 0 ? 'warn' : 'good',
    count: behind.length,
    headline:
      behind.length === 0
        ? m.healthScheduleEvenHeadline(most)
        : m.healthScheduleBehindHeadline(behind.length),
    detail:
      behind.length === 0
        ? m.healthScheduleEvenDetail(through)
        : m.healthScheduleBehindDetail(most, through, behind),
    names: behind.map((b) => b.name),
    action: behind.length > 0 ? input.action : null,
  }
}

// ── Unpaid dues ─────────────────────────────────────────────────────────────

export type DuesTracker = {
  enabled: boolean
  amount: number | null
  currency: string
  paymentLink: string | null
  paymentProvider: string | null
  entries: Array<{ teamId: string; paid: boolean }>
}

/**
 * Reads `League.settings.dues_tracker`, the blob the dues route writes.
 * Anything malformed reads as "not tracked" rather than throwing — the source is
 * JSON a person edited.
 */
export function readDuesTracker(settings: unknown): DuesTracker | null {
  if (!settings || typeof settings !== 'object') return null
  const raw = (settings as Record<string, unknown>).dues_tracker
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const entries = Array.isArray(d.entries)
    ? d.entries.flatMap((e) => {
        if (!e || typeof e !== 'object') return []
        const row = e as Record<string, unknown>
        return typeof row.teamId === 'string' ? [{ teamId: row.teamId, paid: row.paid === true }] : []
      })
    : []
  const link = typeof d.paymentLink === 'string' ? d.paymentLink.trim() : ''
  return {
    enabled: d.enabled === true,
    amount: typeof d.amount === 'number' && Number.isFinite(d.amount) ? d.amount : null,
    currency: typeof d.currency === 'string' && d.currency ? d.currency : 'USD',
    // Only a real https link is ever rendered as one. The value is commissioner-typed.
    paymentLink: /^https:\/\//i.test(link) ? link : null,
    paymentProvider: typeof d.paymentProvider === 'string' ? d.paymentProvider : null,
    entries,
  }
}

export type DuesInput = {
  tracker: DuesTracker | null
  /** `LeagueTeam.id` + display name — the dues entries key on the team row id. */
  teams: Array<{ id: string; name: string }>
  action: HealthFlagAction | null
  language?: string
}

export function unpaidDuesFlag(input: DuesInput): HealthFlag {
  const m = copy(input.language)
  const label = m.healthDuesLabel
  const t = input.tracker
  if (!t || !t.enabled) {
    return {
      key: 'dues',
      label,
      measured: false,
      reason: m.healthDuesUntracked,
      action: input.action ? { ...input.action, label: m.healthDuesSetUp } : null,
    }
  }
  if (input.teams.length === 0) {
    return { key: 'dues', label, measured: false, reason: m.healthDuesNoTeams, action: null }
  }

  const paid = new Set(t.entries.filter((e) => e.paid).map((e) => e.teamId))
  const unpaid = input.teams.filter((team) => !paid.has(team.id)).map((team) => team.name)
  const amount = t.amount != null ? m.healthDuesAmount(formatMoney(t.amount, t.currency)) : ''

  return {
    key: 'dues',
    label,
    measured: true,
    severity: unpaid.length > 0 ? 'warn' : 'good',
    count: unpaid.length,
    headline:
      unpaid.length === 0
        ? m.healthDuesPaidHeadline
        : m.healthDuesOweHeadline(unpaid.length, amount),
    detail:
      unpaid.length === 0
        ? m.healthDuesPaidDetail(input.teams.length)
        : m.healthDuesUnpaidDetail(namesPreview(unpaid, 4, input.language)),
    names: unpaid,
    action: unpaid.length > 0 ? input.action : null,
  }
}

export function formatMoney(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    }).format(amount)
  } catch {
    return `${amount} ${currency}`
  }
}

// ── Unresolved votes ────────────────────────────────────────────────────────

export type LeaguePoll = ViewerPoll & { id: string; postedAt: string }

export type VotesInput = {
  polls: LeaguePoll[] | null
  now: Date
  action: HealthFlagAction | null
  language?: string
}

export function openPolls(polls: LeaguePoll[], now: Date): LeaguePoll[] {
  return polls
    .filter((p) => !isPollClosed(p, now.getTime()))
    .sort((a, b) => {
      const at = a.closesAt ? Date.parse(a.closesAt) : Number.MAX_SAFE_INTEGER
      const bt = b.closesAt ? Date.parse(b.closesAt) : Number.MAX_SAFE_INTEGER
      return at - bt
    })
}

export function unresolvedVotesFlag(input: VotesInput): HealthFlag {
  const m = copy(input.language)
  const label = m.healthVotesLabel
  if (input.polls == null) {
    return {
      key: 'votes',
      label,
      measured: false,
      reason: m.healthVotesUnreadable,
      action: input.action,
    }
  }
  const open = openPolls(input.polls, input.now)
  const soon = open.filter(
    (p) => p.closesAt && Date.parse(p.closesAt) - input.now.getTime() < 24 * 60 * 60 * 1000,
  )
  /*
   * A poll with no deadline never closes on its own. Past a week it is a
   * question the league asked and nobody answered — worth a nudge, and the
   * reason it counts as unresolved rather than merely open.
   */
  const stale = open.filter(
    (p) => !p.closesAt && input.now.getTime() - Date.parse(p.postedAt) > 7 * 24 * 60 * 60 * 1000,
  )

  return {
    key: 'votes',
    label,
    measured: true,
    severity: soon.length > 0 || stale.length > 0 ? 'warn' : 'good',
    count: open.length,
    headline:
      open.length === 0
        ? m.healthVotesNoneHeadline
        : m.healthVotesOpenHeadline(open.length),
    detail:
      open.length === 0
        ? m.healthVotesNoneDetail
        : open
            .slice(0, 3)
            .map((p) => (p.closesAt ? m.healthVoteCloses(p.question, p.closesAt) : m.healthVoteNoDeadline(p.question)))
            .join('; ') + (open.length > 3 ? m.healthVotesMore(open.length - 3) : '.'),
    names: open.map((p) => p.question),
    action: open.length > 0 ? input.action : null,
  }
}

/** Flags that need a commissioner, worst first — the order the hub lists them in. */
export function rankFlags(flags: HealthFlag[]): HealthFlag[] {
  const weight = (f: HealthFlag) => (!f.measured ? 3 : f.severity === 'bad' ? 0 : f.severity === 'warn' ? 1 : 2)
  return [...flags].sort((a, b) => weight(a) - weight(b))
}
