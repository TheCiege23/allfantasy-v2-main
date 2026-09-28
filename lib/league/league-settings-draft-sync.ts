import type { LeagueSettings } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { pickTimerSecondsFromLeagueSettings } from '@/lib/league/league-settings-pick-timer'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'

type SlotRow = { slot: number; rosterId: string; displayName: string }

function draftTypeToSessionFields(draftType: string): { draftType: string; thirdRoundReversal: boolean } {
  const x = String(draftType ?? '').trim().toLowerCase()

  // Third-round reversal modifier (both id variants) — snake pick order + 3RR flag
  if (x === '3rd_reversal' || x === 'third_round_reversal') {
    return { draftType: 'snake', thirdRoundReversal: true }
  }

  // Auction and all auction variants (devy_auction, c2c_auction)
  if (x === 'auction' || x.endsWith('_auction')) {
    return { draftType: 'auction', thirdRoundReversal: false }
  }

  // Linear and all linear variants (devy_linear, c2c_linear)
  if (x === 'linear' || x.endsWith('_linear')) {
    return { draftType: 'linear', thirdRoundReversal: false }
  }

  // Execution modes — map to snake pick order; execution flags are stored
  // separately in LeagueSettings.aiAutoPick / League.settings.draft_execution_offline.
  if (x === 'offline' || x === 'auto' || x === 'team') {
    return { draftType: 'snake', thirdRoundReversal: false }
  }

  // Practice + lifecycle aliases with explicit order mode.
  if (
    x === 'mock_linear' ||
    x === 'slow_linear' ||
    x === 'supplemental_linear' ||
    x === 'dispersal_linear' ||
    x === 'mock_draft_linear' ||
    x === 'slow_draft_linear' ||
    x === 'supplemental_draft_linear' ||
    x === 'dispersal_draft_linear'
  ) {
    return { draftType: 'linear', thirdRoundReversal: false }
  }
  if (
    x === 'mock_snake' ||
    x === 'slow_snake' ||
    x === 'supplemental_snake' ||
    x === 'dispersal_snake' ||
    x === 'mock_draft_snake' ||
    x === 'slow_draft_snake' ||
    x === 'supplemental_draft_snake' ||
    x === 'dispersal_draft_snake'
  ) {
    return { draftType: 'snake', thirdRoundReversal: false }
  }

  // Async / practice modes — snake pick order, no 3RR
  if (x === 'mock_draft' || x === 'slow_draft') {
    return { draftType: 'snake', thirdRoundReversal: false }
  }

  // Lifecycle phases — snake pick order by default
  if (x === 'supplemental_draft' || x === 'dispersal_draft' || x === 'rookie_draft' || x === 'startup_draft') {
    return { draftType: 'snake', thirdRoundReversal: false }
  }

  // Snake and all snake variants (devy_snake, c2c_snake) — default pick order
  return { draftType: 'snake', thirdRoundReversal: false }
}

/**
 * Map LeagueSettings.draftOrderSlots JSON to DraftSession.slotOrder.
 *
 * ⚠ `ownerId` here is whatever the settings screen stored, and the League Settings tab and the
 * randomize route store the `LeagueTeam.id`. The draft engine keys every slot on a ROSTER id
 * (`live-draft-engine/auth.ts`), so copying the team id through put nobody on the clock: every
 * manager's pick was refused and only the commissioner could draft — and the next draft-room
 * visit read every unrecognised id as an empty slot and materialized an AI roster for it. Pass
 * `resolveRosterId` to translate; a slot it cannot place is dropped, and a partial order is not
 * applied at all (see `syncDraftSessionFromLeagueSettings`).
 */
export function draftOrderSlotsToSlotOrder(
  draftOrderSlots: unknown,
  fallbackTeamCount: number,
  resolveRosterId: (ownerId: string) => string | null = (ownerId) => ownerId,
): SlotRow[] {
  if (!Array.isArray(draftOrderSlots)) return []
  const rows: SlotRow[] = []
  for (const raw of draftOrderSlots) {
    if (!raw || typeof raw !== 'object') continue
    const o = raw as Record<string, unknown>
    const slot = typeof o.slot === 'number' ? o.slot : Number(o.slot)
    const ownerId = typeof o.ownerId === 'string' ? o.ownerId : null
    const ownerName = typeof o.ownerName === 'string' ? o.ownerName : 'Team'
    if (!Number.isFinite(slot) || slot < 1 || !ownerId) continue
    const rosterId = resolveRosterId(ownerId)
    if (!rosterId) continue
    rows.push({ slot, rosterId, displayName: ownerName })
  }
  rows.sort((a, b) => a.slot - b.slot)
  if (rows.length >= fallbackTeamCount) return rows
  return rows
}

/** Draft statuses in which the draft has not started — the only ones a settings save may rewrite. */
const NOT_STARTED_DRAFT_STATUSES = new Set(['pre_draft', 'configuring', 'configured'])

/** LeagueSettings keys this sync carries onto the draft session. */
export const DRAFT_SESSION_SYNC_KEYS = [
  'pickTimerPreset',
  'pickTimerCustomValue',
  'draftType',
  'rounds',
  'aiAutoPick',
  'cpuAutoPick',
  'playerPool',
  'alphabeticalSort',
  'draftOrderSlots',
] as const

type ResolverRoster = { id: string; platformUserId: string }
type ResolverTeam = { id: string; externalId: string; claimedByUserId: string | null; platformUserId: string | null }

/**
 * Resolve whatever a settings screen stored as a slot owner to the roster id the draft engine
 * uses: a roster id is kept; a `LeagueTeam.id` becomes its roster — by `externalId` (a native
 * team's is its roster id), else by the person who holds it.
 */
export function buildRosterIdResolver(
  rosters: readonly ResolverRoster[],
  teams: readonly ResolverTeam[],
): (ownerId: string) => string | null {
  const rosterIds = new Set(rosters.map((r) => r.id))
  const rosterByOwner = new Map(rosters.map((r) => [r.platformUserId, r.id] as const))
  const teamToRoster = new Map<string, string>()
  for (const team of teams) {
    const rosterId = rosterIds.has(team.externalId)
      ? team.externalId
      : (team.claimedByUserId && rosterByOwner.get(team.claimedByUserId)) ||
        (team.platformUserId && rosterByOwner.get(team.platformUserId)) ||
        null
    if (rosterId) teamToRoster.set(team.id, rosterId)
  }
  return (ownerId) => (rosterIds.has(ownerId) ? ownerId : teamToRoster.get(ownerId) ?? null)
}

async function loadRosterIdResolver(leagueId: string): Promise<(ownerId: string) => string | null> {
  const [rosters, teams] = await Promise.all([
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
    prisma.leagueTeam.findMany({
      where: { leagueId },
      select: { id: true, externalId: true, claimedByUserId: true, platformUserId: true },
    }),
  ])
  return buildRosterIdResolver(rosters, teams)
}

export type DraftSessionSyncResult =
  | { synced: true }
  | { synced: false; reason: 'no_session' | 'draft_started' | 'nothing_to_sync' }

/**
 * Push LeagueSettings onto the league's draft session — before it starts, and only the fields
 * that changed.
 *
 * 🛑 It used to run on EVERY settings save, at any draft status, and rewrote every field. A
 * timezone or keeper-count edit re-pushed rounds, draft type, 3RR and order over whatever the
 * draft room had set, mid-draft or on a draft that had already completed. `changedKeys` limits it
 * to what the caller actually patched (omit it to push everything, e.g. after a fresh upsert).
 */
export async function syncDraftSessionFromLeagueSettings(
  leagueId: string,
  ls: LeagueSettings,
  leagueTeamCount: number,
  changedKeys?: ReadonlySet<string>,
): Promise<DraftSessionSyncResult> {
  const session = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  if (!session) return { synced: false, reason: 'no_session' }
  if (!NOT_STARTED_DRAFT_STATUSES.has(session.status)) return { synced: false, reason: 'draft_started' }

  const has = (key: (typeof DRAFT_SESSION_SYNC_KEYS)[number]) => !changedKeys || changedKeys.has(key)
  const data: Prisma.DraftSessionUpdateInput = {}

  if (has('pickTimerPreset') || has('pickTimerCustomValue')) {
    data.timerSeconds = pickTimerSecondsFromLeagueSettings(ls.pickTimerPreset, ls.pickTimerCustomValue)
  }
  if (has('draftType')) {
    const { draftType, thirdRoundReversal } = draftTypeToSessionFields(ls.draftType)
    data.draftType = draftType
    data.thirdRoundReversal = thirdRoundReversal
  }
  if (has('rounds')) data.rounds = Math.max(1, Math.min(50, ls.rounds))
  if (has('aiAutoPick')) data.aiAutoPick = ls.aiAutoPick
  if (has('cpuAutoPick')) data.cpuAutoPick = ls.cpuAutoPick
  if (has('playerPool')) data.playerPool = ls.playerPool
  if (has('alphabeticalSort')) data.alphabeticalSort = ls.alphabeticalSort
  if (has('draftOrderSlots')) {
    const resolveRosterId = await loadRosterIdResolver(leagueId)
    const stored = Array.isArray(ls.draftOrderSlots) ? ls.draftOrderSlots.length : 0
    const slotOrder = draftOrderSlotsToSlotOrder(ls.draftOrderSlots, leagueTeamCount, resolveRosterId)
    // Apply only an order that places every stored slot. A partial one would leave teams off
    // the board, and the draft room turns a missing slot into an AI roster.
    if (slotOrder.length > 0 && slotOrder.length === stored) {
      data.slotOrder = slotOrder as unknown as Prisma.InputJsonValue
    }
  }

  if (Object.keys(data).length === 0) return { synced: false, reason: 'nothing_to_sync' }

  await prisma.draftSession.update({
    where: { id: session.id },
    data: { ...data, version: { increment: 1 } },
  })
  return { synced: true }
}
