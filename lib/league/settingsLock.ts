/**
 * Settings lock (docs/AF_COMMISSIONER_SETTINGS_SPEC.md §2.1, Free): the commissioner locks areas of
 * the league's rules for the season, and a locked area cannot change mid-year without a league vote.
 *
 *   lock      any commissioner, any time — more locking is never a surprise to the league
 *   unlock    before the season is under way, by hand; after that ONLY by a passed league vote,
 *             which opens the area for UNLOCK_WINDOW_MS and then it locks again by itself
 *   expires   with the season: a lock records `League.season` and means nothing once that moves on
 *
 * The vote is a yes/no league-chat poll (lib/chat-core/messagePolls reads it). It passes with a
 * strict majority of the votes cast; no votes, or a tie, fails.
 *
 * Stored in `League.settings.settings_lock`, which the generic settings patch must never let a
 * `settingsMerge` write — that would make the lock removable by the very save it guards.
 *
 * Pure.
 */

export const SETTINGS_LOCK_KEY = 'settings_lock'

export const LOCK_GROUPS = ['scoring', 'rosters', 'keepers', 'trades', 'waivers', 'playoffs'] as const
export type LockGroup = (typeof LOCK_GROUPS)[number]

export const LOCK_GROUP_LABELS: Record<LockGroup, { label: string; help: string }> = {
  scoring: { label: 'Scoring', help: 'Scoring rules, presets and the median game' },
  rosters: { label: 'Rosters', help: 'Roster size, starting lineup, bench, IR and taxi' },
  keepers: { label: 'Keepers', help: 'Keeper count, costs and deadlines' },
  trades: { label: 'Trades', help: 'Trade deadline, review and pick trading' },
  waivers: { label: 'Waivers', help: 'Waiver type, FAAB budget, bids and schedule' },
  playoffs: { label: 'Playoffs', help: 'Playoff teams, start week, byes and bracket' },
}

/** How long a passed vote opens an area for the change it was held for. */
export const UNLOCK_WINDOW_MS = 72 * 60 * 60 * 1000
export const VOTE_DAY_OPTIONS = [1, 2, 3, 5, 7] as const
export const DEFAULT_VOTE_DAYS = 2
export const VOTES_KEPT = 30
export const YES = 'yes'
export const NO = 'no'

export type UnlockVoteStatus = 'voting' | 'passed' | 'failed'

export type UnlockVote = {
  id: string
  group: LockGroup
  reason: string
  pollMessageId: string | null
  closesAt: string
  status: UnlockVoteStatus
  yes: number | null
  no: number | null
  proposedBy: string
  proposedAt: string
  resolvedAt: string | null
}

export type SettingsLock = {
  /** `League.season` when it was set; a lock from another season is no lock. */
  season: number | null
  groups: LockGroup[]
  lockedAt: string
  lockedBy: string
  /** A passed vote opens a group until this time. */
  unlockedUntil: Partial<Record<LockGroup, string>>
  votes: UnlockVote[]
}

const isGroup = (x: unknown): x is LockGroup => typeof x === 'string' && (LOCK_GROUPS as readonly string[]).includes(x)
const isRecord = (v: unknown): v is Record<string, unknown> => Boolean(v) && typeof v === 'object' && !Array.isArray(v)

function readVote(v: unknown): UnlockVote | null {
  if (!isRecord(v) || typeof v.id !== 'string' || !isGroup(v.group)) return null
  if (v.status !== 'voting' && v.status !== 'passed' && v.status !== 'failed') return null
  if (typeof v.closesAt !== 'string' || !Number.isFinite(Date.parse(v.closesAt))) return null
  return {
    id: v.id,
    group: v.group,
    reason: typeof v.reason === 'string' ? v.reason : '',
    pollMessageId: typeof v.pollMessageId === 'string' ? v.pollMessageId : null,
    closesAt: v.closesAt,
    status: v.status,
    yes: typeof v.yes === 'number' ? v.yes : null,
    no: typeof v.no === 'number' ? v.no : null,
    proposedBy: typeof v.proposedBy === 'string' ? v.proposedBy : '',
    proposedAt: typeof v.proposedAt === 'string' ? v.proposedAt : v.closesAt,
    resolvedAt: typeof v.resolvedAt === 'string' ? v.resolvedAt : null,
  }
}

/** The lock in force for `currentSeason`, or null (none, unreadable, or from another season). */
export function readSettingsLock(settings: unknown, currentSeason: number | null | undefined): SettingsLock | null {
  const raw = isRecord(settings) ? settings[SETTINGS_LOCK_KEY] : null
  if (!isRecord(raw)) return null
  const season = typeof raw.season === 'number' ? raw.season : null
  if ((season ?? null) !== (currentSeason ?? null)) return null
  const until: Partial<Record<LockGroup, string>> = {}
  if (isRecord(raw.unlockedUntil)) {
    for (const [g, t] of Object.entries(raw.unlockedUntil)) if (isGroup(g) && typeof t === 'string') until[g] = t
  }
  return {
    season,
    groups: Array.isArray(raw.groups) ? LOCK_GROUPS.filter((g) => (raw.groups as unknown[]).includes(g)) : [],
    lockedAt: typeof raw.lockedAt === 'string' ? raw.lockedAt : '',
    lockedBy: typeof raw.lockedBy === 'string' ? raw.lockedBy : '',
    unlockedUntil: until,
    votes: Array.isArray(raw.votes) ? raw.votes.map(readVote).filter((v): v is UnlockVote => v != null) : [],
  }
}

/** A copy of `settings` holding `lock` (removed when it locks nothing and has no vote history). */
export function withSettingsLock(settings: unknown, lock: SettingsLock | null): Record<string, unknown> {
  const base = isRecord(settings) ? { ...settings } : {}
  if (!lock || (!lock.groups.length && !lock.votes.length)) {
    delete base[SETTINGS_LOCK_KEY]
    return base
  }
  const open = lock.votes.filter((v) => v.status === 'voting')
  const done = lock.votes.filter((v) => v.status !== 'voting').slice(0, Math.max(0, VOTES_KEPT - open.length))
  base[SETTINGS_LOCK_KEY] = { ...lock, groups: LOCK_GROUPS.filter((g) => lock.groups.includes(g)), votes: [...open, ...done] }
  return base
}

/** Is this group locked right now (locked, and no passed vote holding it open)? */
export function isGroupLocked(lock: SettingsLock | null, group: LockGroup, now: Date): boolean {
  if (!lock || !lock.groups.includes(group)) return false
  const until = lock.unlockedUntil[group]
  return !(until && Date.parse(until) > now.getTime())
}

// Order matters: a draft-order or draft-slot key is draft setup (never lockable here), a keeper-slot
// key is a keeper rule, a pick-trading key is a trade rule.
// ⚠ The rules that look for a camelCase boundary are CASE-SENSITIVE on purpose: under /i, `[A-Z]`
// matches lowercase too, so `Draft[A-Z]` would swallow `draftPickTrading` and `stat[A-Z_]` would
// catch `status`.
const KEY_RULES: Array<[RegExp, LockGroup | null]> = [
  [/^draft(?!PickTrading)|^draft_|Draft[A-Z]|pickTimer|autostart|AutoPick|autoPick|^rounds$|playerPool|randomize/, null],
  [/trad(e|ing)|veto/i, 'trades'],
  [/keeper/i, 'keepers'],
  [/waiver|faab/i, 'waivers'],
  [/playoff|consolation|toilet|championship|seeding|bye/i, 'playoffs'],
  [/scor|median|ppr|points/i, 'scoring'],
  [/[sS]tat[A-Z_]|[sS]tats$/, 'scoring'],
  [/roster|taxi|lineup|bench|starter|positions?$/i, 'rosters'],
  [/^ir$|^ir[A-Z_]|[a-z]I[rR][A-Z_]|[a-z]IR$|[sS]lots?$/, 'rosters'],
]

/** The lockable group one settings key belongs to, or null for keys no lock covers. */
export function groupForSettingsKey(key: string): LockGroup | null {
  for (const [re, group] of KEY_RULES) if (re.test(key)) return group
  return null
}

const norm = (v: unknown): string => (v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v))

/**
 * Settings keys a patch would actually CHANGE. A settings screen re-sends its whole section, so an
 * unchanged value must not trip a lock. `current(key)` answers the stored value, or undefined when
 * the patch's key is stored somewhere it cannot see — which counts as a change, because a lock that
 * waves through what it cannot compare is not a lock.
 */
export function changedPatchKeys(body: Record<string, unknown>, current: (key: string, fromSettings: boolean) => unknown): string[] {
  const out: string[] = []
  for (const [key, value] of Object.entries(body)) {
    if (key === 'leagueId' || value === undefined) continue
    if (key === 'settingsMerge' && isRecord(value)) {
      for (const [inner, v] of Object.entries(value)) {
        const was = current(inner, true)
        if (was === undefined || norm(was) !== norm(v)) out.push(inner)
      }
      continue
    }
    const was = current(key, false)
    if (was === undefined || norm(was) !== norm(value)) out.push(key)
  }
  return out
}

/** The locked groups a set of changed keys falls in, in group order. */
export function lockedGroupsFor(lock: SettingsLock | null, keys: readonly string[], now: Date): LockGroup[] {
  const touched = new Set(keys.map(groupForSettingsKey).filter((g): g is LockGroup => g != null))
  return LOCK_GROUPS.filter((g) => touched.has(g) && isGroupLocked(lock, g, now))
}

export function lockedMessage(groups: readonly LockGroup[]): string {
  const names = groups.map((g) => LOCK_GROUP_LABELS[g].label.toLowerCase())
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] ?? 'these'
  return `${list[0]?.toUpperCase() ?? ''}${list.slice(1)} settings are locked for the season. A league vote can unlock them.`
}

/** Passed by a strict majority of the votes cast. No votes, or a tie, fails. */
export function tallyUnlock(yes: number, no: number): 'passed' | 'failed' {
  return yes > no ? 'passed' : 'failed'
}

/**
 * Close every vote whose poll has closed, opening each passed group for UNLOCK_WINDOW_MS from the
 * moment it resolved. `pollFor(vote)` gives the poll's counts, or null when it cannot be read — a
 * vote whose poll is gone fails at its deadline rather than staying open forever.
 */
export function resolveUnlockVotes(
  lock: SettingsLock,
  pollFor: (v: UnlockVote) => { yes: number; no: number; closed: boolean } | null,
  now: Date,
): { lock: SettingsLock; resolved: UnlockVote[] } {
  const resolved: UnlockVote[] = []
  const unlockedUntil = { ...lock.unlockedUntil }
  const votes = lock.votes.map((v) => {
    if (v.status !== 'voting') return v
    const poll = pollFor(v)
    let next: UnlockVote | null = null
    if (poll?.closed) next = { ...v, status: tallyUnlock(poll.yes, poll.no), yes: poll.yes, no: poll.no, resolvedAt: now.toISOString() }
    else if (!poll && Date.parse(v.closesAt) <= now.getTime()) next = { ...v, status: 'failed', yes: null, no: null, resolvedAt: now.toISOString() }
    if (!next) return v
    if (next.status === 'passed') unlockedUntil[v.group] = new Date(now.getTime() + UNLOCK_WINDOW_MS).toISOString()
    resolved.push(next)
    return next
  })
  return { lock: resolved.length ? { ...lock, votes, unlockedUntil } : lock, resolved }
}

export function unlockPollQuestion(group: LockGroup, closesAt: string): string {
  return `🔒 Unlock ${LOCK_GROUP_LABELS[group].label.toLowerCase()} settings? They're locked for the season. A majority of votes cast unlocks them for 72 hours. Voting closes ${closesAt.slice(0, 10)}.`
}
