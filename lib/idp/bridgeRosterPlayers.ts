/**
 * Bridge imported rosters into `RedraftRosterPlayer`.
 *
 * 🛑 THE CAP STACK READS A TABLE IMPORTED LEAGUES DO NOT POPULATE. `assignDraftSalary`,
 * `processFranchiseTag` and the league cap overview all key on `RedraftRoster` /
 * `RedraftRosterPlayer`. A league imported from Sleeper gets its `RedraftRoster` rows but its
 * players land in `Roster.playerData` as bare id strings. Measured on KBFL 2026-08-30:
 * 32 RedraftRoster rows, 32 Roster rows holding 1,055 players, and ZERO RedraftRosterPlayer
 * rows. So a commissioner could enable a salary cap and then find no player to assign a salary
 * to — the cap would be real and empty.
 *
 * This fills that table from what the import already stored. It creates only; it never drops,
 * never overwrites, and never invents a player.
 *
 * ⚠ THREE THINGS THAT LOOK LIKE DETAILS AND ARE NOT:
 *
 * 1. THE ROSTER JOIN IS NOT THE OBVIOUS ONE. `Roster.platformUserId` -> `RedraftRoster.ownerId`
 *    matched only 30 of 32 on KBFL. `teamName` and `ownerName` each matched 32 of 32 and are
 *    unique. So the id is tried first and the name only settles what the id could not, against
 *    the rosters still unclaimed — a roster that cannot be matched unambiguously is SKIPPED and
 *    reported, never guessed at.
 *
 * 2. `SportsPlayer.sleeperId` IS NOT UNIQUE AND THE DUPLICATES DISAGREE. 1,055 KBFL ids
 *    resolved to 2,058 rows. `composePlayerIdentities` already exists for exactly this and is
 *    reused rather than reimplemented.
 *
 * 3. VENDORS SPELL POSITIONS TWO WAYS. The same board carries `LB` and `Linebacker`, `DE` and
 *    `Defensive End`, `WR` and `Wide Receiver`. Composition is FIRST-WINS on position, so which
 *    spelling survives depends on Postgres row order. Every IDP predicate in this repo keys on
 *    the abbreviation, so an unnormalised "Linebacker" is a defender the cap engine cannot see.
 *    Normalising is therefore not cosmetic: it decides whether a defender gets a salary.
 */

import { composePlayerIdentities, type PlayerIdentityRow } from '@/lib/core-app/playerIdentityCompose'
import { prisma } from '@/lib/prisma'

export type BridgeResult = {
  leagueId: string
  sport: string
  rostersMatched: number
  rostersSkipped: Array<{ rosterId: string; reason: string }>
  playersSeen: number
  playersResolved: number
  created: number
  alreadyPresent: number
  unresolved: string[]
  defendersCreated: number
  /** Positions excluded as non-fantasy, counted so an over-tight allowlist is visible. */
  filtered: Record<string, number>
}

/**
 * Long vendor spellings -> the abbreviations every IDP predicate in this repo uses.
 * Anything already an abbreviation passes through untouched.
 */
const POSITION_ALIASES: Record<string, string> = {
  QUARTERBACK: 'QB',
  'RUNNING BACK': 'RB',
  FULLBACK: 'FB',
  'WIDE RECEIVER': 'WR',
  'TIGHT END': 'TE',
  KICKER: 'K',
  'PLACE KICKER': 'K',
  PUNTER: 'P',
  LINEBACKER: 'LB',
  'INSIDE LINEBACKER': 'LB',
  'MIDDLE LINEBACKER': 'LB',
  'OUTSIDE LINEBACKER': 'LB',
  CORNERBACK: 'CB',
  SAFETY: 'S',
  'FREE SAFETY': 'FS',
  'STRONG SAFETY': 'SS',
  'DEFENSIVE END': 'DE',
  'DEFENSIVE TACKLE': 'DT',
  'DEFENSIVE LINEMAN': 'DL',
  'NOSE TACKLE': 'NT',
}

export function normalizeRosterPosition(raw: string | null | undefined): string | null {
  const v = String(raw ?? '').trim()
  if (!v) return null
  const upper = v.toUpperCase()
  return POSITION_ALIASES[upper] ?? upper
}

/**
 * Positions a fantasy roster can actually hold, checked AFTER normalisation.
 *
 * 🛑 AN ALLOWLIST, NOT A DENYLIST, AND THE DIRECTION MATTERS. The first cut of this bridge had
 * neither and wrote a row with position "GUARD" — an offensive lineman, on a fantasy roster,
 * because an unrecognised vendor spelling passed through uppercased. A denylist would have to
 * anticipate every such spelling ("Guard", "Offensive Tackle", "Long Snapper", "OL", "C"); an
 * allowlist only has to know what a league can roster, which is a closed set.
 *
 * ⚠ THE COST IS THAT AN UNANTICIPATED *VALID* SPELLING IS DROPPED, so every exclusion is
 * counted into `filtered` rather than discarded silently. An allowlist nobody can see is how a
 * real position goes missing and no one notices.
 *
 * 🛑 AND FILTERING ALONE WOULD HAVE DELETED A REAL PLAYER. The "GUARD" row that prompted this
 * was Daron Payne — a DEFENSIVE TACKLE. He has two vendor rows: `thesportsdb` says "Guard"
 * (wrong) and `sleeper` says "DT" (right). Composition is first-wins on position, so Postgres
 * row order decided which one a fantasy roster saw. Excluding him would have removed a rostered
 * starting defender and reported it as tidying up. So the position is RESOLVED ACROSS ALL
 * VENDOR ROWS FIRST, preferring one the allowlist recognises, and only a player NO vendor
 * describes as rosterable is filtered. Same shape as the composer's own club rule: a value that
 * resolves replaces one that does not.
 */
const FANTASY_POSITIONS = new Set([
  // Offence
  'QB', 'RB', 'FB', 'WR', 'TE', 'K', 'P',
  // Team defence
  'DST', 'DEF',
  // IDP
  'DE', 'DT', 'DL', 'NT', 'EDGE', 'LB', 'ILB', 'OLB', 'MLB', 'CB', 'S', 'SS', 'FS', 'DB',
])

const DEFENSIVE = new Set(['DE', 'DT', 'DL', 'NT', 'LB', 'ILB', 'OLB', 'MLB', 'CB', 'S', 'SS', 'FS', 'DB', 'EDGE'])
export const isDefensivePosition = (pos: string | null): boolean =>
  pos != null && DEFENSIVE.has(pos.toUpperCase())

function idsFrom(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const p of value) {
    const id = typeof p === 'string'
      ? p
      : String((p as Record<string, unknown>)?.player_id ?? (p as Record<string, unknown>)?.playerId ?? (p as Record<string, unknown>)?.id ?? '')
    if (id.trim()) out.push(id.trim())
  }
  return out
}

/**
 * Same precedence as the draft-finalisation path: an explicit starter wins, then a named
 * lineup section, then bench. Bench is the honest default — an imported payload that says
 * nothing about a slot is not evidence the player is starting.
 */
function inferSlotType(payload: Record<string, unknown>, playerId: string): string {
  if (idsFrom(payload.starters).includes(playerId)) return 'starter'
  const sections = (payload.lineup_sections ?? payload.lineupSections) as Record<string, unknown> | undefined
  if (sections && typeof sections === 'object') {
    for (const [name, value] of Object.entries(sections)) {
      if (idsFrom(value).includes(playerId)) {
        const n = name.toLowerCase()
        if (n.includes('taxi')) return 'taxi'
        if (n.includes('ir') || n.includes('injur')) return 'ir'
        if (n.includes('start')) return 'starter'
        return 'bench'
      }
    }
  }
  if (idsFrom(payload.taxi).includes(playerId)) return 'taxi'
  return 'bench'
}

export async function bridgeRosterPlayersForLeague(
  leagueId: string,
  opts?: { dryRun?: boolean },
): Promise<BridgeResult> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { sport: true } })
  const sport = league?.sport ?? 'NFL'
  const result: BridgeResult = {
    leagueId, sport,
    rostersMatched: 0, rostersSkipped: [], playersSeen: 0, playersResolved: 0,
    created: 0, alreadyPresent: 0, unresolved: [], defendersCreated: 0, filtered: {},
  }

  const generic = await prisma.roster.findMany({
    where: { leagueId }, select: { id: true, platformUserId: true, playerData: true },
  })
  const redraft = await prisma.redraftRoster.findMany({
    where: { leagueId }, select: { id: true, ownerId: true, ownerName: true, teamName: true },
  })
  if (!generic.length || !redraft.length) return result

  // Pass 1: canonical id. Pass 2: team name, then owner name, among rosters still unclaimed.
  const claimed = new Set<string>()
  const pairs: Array<{ generic: (typeof generic)[number]; redraftId: string }> = []
  const byOwnerId = new Map(redraft.map((r) => [r.ownerId, r]))

  for (const g of generic) {
    const hit = byOwnerId.get(g.platformUserId)
    if (hit && !claimed.has(hit.id)) {
      claimed.add(hit.id)
      pairs.push({ generic: g, redraftId: hit.id })
    }
  }
  const norm = (s: unknown) => String(s ?? '').trim().toLowerCase()
  for (const g of generic) {
    if (pairs.some((p) => p.generic.id === g.id)) continue
    const pd = (g.playerData ?? {}) as Record<string, unknown>
    const imp = (pd.import ?? {}) as Record<string, unknown>
    const remaining = redraft.filter((r) => !claimed.has(r.id))
    const byTeam = remaining.filter((r) => norm(r.teamName) && norm(r.teamName) === norm(imp.teamName))
    const byOwner = remaining.filter((r) => norm(r.ownerName) === norm(imp.ownerName))
    const chosen = byTeam.length === 1 ? byTeam[0] : byOwner.length === 1 ? byOwner[0] : null
    if (!chosen) {
      result.rostersSkipped.push({
        rosterId: g.id,
        reason: byTeam.length > 1 || byOwner.length > 1 ? 'ambiguous name match' : 'no matching redraft roster',
      })
      continue
    }
    claimed.add(chosen.id)
    pairs.push({ generic: g, redraftId: chosen.id })
  }
  result.rostersMatched = pairs.length

  // Resolve every id once, composing the duplicate vendor rows.
  const allIds = new Set<string>()
  for (const { generic: g } of pairs) {
    const pd = (g.playerData ?? {}) as Record<string, unknown>
    for (const id of idsFrom(Array.isArray(pd) ? pd : pd.players)) allIds.add(id)
  }
  result.playersSeen = allIds.size

  const rows = (await prisma.sportsPlayer.findMany({
    where: { sport, sleeperId: { in: [...allIds] } },
    select: { sleeperId: true, sport: true, name: true, position: true, team: true },
  })) as PlayerIdentityRow[]
  const identities = composePlayerIdentities(rows)

  /*
   * Position resolved across every vendor row for the id, preferring one the allowlist knows.
   * The composed identity is still the source for name and club; only position needs this,
   * because it is the only field where a vendor is not merely less useful but WRONG.
   */
  const positionById = new Map<string, string>()
  for (const r of rows) {
    if (!r.sleeperId) continue
    const norm = normalizeRosterPosition(r.position)
    if (!norm) continue
    const held = positionById.get(r.sleeperId)
    if (!held) { positionById.set(r.sleeperId, norm); continue }
    if (!FANTASY_POSITIONS.has(held) && FANTASY_POSITIONS.has(norm)) positionById.set(r.sleeperId, norm)
  }
  result.playersResolved = identities.size
  for (const id of allIds) if (!identities.has(id)) result.unresolved.push(id)

  const existing = await prisma.redraftRosterPlayer.findMany({
    where: { rosterId: { in: pairs.map((p) => p.redraftId) } },
    select: { rosterId: true, playerId: true },
  })
  const already = new Set(existing.map((e) => `${e.rosterId}:${e.playerId}`))

  for (const { generic: g, redraftId } of pairs) {
    const pd = (g.playerData ?? {}) as Record<string, unknown>
    for (const playerId of idsFrom(Array.isArray(pd) ? pd : pd.players)) {
      if (already.has(`${redraftId}:${playerId}`)) { result.alreadyPresent++; continue }
      const ident = identities.get(playerId)
      if (!ident) continue // counted in unresolved; never invent a name or position
      const position = positionById.get(playerId) ?? normalizeRosterPosition(ident.position)
      if (!position) continue
      if (!FANTASY_POSITIONS.has(position)) {
        result.filtered[position] = (result.filtered[position] ?? 0) + 1
        continue
      }
      if (!opts?.dryRun) {
        await prisma.redraftRosterPlayer.create({
          data: {
            rosterId: redraftId,
            playerId,
            playerName: ident.name ?? playerId,
            position,
            team: ident.team ?? null,
            sport,
            slotType: inferSlotType(pd, playerId),
            /* Not 'drafted': these were imported from another platform, and saying otherwise
             * would misreport how every one of them was acquired. */
            acquisitionType: 'imported',
          },
        })
      }
      result.created++
      if (isDefensivePosition(position)) result.defendersCreated++
    }
  }

  return result
}
