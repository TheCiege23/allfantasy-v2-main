import 'server-only'

import { prisma } from '@/lib/prisma'
import { normalizeTeamAbbrev } from '@/lib/team-abbrev'
import { designationOnset, type InjuryRowLike } from './designationOnset'
import type { TriageInjury } from './gameDayTriage'

/**
 * One injury claim per player name, for a list of players — the rule the game-day list and the
 * "Your shares" list both read, kept in ONE place (two copies of a matching rule is the bug).
 *
 * ⚠ INJURY ROWS MATCH BY NAME, SO THE CLUB IS CHECKED. Two NFL players can share a name; a row that
 * names a club is used only when it folds to the player's club, and a row with no club is accepted
 * as the feed's word. Every source's rows for a name then fold into one claim — the freshest word,
 * the earliest report of it (designationOnset.ts).
 *
 * Keyed by the lower-cased, trimmed name.
 */
export async function readInjuryClaims(
  sport: string,
  players: ReadonlyArray<{ name: string; team: string | null }>,
): Promise<Map<string, TriageInjury>> {
  const out = new Map<string, TriageInjury>()
  const names = [...new Set(players.map((p) => p.name))]
  if (names.length === 0) return out

  const rows = await prisma.sportsInjury
    .findMany({
      where: { sport, playerName: { in: names } },
      orderBy: { fetchedAt: 'desc' },
      select: { playerName: true, team: true, status: true, description: true, date: true, fetchedAt: true },
    })
    .catch(() => [] as Array<{ playerName: string; team: string | null; status: string | null; description: string | null; date: Date | null; fetchedAt: Date }>)

  const clubByName = new Map<string, string | null>()
  for (const p of players) clubByName.set(p.name.trim().toLowerCase(), normalizeTeamAbbrev(p.team))
  const rowsByName = new Map<string, InjuryRowLike[]>()
  for (const r of rows) {
    const key = r.playerName.trim().toLowerCase()
    const rowClub = normalizeTeamAbbrev(r.team)
    const club = clubByName.get(key) ?? null
    if (rowClub && club && rowClub !== club) continue // a namesake on another club
    const list = rowsByName.get(key) ?? []
    list.push(r)
    rowsByName.set(key, list)
  }
  for (const [key, list] of rowsByName) {
    const onset = designationOnset(list)
    if (!onset) continue
    out.set(key, { status: onset.status, description: onset.description, reportedAt: onset.reportedAt ? onset.reportedAt.toISOString() : null })
  }
  return out
}
