/**
 * League Settings hub — pure view model.
 *
 * Turns the payloads the hub already fetches (GET /api/league/settings, roster-settings,
 * history) into display rows. No fetching and no React here, so every rule about what a
 * league type shows is unit-testable in isolation.
 *
 * ⚠ Rows only ever describe values the API actually returned. A missing value renders as
 * "—", never as a format default: a default shown as if it were the league's rule is the
 * failure this module exists to avoid.
 */

import type { NotificationCategoryId } from '@/lib/notification-settings/types'
import { resolveLeagueConceptIntroKey } from '@/lib/league-media/leagueTypeMedia'
import { resolveHubSport, scoringCategories, scoringCategoryFor, sportCopy, sportDisplayName, sportFamily, SPORT_SLOT_NAMES, statLabel } from './sportProfile'

export type HubKind =
  | 'redraft'
  | 'dynasty'
  | 'keeper'
  | 'best_ball'
  | 'guillotine'
  | 'devy'
  | 'c2c'
  | 'salary_cap'
  | 'survivor'
  | 'big_brother'
  | 'zombie'
  | 'tournament'
  | 'idp'
  | 'pirate'
  | 'king_of_the_hill'

const HUB_KINDS: readonly HubKind[] = [
  'redraft', 'dynasty', 'keeper', 'best_ball', 'guillotine', 'devy', 'c2c', 'salary_cap',
  'survivor', 'big_brother', 'zombie', 'tournament', 'idp', 'pirate', 'king_of_the_hill',
]

type HubKindMeta = {
  label: string
  blurb: string
  /** Section title for the format-specific rules card. */
  rulesTitle: string
  /** Label for the playoffs group — formats without playoffs have an endgame instead. */
  endgameLabel: string
  /** Rosters carry over between seasons (taxi, future picks, rookie drafts). */
  carriesOver: boolean
  /** Lineups are set automatically. */
  autoLineups: boolean
}

export const HUB_KIND_META: Record<HubKind, HubKindMeta> = {
  redraft: { label: 'Redraft', blurb: 'Fresh draft every season. Nothing carries over.', rulesTitle: 'Commissioner Tools', endgameLabel: 'Playoffs', carriesOver: false, autoLineups: false },
  dynasty: { label: 'Dynasty', blurb: 'Rosters carry over. Rookie drafts, taxi squad and tradable future picks.', rulesTitle: 'Dynasty Rules', endgameLabel: 'Playoffs', carriesOver: true, autoLineups: false },
  keeper: { label: 'Keeper', blurb: 'Keep a few players each season, paid for with draft capital.', rulesTitle: 'Keeper Rules', endgameLabel: 'Playoffs', carriesOver: false, autoLineups: false },
  best_ball: { label: 'Best Ball', blurb: 'No lineups to set. Your best starters score automatically each week.', rulesTitle: 'Best Ball Rules', endgameLabel: 'Playoffs', carriesOver: false, autoLineups: true },
  guillotine: { label: 'Guillotine', blurb: 'Lowest score each period gets chopped. Their roster hits waivers.', rulesTitle: 'Guilly Rules', endgameLabel: 'Endgame', carriesOver: false, autoLineups: false },
  devy: { label: 'Devy', blurb: 'Dynasty plus college prospects you hold rights to until they turn pro.', rulesTitle: 'Devy Rules', endgameLabel: 'Playoffs', carriesOver: true, autoLineups: false },
  c2c: { label: 'C2C', blurb: 'Campus to Canton: one franchise with a pro roster and a college roster.', rulesTitle: 'C2C Rules', endgameLabel: 'Playoffs', carriesOver: true, autoLineups: false },
  salary_cap: { label: 'Salary Cap', blurb: 'A hard cap, auction startup and multi-year contracts.', rulesTitle: 'Salary Cap & Contracts', endgameLabel: 'Playoffs', carriesOver: true, autoLineups: false },
  survivor: { label: 'Survivor', blurb: 'Tribes, idols and Tribal Council. Outwit, outplay, outscore.', rulesTitle: 'Survivor Rules', endgameLabel: 'Endgame', carriesOver: false, autoLineups: false },
  big_brother: { label: 'Big Brother', blurb: 'Weekly HOH, nominations, Veto and an eviction vote.', rulesTitle: 'Big Brother Rules', endgameLabel: 'Endgame', carriesOver: false, autoLineups: false },
  zombie: { label: 'Zombie', blurb: 'Lose to the Whisperer or a Zombie and you turn. Serums revive.', rulesTitle: 'Zombie Rules', endgameLabel: 'Endgame', carriesOver: false, autoLineups: false },
  tournament: { label: 'Tournament', blurb: 'Leagues feed a bracket. Advancers re-draft each round.', rulesTitle: 'Tournament Rules', endgameLabel: 'Advancement', carriesOver: false, autoLineups: false },
  idp: { label: 'IDP', blurb: 'Individual defensive players score alongside your offense.', rulesTitle: 'IDP Rules', endgameLabel: 'Playoffs', carriesOver: false, autoLineups: false },
  pirate: { label: 'Pirate', blurb: 'Plunder, treasure and a pirate deck on top of a classic season.', rulesTitle: 'Pirate Rules', endgameLabel: 'Playoffs', carriesOver: false, autoLineups: false },
  king_of_the_hill: { label: 'King of the Hill', blurb: 'One crown, defended every week.', rulesTitle: 'King of the Hill Rules', endgameLabel: 'Endgame', carriesOver: false, autoLineups: true },
}

export function resolveHubKind(input: {
  leagueType?: string | null
  leagueVariant?: string | null
  settings?: unknown
  isDynasty?: boolean | null
  guillotineMode?: boolean | null
  bestBallMode?: boolean | null
}): HubKind {
  const key = resolveLeagueConceptIntroKey(input)
  return (HUB_KINDS as readonly string[]).includes(key) ? (key as HubKind) : 'redraft'
}

/* ------------------------------------------------------------------ rows */

type HubScheduleDay = { day: string; mode: string }

export type HubRow = {
  key: string
  label: string
  description?: string
  /** Display value. `null` renders as an em dash. */
  value: string | null
  /** Indented under the row above it (Sleeper's sub-settings). */
  indent?: boolean
  /** When set, the row is an inline switch saved through PATCH /api/league/settings. */
  toggle?: { field: string; on: boolean }
  schedule?: HubScheduleDay[]
}

export type HubGroup = { key: string; label: string; rows: HubRow[] }

/** Loose shape of GET /api/league/settings — every field is optional on purpose. */
export type HubSettingsPayload = {
  userRole?: string | null
  canEdit?: boolean
  settingsSnapshot?: Record<string, unknown> | null
  league?: Record<string, unknown> & {
    id?: string
    name?: string | null
    sport?: string | null
    season?: number | null
    timezone?: string | null
    teamCount?: number | null
    teams?: HubTeam[]
  }
  settings?: Record<string, unknown> | null
  scoringConfig?: { templateId?: string; formatType?: string; rules?: HubScoringRule[] } | null
}

type HubTeam = {
  id: string
  externalId?: string | null
  teamName?: string | null
  ownerName?: string | null
  avatarUrl?: string | null
  claimedByUserId?: string | null
  wins?: number | null
  losses?: number | null
  pointsFor?: number | null
  isCommissioner?: boolean | null
  isCoCommissioner?: boolean | null
}

type HubScoringRule = {
  statKey: string
  pointsValue: number
  multiplier?: number
  enabled: boolean
  isOverridden?: boolean
}

const DASH = null

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}
function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null
}
function yesNo(v: unknown): string | null {
  const b = bool(v)
  return b == null ? DASH : b ? 'Yes' : 'No'
}
function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}
function humanize(raw: string): string {
  return raw
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase())
}

function waiverTypeText(raw: unknown): string | null {
  const s = str(raw)?.toLowerCase()
  if (!s) return DASH
  if (s.includes('faab')) return 'FAAB Bidding'
  if (s.includes('rolling')) return 'Rolling Priority'
  if (s.includes('reverse')) return 'Reverse Standings'
  if (s === 'none' || s.includes('free')) return 'None · free agency'
  return humanize(s)
}

function tradeReviewText(snapshot: Record<string, unknown>): string | null {
  const raw = str(snapshot.trade_review_mode) ?? str(snapshot.tradeReviewMode)
  if (!raw) return DASH
  if (raw === 'none') return 'No review'
  if (raw === 'commissioner') return 'Commissioner'
  if (raw.includes('vote') || raw === 'league') return 'League vote'
  return humanize(raw)
}

function hoursText(h: number | null): string | null {
  if (h == null) return DASH
  if (h === 0) return 'None'
  if (h % 24 === 0) return plural(h / 24, 'day')
  return plural(h, 'hour')
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/**
 * Reads `League.waiverSchedule`. Accepts the two shapes stored in this repo: an array of
 * `{day, mode}`-ish objects, or a record keyed by day name / index. Anything else → [].
 */
export function readWaiverSchedule(raw: unknown): HubScheduleDay[] {
  const label = (mode: unknown): string => {
    const m = String(mode ?? '').toLowerCase()
    if (!m) return '—'
    if (m.includes('fa') && m.includes('waiver')) return 'Waivers to FA'
    if (m === 'fa' || m.includes('free')) return 'Free agency'
    if (m.includes('waiver') || m === 'process' || m === 'true') return 'Waivers'
    if (m === 'false' || m === 'off' || m === 'none') return 'No processing'
    return humanize(m)
  }
  const dayName = (d: unknown): string | null => {
    if (typeof d === 'number' && d >= 0 && d <= 6) return DAY_NAMES[d]
    const s = str(d)
    if (!s) return null
    const hit = DAY_NAMES.find((n) => n.toLowerCase().startsWith(s.toLowerCase().slice(0, 3)))
    return hit ?? null
  }
  const out: HubScheduleDay[] = []
  if (Array.isArray(raw)) {
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const o = item as Record<string, unknown>
      const day = dayName(o.day ?? o.dayOfWeek ?? o.weekday)
      if (day) out.push({ day, mode: label(o.mode ?? o.type ?? o.action ?? o.enabled) })
    }
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      const day = dayName(/^\d$/.test(k) ? Number(k) : k)
      if (day) out.push({ day, mode: label(v && typeof v === 'object' ? (v as Record<string, unknown>).mode : v) })
    }
  }
  const order = (d: string) => (DAY_NAMES.indexOf(d) + 6) % 7 // Monday first
  return out.sort((a, b) => order(a.day) - order(b.day))
}

/* --------------------------------------------------------- league setup */

export function buildGeneralGroups(p: HubSettingsPayload, kind: HubKind): HubGroup[] {
  const l = p.league ?? {}
  const snap = p.settingsSnapshot ?? {}
  const meta = HUB_KIND_META[kind]
  const teamCount = num(l.teamCount) ?? num(l.leagueSize)

  const setup: HubRow[] = [
    { key: 'type', label: 'League Type', value: meta.label },
    { key: 'teams', label: 'Teams', value: teamCount != null ? `${teamCount} Teams` : DASH },
    { key: 'sport', label: 'Sport', value: sportDisplayName(str(l.sport)) },
    { key: 'season', label: 'Season', value: num(l.season) != null ? String(l.season) : DASH },
    { key: 'scoring', label: 'Scoring Format', value: str(l.scoring) },
  ]
  if (l.medianGame != null) {
    setup.push({ key: 'median', label: 'League Median Game', description: 'Every team also plays the weekly median score', value: yesNo(l.medianGame), toggle: { field: 'medianGame', on: l.medianGame === true } })
  }

  const deadline = num(l.tradeDeadlineWeek)
  const trade: HubRow[] = [
    { key: 'deadline', label: 'Trade Deadline', value: deadline != null ? (deadline > 0 ? `Week ${deadline}` : 'None') : DASH },
    { key: 'review', label: 'Trade Review', value: tradeReviewText(snap) },
    { key: 'reviewTime', label: 'Time to Review Pending Trades', value: hoursText(num(l.tradeReviewHours)) },
    { key: 'pickTrading', label: 'Allow Draft Pick Trading', value: yesNo(l.draftPickTrading), toggle: bool(l.draftPickTrading) == null ? undefined : { field: 'draftPickTrading', on: l.draftPickTrading === true } },
    { key: 'benchDrops', label: 'Prevent Bench Players From Being Dropped After Game Starts', value: yesNo(l.preventBenchDrops), toggle: bool(l.preventBenchDrops) == null ? undefined : { field: 'preventBenchDrops', on: l.preventBenchDrops === true } },
  ]
  if (kind === 'survivor') trade.push({ key: 'idols', label: 'Idols in Trades', description: 'An idol is never traded on its own', value: 'Only with their player' })
  if (kind === 'big_brother') trade.push({ key: 'hoh', label: 'HOH & Veto', description: 'Power stays with the team that won it', value: 'Never tradable' })
  if (kind === 'zombie') trade.push({ key: 'zombieTrades', label: 'Zombie Trades', description: 'Once infected, a team can’t trade', value: 'Blocked' })

  const irAllowed = [
    l.irAllowOut === true ? 'Out' : null,
    l.irAllowDoubtful === true ? 'Doubtful' : null,
    l.irAllowSuspended === true ? 'Suspended' : null,
    l.irAllowNA === true ? 'NA' : null,
    l.irAllowCovid === true ? 'COVID' : null,
    l.irAllowDNR === true ? 'DNR' : null,
  ].filter(Boolean) as string[]
  const ir: HubRow[] = [
    { key: 'irSlots', label: 'Injury Reserve Spots', value: num(l.irSlots) != null ? String(l.irSlots) : DASH },
    { key: 'irAllow', label: 'Also Allowed in IR', value: irAllowed.length ? irAllowed.join(', ') : DASH },
  ]

  const moves: HubRow[] = meta.autoLineups
    ? [{ key: 'lineups', label: 'Lineups', value: 'Auto-optimized every week' }]
    : [
        { key: 'preDraft', label: 'Allow Pre-Draft Moves', value: yesNo(l.allowPreDraftMoves) },
        { key: 'lockAll', label: 'Lock All Roster Moves', value: yesNo(l.lockAllMoves) },
      ]

  const playoffTeams = num(l.playoffTeams)
  const playoffStart = num(l.playoffStartWeek)
  const playoffs: HubRow[] =
    meta.endgameLabel === 'Endgame'
      ? [{ key: 'endgame', label: 'Format', value: kind === 'guillotine' ? 'Last team standing' : kind === 'zombie' ? 'Last human standing' : kind === 'king_of_the_hill' ? 'Hold the crown' : 'Jury vote finale' }]
      : [
          { key: 'playoffTeams', label: 'Playoff Teams', value: playoffTeams != null ? String(playoffTeams) : DASH },
          { key: 'playoffStart', label: 'Playoffs Start', value: playoffStart != null ? `Week ${playoffStart}` : DASH },
          { key: 'perRound', label: 'Weeks per Round', value: num(l.playoffWeeksPerRound) != null ? String(l.playoffWeeksPerRound) : DASH },
          { key: 'seeding', label: 'Seeding', value: str(l.playoffSeedingRule) ? humanize(String(l.playoffSeedingRule)) : DASH },
          { key: 'lower', label: 'Consolation Bracket', value: str(l.playoffLowerBracket) ? humanize(String(l.playoffLowerBracket)) : DASH },
        ]

  return [
    { key: 'setup', label: 'League Setup', rows: setup },
    { key: 'trade', label: 'Trade Rules', rows: trade },
    { key: 'ir', label: 'Injury Reserve', rows: ir },
    { key: 'moves', label: meta.autoLineups ? 'Lineups' : 'Roster Moves', rows: moves },
    { key: 'playoffs', label: meta.endgameLabel, rows: playoffs },
  ]
}

export function buildWaiverGroups(p: HubSettingsPayload, kind: HubKind): HubGroup[] {
  const l = p.league ?? {}
  const type = waiverTypeText(l.waiverType)
  const isFaab = type === 'FAAB Bidding'
  const budget = num(l.waiverBudget)
  const minBid = num(l.waiverMinBid)
  const left: HubRow[] = [{ key: 'type', label: 'Waiver Type', value: type }]
  if (isFaab) {
    left.push(
      { key: 'budget', label: 'Waiver Budget', value: budget != null ? `$${budget.toLocaleString('en-US')}` : DASH, indent: true },
      { key: 'minBid', label: 'Min Bid', value: minBid != null ? `$${minBid}` : DASH, indent: true },
    )
  }
  left.push(
    { key: 'clearAfter', label: 'Waivers Clear After Games', value: yesNo(l.waiverClearAfterGames) },
    { key: 'hours', label: 'Time on Waivers After Drop', value: hoursText(num(l.waiverHours)) },
  )
  if (kind === 'guillotine') left.push({ key: 'chopped', label: 'Chopped Rosters', value: 'Released at the next waiver run' })
  if (kind === 'big_brother') left.push({ key: 'evicted', label: 'Evicted Rosters', value: 'Released at the next waiver run' })

  const custom = bool(l.customDailyWaivers)
  const right: HubRow[] = [
    { key: 'custom', label: 'Allow Custom Daily Waivers', description: 'Players lock on waivers when their game starts', value: yesNo(custom), toggle: custom == null ? undefined : { field: 'customDailyWaivers', on: custom } },
  ]
  if (custom) {
    right.push({ key: 'process', label: 'Processing Time', description: `Time shown in ${str(l.timezone) ?? 'league time'}`, value: str(l.waiverProcessTime), indent: true })
    const schedule = readWaiverSchedule(l.waiverSchedule)
    right.push({ key: 'schedule', label: 'Daily Waiver Schedule', value: schedule.length ? null : 'Not set', indent: true, schedule: schedule.length ? schedule : undefined })
  }
  return [
    { key: 'waivers', label: '', rows: left },
    { key: 'daily', label: '', rows: right },
  ]
}

/**
 * Format-specific rules, from fields the settings API actually returns. Specialty formats
 * store their rules in their own config tables, which this payload does not carry — those
 * render the create-time `conceptSetup` answers when present and otherwise nothing, and the
 * hub links to the format's own editor rather than inventing values.
 */
export function buildTypeRuleGroups(p: HubSettingsPayload, kind: HubKind): HubGroup[] {
  const l = p.league ?? {}
  const groups: HubGroup[] = []
  if (kind === 'dynasty' || kind === 'devy' || kind === 'c2c' || kind === 'salary_cap') {
    const taxi = num(l.taxiSlots)
    groups.push({
      key: 'taxi',
      label: 'Taxi Squad',
      rows: [
        { key: 'taxiSlots', label: 'Taxi Spots', value: taxi != null ? String(taxi) : DASH },
        { key: 'taxiNonRookies', label: 'Non-Rookies Allowed', value: yesNo(l.taxiAllowNonRookies) },
        { key: 'taxiYears', label: 'Years Eligible', value: num(l.taxiYearsLimit) != null ? String(l.taxiYearsLimit) : DASH },
        { key: 'taxiDeadline', label: 'Promotion Deadline', value: num(l.taxiDeadlineWeek) != null ? `Week ${l.taxiDeadlineWeek}` : DASH },
      ],
    })
    if (str(l.dynastySeasonPhase)) {
      groups.push({ key: 'phase', label: 'Season', rows: [{ key: 'phase', label: 'Dynasty Phase', value: humanize(String(l.dynastySeasonPhase)) }] })
    }
  }
  if (kind === 'keeper' || num(l.keeperCount)) {
    groups.push({
      key: 'keepers',
      label: 'Keepers',
      rows: [
        { key: 'count', label: 'Max Keepers', value: num(l.keeperCount) != null ? `${l.keeperCount} per team` : DASH },
        { key: 'years', label: 'Max Years Kept', value: num(l.keeperMaxYears) != null ? String(l.keeperMaxYears) : DASH },
        { key: 'cost', label: 'Cost System', value: str(l.keeperCostSystem) ? humanize(String(l.keeperCostSystem)) : DASH },
        { key: 'penalty', label: 'Round Penalty', value: num(l.keeperRoundPenalty) != null ? plural(Number(l.keeperRoundPenalty), 'round') : DASH },
        { key: 'waiver', label: 'Waiver Pickups Keepable', value: yesNo(l.keeperWaiverAllowed) },
        { key: 'conflict', label: 'Conflicts', value: str(l.keeperConflictRule) ? humanize(String(l.keeperConflictRule)) : DASH },
        { key: 'missed', label: 'Missed Deadline', value: str(l.keeperMissedDeadlineRule) ? humanize(String(l.keeperMissedDeadlineRule)) : DASH },
        { key: 'deadline', label: 'Selection Deadline', value: formatDate(l.keeperSelectionDeadline) },
      ],
    })
  }
  const setup = conceptSetupRows(p.settingsSnapshot)
  if (setup.length) groups.push({ key: 'concept', label: 'Format Setup', rows: setup })
  return groups
}

function conceptSetupRows(snapshot: Record<string, unknown> | null | undefined): HubRow[] {
  const raw = snapshot?.conceptSetup
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return []
  const rows: HubRow[] = []
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (rows.length >= 12) break
    let value: string | null = null
    if (typeof v === 'boolean') value = v ? 'Yes' : 'No'
    else if (typeof v === 'number' && Number.isFinite(v)) value = String(v)
    else if (typeof v === 'string' && v.trim() && v.length <= 48) value = /^[a-z0-9_]+$/.test(v) ? humanize(v) : v
    if (value == null) continue
    rows.push({ key: `concept-${k}`, label: humanize(k), value })
  }
  return rows
}

function formatDate(raw: unknown, timeZone?: string | null): string | null {
  const s = str(raw)
  if (!s) return DASH
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return DASH
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: timeZone ?? undefined }).format(d)
  } catch {
    return d.toISOString().slice(0, 16).replace('T', ' ')
  }
}

/* ---------------------------------------------------------------- draft */

export function pickTimerText(preset: unknown, custom: unknown): string | null {
  const p = str(preset)
  if (!p) return DASH
  if (p === 'custom') return num(custom) != null ? `${custom} sec` : 'Custom'
  const m = /^(\d+)\s*(s|sec|m|min|h|hr)?/i.exec(p)
  if (m) {
    const n = Number(m[1])
    const unit = (m[2] ?? 's').toLowerCase()
    if (unit.startsWith('h')) return plural(n, 'hour')
    if (unit.startsWith('m')) return plural(n, 'minute')
    return n >= 60 && n % 60 === 0 ? plural(n / 60, 'minute') : `${n} seconds`
  }
  return humanize(p)
}

export function buildDraftGroups(p: HubSettingsPayload): HubGroup[] {
  const s = p.settings ?? {}
  const tz = str(p.league?.timezone) ?? str(s.timezone)
  const left: HubRow[] = [
    { key: 'time', label: 'Draft Time', description: tz ? `Shown in ${tz}` : undefined, value: formatDate(s.draftDateUtc, tz) },
    { key: 'type', label: 'Draft Type', value: str(s.draftType) ? humanize(String(s.draftType)) : DASH },
    { key: 'autostart', label: 'Auto-start Draft', description: 'Draft begins automatically at start time', value: yesNo(s.autostart), toggle: bool(s.autostart) == null ? undefined : { field: 'autostart', on: s.autostart === true } },
    { key: 'pool', label: 'Available Players to Draft', value: str(s.playerPool) ? humanize(String(s.playerPool)) : 'All' },
  ]
  const right: HubRow[] = [
    { key: 'timer', label: 'Time per Pick', value: pickTimerText(s.pickTimerPreset, s.pickTimerCustomValue) },
    { key: 'rounds', label: 'Rounds', value: num(s.rounds) != null ? String(s.rounds) : DASH },
    { key: 'cpu', label: 'CPU Autopick', description: 'When managers run out of time', value: yesNo(s.cpuAutoPick), toggle: bool(s.cpuAutoPick) == null ? undefined : { field: 'cpuAutoPick', on: s.cpuAutoPick === true } },
    { key: 'alpha', label: 'Alphabetical Sort', description: 'Sort players by name instead of ADP', value: yesNo(s.alphabeticalSort), toggle: bool(s.alphabeticalSort) == null ? undefined : { field: 'alphabeticalSort', on: s.alphabeticalSort === true } },
  ]
  return [
    { key: 'draftLeft', label: '', rows: left },
    { key: 'draftRight', label: '', rows: right },
  ]
}

/* --------------------------------------------------------------- roster */

export type HubSlotDef = { key: string; label?: string; shortLabel?: string; color?: string }
export type HubRosterItem = { key: string; name: string; abbr: string; count: number; color: string; section: string }

const FALLBACK_SLOT_COLORS: Record<string, string> = {
  QB: '#fb7185', RB: '#34d399', WR: '#22d3ee', TE: '#fbbf24', K: '#c084fc', DEF: '#fb923c', DST: '#fb923c',
  BN: '#94a3b8', BE: '#94a3b8', IR: '#f87171', TAXI: '#2dd4bf', DEVY: '#818cf8', DL: '#facc15', LB: '#a5b4fc', DB: '#f472b6',
}

const FLEX_PARTS: Record<string, string[]> = {
  FLEX: ['WR', 'RB', 'TE'], WRT: ['WR', 'RB', 'TE'], 'W/R/T': ['WR', 'RB', 'TE'], WR_RB: ['WR', 'RB'], 'W/R': ['WR', 'RB'],
  WR_TE: ['WR', 'TE'], 'W/T': ['WR', 'TE'], SUPER_FLEX: ['QB', 'WR', 'RB', 'TE'], SUPERFLEX: ['QB', 'WR', 'RB', 'TE'], SF: ['QB', 'WR', 'RB', 'TE'],
  'Q/W/R/T': ['QB', 'WR', 'RB', 'TE'], IDP_FLEX: ['DL', 'LB', 'DB'], IDP: ['DL', 'LB', 'DB'],
}

const SLOT_NAMES: Record<string, string> = {
  QB: 'Quarterback', RB: 'Running Back', WR: 'Wide Receiver', TE: 'Tight End', K: 'Kicker', DEF: 'Team Defense', DST: 'Team Defense',
  FLEX: 'Flex', WRT: 'Flex', WR_RB: 'Flex', WR_TE: 'Flex', SUPER_FLEX: 'Superflex', SUPERFLEX: 'Superflex', SF: 'Superflex',
  BN: 'Bench', BE: 'Bench', IR: 'Injured Reserve', TAXI: 'Taxi Squad', DEVY: 'Devy',
  DL: 'Defensive Line', LB: 'Linebacker', DB: 'Defensive Back', IDP_FLEX: 'IDP Flex', IDP: 'IDP Flex',
}

const SLOT_ABBR: Record<string, string> = {
  FLEX: 'W/R/T', WRT: 'W/R/T', WR_RB: 'W/R', WR_TE: 'W/T', SUPER_FLEX: 'Q/W/R/T', SUPERFLEX: 'Q/W/R/T', SF: 'Q/W/R/T',
  BN: 'BE', IDP_FLEX: 'IDP', DST: 'DEF',
}

/** Solid color for a single position, hard-stop stripes for a flex. */
export function slotSwatch(key: string, def?: HubSlotDef, sport?: string | null): string {
  const k = key.toUpperCase()
  // Football flex codes only: an NBA small forward is `SF` and a soccer `FLEX` is DEF/MID/FWD.
  const parts = sportFamily(resolveHubSport(sport)) === 'football' ? FLEX_PARTS[k] : undefined
  if (parts) {
    const n = parts.length
    const stops = parts.flatMap((p, i) => {
      const c = FALLBACK_SLOT_COLORS[p] ?? '#94a3b8'
      return [`${c} ${Math.round((i * 100) / n)}%`, `${c} ${Math.round(((i + 1) * 100) / n)}%`]
    })
    return `linear-gradient(90deg,${stops.join(',')})`
  }
  if (def?.color) return def.color
  return (sportFamily(resolveHubSport(sport)) === 'football' ? FALLBACK_SLOT_COLORS[k] : undefined) || '#94a3b8'
}

export function buildRosterItems(
  unified: { rosterConfig?: { sections?: Array<{ key: string; label: string; slots: Record<string, number> }> } } | null | undefined,
  slotDefs: HubSlotDef[] | null | undefined,
  sport?: string | null,
): HubRosterItem[] {
  const defs = new Map((slotDefs ?? []).map((d) => [d.key, d]))
  const family = sportFamily(resolveHubSport(sport))
  const names = family === 'football' ? SLOT_NAMES : SPORT_SLOT_NAMES[family]
  const abbrs = family === 'football' ? SLOT_ABBR : {}
  const out: HubRosterItem[] = []
  for (const section of unified?.rosterConfig?.sections ?? []) {
    for (const [key, count] of Object.entries(section.slots ?? {})) {
      if (typeof count !== 'number') continue
      const def = defs.get(key)
      out.push({
        key: `${section.key}:${key}`,
        name: def?.label ?? names[key.toUpperCase()] ?? humanize(key.toLowerCase()),
        abbr: def?.shortLabel ?? abbrs[key.toUpperCase()] ?? key,
        count,
        color: slotSwatch(key, def, sport),
        section: section.label,
      })
    }
  }
  return out
}

/* -------------------------------------------------------------- scoring */

export type HubScoringCategory = { key: string; label: string; rows: Array<{ key: string; label: string; value: string; perUnit?: string }> }

function fmtPoints(n: number): string {
  const r = Math.round(n * 1000) / 1000
  return Number.isInteger(r) ? String(r) : String(r)
}

/**
 * Groups enabled scoring rules into Sleeper-style category tabs for the league's sport (football
 * when unknown). Zero-point rules are hidden.
 */
export function groupScoringRules(rules: HubScoringRule[] | null | undefined, sportRaw?: string | null): HubScoringCategory[] {
  const sport = resolveHubSport(sportRaw)
  const football = sportFamily(sport) === 'football'
  const buckets = new Map<string, HubScoringCategory>()
  const other: HubScoringCategory = { key: 'other', label: 'Other', rows: [] }
  for (const r of rules ?? []) {
    if (!r || !r.enabled || typeof r.pointsValue !== 'number' || r.pointsValue === 0) continue
    const k = r.statKey.toLowerCase()
    const cat = scoringCategoryFor(sport, k)
    const isYards = football && /(_yd|_yds|yards)$/.test(k) && Math.abs(r.pointsValue) < 1
    const label = statLabel(sport, k) ?? humanize(r.statKey)
    const row = isYards
      ? { key: r.statKey, label, value: `${fmtPoints(r.pointsValue)} / yd`, perUnit: `1 point every ${Math.round(1 / Math.abs(r.pointsValue))} yards` }
      : { key: r.statKey, label, value: fmtPoints(r.pointsValue) }
    if (!cat) {
      other.rows.push(row)
      continue
    }
    if (!buckets.has(cat.key)) buckets.set(cat.key, { key: cat.key, label: cat.label, rows: [] })
    buckets.get(cat.key)!.rows.push(row)
  }
  const ordered = scoringCategories(sport).map((c) => buckets.get(c.key)).filter(Boolean) as HubScoringCategory[]
  if (other.rows.length) ordered.push(other)
  return ordered
}

/* -------------------------------------------------------- notifications */

type HubNotificationRow = { id: NotificationCategoryId; label: string; description: string }
export type HubNotificationGroup = { key: string; label: string; rows: HubNotificationRow[] }

export function buildNotificationGroups(kind: HubKind, isCommissioner: boolean, sport?: string | null): HubNotificationGroup[] {
  const meta = HUB_KIND_META[kind]
  const groups: HubNotificationGroup[] = [
    { key: 'general', label: 'General', rows: [
      { id: 'league_announcements', label: 'League Announcements', description: 'Posts pinned by the commissioner' },
      { id: 'league_chat', label: 'Leaguemate Messages', description: 'Messages sent by your leaguemates' },
      { id: 'chat_mentions', label: '@mentions', description: 'Someone mentions you in chat' },
      { id: 'league_drama', label: 'League Drama', description: 'Trash talk, rivalry heat and hot takes' },
    ] },
    { key: 'transactions', label: 'Transactions', rows: [
      { id: 'trade_proposals', label: 'Trade Proposals', description: 'Offers sent to you' },
      { id: 'trade_accept_reject', label: 'Trade Accepted / Rejected', description: 'Responses to offers you sent' },
      { id: 'waiver_processing', label: 'Waiver Results', description: kind === 'zombie' ? 'Free-agent adds and drops' : 'Claims won and lost' },
    ] },
    { key: 'scoring', label: 'Scoring', rows: [
      { id: 'performance_alerts', label: 'Scoring Notifications', description: 'Play alerts from players that you own' },
      { id: 'matchup_results', label: 'Matchup Results', description: 'Final scores when your week closes' },
    ] },
    { key: 'lineups', label: meta.autoLineups ? 'Injuries' : 'Lineups & Injuries', rows: meta.autoLineups
      ? [{ id: 'injury_alerts', label: 'Injury Status Notifications', description: 'Lineups set themselves in this format' }]
      : [
          { id: 'lineup_reminders', label: 'Lineup Reminders', description: sportCopy(sport).lineupReminder },
          { id: 'lineup_alerts', label: 'Inactive Player Notifications', description: 'Alerts when starting an inactive player' },
          { id: 'injury_alerts', label: 'Injury Status Notifications', description: 'Alerts when injury status changes' },
        ] },
    { key: 'ai', label: 'AI & Draft', rows: [
      { id: 'ai_alerts', label: 'Chimmy Insights', description: 'Lineup, waiver and trade nudges from Chimmy' },
      { id: 'draft_alerts', label: 'Draft Alerts', description: 'On the clock, picks made, draft starting' },
      { id: 'followed_players', label: 'Followed Players', description: 'News on players you follow' },
    ] },
  ]
  if (kind === 'tournament' || kind === 'guillotine' || kind === 'survivor' || kind === 'big_brother' || kind === 'zombie') {
    groups[2].rows.push({ id: 'bracket_updates', label: `${meta.label} Updates`, description: kind === 'guillotine' ? 'Chops, danger zone and who survives' : kind === 'tournament' ? 'Advancement, bubble and re-drafts' : 'Eliminations and format events' })
  }
  if (isCommissioner) {
    groups.push({ key: 'commish', label: 'Commissioner', rows: [
      { id: 'commissioner_alerts', label: 'Commissioner Alerts', description: 'Trades to review, inactive managers, rule flags' },
    ] })
  }
  return groups
}

/**
 * Effective on/off for one category in one league: global category switch AND league not
 * muted AND category not muted for this league. Mirrors `lib/notifications/leagueOverrides`.
 */
export function isLeagueCategoryOn(
  prefs: { globalEnabled?: boolean; categories?: Partial<Record<string, { enabled?: boolean }>>; leagues?: Record<string, { enabled?: boolean; mutedCategories?: string[] }> } | null | undefined,
  leagueId: string,
  category: NotificationCategoryId,
): boolean {
  if (!prefs) return true
  if (prefs.globalEnabled === false) return false
  if (prefs.categories?.[category]?.enabled === false) return false
  const league = prefs.leagues?.[leagueId]
  if (league?.enabled === false) return false
  return !(league?.mutedCategories ?? []).includes(category)
}

/* ---------------------------------------------------------- record book */

export type HubStandingRow = { rank: number; name: string; avatar: string | null; record: string; winPct: string; pointsFor: string; seasons: number; titles: number }

export function buildAllTimeStandings(rows: Array<{ managerName: string; managerAvatar?: string | null; totalWins: number; totalLosses: number; totalTies: number; winPct: number; totalPoints: number; seasonsPlayed: number; championships: number }> | null | undefined): HubStandingRow[] {
  return (rows ?? []).map((r, i) => ({
    rank: i + 1,
    name: r.managerName,
    avatar: r.managerAvatar ?? null,
    record: `${r.totalWins}-${r.totalLosses}${r.totalTies ? `-${r.totalTies}` : ''}`,
    winPct: `${Math.round((r.winPct ?? 0) * 100)}%`,
    pointsFor: (r.totalPoints ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    seasons: r.seasonsPlayed,
    titles: r.championships,
  }))
}

export function championWord(kind: HubKind): string {
  if (kind === 'guillotine') return 'Last team standing'
  if (kind === 'survivor') return 'Sole Survivor'
  if (kind === 'big_brother') return 'Winner'
  if (kind === 'zombie') return 'Last human'
  return 'Champion'
}

/** Short note shown under "About stat corrections" when a format treats them specially. */
export function statCorrectionNote(kind: HubKind): string | null {
  if (kind === 'guillotine') return 'Chops wait for stat corrections before a team is eliminated.'
  if (kind === 'best_ball') return 'Your commissioner can apply corrections to recent weeks.'
  if (kind === 'big_brother') return 'HOH and Veto results use the corrected scores.'
  return null
}

export function initials(name: string | null | undefined): string {
  const s = String(name ?? '').replace(/[^A-Za-z0-9 ]/g, ' ').trim()
  if (!s) return '?'
  const parts = s.split(/\s+/)
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : s.slice(0, 2)).toUpperCase()
}
