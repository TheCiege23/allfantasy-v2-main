import { normalizePlayerName } from '@/lib/player-identity/playerIdentityResolution'
import { nameVariants } from '@/lib/chimmy/leagueRosterIndex'

/**
 * A name the model passed → exactly one player id on a known roster, or a sentence saying why not.
 *
 * ⚠ ONE NORMALISER. Matching goes through `normalizePlayerName`, the same one every Chimmy scenario
 * uses — a second normaliser disagreed with it on 7% of rows the last time one was written.
 *
 * ⚠ AMBIGUITY IS A REFUSAL, NEVER A PICK. Two rostered players with one normalised name (father and
 * son differ only by a suffix the normaliser keeps; two teams can roster two "Mike Williams") must be
 * asked about, because a confident move on the wrong one is indistinguishable from a right one.
 */

export type NamedPlayer = { playerId: string; name: string | null }

export function indexByName<T extends NamedPlayer>(players: Iterable<T>): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const p of players) {
    if (!p.name) continue
    const key = normalizePlayerName(p.name)
    if (!key) continue
    const list = out.get(key) ?? []
    if (!list.some((x) => x.playerId === p.playerId)) list.push(p)
    out.set(key, list)
  }
  return out
}

export function findByName<T extends NamedPlayer>(index: Map<string, T[]>, raw: string): T[] {
  for (const variant of nameVariants(raw.trim())) {
    const hits = index.get(normalizePlayerName(variant)) ?? []
    if (hits.length > 0) return hits
  }
  return []
}

export function resolveNamesOnRoster(
  names: string[],
  players: Map<string, NamedPlayer>,
): { ok: true; ids: Map<string, string> } | { ok: false; message: string } {
  const index = indexByName(players.values())
  const ids = new Map<string, string>()
  for (const raw of names) {
    const hits = findByName(index, raw)
    if (hits.length === 0) {
      return {
        ok: false,
        message: `NO CARD WAS MADE: "${raw}" is not on the user's roster in this league. Ask them to check the name; do not guess a different player.`,
      }
    }
    if (hits.length > 1) {
      return {
        ok: false,
        message: `NO CARD WAS MADE: "${raw}" matches ${hits.length} players on the roster. Ask which one they mean.`,
      }
    }
    ids.set(raw, hits[0]!.playerId)
  }
  return { ok: true, ids }
}
