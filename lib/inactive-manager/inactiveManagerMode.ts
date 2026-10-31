/**
 * INACTIVE MANAGER MODE — AllFantasy sets a team's best lineup every week while its manager is away.
 *
 * The commissioner turns it on per team. AllFantasy only ever SUGGESTS teams (the ones manager health
 * already calls inactive), and never switches it on by itself. While it is on, the hourly run sets the
 * projected-best lineup from the players whose games have not started, so a Sunday-morning inactive is
 * benched before kickoff. It turns itself off the moment the owner saves a lineup of their own.
 *
 * The best lineup is the same exact optimiser the lineup screen's "Optimize lineup" button uses
 * (`optimalLineupListsRespectingLocks`): a locked player is never moved, and IR, taxi and devy are
 * never touched — moving those is a roster decision, not a lineup one.
 *
 * Pure. State lives in `League.settings.af_managed_lineups`, keyed by roster id.
 */
import { buildPlayerDataFromSections, getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { buildLineupListsFromPlayerData } from '@/lib/league/lineup-swap'
import { optimalLineupListsRespectingLocks, type LineupPlayerInfo } from '@/lib/league/native/nativeScreenModels'
import type { ExpandedStarterSlot } from '@/lib/league/lineup-expand-template'

export const AF_MANAGED_LINEUPS_KEY = 'af_managed_lineups'

/**
 * How Chimmy runs a team on autopilot (owner decision 2026-10-26, docs/AF_COMMISSIONER_SETTINGS_SPEC.md §5):
 * `dynasty_owner` is the default — protect young players and picks, never sell the future for this
 * week. The commissioner can choose another style per team.
 */
export const AUTOPILOT_STYLES = ['dynasty_owner', 'win_now', 'rebuild'] as const
export type AutopilotStyle = (typeof AUTOPILOT_STYLES)[number]
export const DEFAULT_AUTOPILOT_STYLE: AutopilotStyle = 'dynasty_owner'

export function isAutopilotStyle(v: unknown): v is AutopilotStyle {
  return typeof v === 'string' && (AUTOPILOT_STYLES as readonly string[]).includes(v)
}

/**
 * Chimmy autopilot (AF Commissioner): everything inactive manager mode does, plus roster decisions in
 * the chosen style. Lineup-only management stays free; `autopilot` marks the paid upgrade.
 */
export type ChimmyAutopilot = { style: AutopilotStyle; since: string; byUserId: string }

/**
 * `ownerUserId` is who owned the team when the commissioner switched it on (phase 9, 2026-10-29). The
 * mode is for THAT owner's absence: once the team has a new owner — claimed, adopted, won at auction,
 * reassigned — it no longer applies (`managedForOwner`), and the hourly run ends it. Entries written
 * before this field existed carry none; the hourly run stamps the current owner onto them.
 */
export type ManagedLineup = { since: string; byUserId: string; ownerUserId?: string | null; autopilot?: ChimmyAutopilot }
export type ManagedLineups = Record<string, ManagedLineup>

/**
 * Whether a managed entry still applies to the team's current owner: `current` when it was switched on
 * for this owner, `new_owner` when the team has changed hands since, `unstamped` for an entry written
 * before owners were recorded (treated as current until the hourly run stamps it).
 */
export function managedForOwner(entry: ManagedLineup, currentOwnerId: string | null | undefined): 'current' | 'new_owner' | 'unstamped' {
  if (entry.ownerUserId === undefined) return 'unstamped'
  return (entry.ownerUserId ?? null) === (currentOwnerId ?? null) ? 'current' : 'new_owner'
}

/** Above this share of the open player pool without a projection, the lineup is left alone. */
export const MAX_MISSING_PROJECTION_SHARE = 0.25

export function readManagedLineups(settings: unknown): ManagedLineups {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[AF_MANAGED_LINEUPS_KEY] : null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ManagedLineups = {}
  for (const [rosterId, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
    if (!o || typeof o.since !== 'string' || typeof o.byUserId !== 'string') continue
    const entry: ManagedLineup = { since: o.since, byUserId: o.byUserId }
    if (typeof o.ownerUserId === 'string' || o.ownerUserId === null) entry.ownerUserId = o.ownerUserId as string | null
    const ap = o.autopilot && typeof o.autopilot === 'object' ? (o.autopilot as Record<string, unknown>) : null
    if (ap && typeof ap.since === 'string' && typeof ap.byUserId === 'string') {
      entry.autopilot = { style: isAutopilotStyle(ap.style) ? ap.style : DEFAULT_AUTOPILOT_STYLE, since: ap.since, byUserId: ap.byUserId }
    }
    out[rosterId] = entry
  }
  return out
}

export type LineupPlan =
  | { kind: 'set'; nextPlayerData: Record<string, unknown>; changes: Array<{ slot: string; in: string; out: string | null }> }
  | { kind: 'skip'; reason: 'already_best' | 'no_slots' | 'projections_missing' | 'cannot_fill' }

/**
 * The lineup AllFantasy would set: the projected-best starters among players whose games have not
 * started, seated into the league's slots. `players` carries each player's projection (and a position
 * when the roster row has none).
 */
export function planBestLineup(args: {
  slots: ExpandedStarterSlot[]
  playerData: unknown
  players: Record<string, LineupPlayerInfo | undefined>
  isLocked: (playerId: string) => boolean
  /**
   * Players whose team has no game this week. Each is projected at ZERO, so he is benched whenever a
   * bench player can fill his slot — the weekly projection does not reliably say 0 for a bye (a season
   * rate, or none), and a bye player kept in the lineup scores nothing (phase 6, 2026-10-27).
   */
  onBye?: (playerId: string) => boolean
}): LineupPlan {
  const { slots, playerData, isLocked } = args
  if (slots.length === 0) return { kind: 'skip', reason: 'no_slots' }
  const lists = buildLineupListsFromPlayerData(playerData, slots.length)
  const sections = getNormalizedLineupSections(playerData)
  const rows = new Map<string, Record<string, unknown>>()
  for (const r of [...sections.starters, ...sections.bench]) rows.set(String(r.id), r)

  // The roster row's own position is what the save validates eligibility against; projections fill gaps.
  const players: Record<string, LineupPlayerInfo | undefined> = {}
  for (const id of [...lists.starters, ...lists.bench].filter(Boolean)) {
    const p = args.players[id]
    const projectedPoints = args.onBye?.(id) ? 0 : p?.projectedPoints ?? null
    players[id] = { position: (rows.get(id)?.position as string | undefined) ?? p?.position ?? null, projectedPoints }
  }

  const open = [...lists.starters, ...lists.bench].filter((id) => id && !isLocked(id))
  const missing = open.filter((id) => players[id]?.projectedPoints == null).length
  if (open.length === 0) return { kind: 'skip', reason: 'already_best' }
  if (missing / open.length > MAX_MISSING_PROJECTION_SHARE) return { kind: 'skip', reason: 'projections_missing' }

  const best = optimalLineupListsRespectingLocks(slots, lists, players, isLocked)
  if (!best) return { kind: 'skip', reason: 'already_best' }
  if (best.starters.some((id) => !id)) return { kind: 'skip', reason: 'cannot_fill' }

  const starterRows = best.starters.map((id, slotIndex) => ({ ...(rows.get(id) ?? { id, position: players[id]?.position ?? 'UTIL' }), slotIndex }))
  const benchRows = best.bench.map((id) => {
    const { slotIndex: _drop, ...row } = rows.get(id) ?? { id, position: players[id]?.position ?? 'UTIL' }
    return row
  })
  const changes = best.starters.flatMap((id, i) =>
    id !== (lists.starters[i] ?? '') ? [{ slot: slots[i]?.label ?? `#${i + 1}`, in: id, out: lists.starters[i] || null }] : [],
  )
  return {
    kind: 'set',
    nextPlayerData: buildPlayerDataFromSections(playerData, { ...sections, starters: starterRows, bench: benchRows }),
    changes,
  }
}

export type SuggestionInput = { rosterId: string; status: 'active' | 'at_risk' | 'inactive' | 'unknown' }

/** Teams to suggest: inactive ones not already managed. AllFantasy never acts on these by itself. */
export function suggestInactiveTeams(rows: readonly SuggestionInput[], managed: ManagedLineups): string[] {
  return rows.filter((r) => r.status === 'inactive' && !managed[r.rosterId]).map((r) => r.rosterId)
}

/**
 * Chimmy as a manager (owner decision 2026-10-31): a commissioner can hand up to this many teams in a
 * league to Chimmy — empty seats or absent managers' teams, in any league or draft type AllFantasy
 * runs. Chimmy drafts for them (instantly; in an auction it nominates and bids) and runs them for the
 * season, until a real manager takes the team.
 */
export const CHIMMY_MANAGER_LIMIT = 4

/** Pure: would giving `rosterId` to Chimmy take the league past the limit? */
export function chimmyManagerLimitReached(managed: ManagedLineups, rosterId: string, limit = CHIMMY_MANAGER_LIMIT): boolean {
  if (managed[rosterId]?.autopilot) return false
  return autopilotRosterIds(managed).length >= limit
}

/**
 * Pure: is Chimmy running this roster for its CURRENT owner? An entry switched on before the team
 * changed hands speaks for nobody: the new manager runs it, even before the hourly sweep clears it.
 */
export function isChimmyRunning(managed: ManagedLineups, rosterId: string, currentOwnerId: string | null | undefined): boolean {
  const entry = managed[rosterId]
  return Boolean(entry?.autopilot) && managedForOwner(entry!, currentOwnerId) !== 'new_owner'
}

/** Roster ids Chimmy runs on autopilot in this league. */
export function autopilotRosterIds(managed: ManagedLineups): string[] {
  return Object.entries(managed).flatMap(([id, m]) => (m.autopilot ? [id] : []))
}
