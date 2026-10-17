/**
 * Commish "Edit Rosters" for leagues hosted on AllFantasy: add free agents, drop players, and move
 * players and dynasty future picks between teams (send, receive and switch are all moves).
 *
 * 🛑 A NATIVE ROSTER LIVES IN TWO PLACES AND NOTHING SYNCS THEM. `Roster.playerData` is what the
 * roster screen, lineups, waivers, trades and the free-agent pool read; `RedraftRosterPlayer` rows
 * are what SCORING reads (lib/redraft/scoringEngine.ts). An edit that wrote one would leave a player
 * on a team that does not score him, or scoring a team he left. Every edit here writes both, in one
 * transaction, when the team has a redraft counterpart (`Roster.redraftRosterId`).
 *
 * A commish edit deliberately overrides the ordinary transaction rules — roster locks, "lock all
 * moves", kickoff locks, claim periods, drop limits — because fixing a roster is the point. It never
 * overrides integrity: a player cannot be on two teams, an imported league is read-only here, and a
 * Guillotine team that has been chopped cannot gain or lose anyone.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import {
  addPlayerToRosterData,
  getRosterPlayerIds,
  removePlayerFromRosterData,
} from '@/lib/waiver-wire/roster-utils'
import { applyTradeAssetsInTransaction, type LeagueTradeTx } from '@/lib/league-trade-engine/tradeProcessor'
import { parseInventoryPickId } from '@/lib/league-trade-engine/nativeFuturePicks'
import type { TradeAssetInput } from '@/lib/league-trade-engine/types'

export type CommishPlayerInput = { id: string; name?: string; position?: string; team?: string | null }
export type CommishMove = { fromRosterId: string; toRosterId: string; playerIds?: string[]; pickRefs?: string[] }
export type CommishRosterEdit =
  | { action: 'add'; rosterId: string; players: CommishPlayerInput[] }
  | { action: 'drop'; rosterId: string; playerIds: string[] }
  | { action: 'move'; moves: CommishMove[] }

export class CommishRosterEditError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

export type CommishRosterEditResult = {
  changedRosterIds: string[]
  added: string[]
  dropped: string[]
  moved: Array<{ playerId?: string; pickRef?: string; fromRosterId: string; toRosterId: string }>
  /** Rosters with no scoring counterpart, so only `playerData` changed. Reported, not hidden. */
  rostersWithoutScoringRow: string[]
}

const MAX_ITEMS = 25

/** Structural checks that need no database. Exported for tests. */
export function validateCommishRosterEdit(edit: CommishRosterEdit): string | null {
  if (edit.action === 'add') {
    if (!edit.rosterId) return 'Choose a team.'
    const ids = edit.players.map((p) => p.id)
    if (ids.length === 0 || ids.length > MAX_ITEMS) return `Add between 1 and ${MAX_ITEMS} players.`
    if (ids.some((id) => !id) || new Set(ids).size !== ids.length) return 'Each player can be added once.'
    return null
  }
  if (edit.action === 'drop') {
    if (!edit.rosterId) return 'Choose a team.'
    if (edit.playerIds.length === 0 || edit.playerIds.length > MAX_ITEMS) return `Drop between 1 and ${MAX_ITEMS} players.`
    if (new Set(edit.playerIds).size !== edit.playerIds.length) return 'Each player can be dropped once.'
    return null
  }
  if (edit.moves.length === 0) return 'Nothing to move.'
  const players = edit.moves.flatMap((m) => m.playerIds ?? [])
  const picks = edit.moves.flatMap((m) => m.pickRefs ?? [])
  if (players.length + picks.length === 0 || players.length + picks.length > MAX_ITEMS) {
    return `Move between 1 and ${MAX_ITEMS} players or picks.`
  }
  if (new Set(players).size !== players.length || new Set(picks).size !== picks.length) {
    return 'Each player or pick can move once.'
  }
  if (edit.moves.some((m) => !m.fromRosterId || !m.toRosterId || m.fromRosterId === m.toRosterId)) {
    return 'Players must move between two different teams.'
  }
  if (picks.some((ref) => !parseInventoryPickId(ref))) return 'Only future draft picks can be moved here.'
  return null
}

export async function executeCommishRosterEdit(
  leagueId: string,
  edit: CommishRosterEdit,
): Promise<CommishRosterEditResult> {
  const structural = validateCommishRosterEdit(edit)
  if (structural) throw new CommishRosterEditError(structural)

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { platform: true, sport: true } })
  if (!league) throw new CommishRosterEditError('League not found', 404)
  if (resolveWriteAuthority(league.platform) !== 'NATIVE') {
    throw new CommishRosterEditError('Imported leagues are edited on their host platform.', 409)
  }

  const touched =
    edit.action === 'move'
      ? [...new Set(edit.moves.flatMap((m) => [m.fromRosterId, m.toRosterId]))]
      : [edit.rosterId]

  const chopped = await prisma.guillotineRosterState.findMany({
    where: { rosterId: { in: touched }, choppedAt: { not: null } },
    select: { rosterId: true },
  })
  if (chopped.length > 0) throw new CommishRosterEditError('A chopped Guillotine team cannot change.', 409)

  const sport = String(league.sport ?? 'NFL')
  const now = new Date()
  const result: CommishRosterEditResult = { changedRosterIds: touched, added: [], dropped: [], moved: [], rostersWithoutScoringRow: [] }

  await prisma.$transaction(async (tx) => {
    const rosters = await tx.roster.findMany({
      where: { leagueId },
      select: { id: true, playerData: true, redraftRosterId: true },
    })
    const byId = new Map(rosters.map((r) => [r.id, r]))
    for (const id of touched) if (!byId.has(id)) throw new CommishRosterEditError('A team is not in this league.')
    const redraftIdOf = (id: string) => byId.get(id)?.redraftRosterId ?? null
    for (const id of touched) if (!redraftIdOf(id)) result.rostersWithoutScoringRow.push(id)
    const seasonOf = new Map<string, string>()
    const redraftIds = touched.map(redraftIdOf).filter((x): x is string => Boolean(x))
    if (redraftIds.length > 0) {
      for (const r of await tx.redraftRoster.findMany({ where: { id: { in: redraftIds } }, select: { id: true, seasonId: true } })) {
        seasonOf.set(r.id, r.seasonId)
      }
    }
    const logRedraft = async (rosterId: string, type: string, metadata: Record<string, unknown>) => {
      const rr = redraftIdOf(rosterId)
      const seasonId = rr ? seasonOf.get(rr) : undefined
      if (rr && seasonId) {
        await tx.redraftLeagueTransaction.create({
          data: { leagueId, seasonId, rosterId: rr, type, metadata: { ...metadata, commissionerOverride: true } },
        })
      }
    }

    if (edit.action === 'add') {
      const owned = new Set(rosters.flatMap((r) => getRosterPlayerIds(r.playerData)))
      const taken = edit.players.find((p) => owned.has(p.id))
      if (taken) throw new CommishRosterEditError(`${taken.name ?? taken.id} is already on a team.`, 409)
      let data: unknown = byId.get(edit.rosterId)!.playerData
      for (const p of edit.players) data = addPlayerToRosterData(data, p.id)
      await tx.roster.update({ where: { id: edit.rosterId }, data: { playerData: data as never } })
      const rr = redraftIdOf(edit.rosterId)
      if (rr) {
        await tx.redraftRosterPlayer.createMany({
          data: edit.players.map((p) => ({
            rosterId: rr,
            playerId: p.id,
            playerName: p.name?.trim() || p.id,
            position: p.position?.trim() || 'UNK',
            team: p.team ?? null,
            sport,
            slotType: 'BENCH',
            acquisitionType: 'free_agent',
            addedAt: now,
          })),
        })
      }
      await logRedraft(edit.rosterId, 'commissioner_add', { playerIds: edit.players.map((p) => p.id) })
      result.added = edit.players.map((p) => p.id)
      return
    }

    if (edit.action === 'drop') {
      let data: unknown = byId.get(edit.rosterId)!.playerData
      const onRoster = new Set(getRosterPlayerIds(data))
      const missing = edit.playerIds.find((id) => !onRoster.has(id))
      if (missing) throw new CommishRosterEditError('A player is not on that team.', 409)
      for (const id of edit.playerIds) data = removePlayerFromRosterData(data, id)
      await tx.roster.update({ where: { id: edit.rosterId }, data: { playerData: data as never } })
      const rr = redraftIdOf(edit.rosterId)
      if (rr) {
        await tx.redraftRosterPlayer.updateMany({
          where: { rosterId: rr, playerId: { in: edit.playerIds }, droppedAt: null },
          data: { droppedAt: now },
        })
      }
      await logRedraft(edit.rosterId, 'commissioner_drop', { playerIds: edit.playerIds })
      result.dropped = edit.playerIds
      return
    }

    // Moves — players and future picks — through the same mover accepted trades use.
    const assets: TradeAssetInput[] = edit.moves.flatMap((m) => [
      ...(m.playerIds ?? []).map((id) => ({ itemType: 'player' as const, itemReference: id, fromRosterId: m.fromRosterId, toRosterId: m.toRosterId, metadata: { commissioner: true } })),
      ...(m.pickRefs ?? []).map((ref) => ({ itemType: 'future_pick' as const, itemReference: ref, fromRosterId: m.fromRosterId, toRosterId: m.toRosterId, metadata: { commissioner: true } })),
    ])
    try {
      await applyTradeAssetsInTransaction(tx as LeagueTradeTx, {
        leagueId,
        proposerRosterId: edit.moves[0]!.fromRosterId,
        receiverRosterId: edit.moves[0]!.toRosterId,
        participantRosterIds: touched,
        assets,
      })
    } catch (e) {
      throw new CommishRosterEditError((e as Error).message || 'Move failed', 409)
    }

    for (const m of edit.moves) {
      const ids = m.playerIds ?? []
      if (ids.length > 0) {
        const fromRr = redraftIdOf(m.fromRosterId)
        const toRr = redraftIdOf(m.toRosterId)
        if (fromRr && toRr) {
          await tx.redraftRosterPlayer.updateMany({
            where: { rosterId: fromRr, playerId: { in: ids }, droppedAt: null },
            data: { rosterId: toRr, acquisitionType: 'trade', slotType: 'BENCH', isLocked: false, addedAt: now },
          })
        } else if (fromRr) {
          // No scoring row on the receiving side: the old team must at least stop scoring him.
          await tx.redraftRosterPlayer.updateMany({
            where: { rosterId: fromRr, playerId: { in: ids }, droppedAt: null },
            data: { droppedAt: now },
          })
        }
      }
      const meta = { playerIds: ids, pickRefs: m.pickRefs ?? [], fromRosterId: m.fromRosterId, toRosterId: m.toRosterId }
      await logRedraft(m.fromRosterId, 'commissioner_move_out', meta)
      await logRedraft(m.toRosterId, 'commissioner_move_in', meta)
      result.moved.push(
        ...ids.map((playerId) => ({ playerId, fromRosterId: m.fromRosterId, toRosterId: m.toRosterId })),
        ...(m.pickRefs ?? []).map((pickRef) => ({ pickRef, fromRosterId: m.fromRosterId, toRosterId: m.toRosterId })),
      )
    }
  }, { isolationLevel: 'Serializable' }) // two commishes adding the same free agent at once: one wins

  return result
}
