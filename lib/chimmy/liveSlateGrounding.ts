import 'server-only'

import { prisma } from '@/lib/prisma'
import { describeGameStatus, normalizeGameStatus } from '@/lib/sports/gameStatus'
import { nflFixtureKey, resolveNflTeamRef } from '@/lib/sports/teamRef'
import type { LeagueGroundingRoster } from '@/lib/ai/leagueSportsGroundingPacket'

/**
 * HAS MY PLAYER ALREADY PLAYED?
 *
 * ⚠ THE WEEK 1 QUESTION, AND THE ONE A WRONG ANSWER COSTS MOST. Telling somebody
 * a game has not started when it finished invites them to bench a player whose
 * points are already banked; the reverse tells them a swap is too late when it
 * is not. Both are checkable within minutes, which is exactly why this block
 * refuses to guess.
 *
 * ⚠ THREE TRAPS SIT BETWEEN A ROSTER AND A KICKOFF, all measured 2026-08-25.
 *
 *   1. ONE FIXTURE, UP TO FOUR ROWS. `SportsGame` is unique on
 *      `(sport, externalId, source)`, so the same game is stored once per source
 *      — 421 rolling_insights + 324 thesportsdb + 32 espn + 16 espn_live for NFL
 *      2026. Joining without collapsing them counts one game four times and lets
 *      two sources disagree about whether it is over. `nflFixtureKey` collapses
 *      on team identity and calendar day, because `externalId` differs BY source.
 *
 *   2. TEAM NAMES ARE NOT ONE FORMAT. A roster says `JAX`; thesportsdb says
 *      "Jacksonville Jaguars"; rolling_insights says both, in the same column.
 *      Everything goes through `resolveNflTeamRef`.
 *
 *   3. `status` SPEAKS SIXTEEN VOCABULARIES — see `normalizeGameStatus`. An
 *      unrecognised value is reported as unknown here, never assumed either way.
 */

/** A starting lineup; beyond this the caller is not asking a lineup question. */
const MAX_STARTERS = 20
/** Sources agree more often than not; when they do not, prefer the live feed. */
const SOURCE_PRIORITY = ['espn_live', 'espn', 'rolling_insights', 'thesportsdb']

type GameRow = {
  homeTeam: string
  awayTeam: string
  status: string | null
  startTime: Date | null
  week: number | null
  season: number | null
  source: string
  homeScore: number | null
  awayScore: number | null
}

function bestPerFixture(rows: GameRow[]): GameRow[] {
  const byKey = new Map<string, GameRow>()
  for (const row of rows) {
    const key = nflFixtureKey(row)
    if (!key) continue
    const existing = byKey.get(key)
    if (!existing) {
      byKey.set(key, row)
      continue
    }
    const a = SOURCE_PRIORITY.indexOf(row.source)
    const b = SOURCE_PRIORITY.indexOf(existing.source)
    // Unknown sources sort last rather than winning by accident.
    if ((a === -1 ? 99 : a) < (b === -1 ? 99 : b)) byKey.set(key, row)
  }
  return [...byKey.values()]
}

/**
 * Which of this user's starters have played, are playing, or have not kicked off.
 * Returns null when there is no roster or no schedule to read, so the prompt
 * gains no empty section.
 */
export async function buildLiveSlateContext(args: {
  rosters: LeagueGroundingRoster[] | null | undefined
  sport: string
  season: number | null
  week: number | null
}): Promise<string | null> {
  if (args.sport.toUpperCase() !== 'NFL') return null

  const starters = (args.rosters ?? [])
    .flatMap((r) => r.starters ?? [])
    .filter((p) => p?.playerName)
    .slice(0, MAX_STARTERS)
  if (starters.length === 0) return null

  let rows: GameRow[]
  try {
    rows = (await prisma.sportsGame.findMany({
      where: {
        sport: { equals: args.sport, mode: 'insensitive' },
        ...(args.season != null ? { season: args.season } : {}),
        ...(args.week != null ? { week: args.week } : {}),
      },
      select: {
        homeTeam: true,
        awayTeam: true,
        status: true,
        startTime: true,
        week: true,
        season: true,
        source: true,
        homeScore: true,
        awayScore: true,
      },
      take: 400,
    })) as unknown as GameRow[]
  } catch {
    return null
  }
  if (rows.length === 0) return null

  const fixtures = bestPerFixture(rows)
  const byTeam = new Map<string, GameRow>()
  for (const f of fixtures) {
    for (const ref of [f.homeTeam, f.awayTeam]) {
      const canonical = resolveNflTeamRef(ref)
      if (canonical && !byTeam.has(canonical)) byTeam.set(canonical, f)
    }
  }

  const played: string[] = []
  const live: string[] = []
  const upcoming: string[] = []
  const unknown: string[] = []

  for (const p of starters) {
    const canonical = resolveNflTeamRef(p.team)
    const game = canonical ? byTeam.get(canonical) : null
    const label = `${p.playerName} (${p.position}${p.team ? `, ${p.team}` : ''})`
    if (!game) {
      unknown.push(`${label} — no game found`)
      continue
    }
    const opponent =
      resolveNflTeamRef(game.homeTeam) === canonical ? game.awayTeam : game.homeTeam
    const when = game.startTime ? game.startTime.toISOString() : 'time unknown'
    switch (normalizeGameStatus(game.status)) {
      case 'final':
        played.push(
          `${label} vs ${opponent} — FINAL${game.homeScore != null && game.awayScore != null ? ` ${game.homeScore}-${game.awayScore}` : ''}`,
        )
        break
      case 'live':
        live.push(`${label} vs ${opponent} — IN PROGRESS`)
        break
      case 'scheduled':
        upcoming.push(`${label} vs ${opponent} — kickoff ${when}`)
        break
      default:
        unknown.push(`${label} vs ${opponent} — ${describeGameStatus(game.status)}`)
    }
  }

  const lines: string[] = [
    `THIS USER'S STARTERS AND THEIR GAMES (${args.season ?? 'current season'}${args.week != null ? `, week ${args.week}` : ''}):`,
  ]
  if (played.length > 0) lines.push(`ALREADY PLAYED — their points are final: ${played.join('; ')}.`)
  if (live.length > 0) lines.push(`PLAYING NOW — cannot be changed: ${live.join('; ')}.`)
  if (upcoming.length > 0) lines.push(`NOT STARTED — still changeable: ${upcoming.join('; ')}.`)
  if (unknown.length > 0) {
    lines.push(
      `STATUS UNKNOWN — do NOT say whether these have played: ${unknown.join('; ')}.`,
    )
  }

  lines.push(
    'RULES: only a NOT STARTED player can still be benched. Never tell the user to change a player whose game is final or in progress, and for anyone under STATUS UNKNOWN say you cannot tell rather than assuming either way.',
  )

  return lines.join('\n')
}
