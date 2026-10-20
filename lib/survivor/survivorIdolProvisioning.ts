import { randomInt } from 'node:crypto'
import 'server-only'

import { CURRENT_DRAFT_SESSION_ORDER } from '@/lib/draft-room/currentDraftSession'
import { withSurvivorSetupTransaction } from './survivorSetupTransaction'

import type { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import {
  SURVIVOR_IDOL_CATALOG,
  computePlayerBoundIdolSeedPlan,
  type SurvivorIdolPowerType,
} from './survivorIdolSeedingEngine'
import { normalizeSurvivorFoundationSettings } from './survivorSettings'
import { lockSurvivorIdolDraw } from './survivorIdolConfigService'
import { survivorIdolStoredPowerType, survivorIdolTypeIdForPower } from './survivorIdolTypes'
import { survivorIdolExpiryRule, survivorIdolExpiryText, survivorIdolRowExpiry } from './survivorIdolExpiry'

export type SurvivorIdolSeedOutcome =
  | { ok: true; seeded: boolean; alreadySeeded: boolean; voteShieldCount: number; ownerCount: number; seed: number | null }
  | { ok: false; status: 400 | 422; code: string; error: string }

async function ensureConfigId(leagueId: string, tribeCount: number, idolCount: number, db: Prisma.TransactionClient): Promise<string> {
  const existing = await db.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { id: true, idolCount: true } })
  if (existing) {
    if (existing.idolCount !== idolCount) await db.survivorLeagueConfig.update({ where: { id: existing.id }, data: { idolCount } })
    return existing.id
  }
  const created = await db.survivorLeagueConfig.create({
    data: { leagueId, tribeCount, tribeSize: 5, tribeFormation: 'random', idolCount },
    select: { id: true },
  })
  return created.id
}

export async function getIdolSeedStatus(leagueId: string, db: Prisma.TransactionClient = prisma): Promise<{ seeded: boolean; voteShieldCount: number }> {
  const voteShieldCount = await db.survivorIdol.count({ where: { leagueId } })
  return { seeded: voteShieldCount > 0, voteShieldCount }
}

/**
 * Seed the configured number of hidden player-bound idols after a completed native draft.
 * The default is one third of the cast; added idols may give a manager more than one. Persists
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

  const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true, survivorIdolCount: true, userId: true } })
  if (!league) return { ok: false, status: 422, code: 'league_missing', error: 'League not found.' }
  const settings = normalizeSurvivorFoundationSettings(league.settings as Record<string, unknown> | null)
  // One league rule for expiry, stamped on every idol and told to its holder.
  const expiryRule = survivorIdolExpiryRule(settings)
  const rowExpiry = survivorIdolRowExpiry(expiryRule)
  const expiryText = survivorIdolExpiryText(expiryRule)
  const tribeCount = Math.max(1, Math.floor(opts.tribeCount ?? (await db.survivorTribe.count({ where: { leagueId } })) ?? 4))
  // The league's idol types: drawn at draft lock (or now, if lock was missed). Null keeps the
  // legacy power-pool path for leagues with a commissioner-saved pool or before migration.
  const draw = await lockSurvivorIdolDraw(leagueId, db)
  const typeById = new Map((draw?.types ?? []).map(type => [survivorIdolStoredPowerType(type), type]))
  const idolCount = draw ? draw.types.length : league.survivorIdolCount ?? settings.idolCount
  const draft = await db.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { id: true, status: true, sessionKind: true } })
  if (!draft || draft.status !== 'completed' || draft.sessionKind === 'mock') {
    return { ok: false, status: 422, code: 'draft_not_ready', error: 'Finish the current native draft before idols can be assigned to real players.' }
  }

  const players = await db.survivorPlayer.findMany({
    where: { leagueId, playerState: 'active' },
    select: { userId: true, redraftRosterId: true },
  })
  const ownerByRoster = new Map(players.filter(player => player.redraftRosterId).map(player => [player.redraftRosterId!, player.userId]))
  if (ownerByRoster.size !== players.length) return { ok: false, status: 422, code: 'cast_incomplete', error: 'Every active Survivor manager needs a drafted roster before idols can be assigned.' }
  const rosterLinks = await db.roster.findMany({
    where: { leagueId, id: { in: [...ownerByRoster.keys()] } },
    select: { id: true, redraftRosterId: true },
  })
  if (rosterLinks.length !== ownerByRoster.size || rosterLinks.some(roster => !roster.redraftRosterId)) {
    return { ok: false, status: 422, code: 'season_rosters_not_ready', error: 'Finish linking drafted teams to native season rosters before idols can be assigned.' }
  }
  const picks = await db.draftPick.findMany({ where: { sessionId: draft.id }, select: { playerId: true, playerName: true, rosterId: true, assetType: true }, orderBy: { overall: 'asc' } })
  const candidates = picks.filter(pick => pick.playerId && (!pick.assetType || pick.assetType === 'player') && ownerByRoster.has(pick.rosterId))
    .map(pick => ({ playerId: pick.playerId!, playerName: pick.playerName, rosterId: pick.rosterId, ownerUserId: ownerByRoster.get(pick.rosterId)! }))
  const config = await db.survivorLeagueConfig.findUnique({ where: { leagueId }, select: { idolPowerPool: true } })
  const powerPool = Array.isArray(config?.idolPowerPool) ? config.idolPowerPool.filter((power): power is string => typeof power === 'string') as SurvivorIdolPowerType[] : undefined
  const plan = computePlayerBoundIdolSeedPlan({
    candidates, idolCount, powerPool,
    ...(draw ? { powerTypes: draw.types.map(survivorIdolStoredPowerType) } : {}),
    seed: opts.seed ?? randomInt(0, 2_147_483_647),
  })
  if (!plan.ok) {
    return { ok: false, status: 422, code: plan.code, error: plan.error }
  }

  const configId = await ensureConfigId(leagueId, tribeCount, idolCount, db)
  const ownerIds = new Set<string>()

  const write = async (tx: Prisma.TransactionClient) => {
    if (status.seeded && opts.allowReseed) {
      const ids = ((await tx.survivorIdol.findMany({ where: { leagueId }, select: { id: true } })) as Array<{ id: string }>).map((i) => i.id)
      if (ids.length) await tx.leagueChatMessage.deleteMany({ where: { leagueId, id: { in: ids.map(id => `survivor-idol:${id}:notice`) } } })
      if (ids.length) await tx.survivorIdolLedgerEntry.deleteMany({ where: { idolId: { in: ids } } })
      await tx.survivorIdol.deleteMany({ where: { leagueId } })
      await tx.survivorPlayer.updateMany({ where: { leagueId }, data: { idolIds: [] } })
    }

    const idsByOwner = new Map<string, string[]>()
    for (const a of plan.assignments) {
      const type = typeById.get(a.powerType)
      const legacy = SURVIVOR_IDOL_CATALOG[a.powerType as SurvivorIdolPowerType]
      const spec = type
        ? { label: type.name, description: type.power, category: type.category.toLowerCase() }
        : { label: legacy?.label ?? a.powerType, description: legacy?.description ?? '', category: legacy?.category ?? 'game' }
      ownerIds.add(a.ownerUserId)
      const idol = await tx.survivorIdol.create({
        data: {
          leagueId,
          configId,
          rosterId: a.rosterId,
          playerId: a.playerId,
          powerType: a.powerType,
          powerLabel: spec.label,
          powerDesc: spec.description,
          powerCategory: spec.category,
          status: 'hidden',
          isSecret: true,
          isPubliclyKnown: false,
          isUsed: false,
          isTradable: true,
          currentOwnerUserId: a.ownerUserId,
          originalOwnerUserId: a.ownerUserId,
          expiresAtMerge: rowExpiry.expiresAtMerge,
          expiresAtWeek: rowExpiry.expiresAtWeek,
          validUntilPhase: rowExpiry.validUntilPhase,
          playWindowRule: 'before_reveal',
          rarity: 'common',
          assignedAt: new Date(),
          auditLog: { assignedSource: 'phase2_seed', playerId: a.playerId, expiry: expiryRule, ...(type ? { idolTypeId: type.id } : {}) },
        },
        select: { id: true },
      })
      await tx.survivorIdolLedgerEntry.create({
        data: { leagueId, idolId: idol.id, eventType: 'assigned', toRosterId: a.rosterId, metadata: { source: 'phase2_seed', playerId: a.playerId, powerType: a.powerType } },
      })
      const player = await tx.sportsPlayer.findFirst({
        where: { sport: 'NBA', OR: [{ id: a.playerId }, { externalId: a.playerId }, { sleeperId: a.playerId }] },
        select: { name: true, imageUrl: true },
      })
      await tx.leagueChatMessage.create({
        data: {
          id: `survivor-idol:${idol.id}:notice`,
          leagueId,
          userId: league.userId,
          message: `@Chimmy: ${player?.name ?? a.playerName ?? 'Your drafted player'} holds your secret ${spec.label}. ${spec.description} ${expiryText} Keep this between us; the official idol follows that player through trades and waivers.`,
          type: 'system',
          imageUrl: player?.imageUrl ?? null,
          isPrivate: true,
          visibleToUserId: a.ownerUserId,
          messageSubtype: 'chimmy_private',
          metadata: { chimmyPrivateReply: true, survivorIdolReveal: true, idolId: idol.id, playerId: a.playerId, playerName: player?.name ?? a.playerName ?? null, playerImageUrl: player?.imageUrl ?? null, idolTypeId: type?.id ?? survivorIdolTypeIdForPower(a.powerType), idolLabel: spec.label, idolDescription: spec.description, expiryText },
        },
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
        data: { count: plan.assignments.length, draftSessionId: draft.id, tribeCount, ownerCount: ownerIds.size },
        isVisibleToCommissioner: true,
        isVisibleToPublic: false,
      },
    })
  }
  await write(db)

  return { ok: true, seeded: true, alreadySeeded: false, voteShieldCount: plan.assignments.length, ownerCount: ownerIds.size, seed: plan.seed }
}
