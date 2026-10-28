/**
 * What the league home shows a viewer: the full rules, whether the first-time popup is due, the
 * unseen "What changed" cards and the change history. Pure — the route feeds it rows.
 *
 * Seen-state lives in `UserProfile.corePreferences.leagueRulesSeen[leagueId]` (./seenStore.ts) — the
 * account-scoped JSONB column for Core preferences, so no migration. Shape:
 *   { rulesSeenAt, lastSeenSettingsEventId, lastSeenSettingsEventAt }
 */

import { explainLeagueRules, groupSettingsChanges } from './explain'
import { isChangeableRuleKey } from './changeKeys'
import type { ChangeGroup, RuleChange, RuleSection, RuleSnapshot, SettingsChangeEvent } from './types'

/** Key inside `corePreferences`. */
export const LEAGUE_RULES_SEEN_KEY = 'leagueRulesSeen'

export type LeagueRulesSeen = {
  rulesSeenAt: string | null
  lastSeenSettingsEventId: string | null
  lastSeenSettingsEventAt: string | null
}

export const EMPTY_LEAGUE_RULES_SEEN: LeagueRulesSeen = { rulesSeenAt: null, lastSeenSettingsEventId: null, lastSeenSettingsEventAt: null }

function iso(v: unknown): string | null {
  return typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : null
}

/** One league's entry from a stored `leagueRulesSeen` value (anything malformed reads as unseen). */
export function readLeagueRulesSeen(entry: unknown): LeagueRulesSeen {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return { ...EMPTY_LEAGUE_RULES_SEEN }
  const e = entry as Record<string, unknown>
  return {
    rulesSeenAt: iso(e.rulesSeenAt),
    lastSeenSettingsEventId: typeof e.lastSeenSettingsEventId === 'string' && e.lastSeenSettingsEventId.length <= 64 ? e.lastSeenSettingsEventId : null,
    lastSeenSettingsEventAt: iso(e.lastSeenSettingsEventAt),
  }
}

/** A stored `league_events` row (eventType `settings_changed`). */
export type SettingsEventRow = { id: string; createdAt: Date | string; payload: unknown }

/**
 * The events that carry before/after values. Rows written before this feature (no `ruleChanges`) are
 * skipped — they have nothing to explain — and every change naming an unknown key is dropped.
 */
export function parseSettingsChangeEvents(rows: readonly SettingsEventRow[]): SettingsChangeEvent[] {
  const out: SettingsChangeEvent[] = []
  for (const row of rows) {
    const payload = row.payload && typeof row.payload === 'object' && !Array.isArray(row.payload) ? (row.payload as Record<string, unknown>) : null
    const raw = payload?.ruleChanges
    if (!Array.isArray(raw)) continue
    const changes: RuleChange[] = []
    for (const c of raw) {
      if (!c || typeof c !== 'object') continue
      const key = (c as Record<string, unknown>).key
      if (!isChangeableRuleKey(key)) continue
      changes.push({ key, before: (c as Record<string, unknown>).before ?? null, after: (c as Record<string, unknown>).after ?? null })
    }
    if (!changes.length) continue
    const createdAt = row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt)
    if (!Number.isFinite(Date.parse(createdAt))) continue
    out.push({ id: row.id, createdAt, actorUserId: typeof payload?.actorUserId === 'string' ? payload.actorUserId : null, changes })
  }
  return out
}

/** Seen when at or before the stored marker. Equal timestamps compare by id, so the marker event itself is seen. */
export function isSettingsEventSeen(ev: Pick<SettingsChangeEvent, 'id' | 'createdAt'>, seen: LeagueRulesSeen): boolean {
  if (!seen.lastSeenSettingsEventAt) return false
  const at = Date.parse(ev.createdAt)
  const mark = Date.parse(seen.lastSeenSettingsEventAt)
  if (at < mark) return true
  if (at > mark) return false
  return seen.lastSeenSettingsEventId == null || ev.id <= seen.lastSeenSettingsEventId
}

export type RulesExplainerView = {
  supported: true
  sport: string
  format: RuleSnapshot['format']
  isCommissioner: boolean
  sections: RuleSection[]
  /** First visit after joining (or creating): show the full rules popup. */
  showRulesPopup: boolean
  /** Unseen change cards, newest first. Empty when the league turned commissioner broadcasts off. */
  pendingChanges: ChangeGroup[]
  /** Seen (and own) changes, newest first. */
  history: ChangeGroup[]
  /** The newest settings event — what "rules seen" is recorded up to. */
  latestEvent: { id: string; createdAt: string } | null
}

export const HISTORY_LIMIT = 20

export function buildRulesExplainerView(input: {
  snapshot: RuleSnapshot
  events: readonly SettingsChangeEvent[]
  seen: LeagueRulesSeen
  viewerUserId: string
  isCommissioner: boolean
  /** `League.settings.leagueNotificationPrefs.commissionerBroadcasts` (default on). */
  broadcastsEnabled: boolean
}): RulesExplainerView {
  const { snapshot, events, seen, viewerUserId, isCommissioner, broadcastsEnabled } = input
  const showRulesPopup = seen.rulesSeenAt == null
  // The first-time popup shows the CURRENT rules, so nothing that happened before it is "new" to the
  // viewer. Your own changes are never news to you.
  const unseen = showRulesPopup
    ? []
    : events.filter((ev) => !isSettingsEventSeen(ev, seen) && ev.actorUserId !== viewerUserId)
  const pending = broadcastsEnabled ? groupSettingsChanges(unseen, snapshot) : []
  const pendingIds = new Set(pending.flatMap((g) => g.eventIds))
  const history = groupSettingsChanges(
    events.filter((ev) => !pendingIds.has(ev.id)),
    snapshot,
  ).slice(0, HISTORY_LIMIT)
  const latest = [...events].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.id.localeCompare(a.id))[0]
  return {
    supported: true,
    sport: snapshot.sport,
    format: snapshot.format,
    isCommissioner,
    sections: explainLeagueRules(snapshot, { isCommissioner }),
    showRulesPopup,
    pendingChanges: pending,
    history,
    latestEvent: latest ? { id: latest.id, createdAt: latest.createdAt } : null,
  }
}

/**
 * The next stored entry. Monotonic: a marker never moves backwards (two tabs, a stale card), and
 * `rulesSeenAt` is set once.
 */
export function nextLeagueRulesSeen(
  current: LeagueRulesSeen,
  action: { kind: 'rules'; now: string; latestEvent: { id: string; createdAt: string } | null } | { kind: 'changes'; event: { id: string; createdAt: string } },
): LeagueRulesSeen {
  const next: LeagueRulesSeen = { ...current }
  if (action.kind === 'rules' && !next.rulesSeenAt) next.rulesSeenAt = action.now
  const mark = action.kind === 'rules' ? action.latestEvent : action.event
  if (mark && !isSettingsEventSeen(mark, current)) {
    next.lastSeenSettingsEventId = mark.id
    next.lastSeenSettingsEventAt = mark.createdAt
  }
  return next
}
