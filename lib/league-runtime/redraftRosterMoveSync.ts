import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import { findSportsPlayerByLeagueId } from '@/lib/player-identity/findSportsPlayerByLeagueId'
import { slotTypeFor } from './redraftSlotType'

/**
 * Carry a NATIVE roster move (waiver award, free-agent add/drop, trade) into `RedraftRosterPlayer`.
 *
 * 🛑 THE BUG THIS CLOSES. Native scoring decides who scores from `RedraftRosterPlayer` —
 * `scoreRosterStarters` live and `finalizeRedraftWeek` at the seal. The native waiver screen
 * (`lib/waiver-wire/process-engine.ts`), the instant add/drop (`free-agent-service.ts`) and the
 * generic trade processor (`lib/league-trade-engine/tradeProcessor.ts`) wrote `Roster.playerData`
 * only. `redraftSlotSync` updates EXISTING rows on a lineup save and the materializer runs on
 * imports only, so nothing created a row for the new player: a waiver pickup could be started,
 * show in the lineup, and score zero all season, while the dropped player kept a live row.
 *
 * ⚠ EVENT-SCOPED, NOT A ROSTER DIFF. Only the players named in `moves` are touched. On a native
 * league the redraft rows are the side the engines own and `playerData` can be the stale one
 * (see `materializeRedraftRosterPlayers`), so diffing the whole blob would resurrect or drop
 * players nobody moved — the two-way sync this codebase has already shipped wrong twice.
 *
 * Reads happen now, against `db`; the returned writes are LAZY Prisma promises built on `db`, so
 * a caller can spread them into an array `$transaction` (pass `prisma`) or await them inside an
 * interactive one (pass `tx`). NATIVE leagues only: an imported league is a SHADOW twin and must
 * never reach redraft tables. A roster with no linked `RedraftRoster` has nothing to keep.
 */

type Db = Prisma.TransactionClient | typeof prisma

export interface RedraftRosterMove {
  playerId: string
  /** Generic `Roster.id` the player left, or null for a pure add. */
  fromRosterId: string | null
  /** Generic `Roster.id` the player joined, or null for a pure drop. */
  toRosterId: string | null
}

export interface PlanRedraftRosterMoveInput {
  leagueId: string
  moves: RedraftRosterMove[]
  /** `acquisitionType` on a row this move creates or moves — 'waiver' | 'free_agent' | 'trade'. */
  acquisitionType: string
  /** The rosters' `playerData` AFTER the move, keyed by generic `Roster.id`, for the slot rule. */
  playerDataByRoster?: ReadonlyMap<string, unknown>
}

type PlayerMeta = { playerName: string; position: string; team: string | null }

/** Same lookup order as `resolveNflRedraftWaiverRuntime`: our id / Sleeper id first. */
async function resolvePlayerMeta(db: Db, sport: string, playerId: string): Promise<PlayerMeta> {
  const row = await db.sportsPlayer
    .findFirst({ where: { id: playerId }, select: { name: true, position: true, team: true } })
    .then((own) => own ?? findSportsPlayerByLeagueId(sport, playerId))
    .catch(() => null)
  return {
    playerName: row?.name || playerId,
    // `position` is non-nullable on the model; 'UNK' is the placeholder the draft path already writes.
    position: row?.position || 'UNK',
    team: row?.team ?? null,
  }
}

export async function planRedraftRosterMoveWrites(
  db: Db,
  input: PlanRedraftRosterMoveInput,
): Promise<Prisma.PrismaPromise<unknown>[]> {
  const moves = input.moves.filter((m) => m.playerId && (m.fromRosterId || m.toRosterId))
  if (moves.length === 0) return []

  const league = await db.league.findUnique({
    where: { id: input.leagueId },
    select: { platform: true, sport: true },
  })
  if (!league || resolveWriteAuthority(league.platform) !== 'NATIVE') return []
  const sport = String(league.sport ?? 'NFL')

  const rosterIds = [...new Set(moves.flatMap((m) => [m.fromRosterId, m.toRosterId]).filter(Boolean))] as string[]
  const rosters = await db.roster.findMany({
    where: { id: { in: rosterIds }, leagueId: input.leagueId },
    select: { id: true, redraftRosterId: true },
  })
  const linkOf = new Map(rosters.map((r) => [r.id, r.redraftRosterId ?? null]))
  const link = (rosterId: string | null) => (rosterId ? linkOf.get(rosterId) ?? null : null)

  const writes: Prisma.PrismaPromise<unknown>[] = []
  for (const move of moves) {
    const fromRedraft = link(move.fromRosterId)
    const toRedraft = link(move.toRosterId)
    if (!fromRedraft && !toRedraft) continue

    const fromRow = fromRedraft
      ? await db.redraftRosterPlayer.findFirst({
          where: { rosterId: fromRedraft, playerId: move.playerId, droppedAt: null },
          select: { id: true, position: true },
        })
      : null

    if (!toRedraft) {
      if (fromRow) {
        writes.push(db.redraftRosterPlayer.updateMany({
          where: { id: fromRow.id, droppedAt: null },
          data: { droppedAt: new Date() },
        }))
      }
      continue
    }

    // Already live on the receiving roster: another writer got there first. Nothing to add.
    const alreadyThere = await db.redraftRosterPlayer.findFirst({
      where: { rosterId: toRedraft, playerId: move.playerId, droppedAt: null },
      select: { id: true },
    })
    const toData = move.toRosterId ? input.playerDataByRoster?.get(move.toRosterId) : undefined

    if (alreadyThere) {
      if (fromRow) {
        writes.push(db.redraftRosterPlayer.updateMany({
          where: { id: fromRow.id, droppedAt: null },
          data: { droppedAt: new Date() },
        }))
      }
      continue
    }

    if (fromRow) {
      // A trade moves the row, as `lib/redraft/tradeSettlement.ts` does, so its history travels with it.
      writes.push(db.redraftRosterPlayer.updateMany({
        where: { id: fromRow.id, droppedAt: null },
        data: {
          rosterId: toRedraft,
          acquisitionType: input.acquisitionType,
          slotType: slotTypeFor(toData, move.playerId, fromRow.position),
          isLocked: false,
        },
      }))
      continue
    }

    const meta = await resolvePlayerMeta(db, sport, move.playerId)
    writes.push(db.redraftRosterPlayer.create({
      data: {
        rosterId: toRedraft,
        playerId: move.playerId,
        playerName: meta.playerName,
        position: meta.position,
        team: meta.team,
        sport,
        slotType: slotTypeFor(toData, move.playerId, meta.position),
        acquisitionType: input.acquisitionType,
      },
    }))
  }
  return writes
}

/** Interactive-transaction form: plan and apply inside `tx`. */
export async function applyRedraftRosterMoves(
  tx: Prisma.TransactionClient,
  input: PlanRedraftRosterMoveInput,
): Promise<{ written: number }> {
  const writes = await planRedraftRosterMoveWrites(tx, input)
  for (const w of writes) await w
  return { written: writes.length }
}
