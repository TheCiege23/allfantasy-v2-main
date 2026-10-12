import { randomInt } from 'node:crypto'
import 'server-only'

import { withSurvivorSetupTransaction } from './survivorSetupTransaction'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  SURVIVOR_IDOL_CATALOG,
  computeIdolSeedPlan,
  type IdolSeedParticipant,
} from './survivorIdolSeedingEngine'

const DEFAULT_ROSTER_SPOTS = 15

export type SurvivorIdolSeedOutcome =
  | { ok: true; seeded: boolean; alreadySeeded: boolean; voteShieldCount: number; ownerCount: number; seed: number | null }
  | { ok: false; status: 400 | 422; code: string; error: string }

async function ensureConfigId(leagueId: string, tribeCount: number, db: Prisma.TransactionClient): Promise<string> {
  const existing = await db.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true } })
  if (existing) return existing.id
  const created = await db.survivorLeagueConfig.create({
    data: { leagueId, tribeCount, tribeSize: 5, tribeFormation: 'random' },
    select: { id: true },
  })
  return created.id
}

export async function getIdolSeedStatus(leagueId: string, db: Prisma.TransactionClient = prisma): Promise<{ seeded: boolean; voteShieldCount: number }> {
  const voteShieldCount = await db.survivorIdol.count({ where: { leagueId, powerType: 'vote_shield' } })
  return { seeded: voteShieldCount > 0, voteShieldCount }
}

/**
 * Seed the canonical Vote Shield idols ONCE: count = rosterSpots + tribeCount, hidden,
 * randomly distributed across active participants (multiple per user allowed). Persists
 * SurvivorIdol rows (status=hidden, isSecret=true), a per-idol ledger entry (assignment),
 * and a commissioner-only summary audit entry. Idempotent: re-running is a no-op unless
 * `allowReseed` is set (reset path).
 */
export async function seedSurvivorIdols(
  leagueId: string,
  opts: { tribeCount?: number; rosterSpots?: number; seed?: number | null; actorUserId?: string; allowReseed?: boolean; db?: Prisma.TransactionClient } = {},
): Promise<SurvivorIdolSeedOutcome> {
  if (!opts.db) return withSurvivorSetupTransaction(leagueId, (db) => seedSurvivorIdols(leagueId, { ...opts, db }))
  const db = opts.db
  const status = await getIdolSeedStatus(leagueId, db)
  if (status.seeded && !opts.allowReseed) {
    return { ok: true, seeded: false, alreadySeeded: true, voteShieldCount: status.voteShieldCount, ownerCount: 0, seed: null }
  }

  const league = await db.league.findUnique({ where: { id: leagueId }, select: { rosterSize: true } })
  const tribeCount = Math.max(1, Math.floor(opts.tribeCount ?? (await db.survivorTribe.count({ where: { leagueId } })) ?? 4))
  const rosterSpots = Math.max(1, Math.floor(opts.rosterSpots ?? league?.rosterSize ?? DEFAULT_ROSTER_SPOTS))

  const players = await db.survivorPlayer.findMany({
    where: { leagueId, playerState: 'active' },
    select: { userId: true, redraftRosterId: true },
  })
  const participants: IdolSeedParticipant[] = (players as Array<{ userId: string; redraftRosterId: string | null }>).map(
    (p) => ({ userId: p.userId, rosterId: p.redraftRosterId ?? p.userId }),
  )

  const plan = computeIdolSeedPlan({ participants, rosterSpots, tribeCount, seed: opts.seed ?? randomInt(0, 2_147_483_647) })
  if (!plan.ok) {
    return { ok: false, status: plan.code === 'no_participants' ? 422 : 400, code: plan.code, error: plan.error }
  }

  const configId = await ensureConfigId(leagueId, tribeCount, db)
  const spec = SURVIVOR_IDOL_CATALOG.vote_shield
  const ownerIds = new Set<string>()

  const write = async (tx: Prisma.TransactionClient) => {
    if (status.seeded && opts.allowReseed) {
      const ids = ((await tx.survivorIdol.findMany({ where: { leagueId }, select: { id: true } })) as Array<{ id: string }>).map((i) => i.id)
      if (ids.length) await tx.survivorIdolLedgerEntry.deleteMany({ where: { idolId: { in: ids } } })
      await tx.survivorIdol.deleteMany({ where: { leagueId } })
      await tx.survivorPlayer.updateMany({ where: { leagueId }, data: { idolIds: [] } })
    }

    const idsByOwner = new Map<string, string[]>()
    for (const a of plan.assignments) {
      ownerIds.add(a.ownerUserId)
      const idol = await tx.survivorIdol.create({
        data: {
          leagueId,
          configId,
          rosterId: a.rosterId,
          playerId: a.rosterId,
          powerType: 'vote_shield',
          powerLabel: spec.label,
          powerDesc: spec.description,
          powerCategory: spec.category,
          status: 'hidden',
          isSecret: true,
          isPubliclyKnown: false,
          isUsed: false,
          isTradable: false,
          currentOwnerUserId: a.ownerUserId,
          originalOwnerUserId: a.ownerUserId,
          expiresAtMerge: false,
          validUntilPhase: 'final_5',
          playWindowRule: 'before_reveal',
          rarity: 'common',
          assignedAt: new Date(),
          auditLog: { assignedSource: 'phase2_seed', seed: plan.seed, expiresAtRemainingPlayers: a.expiresAtRemainingPlayers },
        },
        select: { id: true },
      })
      await tx.survivorIdolLedgerEntry.create({
        data: { leagueId, idolId: idol.id, eventType: 'assigned', toRosterId: a.rosterId, metadata: { source: 'phase2_seed', powerType: 'vote_shield' } },
      })
      const arr = idsByOwner.get(a.ownerUserId) ?? []
      arr.push(idol.id)
      idsByOwner.set(a.ownerUserId, arr)
    }

    // Sync each owner's SurvivorPlayer.idolIds[] for inventory consistency.
    for (const [userId, ids] of idsByOwner) {
      const player = await tx.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { idolIds: true } })
      if (player) {
        await tx.survivorPlayer.update({
          where: { leagueId_userId: { leagueId, userId } },
          data: { idolIds: Array.from(new Set([...(player.idolIds ?? []), ...ids])) },
        })
      }
    }

    // Commissioner-only summary audit (NOT public — hidden ownership stays hidden).
    await tx.survivorAuditEntry.create({
      data: {
        leagueId,
        category: 'idol',
        action: 'idols_seeded',
        actorUserId: null,
        data: { powerType: 'vote_shield', count: plan.voteShieldCount, rosterSpots, tribeCount, seed: plan.seed, ownerCount: ownerIds.size },
        isVisibleToCommissioner: true,
        isVisibleToPublic: false,
      },
    })
  }
  await write(db)

  return { ok: true, seeded: true, alreadySeeded: false, voteShieldCount: plan.voteShieldCount, ownerCount: ownerIds.size, seed: plan.seed }
}
