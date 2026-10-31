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
import { SURVIVOR_IDOL_PICK_COUNT_MAX, survivorIdolStoredPowerType, survivorIdolTypeIdForPower } from './survivorIdolTypes'
import { SURVIVOR_NOTIFICATION_SPECS, survivorNotificationCopy } from './survivorNotificationCatalog'
import { survivorIdolExpiryRule, survivorIdolExpiryText, survivorIdolRowExpiry } from './survivorIdolExpiry'
import {
  SURVIVOR_POOL_IDOL_ROSTER_ID,
  SURVIVOR_WAIVER_IDOL_ROSTER_ID,
  SURVIVOR_WAIVER_IMMUNITY_IDOLS,
  SURVIVOR_WAIVER_IMMUNITY_POWER,
  chooseWaiverImmunityPlayers,
  computeSurvivorIdolPoolPlacement,
  type PoolIdolCandidate,
} from './survivorIdolPoolPlacement'

export type SurvivorIdolSeedOutcome =
  | { ok: true; seeded: boolean; alreadySeeded: boolean; voteShieldCount: number; ownerCount: number; seed: number | null; fromPool?: number; waiverImmunity?: number }
  | { ok: false; status: 400 | 422; code: string; error: string }

export type SurvivorIdolPlacementOutcome =
  | { ok: true; placed: boolean; alreadyPlaced: boolean; count: number }
  | { ok: false; status: 422; code: string; error: string }

type PoolEntryLike = { playerId?: unknown; name?: unknown; adp?: unknown; aiAdp?: unknown }

/*
 * 🛑 READ THE CACHED POOL BEFORE BUILDING ONE. The draft room, autopick and lookahead keep the pool
 * in the draft-pool cache for the whole draft, and its key depends on the roster template, never on
 * who has been drafted. A cold build costs ~160 s for a 16-team NFL pool. Measured in the season
 * rehearsal: both post-draft bootstraps (DraftSessionService and postDraftFinalizeArtifacts) built
 * it from scratch for the waiver-wire idols, so tribes appeared minutes after the last pick. The
 * cached row, fresh or stale, is the pool the draft just used; drafted players are excluded here.
 */
async function readCachedPoolEntries(leagueId: string): Promise<PoolEntryLike[] | null> {
  const { getWarmDraftPoolSnapshotFast, readStaleDraftPoolRow, resolveDraftPoolCacheContext } = await import('@/lib/draft-room/ensureDraftPoolReady')
  const warm = await getWarmDraftPoolSnapshotFast(leagueId)
  if (warm.warm && warm.payload.entries?.length) return warm.payload.entries as PoolEntryLike[]
  const context = await resolveDraftPoolCacheContext(leagueId)
  const stale = await readStaleDraftPoolRow(leagueId, { cacheKey: context.standardCacheKey, rosterFp: context.rosterFp })
  return stale?.payload.entries?.length ? stale.payload.entries as PoolEntryLike[] : null
}

/** The draft pool as idol candidates: stable ids with ADP, best first. Lazy: the pool is heavy. */
async function loadPoolCandidates(leagueId: string, limit: number, excludeDraftedPlayerIds?: ReadonlySet<string>): Promise<PoolIdolCandidate[]> {
  const cached = await readCachedPoolEntries(leagueId).catch(() => null)
  const entries: PoolEntryLike[] = cached ?? (await (await import('@/lib/draft-room/getResolvedDraftPoolForLeague'))
    .getResolvedDraftPoolForLeague(leagueId, { limit, excludeDraftedPlayerIds })).entries
  return entries
    .filter(entry => entry.playerId && !excludeDraftedPlayerIds?.has(String(entry.playerId)))
    .slice(0, limit)
    .map(entry => ({
      playerId: String(entry.playerId),
      playerName: typeof entry.name === 'string' ? entry.name : null,
      adp: typeof entry.adp === 'number' ? entry.adp : typeof entry.aiAdp === 'number' ? entry.aiAdp : null,
    }))
}

/*
 * 🛑 THE POOL BUILD NEVER RUNS INSIDE A SETUP TRANSACTION. A cold `getResolvedDraftPoolForLeague`
 * takes ~95 s for a 16-team NFL pool; the setup transaction times out at 30 s. Measured in the
 * season rehearsal: the draft-lock placement died with "Transaction already closed" every time
 * (swallowed, so no idol was ever hidden in the pool), holding the setup lock while it did. The
 * outer, lock-free callers load the pool first and hand the rows in.
 */

/** Waiver-wire immunity idols go on two of the best undrafted players. */
const SURVIVOR_WAIVER_POOL_LIMIT = 120

/** Pool rows to read before draft-lock placement: twice the largest window it can use. */
function placementPoolLimit(teamCount: number, rounds: number): number {
  return Math.max(SURVIVOR_IDOL_PICK_COUNT_MAX, Math.floor(teamCount) * Math.floor(rounds)) * 2
}

/**
 * The undrafted pool for the waiver-wire immunity idols, read OUTSIDE any transaction, or
 * undefined when the post-draft seed will not place them (no idols waiting in the pool, or the
 * league is already seeded). Callers pass the result to `seedSurvivorIdols` as `waiverPool`.
 */
export async function loadSurvivorWaiverIdolPool(leagueId: string): Promise<PoolIdolCandidate[] | undefined> {
  const [pooled, seeded] = await Promise.all([
    prisma.survivorIdol.count({ where: { leagueId, rosterId: SURVIVOR_POOL_IDOL_ROSTER_ID } }),
    prisma.survivorIdol.count({ where: { leagueId, ...SEEDED_IDOL_WHERE } }),
  ])
  if (pooled === 0 || seeded > 0) return undefined
  const draft = await prisma.draftSession.findFirst({ where: { leagueId }, orderBy: CURRENT_DRAFT_SESSION_ORDER, select: { id: true, status: true } })
  if (!draft || draft.status !== 'completed') return undefined
  const picks = await prisma.draftPick.findMany({ where: { sessionId: draft.id }, select: { playerId: true } })
  const drafted = new Set(picks.map(pick => pick.playerId).filter((id): id is string => Boolean(id)))
  return loadPoolCandidates(leagueId, SURVIVOR_WAIVER_POOL_LIMIT, drafted).catch(() => undefined)
}

/** Seeded (post-draft) idols only: a pool placement waiting for the draft does not count. */
const SEEDED_IDOL_WHERE = { rosterId: { not: SURVIVOR_POOL_IDOL_ROSTER_ID } } as const

/**
 * Draft lock (owner's call, 2026-10-20): hide the sealed idol types on random players in the draft
 * pool — the top `teamCount × rounds` by ADP, so a pick can carry one. Rows are written with the
 * pool sentinel roster and no owner; nobody, not even the commissioner, can read which players.
 * Idempotent: a league with any idol row keeps what it has. Non-fatal for the draft: the caller
 * swallows a failure and the post-draft path still seeds idols the older way.
 */
export async function placeSurvivorIdolsInPool(
  leagueId: string,
  opts: { teamCount: number; rounds: number; seed?: number | null; actorUserId?: string; db?: Prisma.TransactionClient; poolCandidates?: PoolIdolCandidate[] },
): Promise<SurvivorIdolPlacementOutcome> {
  if (!opts.db) {
    // Cheap checks first, so a league that already placed (or has idols off) never pays for a build.
    const existing = await prisma.survivorIdol.count({ where: { leagueId } })
    if (existing > 0) return { ok: true, placed: false, alreadyPlaced: true, count: existing }
    const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    if (league && !normalizeSurvivorFoundationSettings(league.settings as Record<string, unknown> | null).idolsEnabled) {
      return { ok: true, placed: false, alreadyPlaced: false, count: 0 }
    }
    const poolCandidates = opts.poolCandidates ?? await loadPoolCandidates(leagueId, placementPoolLimit(opts.teamCount, opts.rounds))
    return withSurvivorSetupTransaction(leagueId, (db) => placeSurvivorIdolsInPool(leagueId, { ...opts, poolCandidates, db }))
  }
  const db = opts.db
  const existing = await db.survivorIdol.count({ where: { leagueId } })
  if (existing > 0) return { ok: true, placed: false, alreadyPlaced: true, count: existing }
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  if (!league) return { ok: false, status: 422, code: 'league_missing', error: 'League not found.' }
  const settings = normalizeSurvivorFoundationSettings(league.settings as Record<string, unknown> | null)
  if (!settings.idolsEnabled) return { ok: true, placed: false, alreadyPlaced: false, count: 0 }
  const draw = await lockSurvivorIdolDraw(leagueId, db)
  if (!draw || draw.types.length === 0) return { ok: false, status: 422, code: 'no_draw', error: 'The idol draw is not sealed for this league.' }
  const windowSize = Math.max(draw.types.length, Math.floor(opts.teamCount) * Math.floor(opts.rounds))
  if (!opts.poolCandidates) return { ok: false, status: 422, code: 'pool_not_loaded', error: 'Load the draft pool before opening the setup transaction.' }
  const candidates = opts.poolCandidates.slice(0, windowSize * 2)
  const plan = computeSurvivorIdolPoolPlacement({
    candidates, windowSize, powerTypes: draw.types.map(survivorIdolStoredPowerType), seed: opts.seed ?? randomInt(0, 2_147_483_647),
  })
  if (!plan.ok) return { ok: false, status: 422, code: plan.code, error: plan.error }
  const expiry = survivorIdolRowExpiry(survivorIdolExpiryRule(settings))
  const typeByPower = new Map(draw.types.map(type => [survivorIdolStoredPowerType(type), type]))
  const configId = await ensureConfigId(leagueId, Math.max(1, settings.tribeCount), draw.types.length, db)
  for (const placement of plan.placements) {
    const type = typeByPower.get(placement.powerType)
    const legacy = SURVIVOR_IDOL_CATALOG[placement.powerType as SurvivorIdolPowerType]
    const idol = await db.survivorIdol.create({
      data: {
        leagueId, configId, rosterId: SURVIVOR_POOL_IDOL_ROSTER_ID, playerId: placement.playerId, powerType: placement.powerType,
        powerLabel: type?.name ?? legacy?.label ?? placement.powerType, powerDesc: type?.power ?? legacy?.description ?? '',
        powerCategory: (type?.category ?? legacy?.category ?? 'game').toLowerCase(),
        status: 'hidden', isSecret: true, isPubliclyKnown: false, isUsed: false, isTradable: true,
        currentOwnerUserId: null, originalOwnerUserId: null,
        expiresAtMerge: expiry.expiresAtMerge, expiresAtWeek: expiry.expiresAtWeek, validUntilPhase: expiry.validUntilPhase,
        playWindowRule: 'before_reveal', rarity: 'common', assignedAt: new Date(),
        auditLog: { assignedSource: 'draft_pool', playerId: placement.playerId, playerName: placement.playerName, ...(type ? { idolTypeId: type.id } : {}) },
      },
      select: { id: true },
    })
    await db.survivorIdolLedgerEntry.create({ data: { leagueId, idolId: idol.id, eventType: 'placed', toRosterId: null, metadata: { source: 'draft_pool', playerId: placement.playerId, powerType: placement.powerType } } })
  }
  // Commissioner-only count. Which players hold them is never written anywhere readable.
  await db.survivorAuditEntry.create({ data: {
    leagueId, category: 'idol', action: 'idols_placed', actorUserId: opts.actorUserId ?? null,
    data: { count: plan.placements.length, windowSize }, isVisibleToCommissioner: true, isVisibleToPublic: false,
  } })
  return { ok: true, placed: true, alreadyPlaced: false, count: plan.placements.length }
}

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
  const voteShieldCount = await db.survivorIdol.count({ where: { leagueId, ...SEEDED_IDOL_WHERE } })
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
  opts: {
    tribeCount?: number; rosterSpots?: number; seed?: number | null; actorUserId?: string; allowReseed?: boolean; db?: Prisma.TransactionClient
    /** The undrafted pool from `loadSurvivorWaiverIdolPool`; without it no waiver-wire idols are placed. */
    waiverPool?: PoolIdolCandidate[]
  } = {},
): Promise<SurvivorIdolSeedOutcome> {
  if (!opts.db) {
    const waiverPool = opts.waiverPool ?? await loadSurvivorWaiverIdolPool(leagueId)
    return withSurvivorSetupTransaction(leagueId, (db) => seedSurvivorIdols(leagueId, { ...opts, waiverPool, db }))
  }
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

  // Idols hidden in the pool at draft lock: whoever drafted the player found one; the rest stay
  // on the wire. Then two immunity idols go on undrafted players for the waiver wire.
  const pooled = await db.survivorIdol.findMany({
    where: { leagueId, rosterId: SURVIVOR_POOL_IDOL_ROSTER_ID },
    select: { id: true, playerId: true, powerType: true, powerLabel: true, powerDesc: true, auditLog: true },
  })
  if (pooled.length > 0 && !(status.seeded && opts.allowReseed)) {
    return resolvePooledIdols(leagueId, { db, league, draftId: draft.id, pooled, candidates, tribeCount, expiryText, rowExpiry, seed: opts.seed ?? randomInt(0, 2_147_483_647), waiverPool: opts.waiverPool })
  }
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

    // Push and email ("you hold an idol", never which one) for every holder, written in the same
    // transaction as the idols so a rolled-back seed queues nothing. The legacy path did this;
    // the native path only wrote the private chat card.
    const idolFound = survivorNotificationCopy({ kind: 'idol_found' })
    const idolSpec = SURVIVOR_NOTIFICATION_SPECS.idol_found
    for (const ownerUserId of ownerIds) {
      await tx.survivorNotification.create({
        data: {
          leagueId, type: 'idol_found', recipientUserId: ownerUserId,
          title: idolFound.title, body: idolFound.body, deepLinkPath: idolSpec.path(leagueId),
          urgency: idolSpec.urgency, isSpoilerSafe: true, scheduledFor: new Date(), status: 'pending',
        },
      })
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

type PooledIdolRow = { id: string; playerId: string; powerType: string; powerLabel: string | null; powerDesc: string | null; auditLog: unknown }
type DraftedCandidate = { playerId: string; playerName: string | null; rosterId: string; ownerUserId: string }

async function resolvePooledIdols(
  leagueId: string,
  input: {
    db: Prisma.TransactionClient
    league: { userId: string }
    draftId: string
    pooled: PooledIdolRow[]
    candidates: DraftedCandidate[]
    tribeCount: number
    expiryText: string
    rowExpiry: { expiresAtMerge: boolean; expiresAtWeek: number | null; validUntilPhase: string }
    seed: number
    waiverPool?: PoolIdolCandidate[]
  },
): Promise<SurvivorIdolSeedOutcome> {
  const { db, league, pooled, candidates } = input
  const byPlayer = new Map(candidates.map(candidate => [candidate.playerId, candidate]))
  const ownerIds = new Set<string>()
  const idsByOwner = new Map<string, string[]>()
  let drafted = 0
  let undrafted = 0
  for (const idol of pooled) {
    const pick = byPlayer.get(idol.playerId)
    const previous = idol.auditLog && typeof idol.auditLog === 'object' && !Array.isArray(idol.auditLog) ? idol.auditLog as Record<string, unknown> : {}
    if (!pick) {
      undrafted += 1
      await db.survivorIdol.update({ where: { id: idol.id }, data: { rosterId: SURVIVOR_WAIVER_IDOL_ROSTER_ID, auditLog: { ...previous, resolvedSource: 'undrafted', draftSessionId: input.draftId } } })
      await db.survivorIdolLedgerEntry.create({ data: { leagueId, idolId: idol.id, eventType: 'waived', fromRosterId: SURVIVOR_POOL_IDOL_ROSTER_ID, toRosterId: null, metadata: { reason: 'undrafted', playerId: idol.playerId, powerType: idol.powerType } } })
      continue
    }
    drafted += 1
    ownerIds.add(pick.ownerUserId)
    await db.survivorIdol.update({
      where: { id: idol.id },
      data: { rosterId: pick.rosterId, currentOwnerUserId: pick.ownerUserId, originalOwnerUserId: pick.ownerUserId, assignedAt: new Date(), auditLog: { ...previous, resolvedSource: 'drafted', draftSessionId: input.draftId } },
    })
    await db.survivorIdolLedgerEntry.create({ data: { leagueId, idolId: idol.id, eventType: 'assigned', fromRosterId: SURVIVOR_POOL_IDOL_ROSTER_ID, toRosterId: pick.rosterId, metadata: { source: 'draft_pool', playerId: idol.playerId, powerType: idol.powerType } } })
    const player = await db.sportsPlayer.findFirst({
      where: { sport: 'NBA', OR: [{ id: idol.playerId }, { externalId: idol.playerId }, { sleeperId: idol.playerId }] },
      select: { name: true, imageUrl: true },
    })
    const label = idol.powerLabel ?? idol.powerType
    await db.leagueChatMessage.create({
      data: {
        id: `survivor-idol:${idol.id}:notice`,
        leagueId,
        userId: league.userId,
        message: `@Chimmy: You drafted ${player?.name ?? pick.playerName ?? 'a player'} and found a hidden ${label}. ${idol.powerDesc ?? ''} ${input.expiryText} Keep this between us; the official idol follows that player through trades and waivers.`.replace(/\s+/g, ' ').trim(),
        type: 'system',
        imageUrl: player?.imageUrl ?? null,
        isPrivate: true,
        visibleToUserId: pick.ownerUserId,
        messageSubtype: 'chimmy_private',
        metadata: { chimmyPrivateReply: true, survivorIdolReveal: true, idolId: idol.id, playerId: idol.playerId, playerName: player?.name ?? pick.playerName ?? null, playerImageUrl: player?.imageUrl ?? null, idolTypeId: survivorIdolTypeIdForPower(idol.powerType), idolLabel: label, idolDescription: idol.powerDesc ?? null, expiryText: input.expiryText, foundInDraft: true },
      },
    })
    idsByOwner.set(pick.ownerUserId, [...(idsByOwner.get(pick.ownerUserId) ?? []), idol.id])
  }
  for (const [userId, ids] of idsByOwner) {
    const row = await db.survivorPlayer.findUnique({ where: { leagueId_userId: { leagueId, userId } }, select: { idolIds: true } })
    if (row) await db.survivorPlayer.update({ where: { leagueId_userId: { leagueId, userId } }, data: { idolIds: Array.from(new Set([...(row.idolIds ?? []), ...ids])) } })
  }

  // Two immunity idols on undrafted players, for the waiver wire. Never on a player already carrying one.
  let waiverImmunity = 0
  const draftedIds = new Set(candidates.map(candidate => candidate.playerId))
  const carrying = new Set(pooled.map(idol => idol.playerId))
  try {
    const undraftedPool = input.waiverPool ?? []
    const chosen = chooseWaiverImmunityPlayers({ undrafted: undraftedPool.filter(candidate => !draftedIds.has(candidate.playerId)), excludePlayerIds: carrying, count: SURVIVOR_WAIVER_IMMUNITY_IDOLS, windowSize: 40, seed: input.seed })
    if (chosen.length) {
      const configId = await ensureConfigId(leagueId, input.tribeCount, pooled.length, db)
      const spec = SURVIVOR_IDOL_CATALOG[SURVIVOR_WAIVER_IMMUNITY_POWER]
      for (const player of chosen) {
        const idol = await db.survivorIdol.create({
          data: {
            leagueId, configId, rosterId: SURVIVOR_WAIVER_IDOL_ROSTER_ID, playerId: player.playerId, powerType: SURVIVOR_WAIVER_IMMUNITY_POWER,
            powerLabel: spec.label, powerDesc: spec.description, powerCategory: spec.category,
            status: 'hidden', isSecret: true, isPubliclyKnown: false, isUsed: false, isTradable: true, currentOwnerUserId: null, originalOwnerUserId: null,
            expiresAtMerge: input.rowExpiry.expiresAtMerge, expiresAtWeek: input.rowExpiry.expiresAtWeek, validUntilPhase: input.rowExpiry.validUntilPhase,
            playWindowRule: 'before_reveal', rarity: 'common', assignedAt: new Date(),
            auditLog: { assignedSource: 'waiver_pool', playerId: player.playerId, playerName: player.playerName ?? null, draftSessionId: input.draftId },
          },
          select: { id: true },
        })
        await db.survivorIdolLedgerEntry.create({ data: { leagueId, idolId: idol.id, eventType: 'placed', toRosterId: null, metadata: { source: 'waiver_pool', playerId: player.playerId, powerType: SURVIVOR_WAIVER_IMMUNITY_POWER } } })
        waiverImmunity += 1
      }
    }
  } catch {
    // The waiver idols are a bonus on top of a completed draft; a pool read failure must not undo it.
  }

  await db.survivorAuditEntry.create({
    data: {
      leagueId, category: 'idol', action: 'idols_seeded', actorUserId: null,
      data: { count: drafted + waiverImmunity, fromPool: pooled.length, drafted, undrafted, waiverImmunity, draftSessionId: input.draftId, tribeCount: input.tribeCount, ownerCount: ownerIds.size },
      isVisibleToCommissioner: true, isVisibleToPublic: false,
    },
  })
  return { ok: true, seeded: true, alreadySeeded: false, voteShieldCount: drafted + waiverImmunity, ownerCount: ownerIds.size, seed: input.seed, fromPool: pooled.length, waiverImmunity }
}
