import 'server-only'

import { prisma } from '@/lib/prisma'
import { readImportedPlayerMetadata } from '@/lib/league-import/importedPlayerMetadata'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { collegePlayerIds } from '@/lib/c2c/campusLineup'
import { ourIdOrSleeperIdWhere, playerNamesAgree, providerIdWhere } from '@/lib/player-identity/externalIdNamespace'
import { providerIdentityColumn, resolveProviderRosterPlayers } from '@/lib/player-identity/resolveProviderRosterPlayers'

/**
 * A stored trade's player ids, resolved to EXACTLY ONE player each — or not at all. The design's rule
 * (`docs/TRADE_EVALUATOR_DESIGN.md`): "If any asset fails to resolve to exactly one player, return
 * 'can't evaluate yet' instead of guessing."
 *
 * 🛑 THE ID SPACE DEPENDS ON THE LEAGUE, AND GUESSING IT NAMES STRANGERS.
 *   - NFL — native or imported from Sleeper — stores Sleeper ids.
 *   - A native NBA / NHL / MLB league stores Rolling Insights ids. They are bare numbers like a
 *     Sleeper id; matched as Sleeper ids they find a different person (see
 *     `lib/player-identity/externalIdNamespace.ts` — 42,031 of 42,032 bare-id collisions were).
 *   - ESPN / Fantrax / Fleaflicker / MFL leagues store that platform's id, resolved through its own
 *     `PlayerIdentityMap` column (`resolveProviderRosterPlayers`).
 * The old `loadNativePlayerNames` only tried `SportsPlayer.sleeperId`, with no sport and
 * first-row-wins — so a native NBA trade resolved nothing, or the wrong man.
 *
 * ⚠ SEVERAL ROWS FOR ONE ID ARE USUALLY ONE PERSON. `SportsPlayer` carries 2–3 rows for ~1,400 NFL
 * Sleeper ids. They count as one match when every name agrees (`playerNamesAgree`); a disagreement
 * is ambiguity, and ambiguity is a refusal.
 */

/** Every id a stored roster holds, including lineup sections used by older imports. */
export function rosteredIdsOf(playerData: unknown): string[] {
  const ids = new Set([...getRosterPlayerIds(playerData).map(String), ...collegePlayerIds(playerData)])
  const pd = (playerData ?? {}) as Record<string, unknown>
  for (const key of ['starters', 'reserve', 'taxi', 'bench', 'ir']) {
    const entries = pd[key]
    if (!Array.isArray(entries)) continue
    for (const raw of entries) {
      const row = raw && typeof raw === 'object' ? (raw as { id?: unknown; player_id?: unknown }) : null
      const id = typeof raw === 'string' ? raw : row ? String(row.id ?? row.player_id ?? '') : ''
      if (id) ids.add(id)
    }
  }
  return [...ids]
}

/** Use only for membership-checked trade reads. These IDs stay in the league's namespace. */
export async function loadTradeRosterIds(leagueId: string, rosterIds?: string[]): Promise<Map<string, string[]>> {
  const rows = await prisma.roster.findMany({
    where: { leagueId, ...(rosterIds ? { id: { in: rosterIds } } : {}) },
    select: { id: true, playerData: true },
  })
  return new Map(rows.map((row) => [row.id, rosteredIdsOf(row.playerData)]))
}

/** Imports can store Fantrax display names in surname-first order. */
export function providerNameInChartOrder(provider: string, name: string): string {
  const trimmed = name.trim()
  if (provider.trim().toLowerCase() !== 'fantrax') return trimmed
  const parts = /^([^,]+),\s*([^,]+)$/.exec(trimmed)
  return parts ? parts[2]!.trim() + ' ' + parts[1]!.trim() : trimmed
}

export type PlayerIdSpace = 'sleeper' | 'rolling_insights' | { provider: string }

export type ResolvedTradePlayer =
  | { ok: true; name: string; position: string | null; sleeperId?: string; externalId?: string }
  | { ok: false; why: 'unresolved' | 'ambiguous' }

/** Which id space a league's stored player ids are in. */
export function playerIdSpaceFor(league: { platform: string | null; sport: string }): PlayerIdSpace {
  const platform = String(league.platform ?? '').trim().toLowerCase()
  if (platform === 'sleeper') return 'sleeper'
  if (platform === 'yahoo' || (platform && providerIdentityColumn(platform))) return { provider: platform }
  // Native (AllFantasy-created): NFL pools are Sleeper-keyed, every other sport is Rolling Insights.
  return String(league.sport).toUpperCase() === 'NFL' ? 'sleeper' : 'rolling_insights'
}

/** PURE. The rows found for ONE id → exactly one player, or why not. */
export function decidePlayerIdentity(rows: ReadonlyArray<{ name: string | null; position: string | null }>): ResolvedTradePlayer {
  const named = rows.filter((r): r is { name: string; position: string | null } => typeof r.name === 'string' && r.name.trim().length > 0)
  if (named.length === 0) return { ok: false, why: 'unresolved' }
  const first = named[0]!
  if (!named.every((r) => playerNamesAgree(r.name, first.name))) return { ok: false, why: 'ambiguous' }
  return { ok: true, name: first.name.trim(), position: named.find((r) => r.position)?.position ?? null }
}

/** Resolve every id at once. Never throws: an unreadable table is "unresolved", which refuses the grade. */
export async function resolveTradePlayers(
  playerIds: readonly string[],
  opts: { space: PlayerIdSpace; sport: string; membershipCheckedLeagueId?: string },
): Promise<Map<string, ResolvedTradePlayer>> {
  const ids = [...new Set(playerIds.map((i) => String(i ?? '').trim()).filter(Boolean))]
  const out = new Map<string, ResolvedTradePlayer>()
  if (ids.length === 0) return out
  const sport = opts.sport.toUpperCase()

  if (typeof opts.space === 'object') {
    // The provider resolver already leaves an id that matches two identities unresolved.
    const provider = opts.space.provider
    const ambiguous = new Set<string>()
    const found = await resolveProviderRosterPlayers(provider, ids, sport, ambiguous).catch(() => new Map())
    const names = new Map<string, Array<{ name: string; position: string | null }>>()
    // Saved provider metadata names the roster entry in this league. The projection grader still
    // independently verifies its crosswalk before assigning a value.
    if (opts.membershipCheckedLeagueId && (provider === 'espn' || provider === 'yahoo' || provider === 'fantrax')) {
      const missing = new Set(ids.filter((id) => !found.has(id) && !ambiguous.has(id)))
      if (missing.size) {
        const rosters = await prisma.roster.findMany({ where: { leagueId: opts.membershipCheckedLeagueId }, select: { playerData: true } }).catch(() => [])
        for (const { playerData } of rosters) {
          for (const id of rosteredIdsOf(playerData)) {
            if (!missing.has(id)) continue
            const player = readImportedPlayerMetadata(playerData, provider, id)
            if (player) names.set(id, [...(names.get(id) ?? []), player])
          }
        }
      }
    }
    for (const id of ids) {
      const p = found.get(id)
      out.set(id, p?.name ? { ok: true, name: p.name, position: p.position ?? null, ...(p.sleeperId ? { sleeperId: p.sleeperId } : {}) }
        : ambiguous.has(id) ? { ok: false, why: 'ambiguous' } : decidePlayerIdentity(names.get(id) ?? []))
    }
    return out
  }

  type IdentityRow = { name: string | null; position: string | null; sleeperId?: string | null; externalId?: string }
  const rowsById = new Map<string, IdentityRow[]>()
  const wanted = new Set(ids)
  const record = (key: string | null | undefined, row: IdentityRow) => {
    if (key && wanted.has(key)) rowsById.set(key, [...(rowsById.get(key) ?? []), row])
  }
  try {
    if (opts.space === 'sleeper') {
      const rows = await prisma.sportsPlayer.findMany({
        where: ourIdOrSleeperIdWhere([...new Set(ids.flatMap((id) => [id, id.replace(/^sleeper:/, '')]))], sport),
        select: { id: true, sleeperId: true, externalId: true, name: true, position: true },
      })
      for (const r of rows) {
        const key = r.sleeperId ?? (r.externalId.startsWith('sleeper:') ? r.externalId.slice('sleeper:'.length) : null)
        record(key, r)
        if (key) record('sleeper:' + key, r)
        if (r.id !== key) record(r.id, r)
      }
    } else {
      const collegeIds = sport === 'NBA' ? ids.filter((id) => /^espn:ncaab:\d+$/.test(id)) : []
      if (collegeIds.length) {
        const campus = await prisma.devyPlayer.findMany({
          where: { id: { in: collegeIds }, sport: 'NCAAB', source: 'espn_ncaab_roster' },
          select: { id: true, name: true, position: true },
        }).catch(() => [])
        for (const player of campus) record(player.id, player)
      }
      const rows = await prisma.sportsPlayer.findMany({
        where: { sport, OR: [{ id: { in: ids } }, providerIdWhere('rolling_insights', ids)] },
        select: { id: true, source: true, externalId: true, name: true, position: true },
      })
      for (const r of rows) {
        if (r.source === 'rolling_insights') record(r.externalId, r)
        if (r.source !== 'rolling_insights') record(r.id, { ...r, externalId: undefined })
        else if (r.id !== r.externalId) record(r.id, r)
      }
    }
  } catch {
    // Fall through: every id is unresolved, and the trade is refused by name rather than guessed.
  }
  for (const id of ids) {
    const rows = rowsById.get(id) ?? []
    const result = decidePlayerIdentity(rows)
    if (result.ok) {
      const linkedIds = [...new Set(rows.map((r) => opts.space === 'sleeper' ? r.sleeperId : r.externalId).filter((v): v is string => Boolean(v)))]
      if (linkedIds.length > 1) {
        out.set(id, { ok: false, why: 'ambiguous' })
        continue
      }
      const linked = linkedIds[0]
      if (linked && linked !== id) {
        if (opts.space === 'sleeper') result.sleeperId = linked
        else result.externalId = linked
      }
    }
    out.set(id, result)
  }
  return out
}
