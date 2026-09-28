import 'server-only'

import { createHash } from 'node:crypto'
import type { League } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { resolveLeagueMembership } from '@/lib/league-access'
import { resolveWriteAuthority, sourcePlatformLabel } from '@/lib/league/write-authority'
import { resolveNames } from '@/lib/ai-payload/resolveAiTeamContext'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { getRosterPlayerIds } from '@/lib/waiver-wire/roster-utils'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { weekFromLeagueSettingsForLineup } from '@/lib/roster/buildPersistedRosterDataFromRosterState'

/**
 * Who may act, where — the checks every Chimmy action runs twice: once when the card is built, and
 * again, from scratch, when the user taps Confirm.
 *
 * 🛑 NATIVE LEAGUES ONLY, DECIDED BY `resolveWriteAuthority`. That predicate is the one the app uses
 * to decide where any write lands, and it fails SAFE: an unrecognised or empty platform resolves to
 * SHADOW. An imported league is read-only here — AllFantasy holds no write-back to ESPN, Yahoo or
 * Sleeper, so "set my lineup" there would change a copy nobody plays. The refusal says where to go.
 *
 * 🛑 THE USER'S ROSTER IS `Roster.platformUserId === userId`, EXACTLY AS `/api/leagues/roster/save`
 * FINDS IT. In a native league that column holds the AllFantasy account id. No commissioner
 * override: Chimmy only ever moves the asker's own team.
 */

export type ActionLeague = League

export type ActionScope =
  | { ok: true; league: ActionLeague; week: number; season: number }
  | { ok: false; message: string }

export function importedLeagueRefusal(args: {
  leagueName: string | null
  platform: string | null
  action: 'lineup' | 'trade'
}): string {
  const label = sourcePlatformLabel(args.platform) ?? 'the platform it was imported from'
  const name = args.leagueName ? `"${args.leagueName}"` : 'This league'
  const where =
    args.action === 'lineup'
      ? `Set the lineup in ${label} — that is where this league's games are actually scored.`
      : `Send the offer in ${label} — the other manager will never see a trade made here.`
  return [
    `${name} is imported from ${label}, so AllFantasy cannot change anything in it — imported leagues are read-only here.`,
    where,
    'Tell the user exactly that, kindly. You may still share the analysis (best lineup, trade grade) so they can make the move themselves. Do NOT say the move was made or queued.',
  ].join(' ')
}

/** Membership, a native league, and its current week — or the sentence saying why not. */
export async function loadActionScope(leagueId: string, userId: string, action: 'lineup' | 'trade'): Promise<ActionScope> {
  const membership = await resolveLeagueMembership(leagueId, userId).catch(() => null)
  if (!membership) return { ok: false, message: 'Your league membership could not be checked just now, so nothing can be prepared. Say so; do not offer the move.' }
  if (!membership.ok) {
    return { ok: false, message: 'The signed-in user is not a member of this league, so nothing can be prepared. Say so; do not offer the move.' }
  }

  const league = await prisma.league.findUnique({ where: { id: leagueId } }).catch(() => null)
  if (!league) return { ok: false, message: 'The league could not be loaded, so nothing can be prepared. Say so; do not offer the move.' }

  if (resolveWriteAuthority(league.platform) !== 'NATIVE') {
    return { ok: false, message: importedLeagueRefusal({ leagueName: league.name ?? null, platform: league.platform ?? null, action }) }
  }

  return {
    ok: true,
    league,
    week: weekFromLeagueSettingsForLineup(league.settings),
    season: league.season ?? new Date().getFullYear(),
  }
}

export type ActionRosterRow = {
  id: string
  platformUserId: string
  playerData: unknown
}

/** The asker's own roster in a native league, found the way the lineup save route finds it. */
export async function loadOwnRoster(leagueId: string, userId: string): Promise<ActionRosterRow | null> {
  return prisma.roster
    .findFirst({ where: { leagueId, platformUserId: userId }, select: { id: true, platformUserId: true, playerData: true } })
    .catch(() => null)
}

export type RosterPlayerInfo = {
  playerId: string
  name: string | null
  position: string | null
  team: string | null
  status: string | null
  gameTime: string | null
  section: 'starters' | 'bench' | 'ir' | 'taxi' | 'devy' | null
}

const NAMELESS = new Set(['', '—', '-'])

function str(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t && !NAMELESS.has(t) ? t : null
}

/**
 * Every player on a roster with the facts the card and the lock check need: name, position, team,
 * injury status, stored game time, and which section they sit in. Row data first (it is what the
 * Roster tab shows), then the shared player cache for anything the row lacks.
 *
 * ⚠ A ROW'S `name` CAN BE ITS ID. The lineup builder writes `name: String(obj.name ?? id)`, so a
 * row saved without a name carries its own id as one. That is not a name, and it is replaced.
 */
export async function describeRosterPlayers(
  sport: string,
  playerData: unknown,
): Promise<Map<string, RosterPlayerInfo>> {
  const sections = getNormalizedLineupSections(playerData)
  const out = new Map<string, RosterPlayerInfo>()
  for (const section of ['starters', 'bench', 'ir', 'taxi', 'devy'] as const) {
    for (const row of sections[section]) {
      const r = row as Record<string, unknown>
      const id = String(r.id ?? '').trim()
      if (!id || out.has(id)) continue
      const rawName = str(r.name ?? r.full_name)
      const position = str(r.position)
      out.set(id, {
        playerId: id,
        name: rawName && rawName !== id ? rawName : null,
        position: position && position !== 'UTIL' ? position.toUpperCase() : null,
        team: str(r.team ?? r.team_abbreviation),
        status: str(r.status ?? r.injury_status),
        gameTime: str(r.gameTime ?? r.game_time),
        section,
      })
    }
  }
  for (const id of getRosterPlayerIds(playerData)) {
    const key = String(id)
    if (!out.has(key)) {
      out.set(key, { playerId: key, name: null, position: null, team: null, status: null, gameTime: null, section: null })
    }
  }

  const missing = [...out.values()].filter((p) => !p.name || !p.position).map((p) => p.playerId)
  if (missing.length > 0) {
    const names = await resolveNames(normalizeToSupportedSport(sport), missing, 120).catch(() => new Map())
    for (const id of missing) {
      const meta = names.get(id)
      if (!meta) continue
      const cur = out.get(id)!
      out.set(id, {
        ...cur,
        name: cur.name ?? meta.name ?? null,
        position: cur.position ?? (meta.position ? String(meta.position).toUpperCase() : null),
        team: cur.team ?? meta.team ?? null,
        status: cur.status ?? meta.injury ?? null,
      })
    }
  }
  return out
}

/** Order-sensitive hash of who starts and who sits — the lineup a card was built against. */
export function lineupFingerprint(playerData: unknown): string {
  const sections = getNormalizedLineupSections(playerData)
  const ids = (rows: Array<Record<string, unknown>>) => rows.map((r) => String(r.id ?? '')).join(',')
  return createHash('sha256')
    .update(`S:${ids(sections.starters)}|B:${ids(sections.bench)}|I:${ids(sections.ir)}|T:${ids(sections.taxi)}|D:${ids(sections.devy)}`)
    .digest('hex')
    .slice(0, 32)
}

export function displayName(p: Pick<RosterPlayerInfo, 'name' | 'playerId'> | undefined): string {
  return p?.name ?? `(unnamed player ${p?.playerId ?? '?'})`
}
