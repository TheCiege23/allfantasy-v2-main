import 'server-only'

import { prisma } from '@/lib/prisma'
import { bridgeRosterIdsToGameLogIds } from '@/lib/redraft/rosterGameLogIdBridge'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import {
  boxScorePositionEvidence,
  effectivePositionString,
  resolveLeagueEligibility,
  resolvePlayerEligibility,
  type EligibilityChange,
  type NbaEligibilityPosition,
  type PlayerEligibility,
  type PositionEvidence,
} from './nbaPositionEligibility'

/**
 * The commissioner's position-eligibility log, read and written. DB-only: no provider is called here.
 *
 * ⚠ "LISTED" COMES FROM `SportsPlayer`, NEVER FROM THE SAVED ROSTER ROW. Once a commissioner adds SF,
 * the lineup screen saves the player's row as "PG,SF" — so reading the row back as the listed
 * position would make the addition look natural and turn a later "reset" into a no-op. The row is
 * used only when no `SportsPlayer` row is found, and then only its FIRST position.
 */

/** Only NBA has a commissioner eligibility tool today. */
export function leagueSupportsPositionEligibility(sport: string | null | undefined): boolean {
  return String(sport ?? '').toUpperCase() === 'NBA'
}

/** NBA seasons are stored by their start year ("2025-26" -> 2025): October onward is the new one. */
export function currentNbaSeason(now: Date = new Date()): number {
  return now.getUTCMonth() >= 8 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
}

type Row = {
  playerId: string
  playerName: string
  position: string
  action: string
  reason: string | null
  actorUserId: string
  createdAt: Date
}

function toChange(r: Row): EligibilityChange | null {
  const position = r.position.toUpperCase() as NbaEligibilityPosition
  if (!['PG', 'SG', 'SF', 'PF', 'C'].includes(position)) return null
  if (r.action !== 'add' && r.action !== 'remove' && r.action !== 'reset') return null
  return { ...r, position, action: r.action }
}

export async function loadEligibilityChanges(leagueId: string): Promise<EligibilityChange[]> {
  const rows = await prisma.leaguePositionEligibilityChange.findMany({
    where: { leagueId },
    orderBy: { createdAt: 'asc' },
    select: { playerId: true, playerName: true, position: true, action: true, reason: true, actorUserId: true, createdAt: true },
    take: 2000,
  })
  return rows.map(toChange).filter((c): c is EligibilityChange => c !== null)
}

export async function appendEligibilityChange(
  leagueId: string,
  change: Omit<EligibilityChange, 'createdAt' | 'actorName'>,
): Promise<void> {
  await prisma.leaguePositionEligibilityChange.create({
    data: {
      leagueId,
      playerId: change.playerId.slice(0, 64),
      playerName: change.playerName.slice(0, 120),
      position: change.position,
      action: change.action,
      reason: change.reason,
      actorUserId: change.actorUserId,
    },
  })
}

export type LeagueEligibilityPlayer = {
  id: string
  name: string
  team: string | null
  /** The roster (team) name holding him, for the commissioner's picker. */
  rosterName: string | null
  listedRaw: string | null
}

/** Every rostered player in the league, with his listed position from `SportsPlayer` where known. */
export async function loadLeagueRosteredPlayers(leagueId: string): Promise<LeagueEligibilityPlayer[]> {
  const rosters = await prisma.roster.findMany({ where: { leagueId }, select: { id: true, playerData: true, platformUserId: true } })
  const teams = await prisma.leagueTeam
    .findMany({ where: { leagueId }, select: { externalId: true, platformUserId: true, teamName: true } })
    .catch(() => [])
  const teamName = new Map<string, string | null>()
  for (const t of teams) {
    if (t.platformUserId) teamName.set(t.platformUserId, t.teamName ?? null)
    if (t.externalId && !teamName.has(t.externalId)) teamName.set(t.externalId, t.teamName ?? null)
  }
  const seen = new Map<string, LeagueEligibilityPlayer>()
  for (const roster of rosters) {
    const sections = getNormalizedLineupSections(roster.playerData)
    for (const key of Object.keys(sections) as Array<keyof typeof sections>) {
      for (const row of sections[key]) {
        const id = String(row.id ?? '').trim()
        if (!id || seen.has(id)) continue
        const rowPosition = String(row.position ?? '').split(',')[0]?.trim() || null
        seen.set(id, {
          id,
          name: String(row.name ?? row.playerName ?? id),
          team: typeof row.team === 'string' && row.team !== '—' ? row.team : null,
          rosterName: teamName.get(roster.platformUserId) ?? null,
          listedRaw: rowPosition,
        })
      }
    }
  }
  const players = [...seen.values()]
  const listed = await loadListedPositions(players.map((p) => p.id))
  for (const p of players) {
    const sp = listed.get(p.id)
    if (sp?.position) p.listedRaw = sp.position
    if (sp?.name && p.name === p.id) p.name = sp.name
  }
  return players.sort((a, b) => a.name.localeCompare(b.name))
}

/** Roster id -> the `SportsPlayer` row's listed position, name and Rolling Insights id. */
export async function loadListedPositions(
  ids: readonly string[],
): Promise<Map<string, { position: string | null; name: string; riId: string | null }>> {
  const out = new Map<string, { position: string | null; name: string; riId: string | null }>()
  if (!ids.length) return out
  const rows = await prisma.sportsPlayer.findMany({
    where: { sport: 'NBA', OR: [{ id: { in: [...ids] } }, { externalId: { in: [...ids] } }, { sleeperId: { in: [...ids] } }] },
    select: { id: true, externalId: true, sleeperId: true, name: true, position: true, source: true },
  })
  const wanted = new Set(ids)
  for (const r of rows) {
    const value = {
      position: r.position,
      name: r.name,
      riId: /^\d+$/.test(r.externalId) && /rolling/i.test(r.source) ? r.externalId : null,
    }
    for (const key of [r.id, r.externalId, r.sleeperId]) {
      if (key && wanted.has(key) && !out.has(key)) out.set(key, value)
    }
  }
  return out
}

/**
 * The effective positions for every player in `ids` that the commissioner changed. Players with no
 * change are absent: callers leave their position exactly as it was.
 */
export async function loadEffectivePositionStrings(
  leagueId: string,
  ids: readonly string[],
  rowPositionById: ReadonlyMap<string, string | null | undefined> = new Map(),
): Promise<Map<string, string>> {
  const changes = (await loadEligibilityChanges(leagueId)).filter((c) => ids.includes(c.playerId))
  if (!changes.length) return new Map()
  const changedIds = [...new Set(changes.map((c) => c.playerId))]
  const listed = await loadListedPositions(changedIds)
  const listedById = new Map(
    changedIds.map((id) => [id, listed.get(id)?.position ?? String(rowPositionById.get(id) ?? '').split(',')[0] ?? null]),
  )
  const states = resolveLeagueEligibility(changes, listedById)
  return new Map([...states].map(([id, s]) => [id, effectivePositionString(s)]))
}

/** Box-score evidence this season for each player, keyed by roster id. Empty when no game logs join. */
export async function loadBoxScoreEvidence(
  players: ReadonlyArray<{ id: string; name: string }>,
  season: number = currentNbaSeason(),
): Promise<Map<string, PositionEvidence[]>> {
  const out = new Map<string, PositionEvidence[]>()
  if (!players.length) return out
  const listed = await loadListedPositions(players.map((p) => p.id))
  // A `SportsPlayer` uuid on the roster is bridged through its Rolling Insights id.
  const viaRi = new Map<string, string>()
  for (const p of players) {
    const ri = listed.get(p.id)?.riId
    viaRi.set(ri && !/^\d+$/.test(p.id) ? ri : p.id, p.id)
  }
  const bridge = await bridgeRosterIdsToGameLogIds(
    prisma as never,
    ['NBA'],
    [...viaRi.keys()],
    new Map(players.map((p) => [p.id, p.name])),
  )
  if (!bridge.gameLogIds.length) return out
  const rows = await prisma.playerGameStat.findMany({
    where: { sportType: 'NBA', season, playerId: { in: bridge.gameLogIds } },
    select: { playerId: true, statPayload: true },
  })
  const games = new Map<string, Array<{ position: string | null }>>()
  for (const r of rows) {
    const bridged = bridge.rosterIdFor(r.playerId)
    const rosterId = bridged ? viaRi.get(bridged) ?? bridged : undefined
    if (!rosterId) continue
    const payload = (r.statPayload ?? {}) as Record<string, unknown>
    if (payload.seasonType && payload.seasonType !== 'regular') continue
    const position = typeof payload.position === 'string' ? payload.position : null
    games.set(rosterId, [...(games.get(rosterId) ?? []), { position }])
  }
  for (const [id, list] of games) out.set(id, boxScorePositionEvidence(list))
  return out
}

export type EligibilityPlayerView = {
  id: string
  name: string
  team: string | null
  rosterName: string | null
  state: PlayerEligibility
  evidence: PositionEvidence[]
}

export type EligibilityLogEntry = {
  playerId: string
  playerName: string
  position: NbaEligibilityPosition
  action: 'add' | 'remove' | 'reset'
  reason: string | null
  actorName: string | null
  createdAt: string
}

/** Everything the panel shows: every rostered player's state + evidence, and the log, newest first. */
export async function loadEligibilityPanel(leagueId: string): Promise<{
  players: EligibilityPlayerView[]
  log: EligibilityLogEntry[]
  season: number
}> {
  const season = currentNbaSeason()
  const [players, changes] = await Promise.all([loadLeagueRosteredPlayers(leagueId), loadEligibilityChanges(leagueId)])
  const evidence = await loadBoxScoreEvidence(players, season).catch(() => new Map<string, PositionEvidence[]>())
  const byPlayer = new Map<string, EligibilityChange[]>()
  for (const c of changes) byPlayer.set(c.playerId, [...(byPlayer.get(c.playerId) ?? []), c])
  const actorIds = [...new Set(changes.map((c) => c.actorUserId))]
  const actors = actorIds.length
    ? await prisma.appUser.findMany({ where: { id: { in: actorIds } }, select: { id: true, displayName: true, username: true } }).catch(() => [])
    : []
  const actorName = new Map(actors.map((a) => [a.id, a.displayName || a.username || null]))
  return {
    season,
    players: players.map((p) => ({
      id: p.id,
      name: p.name,
      team: p.team,
      rosterName: p.rosterName,
      state: resolvePlayerEligibility(p.listedRaw, byPlayer.get(p.id) ?? []),
      evidence: evidence.get(p.id) ?? [],
    })),
    log: [...changes].reverse().map((c) => ({
      playerId: c.playerId,
      playerName: c.playerName,
      position: c.position,
      action: c.action,
      reason: c.reason,
      actorName: actorName.get(c.actorUserId) ?? null,
      createdAt: new Date(c.createdAt).toISOString(),
    })),
  }
}

