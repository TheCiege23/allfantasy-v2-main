/**
 * Fantrax NBA average draft position → `adp_data` rows, matched to our own NBA players.
 *
 * 🛑 NBA HAD NO ADP AT ALL. Measured on production 2026-10-13: `adp_data` held only NFL rows and
 * `sports_players.adp` was set for 0 of 4,068 NBA players, so every NBA draft board and every NBA
 * autopick fell through `compareDraftEntriesByStableRank` to ALPHABETICAL order — a test draft took
 * Aaron Brooks (retired 2018) in round 1. `getAdp?sport=NBA` is a market: real draft behaviour on
 * Fantrax, the same feed `lib/devy/ingestFantraxDevyAdp.ts` already reads for college football.
 *
 * ⚠ INGESTION, NOT A REQUEST PATH. Only the scheduled ADP import calls this (see
 * `allowProviderFetch` in `lib/workers/adp-importer.ts`); request paths read `adp_data`.
 *
 * 🛑 FANTRAX'S POSITION IS NOT OURS — DO NOT KEY ON IT. Of the 346 players that matched by name on
 * 2026-10-13, Fantrax and `PlayerIdentityMap` disagreed on position for 241 (70%): Aaron Gordon PF/C,
 * Amen Thompson SF/PG, Alperen Sengun C/PF. Rows carry OUR name, position and team, taken from the
 * matched identity, so they line up with the draft pool and with roster eligibility. Fantrax's
 * position is used only to split two identities that share a name.
 *
 * ⚠ NAME IS THE ONLY KEY. The payload is `{ pos, name: "Last, First", id, ADP }` — no team. A name
 * that matches no identity, or several we cannot split, is skipped and counted rather than guessed.
 */
import 'server-only'
import { prisma } from '@/lib/prisma'
import { getFantraxAdp, type FantraxAdpEntry } from '@/lib/league-import/fantrax/fantraxApi'
import { normalizePlayerName, normalizePositionForSport, normalizeTeamAbbrev } from '@/lib/team-abbrev'

/**
 * The matching key for both sides. `normalizePlayerName` (the normalizer `PlayerIdentityMap` names
 * are written with) DROPS accented letters rather than folding them — "Jokić" becomes "joki" — so
 * accents are folded first, on both sides, through this one function.
 */
export function nbaAdpNameKey(name: string | null | undefined): string {
  const folded = String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
  return normalizePlayerName(folded)
}

/** Fantrax sends "Last, First". A name without a comma is used as it is. */
export function fantraxDisplayName(raw: string): string {
  const [last, first] = String(raw ?? '')
    .split(',')
    .map((part) => part.trim())
  return first ? `${first} ${last}` : (last ?? '')
}

export type NbaIdentityRow = {
  id: string
  canonicalName: string
  position: string | null
  currentTeam: string | null
}

export type NbaAdpMatch = {
  identityId: string
  /** Our name for the player, not Fantrax's. */
  playerName: string
  /** Our position, never Fantrax's — see the header. */
  position: string
  team: string
  adp: number
}

export type NbaAdpMatchResult = {
  matched: NbaAdpMatch[]
  /** Names shared by several identities that Fantrax's position could not split. */
  ambiguous: string[]
  /** Names with no identity at all. */
  unmatched: string[]
  /** Second Fantrax rows that resolved to an identity already priced; the earlier ADP is kept. */
  duplicates: number
}

const nbaPosition = (raw: string | null | undefined) => normalizePositionForSport('NBA', raw)

export function matchFantraxNbaAdp(entries: FantraxAdpEntry[], identities: NbaIdentityRow[]): NbaAdpMatchResult {
  const byName = new Map<string, NbaIdentityRow[]>()
  for (const identity of identities) {
    const key = nbaAdpNameKey(identity.canonicalName)
    if (!key) continue
    const bucket = byName.get(key)
    if (bucket) bucket.push(identity)
    else byName.set(key, [identity])
  }

  const result: NbaAdpMatchResult = { matched: [], ambiguous: [], unmatched: [], duplicates: 0 }
  const priced = new Set<string>()
  const ordered = [...entries].sort((a, b) => a.adp - b.adp)

  for (const entry of ordered) {
    if (!Number.isFinite(entry.adp) || entry.adp <= 0) continue
    const display = fantraxDisplayName(entry.name)
    const candidates = byName.get(nbaAdpNameKey(display)) ?? []
    let identity: NbaIdentityRow | null = null
    if (candidates.length === 1) {
      identity = candidates[0]
    } else if (candidates.length > 1) {
      const fantraxPos = nbaPosition(entry.position)
      const samePosition = fantraxPos ? candidates.filter((c) => nbaPosition(c.position) === fantraxPos) : []
      if (samePosition.length === 1) identity = samePosition[0]
    }

    if (!identity) {
      ;(candidates.length === 0 ? result.unmatched : result.ambiguous).push(display)
      continue
    }
    if (priced.has(identity.id)) {
      result.duplicates++
      continue
    }
    priced.add(identity.id)
    result.matched.push({
      identityId: identity.id,
      playerName: identity.canonicalName,
      position: nbaPosition(identity.position) ?? nbaPosition(entry.position) ?? 'UTIL',
      team: normalizeTeamAbbrev(identity.currentTeam) ?? identity.currentTeam ?? 'FA',
      adp: entry.adp,
    })
  }
  return result
}

export type FantraxNbaAdpLoad =
  | { ok: true; priced: number; result: NbaAdpMatchResult }
  | { ok: false; reason: string }

/** Fetch Fantrax NBA ADP and match it to our NBA identities. Ingestion only. */
export async function loadFantraxNbaAdp(): Promise<FantraxNbaAdpLoad> {
  const res = await getFantraxAdp('NBA')
  if (!res.ok) return { ok: false, reason: res.failure.message }
  const identities = await prisma.playerIdentityMap.findMany({
    where: { sport: 'NBA' },
    select: { id: true, canonicalName: true, position: true, currentTeam: true },
  })
  return { ok: true, priced: res.data.length, result: matchFantraxNbaAdp(res.data, identities) }
}
