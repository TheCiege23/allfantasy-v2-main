import 'server-only'

import { prisma } from '@/lib/prisma'
import { playerNamesAgree, providerIdWhere, sleeperIdWhere } from '@/lib/player-identity/externalIdNamespace'
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
 * The existing `loadNativePlayerNames` only ever tried `SportsPlayer.sleeperId`, with no sport and
 * first-row-wins — so a native NBA trade resolved nothing, or the wrong man.
 *
 * ⚠ SEVERAL ROWS FOR ONE ID ARE USUALLY ONE PERSON. `SportsPlayer` carries 2–3 rows for ~1,400 NFL
 * Sleeper ids. They count as one match when every name agrees (`playerNamesAgree`); a disagreement
 * is ambiguity, and ambiguity is a refusal.
 */

export type PlayerIdSpace = 'sleeper' | 'rolling_insights' | { provider: string }

export type ResolvedTradePlayer =
  | { ok: true; name: string; position: string | null }
  | { ok: false; why: 'unresolved' | 'ambiguous' }

/** Which id space a league's stored player ids are in. */
export function playerIdSpaceFor(league: { platform: string | null; sport: string }): PlayerIdSpace {
  const platform = String(league.platform ?? '').trim().toLowerCase()
  if (platform === 'sleeper') return 'sleeper'
  if (platform && providerIdentityColumn(platform)) return { provider: platform }
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
  opts: { space: PlayerIdSpace; sport: string },
): Promise<Map<string, ResolvedTradePlayer>> {
  const ids = [...new Set(playerIds.map((i) => String(i ?? '').trim()).filter(Boolean))]
  const out = new Map<string, ResolvedTradePlayer>()
  if (ids.length === 0) return out
  const sport = opts.sport.toUpperCase()

  if (typeof opts.space === 'object') {
    // The provider resolver already leaves an id that matches two identities unresolved.
    const found = await resolveProviderRosterPlayers(opts.space.provider, ids, sport).catch(() => new Map())
    for (const id of ids) {
      const p = found.get(id)
      out.set(id, p ? { ok: true, name: p.name, position: p.position ?? null } : { ok: false, why: 'unresolved' })
    }
    return out
  }

  const rowsById = new Map<string, Array<{ name: string | null; position: string | null }>>()
  try {
    if (opts.space === 'sleeper') {
      const rows = await prisma.sportsPlayer.findMany({
        where: sleeperIdWhere(ids, sport),
        select: { sleeperId: true, externalId: true, name: true, position: true },
      })
      for (const r of rows) {
        const key = r.sleeperId ?? (r.externalId.startsWith('sleeper:') ? r.externalId.slice('sleeper:'.length) : null)
        if (key) rowsById.set(key, [...(rowsById.get(key) ?? []), { name: r.name, position: r.position }])
      }
    } else {
      const rows = await prisma.sportsPlayer.findMany({
        where: providerIdWhere('rolling_insights', ids, sport),
        select: { externalId: true, name: true, position: true },
      })
      for (const r of rows) rowsById.set(r.externalId, [...(rowsById.get(r.externalId) ?? []), { name: r.name, position: r.position }])
    }
  } catch {
    // Fall through: every id is unresolved, and the trade is refused by name rather than guessed.
  }
  for (const id of ids) out.set(id, decidePlayerIdentity(rowsById.get(id) ?? []))
  return out
}
