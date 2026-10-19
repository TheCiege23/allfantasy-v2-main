/**
 * The Sleeper-style League Settings list (2026-10-18): one scrollable list of sections, each row a
 * label on the left and the CURRENT value on the right. Pure — every value is computed from data
 * the caller already holds (league row, roster GET, draft settings GET, guillotine summary GET),
 * so the list is testable without a browser or a database.
 *
 * A row's `target` names the sub-page that edits it. Members get the same list with every target
 * removed (values shown, no way into an editor). The Commissioner tools row is commissioner-only.
 */

import { getGuillotineSportConfig } from '@/lib/guillotine/sportConfig'
import type { GuillotineAdvanced } from '@/lib/guillotine/chopSchedule'

export type SettingsSubPageId =
  | 'general'
  | 'format'
  | 'roster'
  | 'scoring'
  | 'draft'
  | 'waivers'
  | 'trades'
  | 'guillotine-first-chop'
  /** Guillotine: chop schedule, double/no-chop weeks and immunity (lib/guillotine/chopSchedule.ts). */
  | 'guillotine-chop-rules'
  | 'playoffs'
  | 'members'
  | 'co-commissioners'
  | 'divisions'
  | 'ai'
  | 'commissioner-tools'
  /** Manual point adjustments per matchup, with a reason (lib/score-adjustments). */
  | 'score-adjustments'
  /** Survivor leagues only: tribe count, identities and the pre-draft tribe plan (handoff §5.4). */
  | 'survivor-tribes'

export type SettingsHomeRow = {
  id: string
  label: string
  value: string
  /** Sub-page that edits this row; absent = display only. */
  target?: SettingsSubPageId
  /** Inline copy action (the invite link). */
  copyText?: string
  /** Value still loading from its GET. */
  pending?: boolean
}

export type SettingsHomeSection = { id: string; title: string; rows: SettingsHomeRow[] }

export type SettingsHomeLeague = {
  id: string
  name?: string | null
  sport?: string | null
  leagueSize?: number | null
  leagueVariant?: string | null
  survivorMode?: boolean | null
  guillotineMode?: boolean | null
  guillotineEndgame?: string | null
  waiverType?: string | null
  waiverBudget?: number | null
  tradeReviewHours?: number | null
  tradeDeadlineWeek?: number | null
  playoffTeams?: number | null
  playoffStartWeek?: number | null
  settings?: unknown
}

export type SettingsHomeTeam = {
  claimedByUserId?: string | null
  isCoCommissioner?: boolean | null
  ownerName?: string | null
  teamName?: string | null
}

export type SettingsHomeDraft = {
  dateIso: string | null
  type: string | null
  rounds: number | null
  timerSeconds: number | null
  autostart: boolean | null
}

export type SettingsHomeGuillotine = {
  firstChopWeek: number
  endWeek: number | null
  /** One line per chop rule, from the server (describeSchedule). */
  scheduleLines?: string[]
  /** The chop rules as saved, and the base teams per chop they build on. */
  advanced?: GuillotineAdvanced | null
  teamsPerChop?: number
  /** The first chop has happened — the start week can no longer move. */
  locked: boolean
}

export type BuildSettingsHomeInput = {
  league: SettingsHomeLeague
  teams: readonly SettingsHomeTeam[]
  canEdit: boolean
  /** e.g. "Guillotine" — from lib/league-media/leagueTypeMedia. */
  formatLabel: string
  /** Scoring preset name, when the league carries one. */
  scoringLabel: string | null
  /** null = still loading; {} = loaded but empty. */
  rosterSlots: Record<string, number> | null
  /** null = still loading. */
  draft: SettingsHomeDraft | null
  /** null = loading (or not a guillotine league). */
  guillotine: SettingsHomeGuillotine | null
  inviteUrl: string
  /** Viewer's IANA zone; defaults to the runtime's. */
  viewerTimeZone?: string
}

const LOADING = '…'

/**
 * Values longer than this sit UNDER their label on a phone instead of beside it (the row renders
 * `data-layout="stacked"`; league-settings-home.css applies it below 480px). Short values stay
 * right-aligned like Sleeper. Nothing is ever truncated: a long value wraps.
 */
export const LONG_SETTINGS_VALUE_CHARS = 24

export function isLongSettingsValue(value: string | null | undefined): boolean {
  return String(value ?? '').length > LONG_SETTINGS_VALUE_CHARS
}

function settingsRecord(settings: unknown): Record<string, unknown> {
  return settings && typeof settings === 'object' && !Array.isArray(settings) ? (settings as Record<string, unknown>) : {}
}

export function isSurvivorSettingsLeague(league: Pick<SettingsHomeLeague, 'leagueVariant' | 'survivorMode'>): boolean {
  return String(league.leagueVariant ?? '').toLowerCase() === 'survivor' || league.survivorMode === true
}

export function isGuillotineSettingsLeague(league: Pick<SettingsHomeLeague, 'leagueVariant' | 'guillotineMode'>): boolean {
  return String(league.leagueVariant ?? '').toLowerCase() === 'guillotine' || league.guillotineMode === true
}

function titleCase(raw: string): string {
  return raw
    .replace(/[_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w))
    .join(' ')
}

const BENCH_KEYS = new Set(['BN', 'BENCH'])
const RESERVE_KEYS = new Set(['IL', 'IR', 'IL+', 'NA'])
const TAXI_KEYS = new Set(['TAXI'])

/** "UTIL ×4, SUPER_UTIL, 4 BN, 1 IL" — starters in slot order, then bench / reserve / taxi counts. */
export function formatRosterSummary(slots: Record<string, number> | null | undefined): string {
  if (!slots) return LOADING
  const starters: string[] = []
  const tail: string[] = []
  const tailOrder: string[] = []
  for (const [rawKey, rawCount] of Object.entries(slots)) {
    const count = Number(rawCount)
    if (!Number.isFinite(count) || count <= 0) continue
    const key = rawKey.toUpperCase()
    if (BENCH_KEYS.has(key)) tailOrder[0] = `${count} BN`
    else if (RESERVE_KEYS.has(key)) tailOrder[1] = `${tailOrder[1] ? `${tailOrder[1]}, ` : ''}${count} ${key}`
    else if (TAXI_KEYS.has(key)) tailOrder[2] = `${count} TAXI`
    else starters.push(count > 1 ? `${key} ×${count}` : key)
  }
  for (const part of tailOrder) if (part) tail.push(part)
  const all = [...starters, ...tail]
  return all.length ? all.join(', ') : 'Not set'
}

const ZONE_SHORT: Record<string, string> = {
  EDT: 'ET', EST: 'ET', CDT: 'CT', CST: 'CT', MDT: 'MT', MST: 'MT', PDT: 'PT', PST: 'PT',
}

/** "Mon Oct 19, 8:00 PM ET" in the viewer's zone. */
export function formatDraftDateTime(iso: string | null | undefined, timeZone?: string): string {
  if (!iso) return 'Not scheduled'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'Not scheduled'
  let parts: Intl.DateTimeFormatPart[]
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
      ...(timeZone ? { timeZone } : {}),
    }).formatToParts(d)
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).formatToParts(d)
  }
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ''
  const zone = get('timeZoneName')
  return `${get('weekday')} ${get('month')} ${get('day')}, ${get('hour')}:${get('minute')} ${get('dayPeriod')} ${ZONE_SHORT[zone] ?? zone}`.replace(/\s+/g, ' ').trim()
}

export function formatPickTimer(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return 'No timer'
  if (seconds < 120) return `${seconds}s`
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`
  const h = seconds / 3600
  return `${Number.isInteger(h) ? h : h.toFixed(1)}h`
}

export function formatDraftShape(draft: SettingsHomeDraft | null): string {
  if (!draft) return LOADING
  const type = draft.type ? titleCase(draft.type) : 'Snake'
  const rounds = draft.rounds ? `${draft.rounds} rounds` : null
  return [type, rounds, formatPickTimer(draft.timerSeconds)].filter(Boolean).join(' · ')
}

export function formatWaivers(league: Pick<SettingsHomeLeague, 'waiverType' | 'waiverBudget'>): string {
  const type = String(league.waiverType ?? 'rolling').toLowerCase()
  if (type === 'faab') {
    const budget = Number(league.waiverBudget ?? 100)
    return `FAAB · $${budget.toLocaleString('en-US')}`
  }
  if (type === 'reverse_standings') return 'Reverse standings'
  return titleCase(type)
}

const TRADE_REVIEW_LABELS: Record<string, string> = {
  commissioner: 'Commissioner review',
  league_vote: 'League vote',
  instant: 'Instant',
  none: 'Trades off',
}

export function formatTrades(league: Pick<SettingsHomeLeague, 'settings' | 'tradeDeadlineWeek'>): string {
  const s = settingsRecord(league.settings)
  const json = settingsRecord(s.settingsJson)
  const mode = String(s.trade_review_mode ?? s.tradeReviewMode ?? json.tradeReviewMode ?? 'commissioner').toLowerCase()
  const review = TRADE_REVIEW_LABELS[mode] ?? titleCase(mode)
  if (mode === 'none') return review
  const deadline = league.tradeDeadlineWeek ? `deadline Wk ${league.tradeDeadlineWeek}` : 'no deadline'
  return `${review} · ${deadline}`
}

const ENDGAME_LABELS: Record<string, string> = {
  last_team_standing: 'Last team standing',
  final_four: 'Final four',
  final_three: 'Final three',
  final_two: 'Final two showdown',
}

export function formatScoringMode(settings: unknown): string {
  const s = settingsRecord(settings)
  const mode = String(s.scoring_mode ?? s.scoringMode ?? 'points').toLowerCase()
  if (mode.includes('categor')) return 'Categories'
  if (mode.includes('roto')) return 'Roto'
  return 'Points'
}

function divisionCount(settings: unknown): number {
  const s = settingsRecord(settings)
  const cfg = settingsRecord(s.division_config)
  const n = Number(cfg.count ?? s.num_divisions ?? 0)
  return Number.isFinite(n) ? n : 0
}

export function buildLeagueSettingsHome(input: BuildSettingsHomeInput): SettingsHomeSection[] {
  const { league, teams, canEdit } = input
  const edit = (target: SettingsSubPageId) => (canEdit ? { target } : {})
  const guillotine = isGuillotineSettingsLeague(league)
  const teamCount = league.leagueSize ?? teams.length
  const joined = teams.filter((t) => Boolean(t.claimedByUserId)).length

  const sections: SettingsHomeSection[] = [
    {
      id: 'general',
      title: 'General',
      rows: [
        { id: 'name', label: 'League name', value: league.name?.trim() || 'Untitled league', ...edit('general') },
        { id: 'teams', label: 'Teams', value: String(teamCount) },
        { id: 'format', label: 'Format', value: `${input.formatLabel} · ${formatScoringMode(league.settings)}`, ...edit('format') },
      ],
    },
    {
      id: 'roster-scoring',
      title: 'Roster & scoring',
      rows: [
        { id: 'roster', label: 'Roster positions', value: formatRosterSummary(input.rosterSlots), pending: input.rosterSlots == null, ...edit('roster') },
        { id: 'scoring', label: 'Scoring', value: input.scoringLabel || formatScoringMode(league.settings), ...edit('scoring') },
      ],
    },
    {
      id: 'draft',
      title: 'Draft',
      rows: [
        {
          id: 'draft-date',
          label: 'Draft date & time',
          value: input.draft ? formatDraftDateTime(input.draft.dateIso, input.viewerTimeZone) : LOADING,
          pending: input.draft == null,
          ...edit('draft'),
        },
        { id: 'draft-shape', label: 'Type · rounds · pick timer', value: formatDraftShape(input.draft), pending: input.draft == null, ...edit('draft') },
        {
          id: 'draft-autostart',
          label: 'Autostart',
          value: input.draft ? (input.draft.autostart ? 'On' : 'Off') : LOADING,
          pending: input.draft == null,
          ...edit('draft'),
        },
      ],
    },
    {
      id: 'waivers-trades',
      title: 'Waivers & trades',
      rows: [
        { id: 'waivers', label: 'Waivers', value: formatWaivers(league), ...edit('waivers') },
        { id: 'trades', label: 'Trades', value: formatTrades(league), ...edit('trades') },
      ],
    },
  ]

  if (guillotine) {
    const profile = getGuillotineSportConfig(String(league.sport ?? 'NFL'))
    const g = input.guillotine
    sections.push({
      id: 'guillotine',
      title: 'Guillotine',
      rows: [
        {
          id: 'first-chop',
          label: 'First chop week',
          value: g ? `Week ${g.firstChopWeek}${g.locked ? ' · locked' : ''}` : LOADING,
          pending: g == null,
          ...(g?.locked ? {} : edit('guillotine-first-chop')),
        },
        {
          id: 'chop-rules',
          label: 'Chop rules',
          value: g ? (g.scheduleLines?.length ? g.scheduleLines.slice(0, 2).join(' ') : 'One chop a week') : LOADING,
          pending: g == null,
          ...edit('guillotine-chop-rules'),
        },
        {
          id: 'chop-schedule',
          label: 'Chop & waiver schedule',
          value: profile ? `Chop ${profile.chopLabel.replace(/^By /, 'by ')} · Waivers ${profile.waiverLabel}` : 'Weekly',
        },
        {
          id: 'endgame',
          label: 'Endgame',
          value: ENDGAME_LABELS[String(league.guillotineEndgame ?? 'last_team_standing')] ?? titleCase(String(league.guillotineEndgame)),
        },
      ],
    })
  } else {
    sections.push({
      id: 'playoffs',
      title: 'Playoffs',
      rows: [
        {
          id: 'playoffs',
          label: 'Playoffs',
          value: `${league.playoffTeams ?? 4} teams · starts Wk ${league.playoffStartWeek ?? 14}`,
          ...edit('playoffs'),
        },
      ],
    })
  }

  const coCommissioners = teams.filter((t) => t.isCoCommissioner).map((t) => t.ownerName || t.teamName || 'Manager')
  const divisions = divisionCount(league.settings)
  const memberRows: SettingsHomeRow[] = [
    { id: 'managers', label: 'Managers', value: `${joined} / ${teamCount} joined`, ...edit('members') },
    {
      id: 'invite',
      label: 'Invite link',
      value: input.inviteUrl ? input.inviteUrl.replace(/^https?:\/\//, '') : 'No invite link yet',
      ...(input.inviteUrl ? { copyText: input.inviteUrl } : {}),
    },
    { id: 'co-commissioners', label: 'Co-commissioners', value: coCommissioners.length ? coCommissioners.join(', ') : 'None', ...edit('co-commissioners') },
  ]
  if (divisions > 0) memberRows.push({ id: 'divisions', label: 'Divisions', value: `${divisions} divisions`, ...edit('divisions') })
  sections.push({ id: 'members', title: 'Members', rows: memberRows })

  if (canEdit) {
    sections.push({
      id: 'commissioner',
      title: 'Commissioner tools',
      rows: [
        { id: 'league-ai', label: 'League AI', value: 'Helpers & commissioner intelligence', target: 'ai' },
        { id: 'commissioner-tools', label: 'Commissioner tools', value: 'Controls, dues, history', target: 'commissioner-tools' },
        { id: 'score-adjustments', label: 'Score adjustments', value: 'Add or take away points, with a reason', target: 'score-adjustments' },
        ...(isSurvivorSettingsLeague(league)
          ? [{ id: 'survivor-tribes', label: 'Survivor tribes', value: 'Tribes, assignment & announce', target: 'survivor-tribes' as const }]
          : []),
      ],
    })
  }

  return sections
}
