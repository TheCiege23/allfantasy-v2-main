import 'server-only'

import type { LeagueSport } from '@prisma/client'

import { getPlayerPoolForLeague } from '@/lib/sport-teams/SportPlayerPoolResolver'
import type { PoolPlayerRecord } from '@/lib/sport-teams/types'
import { normalizeToSupportedSport } from '@/lib/sport-scope'
import { BASELINE_BASIS, baselineAvailable, baselineFor, loadBaselineIndex, type BaselineIndex } from '@/lib/chimmy/afBaselineIndex'
import { prisma } from '@/lib/prisma'
import { loadNhlProspectFreeAgents } from '@/lib/waiver-wire/nhlProspectFreeAgency'

/**
 * "Who can I pick up?" in an NBA, NHL, MLB, college or soccer league.
 *
 * The NFL tool ranks unrostered players by published market VALUE, which exists for the NFL only.
 * Every other sport still has two things in our database: the sport's player pool (the same pool the
 * Waivers tab subtracts rosters from — `getPlayerPoolForLeague`, a cached `SportsPlayer` read, no
 * provider call) and AllFantasy's season-long per-game projection. So this subtracts the league's
 * rosters from the pool, exactly as the Waivers tab does, and ranks what is left by that projection —
 * and says in words that it is the standard per-game number, not this league's scoring.
 *
 * ⚠ SOCCER HAS NO PROJECTION BASE (no player season stats from Rolling Insights), so a soccer league
 * gets a count and a refusal to rank, never an invented order.
 */

const MAX_SHOWN = 15

export type OtherSportAvailableDeps = {
  pool: (leagueId: string, sport: string) => Promise<PoolPlayerRecord[]>
  baseline: (sport: string) => Promise<BaselineIndex>
  /** NHL dynasty: how many Fantrax prospects are on no roster (lib/waiver-wire/nhlProspectFreeAgency.ts). */
  prospectCount?: (rostered: Set<string>) => Promise<number>
}

const defaultDeps: OtherSportAvailableDeps = {
  pool: (leagueId, sport) => getPlayerPoolForLeague(leagueId, normalizeToSupportedSport(sport) as LeagueSport, { limit: 5000 }),
  baseline: loadBaselineIndex,
  prospectCount: async (rostered) => (await loadNhlProspectFreeAgents(prisma as never, { rosteredIds: rostered, limit: 0 })).total,
}

function isRostered(p: PoolPlayerRecord, rostered: Set<string>): boolean {
  return [p.player_id, p.external_source_id, p.sleeper_id].some((id) => id != null && rostered.has(String(id)))
}

/**
 * NHL dynasty leagues also hold Fantrax-only prospects in free agency. They have no projection, so
 * they are never ranked or recommended here: Chimmy is told they exist, what they are, and where to
 * find them. A failed read says nothing about them rather than guessing.
 */
async function nhlProspectNote(
  args: { sport: string; dynasty?: boolean; rostered: Set<string> },
  deps: OtherSportAvailableDeps,
): Promise<string | null> {
  if (String(args.sport).toUpperCase() !== 'NHL' || args.dynasty !== true || args.rostered.size === 0) return null
  const count = await (deps.prospectCount ?? defaultDeps.prospectCount!)(args.rostered).catch(() => null)
  if (!count) return null
  return [
    `Also free in this dynasty league: ${count} NHL prospects from Fantrax (AHL, junior or unsigned players who are on no NHL roster in our data).`,
    'They have no projection, age or draft year, so they are NOT ranked above and you must give no projection-based advice about them.',
    'If the user asks about prospects, say they can be found by name in the free-agent list, where each one is marked "Prospect", and that he scores zero until he plays NHL games.',
  ].join(' ')
}

export async function buildOtherSportAvailableContext(
  args: { leagueName: string; sport: string; leagueId: string; rostered: Set<string>; dynasty?: boolean },
  deps: OtherSportAvailableDeps = defaultDeps,
): Promise<string> {
  const base = await buildPoolContext(args, deps)
  const note = await nhlProspectNote(args, deps)
  return note ? `${base}\n${note}` : base
}

async function buildPoolContext(
  args: { leagueName: string; sport: string; leagueId: string; rostered: Set<string> },
  deps: OtherSportAvailableDeps,
): Promise<string> {
  const sport = String(args.sport).toUpperCase()
  const head = `Player VALUES are only published for NFL, so "${args.leagueName}" (${sport}) is ranked a different way below.`

  if (args.rostered.size === 0) {
    return `No rosters are stored for "${args.leagueName}", so we cannot tell who is taken and who is free. Say the rosters have not synced; do NOT name any players as available.`
  }

  const pool = await deps.pool(args.leagueId, sport).catch(() => [] as PoolPlayerRecord[])
  if (pool.length === 0) {
    return `${head} But the ${sport} player pool could not be read, so nobody can be named as available. Say so.`
  }
  const available = pool.filter((p) => !isRostered(p, args.rostered))

  if (!baselineAvailable(sport)) {
    return [
      head,
      `${available.length} players in the ${sport} pool are on no roster in this league, but AllFantasy has no ${sport} projections to rank them by (there is no player season-stat base for it).`,
      'Say that plainly. Do NOT rank them or pick a "best" one from general knowledge.',
    ].join(' ')
  }

  const index = await deps.baseline(sport).catch(() => null)
  if (!index || index.byName.size === 0) {
    return `${head} But no AllFantasy ${sport} projections are stored right now, so the ${available.length} unrostered players cannot be ranked. Say so; do not rank them yourself.`
  }

  const ranked = available
    .map((p) => ({ p, b: baselineFor(index, p.full_name) }))
    .filter((x): x is { p: PoolPlayerRecord; b: NonNullable<ReturnType<typeof baselineFor>> } => x.b != null)
    .sort((a, b) => b.b.perGame - a.b.perGame)
  const shown = ranked.slice(0, MAX_SHOWN)
  if (shown.length === 0) {
    return `${head} None of the ${available.length} unrostered ${sport} players has an AllFantasy projection on file, so none can be ranked. Say so; do not rank them yourself.`
  }

  const lines = shown.map(({ p, b }, i) => {
    const bits = [p.position, p.team_abbreviation ?? p.team].filter(Boolean).join(', ')
    const injury = p.injury_status && p.injury_status.trim() ? ` [${p.injury_status}]` : ''
    return `${i + 1}. ${p.full_name}${bits ? ` (${bits})` : ''} — ${b.perGame.toFixed(1)} pts per game${injury}`
  })
  return [
    head,
    `UNROSTERED in this league, ranked by ${BASELINE_BASIS} (season ${index.season}):`,
    ...lines,
    `${available.length - ranked.length} other unrostered players have no projection on file and are not ranked.`,
    'Unrostered is not the same as claimable right now — a just-dropped player can be on waivers. Call get_waiver_status for the waiver rules. Quote these numbers as per-game standard projections, never as this league\'s points.',
  ].join('\n')
}
