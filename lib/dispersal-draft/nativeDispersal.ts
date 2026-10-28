/**
 * The dispersal draft in a league AllFantasy runs: where the pool comes from and where the claims go.
 *
 * 🛑 THE ENGINE WROTE `Roster.playerData` ONLY, AND IN A NATIVE LEAGUE THAT IS THE WRONG PLACE.
 * Native scoring, lineups and the roster screen read `RedraftRosterPlayer` (lib/league-runtime/
 * redraftRosterMoveSync.ts records the same bug for waivers and trades), so a claimed player stayed
 * on the orphan team for scoring and never reached the team that drafted the player. And the pool read
 * the same JSON: a native roster's `playerData.players` is a list of id STRINGS, which
 * `rowToPlayerAsset` drops, so a native league's pool held no players at all. Future picks lived in
 * `future_draft_picks` (lib/league-trade-engine/nativeFuturePicks.ts), not in the JSON either, and
 * FAAB in `RedraftRoster.faabBalance`.
 *
 * So in a native league:
 *   pool       the orphan team's active `RedraftRosterPlayer` rows, its future picks from the native
 *              inventory, and its `faabBalance`
 *   claimed    the player row moves to the claiming team (bench, acquisitionType
 *              `dispersal_draft`), as a trade moves one; a pick through `transferNativeFuturePick`
 *   unclaimed  the player is dropped to free agency; a pick stays with the orphan team, as before
 *   FAAB       the orphan team's balance goes to 0, claimed or not, as before
 * and the lineup JSON is edited for the players that moved, event-scoped: never rebuilt from a diff.
 *
 * Teams are `Roster.id` throughout (the draft's ids); each maps to its team in the league's current
 * season by owner (`draftRosterIdForOwner`), the mapping a draft's own picks use.
 */
import type { Prisma } from '@prisma/client'
import { randomUUID } from 'node:crypto'
import { draftRosterIdForOwner } from '@/lib/live-draft-engine/createNextLeagueDraft'
import { loadNativeFuturePicks, transferNativeFuturePick } from '@/lib/league-trade-engine/nativeFuturePicks'
import { inventoryPickId, roundOrdinal } from '@/lib/league-trade-engine/futurePickInventory'
import { copyRedraftFaabToGeneric } from '@/lib/league/faabMirror'
import { resolveWriteAuthority } from '@/lib/league/write-authority'
import type { DispersalAsset } from './types'

type Db = Prisma.TransactionClient

/** A league AllFantasy runs: its rosters are RedraftRosterPlayer rows, not the lineup JSON. */
export async function isNativeDispersalLeague(db: Db, leagueId: string): Promise<boolean> {
  const league = await db.league.findUnique({ where: { id: leagueId }, select: { platform: true } })
  return Boolean(league) && resolveWriteAuthority(league!.platform) === 'NATIVE'
}

/** Each draft roster's team in the league's current season. Rosters with none are absent. */
export async function seasonTeamsByRoster(db: Db, leagueId: string): Promise<Map<string, string>> {
  const season = await db.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' }, select: { id: true } })
  if (!season) return new Map()
  const [teams, rosters] = await Promise.all([
    db.redraftRoster.findMany({ where: { seasonId: season.id }, select: { id: true, ownerId: true } }),
    db.roster.findMany({ where: { leagueId }, select: { id: true, platformUserId: true } }),
  ])
  const out = new Map<string, string>()
  for (const t of teams) {
    const rosterId = draftRosterIdForOwner(t.ownerId, rosters)
    if (rosterId && !out.has(rosterId)) out.set(rosterId, t.id)
  }
  return out
}

/** The pool for a native league: players, future picks and FAAB of the source teams. */
export async function buildNativeAssetPool(db: Db, leagueId: string, sourceRosterIds: readonly string[]): Promise<DispersalAsset[]> {
  const teamByRoster = await seasonTeamsByRoster(db, leagueId)
  const teamIds = sourceRosterIds.map((id) => teamByRoster.get(id)).filter((x): x is string => Boolean(x))
  const [players, teams, inventory] = await Promise.all([
    db.redraftRosterPlayer.findMany({
      where: { rosterId: { in: teamIds }, droppedAt: null },
      orderBy: [{ rosterId: 'asc' }, { addedAt: 'asc' }],
      select: { rosterId: true, playerId: true, playerName: true, position: true, team: true },
    }),
    db.redraftRoster.findMany({ where: { id: { in: teamIds } }, select: { id: true, faabBalance: true } }),
    loadNativeFuturePicks(leagueId, db),
  ])
  const assets: DispersalAsset[] = []
  for (const sourceRosterId of sourceRosterIds) {
    const teamId = teamByRoster.get(sourceRosterId)
    for (const p of players.filter((x) => x.rosterId === teamId)) {
      assets.push({
        id: randomUUID(),
        assetType: 'player',
        sourceRosterId,
        playerId: p.playerId,
        playerName: p.playerName,
        playerPosition: p.position || undefined,
        playerTeam: p.team || undefined,
        isAvailable: true,
      })
    }
    for (const pick of (inventory?.picks ?? []).filter((x) => x.ownerTeamId === sourceRosterId)) {
      const traded = pick.originalTeamId !== pick.ownerTeamId
      assets.push({
        id: randomUUID(),
        assetType: 'draft_pick',
        sourceRosterId,
        pickId: inventoryPickId(pick),
        pickRound: pick.round,
        pickYear: pick.season,
        originalOwnerRosterId: pick.originalTeamId,
        tradedToRosterId: pick.ownerTeamId,
        isTradedPick: traded,
        pickLabel: `${pick.season} ${roundOrdinal(pick.round)} round${traded ? ' (acquired)' : ''}`,
        isAvailable: true,
      })
    }
    const faab = teams.find((t) => t.id === teamId)?.faabBalance ?? 0
    if (faab > 0) assets.push({ id: randomUUID(), assetType: 'faab', sourceRosterId, faabAmount: faab, isAvailable: true })
  }
  return assets
}

const asObject = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {}
const idOf = (row: unknown) => {
  if (typeof row === 'string') return row
  const o = row && typeof row === 'object' ? (row as Record<string, unknown>) : null
  return String(o?.id ?? o?.playerId ?? o?.player_id ?? '')
}
const SECTION_KEYS = ['starters', 'bench', 'ir', 'taxi', 'devy'] as const
const FLAT_KEYS = ['players', 'starters', 'reserve', 'taxi', 'devy'] as const

/** A lineup with these players taken off it, every other spot unchanged. */
export function removeFromLineup(playerData: unknown, ids: readonly string[]): Record<string, unknown> {
  const drop = new Set(ids)
  const root = asObject(playerData)
  for (const k of FLAT_KEYS) if (Array.isArray(root[k])) root[k] = (root[k] as unknown[]).filter((x) => !drop.has(idOf(x)))
  const sections = asObject(root.lineup_sections)
  for (const k of SECTION_KEYS) if (Array.isArray(sections[k])) sections[k] = (sections[k] as unknown[]).filter((x) => !drop.has(idOf(x)))
  if (root.lineup_sections) root.lineup_sections = sections
  return root
}

/** A lineup with these players added to the end of the bench. */
export function addToBench(playerData: unknown, rows: ReadonlyArray<{ id: string; name?: string; position?: string; team?: string }>): Record<string, unknown> {
  const root = asObject(playerData)
  const sections = asObject(root.lineup_sections)
  const have = new Set([...(Array.isArray(root.players) ? (root.players as unknown[]).map(idOf) : []), ...SECTION_KEYS.flatMap((k) => (Array.isArray(sections[k]) ? (sections[k] as unknown[]).map(idOf) : []))])
  const fresh = rows.filter((r) => !have.has(r.id))
  root.players = [...(Array.isArray(root.players) ? (root.players as unknown[]) : []), ...fresh.map((r) => r.id)]
  sections.bench = [...(Array.isArray(sections.bench) ? (sections.bench as unknown[]) : []), ...fresh.map((r) => ({ id: r.id, name: r.name, position: r.position, team: r.team }))]
  root.lineup_sections = sections
  return root
}

export type NativeDispersalResult = {
  playersMoved: number
  playersDropped: number
  picksMoved: number
  /** Claimed players or picks no longer with the source team when the draft completed (moved meanwhile). */
  missing: string[]
}

/** Apply a completed draft's claims inside its transaction. */
export async function applyNativeDispersal(
  db: Db,
  input: { leagueId: string; assets: readonly DispersalAsset[]; now?: Date },
): Promise<NativeDispersalResult> {
  const now = input.now ?? new Date()
  const teamByRoster = await seasonTeamsByRoster(db, input.leagueId)
  const result: NativeDispersalResult = { playersMoved: 0, playersDropped: 0, picksMoved: 0, missing: [] }
  const added = new Map<string, Array<{ id: string; name?: string; position?: string; team?: string }>>()
  const removed = new Map<string, string[]>()
  const push = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v])
  const faabTeams = new Set<string>()

  for (const asset of input.assets) {
    const fromTeam = teamByRoster.get(asset.sourceRosterId)
    if (asset.assetType === 'player' && asset.playerId) {
      if (!fromTeam) continue
      const claimedBy = asset.claimedByRosterId ?? null
      const toTeam = claimedBy ? teamByRoster.get(claimedBy) : null
      if (claimedBy && toTeam) {
        const moved = await db.redraftRosterPlayer.updateMany({
          where: { rosterId: fromTeam, playerId: asset.playerId, droppedAt: null },
          data: { rosterId: toTeam, slotType: 'BENCH', acquisitionType: 'dispersal_draft', isLocked: false, addedAt: now },
        })
        if (moved.count === 0) {
          result.missing.push(asset.playerId)
          continue
        }
        result.playersMoved += 1
        push(removed, asset.sourceRosterId, asset.playerId)
        push(added, claimedBy, { id: asset.playerId, name: asset.playerName, position: asset.playerPosition, team: asset.playerTeam })
      } else {
        const dropped = await db.redraftRosterPlayer.updateMany({
          where: { rosterId: fromTeam, playerId: asset.playerId, droppedAt: null },
          data: { droppedAt: now },
        })
        result.playersDropped += dropped.count
        push(removed, asset.sourceRosterId, asset.playerId)
      }
      continue
    }
    if (asset.assetType === 'draft_pick' && asset.pickId && asset.claimedByRosterId) {
      // A pick that left the source team during the draft (used, forfeited, past the horizon) is
      // reported, not allowed to undo every other claim.
      try {
        await transferNativeFuturePick(db, {
          leagueId: input.leagueId,
          ref: asset.pickId,
          fromRosterId: asset.sourceRosterId,
          toRosterId: asset.claimedByRosterId,
          now,
        })
        result.picksMoved += 1
      } catch {
        result.missing.push(asset.pickId)
      }
      continue
    }
    if (asset.assetType === 'faab' && fromTeam) faabTeams.add(fromTeam)
  }

  for (const [rosterId, ids] of removed) {
    const r = await db.roster.findUnique({ where: { id: rosterId }, select: { playerData: true } })
    if (r) await db.roster.update({ where: { id: rosterId }, data: { playerData: removeFromLineup(r.playerData, ids) as Prisma.InputJsonValue } })
  }
  for (const [rosterId, rows] of added) {
    const r = await db.roster.findUnique({ where: { id: rosterId }, select: { playerData: true } })
    if (r) await db.roster.update({ where: { id: rosterId }, data: { playerData: addToBench(r.playerData, rows) as Prisma.InputJsonValue } })
  }
  if (faabTeams.size) {
    await db.redraftRoster.updateMany({ where: { id: { in: [...faabTeams] } }, data: { faabBalance: 0 } })
    await copyRedraftFaabToGeneric(db, [...faabTeams])
  }
  return result
}
