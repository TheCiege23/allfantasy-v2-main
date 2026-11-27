/**
 * AF places the league's LOCKED keepers on its draft board — AF Commissioner / AF Supreme.
 *
 * Without it the commissioner enters each keeper on the board by hand (POST
 * /api/leagues/[leagueId]/draft/keepers), as on most apps. With `keeper_auto_place_board` on, every
 * locked `KeeperRecord` of the latest locked keeper window takes his team's own pick in the round he
 * costs (./keeperBoardPlacement), on the league's current PRE-DRAFT board:
 *
 *   - when keepers lock (./selectionEngine `lockKeeperSelections`, deadline cron included)
 *   - when the next season's draft is created (lib/live-draft-engine/createNextLeagueDraft.ts)
 *   - on demand, from the commissioner (POST …/draft/keepers/auto-place)
 *
 * The plan that unlocks it is the COMMISSIONER's (`League.userId`), checked on every run — a league
 * whose plan lapsed keeps its board as it is and goes back to the manual flow.
 *
 * Writes only `DraftSession.keeperSelections` / `keeperConfig` (JSON), never a schema change. A keeper
 * the commissioner placed by hand with an override stays, and his round is not reused.
 */

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { commissionerHasKeeperAutomation } from './keeperCommissionerPlan'
import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { draftRosterIdForOwner } from '@/lib/live-draft-engine/createNextLeagueDraft'
import type { KeeperConfig, KeeperSelection } from '@/lib/live-draft-engine/keeper/types'
import type { KeeperAutoPlacementSummary, SlotOrderEntry, TradedPickRecord } from '@/lib/live-draft-engine/types'
import { resolveKeeperRules } from './keeperRules'
import { placeKeepersOnBoard, type KeeperForBoard } from './keeperBoardPlacement'
import { readKeeperAutoBoard } from './keeperAutoBoardSetting'

export { commissionerHasKeeperAutomation }

export type KeeperAutoBoardOutcome =
  | { ok: true; draftSessionId: string; summary: KeeperAutoPlacementSummary }
  | { ok: false; code: 'NOT_ENABLED' | 'NOT_ENTITLED' | 'NO_PRE_DRAFT_BOARD' | 'AUCTION_DRAFT' | 'NO_LOCKED_KEEPERS' | 'LEAGUE_NOT_FOUND'; message: string }

const norm = (s: string) => s.trim().toLowerCase()

/**
 * Place the locked keepers. `requireSetting: false` is the commissioner's explicit "place them now";
 * the automatic hooks pass true. The plan is checked either way.
 */
export async function placeLockedKeepersOnDraftBoard(
  leagueId: string,
  options: { requireSetting: boolean },
): Promise<KeeperAutoBoardOutcome> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, userId: true, settings: true, keeperCostSystem: true, keeperRoundPenalty: true, keeperInflationRate: true, keeperConflictRule: true, keeperCount: true },
  })
  if (!league) return { ok: false, code: 'LEAGUE_NOT_FOUND', message: 'League not found' }
  if (options.requireSetting && !readKeeperAutoBoard(league.settings)) {
    return { ok: false, code: 'NOT_ENABLED', message: 'Automatic keeper placement is off for this league.' }
  }
  if (!(await commissionerHasKeeperAutomation(league.userId))) {
    return { ok: false, code: 'NOT_ENTITLED', message: 'Placing keepers on the draft board automatically requires AF Commissioner or AF Supreme.' }
  }

  const draft = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER })
  if (!draft || draft.status !== 'pre_draft') {
    return { ok: false, code: 'NO_PRE_DRAFT_BOARD', message: 'Keepers go on the board before the draft starts. There is no draft waiting to start.' }
  }
  if (draft.draftType === 'auction') {
    return { ok: false, code: 'AUCTION_DRAFT', message: 'An auction draft has no round picks for keepers to occupy.' }
  }

  const window = await prisma.keeperSelectionSession.findFirst({
    where: { leagueId, status: 'locked' },
    orderBy: [{ lockedAt: 'desc' }, { openedAt: 'desc' }],
    select: { seasonId: true },
  })
  const locked = window
    ? await prisma.keeperRecord.findMany({
        where: { leagueId, seasonId: window.seasonId, status: 'locked', costRound: { not: null } },
        orderBy: [{ costRound: 'asc' }, { playerName: 'asc' }],
        select: { rosterId: true, playerId: true, playerName: true, position: true, team: true, costRound: true },
      })
    : []
  if (!window || locked.length === 0) {
    return { ok: false, code: 'NO_LOCKED_KEEPERS', message: 'No locked keepers to place yet. Keepers are placed once they lock.' }
  }

  // A season roster's owner → the draft roster a pick is made for (the same mapping the next draft uses).
  const [seasonRosters, draftRosters] = await Promise.all([
    prisma.redraftRoster.findMany({ where: { leagueId, seasonId: window.seasonId }, select: { id: true, ownerId: true } }),
    prisma.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
  ])
  const ownerBySeasonRoster = new Map(seasonRosters.map((r) => [r.id, r.ownerId]))
  const unmapped: KeeperAutoPlacementSummary['flagged'] = []
  const keepers: KeeperForBoard[] = []
  for (const k of locked) {
    const ownerId = ownerBySeasonRoster.get(k.rosterId)
    const rosterId = ownerId ? draftRosterIdForOwner(ownerId, draftRosters) : null
    if (!rosterId) {
      unmapped.push({ rosterId: k.rosterId, playerId: k.playerId, playerName: k.playerName, costRound: k.costRound!, message: `${k.playerName}'s team could not be matched to a team on the draft board. The commissioner needs to place him.` })
      continue
    }
    keepers.push({ rosterId, playerId: k.playerId, playerName: k.playerName, position: k.position, team: k.team ?? null, costRound: k.costRound! })
  }

  // Selections the commissioner entered by hand stay; an earlier auto run is replaced.
  const existing = (Array.isArray(draft.keeperSelections) ? (draft.keeperSelections as unknown as KeeperSelection[]) : [])
  const autoNames = new Set(keepers.map((k) => `${k.rosterId}|${norm(k.playerName)}`))
  const manual = existing.filter((s) => !s.autoPlaced && !autoNames.has(`${s.rosterId}|${norm(s.playerName)}`))
  const reserved = new Map<string, Set<number>>()
  for (const s of manual) reserved.set(s.rosterId, (reserved.get(s.rosterId) ?? new Set()).add(s.roundCost))

  const placement = placeKeepersOnBoard(resolveKeeperRules(league), keepers, {
    slotOrder: (draft.slotOrder as unknown as SlotOrderEntry[]) ?? [],
    tradedPicks: Array.isArray(draft.tradedPicks) ? (draft.tradedPicks as unknown as TradedPickRecord[]) : [],
    rounds: draft.rounds,
  }, reserved)

  const selections: KeeperSelection[] = [...manual, ...placement.selections]
  const perRoster = new Map<string, number>()
  for (const s of selections) perRoster.set(s.rosterId, (perRoster.get(s.rosterId) ?? 0) + 1)
  const summary: KeeperAutoPlacementSummary = {
    at: new Date().toISOString(),
    placed: placement.selections.length,
    moved: placement.selections.filter((s) => s.placementNote).length,
    flagged: [...unmapped, ...placement.flagged.map(({ rosterId, playerId, playerName, costRound, message }) => ({ rosterId, playerId, playerName, costRound, message }))],
  }
  const current = (draft.keeperConfig && typeof draft.keeperConfig === 'object' ? draft.keeperConfig : {}) as unknown as KeeperConfig
  const config: KeeperConfig = {
    ...current,
    maxKeepers: Math.max(current.maxKeepers ?? 0, league.keeperCount ?? 0, ...perRoster.values(), 0),
    autoPlacement: summary,
  }

  // Optimistic on `version`: a commissioner edit that lands mid-run is not overwritten.
  const written = await prisma.draftSession.updateMany({
    where: { id: draft.id, version: draft.version, status: 'pre_draft' },
    data: {
      keeperSelections: selections as unknown as Prisma.InputJsonValue,
      keeperConfig: config as unknown as Prisma.InputJsonValue,
      version: { increment: 1 },
      updatedAt: new Date(),
    },
  })
  if (written.count === 0) {
    return { ok: false, code: 'NO_PRE_DRAFT_BOARD', message: 'The draft board changed while keepers were being placed. Try again.' }
  }
  return { ok: true, draftSessionId: draft.id, summary }
}

/** The automatic hooks: never throws, never blocks the lock or the draft it runs after. */
export async function autoPlaceKeepersIfEnabled(leagueId: string): Promise<KeeperAutoBoardOutcome | null> {
  try {
    return await placeLockedKeepersOnDraftBoard(leagueId, { requireSetting: true })
  } catch (error) {
    console.error('[keeper] automatic keeper placement failed', { leagueId, error: error instanceof Error ? error.message : error })
    return null
  }
}
