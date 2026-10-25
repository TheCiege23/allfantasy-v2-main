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

export type ManagedLineup = { since: string; byUserId: string }
export type ManagedLineups = Record<string, ManagedLineup>

/** Above this share of the open player pool without a projection, the lineup is left alone. */
export const MAX_MISSING_PROJECTION_SHARE = 0.25

export function readManagedLineups(settings: unknown): ManagedLineups {
  const raw = settings && typeof settings === 'object' ? (settings as Record<string, unknown>)[AF_MANAGED_LINEUPS_KEY] : null
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const out: ManagedLineups = {}
  for (const [rosterId, v] of Object.entries(raw as Record<string, unknown>)) {
    const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : null
    if (o && typeof o.since === 'string' && typeof o.byUserId === 'string') out[rosterId] = { since: o.since, byUserId: o.byUserId }
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
    players[id] = { position: (rows.get(id)?.position as string | undefined) ?? p?.position ?? null, projectedPoints: p?.projectedPoints ?? null }
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
