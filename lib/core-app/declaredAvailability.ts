import 'server-only'

import { prisma } from '@/lib/prisma'
import { givenNameNicknameOf, normalizeMatchName, sideOfBall } from '@/lib/player-match/verifiedNameMatch'
import { normalizePlayerName, normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { bridgeColumnFor, bridgeVerdict, declaredBridgeMap, isDeclaredBridge } from './bridgedRosterIds'
import { collectRosterIds } from './rosterIdSpace'

/**
 * Can a pasted Yahoo league say who is AVAILABLE — and if so, who must still be kept off the list?
 *
 * 🛑 "NOT ON ANY ROSTER" IS NOT "AVAILABLE" HERE. A pasted league stores each player it resolved
 * DECLARED (`sleeper:<id>`, declaredSleeperId.ts) and every player it could not as `yahoo-paste:<name>|
 * <pos>|<team>`. `sleeperReadableRosters` keeps the declared ids and drops the rest, so a reader that
 * subtracts rosters from a pool would offer every unmatched player as a free agent: he is on somebody's
 * team, under an id no Sleeper-id read can see.
 *
 * So, for such a league:
 *
 *   - BELOW THE COVERAGE BAR (`BRIDGE_MIN_COVERAGE`, bridgedRosterIds.ts — the one rule, read through
 *     `bridgeVerdict`, not restated here) nobody may be called available. The reader returns its
 *     "can't verify" state with `unmatched`.
 *   - ABOVE IT the list stands, minus every wire player `hides` matches, and the screen says how many
 *     rostered players could not be matched.
 *
 * ⚠ `hides` IS BY NAME, AND A NAME HERE ONLY EVER HIDES (the rule `excludeUntranslatedEspn` in
 * lib/decision-os/waiver/pool.ts already applies to ESPN). A namesake who really is free is hidden too,
 * which is the safe direction for a list of who is available; listing a rostered player is not.
 *
 * WHERE THE NAME COMES FROM. A pasted id carries the name the page showed, already folded by
 * `normalizePlayerName` (team-abbrev — the paste id's own normalizer). The roster's `player_metadata`
 * (written for every id by the import bootstrap, `snapshotImportedPlayerMetadata`) carries the RAW
 * name, position and club. Both are used. That metadata is the only name a bare Yahoo number has; with
 * none stored he hides nothing and is still counted in `unmatched`, which is what the "N couldn't be
 * matched" line on every screen reports — so he is never silently listed AND never silently dropped.
 *
 * HOW TWO SPELLINGS MEET (2026-11-27). No new normalizer: both sides are keyed by `normalizeMatchName`
 * (verifiedNameMatch.ts — accents, trailing suffix, punctuation), and each name is ALSO keyed through
 * `normalizePlayerName` first, because that one DROPS a non-ASCII letter ("José" → "jos") and the paste
 * id was built with it. Then a given-name nickname with the same surname ("Mitch"/"Mitchell",
 * `givenNameNicknameOf` — a 3+ letter prefix, NOT a nickname table, so "Bob"/"Robert" does not meet).
 * ACCENTS (2026-11-28): a paste id is now built from the accent-folded name (yahooSnapshotModel.ts
 * `snapshotPlayerId`), so with no stored metadata every spelling meets it ("José"/"Jose" → "jose"). An id
 * built BEFORE that has lost the letter ("jos"): it still meets every ACCENTED spelling through the
 * `normalizePlayerName` key below, and a same-surname spelling through the nickname pass ("Jose Ramírez"
 * → given "jose" extends "jos"). ⚠ What stays open is only an OLD id with no metadata against a wire
 * spelling whose SURNAME has no accent ("jos ramrez" vs "Jose Ramirez" or "José Ramirez") — and every
 * import writes metadata, so that needs a roster written before both fixes.
 *
 * THE ONE THING THAT UN-HIDES A NAME MATCH: both sides state a position, on different sides of the ball
 * (`sideOfBall`) — QB Josh Allen rostered does not hide LB Josh Allen. A CLUB disagreement does NOT
 * un-hide: a paste is a snapshot, a traded player's club moves, and a stale club would list a rostered
 * player. Sub-positions on one side never disagree (a DE in one feed is an OLB in another), and an
 * unknown position makes no claim, so he is hidden.
 *
 * A pasted defence hides its club's defence.
 *
 * Null for every league that is not a declared-bridge league, AND for one with no declared id at all (a
 * Yahoo league imported any other way): those keep the refusal they already had.
 */

export type DeclaredAvailability = {
  /** True when the league clears the coverage bar: a miss can be trusted. */
  verified: boolean
  /** Distinct roster ids across the league. */
  total: number
  /** How many of them are declared Sleeper ids. */
  matched: number
  /** Rostered players no Sleeper-id read can see. */
  unmatched: number
  /** True for a wire player who could be one of the unmatched rostered players. Only ever hides. */
  hides: (row: { name?: string | null; position?: string | null; team?: string | null }) => boolean
}

const PASTE_PREFIX = 'yahoo-paste:'
const DEFENSE_POSITIONS = new Set(['DEF', 'DST', 'D/ST'])

type UnmatchedPerson = { keys: Set<string>; position: string }

/** Pure: the verdict for one league, from its rosters' raw `playerData`. */
export function declaredAvailability(
  platform: string | null | undefined,
  playerDatas: readonly unknown[],
): DeclaredAvailability | null {
  if (!isDeclaredBridge(bridgeColumnFor(platform))) return null
  const ids = collectRosterIds(playerDatas)
  const map = declaredBridgeMap(ids)
  if (map.size === 0) return null
  const { total, translated, readable } = bridgeVerdict(ids, map)

  const metadata = playerMetadataOf(playerDatas)
  const people: UnmatchedPerson[] = []
  const defenseClubs = new Set<string>()
  for (const id of ids) {
    if (map.has(id)) continue
    const meta = metadata.get(id)
    const names = [meta?.name ?? '']
    let position = meta?.position ?? ''
    let team = meta?.team ?? ''
    if (id.startsWith(PASTE_PREFIX)) {
      const [pastedName = '', pastedPosition = '', pastedTeam = ''] = id.slice(PASTE_PREFIX.length).split('|')
      names.push(pastedName)
      position ||= pastedPosition
      team ||= pastedTeam
    }
    if (DEFENSE_POSITIONS.has(position.trim().toUpperCase())) {
      const club = normalizeTeamAbbrev(team)
      if (club) defenseClubs.add(club)
      continue
    }
    const keys = new Set(names.flatMap(nameKeys))
    if (keys.size > 0) people.push({ keys, position })
  }

  const byKey = new Map<string, UnmatchedPerson[]>()
  const bySurname = new Map<string, Array<{ given: string; person: UnmatchedPerson }>>()
  for (const person of people) {
    for (const key of person.keys) {
      byKey.set(key, [...(byKey.get(key) ?? []), person])
      const split = splitKey(key)
      if (split) bySurname.set(split.surname, [...(bySurname.get(split.surname) ?? []), { given: split.given, person }])
    }
  }

  return {
    verified: readable,
    total,
    matched: translated,
    unmatched: total - translated,
    hides: (row) => {
      if (DEFENSE_POSITIONS.has(String(row.position ?? '').trim().toUpperCase())) {
        return defenseClubs.has(normalizeTeamAbbrev(row.team ?? '') ?? '')
      }
      const sameSide = (person: UnmatchedPerson) => {
        const a = sideOfBall(person.position)
        const b = sideOfBall(row.position)
        return a == null || b == null || a === b
      }
      for (const key of nameKeys(row.name ?? '')) {
        if ((byKey.get(key) ?? []).some(sameSide)) return true
        const split = splitKey(key)
        if (!split) continue
        const nickname = (bySurname.get(split.surname) ?? []).some(
          (c) => givenNameNicknameOf(c.given, split.given) && sameSide(c.person),
        )
        if (nickname) return true
      }
      return false
    },
  }
}

/**
 * Every key one name can meet under: `normalizeMatchName` of it as written, and of it folded through
 * `normalizePlayerName` first (the paste id's normalizer, which drops a non-ASCII letter). Two existing
 * normalizers composed — not a third.
 */
function nameKeys(name: string): string[] {
  const raw = String(name ?? '').trim()
  if (!raw) return []
  return [...new Set([normalizeMatchName(raw), normalizeMatchName(normalizePlayerName(raw))])].filter(Boolean)
}

/** Given name and the rest, for the nickname pass. Null for a one-word key. */
function splitKey(key: string): { given: string; surname: string } | null {
  const words = key.split(' ')
  return words.length >= 2 ? { given: words[0]!, surname: words.slice(1).join(' ') } : null
}

/** `player_metadata` across the league's rosters: id → the name, position and club the import stored. */
function playerMetadataOf(playerDatas: readonly unknown[]): Map<string, { name: string; position: string; team: string }> {
  const out = new Map<string, { name: string; position: string; team: string }>()
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  for (const pd of playerDatas) {
    const meta = pd && typeof pd === 'object' ? (pd as Record<string, unknown>).player_metadata : null
    if (!meta || typeof meta !== 'object' || Array.isArray(meta)) continue
    for (const [id, row] of Object.entries(meta as Record<string, unknown>)) {
      if (out.has(id) || !row || typeof row !== 'object') continue
      const r = row as Record<string, unknown>
      const name = text(r.name)
      // A stored "name" that is only the id (a bare number) is no name at all.
      out.set(id, { name: name === id ? '' : name, position: text(r.position), team: text(r.team) })
    }
  }
  return out
}

/** `declaredAvailability` for one league, reading its rosters. No read for a league on another platform. */
export async function loadDeclaredAvailability(
  league: { id: string; platform: string | null | undefined },
  db: Pick<typeof prisma, 'roster'> = prisma,
): Promise<DeclaredAvailability | null> {
  if (!isDeclaredBridge(bridgeColumnFor(league.platform))) return null
  const rosters = await db.roster
    .findMany({ where: { leagueId: league.id }, select: { playerData: true } })
    .catch(() => [] as Array<{ playerData: unknown }>)
  return declaredAvailability(league.platform, rosters.map((r) => r.playerData))
}
