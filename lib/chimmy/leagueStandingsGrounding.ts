import 'server-only'

import { prisma } from '@/lib/prisma'

/**
 * LEAGUE STANDINGS AND MANAGER PROFILES -> CHIMMY.
 *
 * ⚠ THE PACKET DESCRIBES STANDINGS WITHOUT CONTAINING THEM. The league sports
 * grounding packet carries a `standingsSummary` of `{ available, rowCount,
 * lastSyncedAt, source }` — metadata about a table Chimmy is never shown. So
 * "who is first?", "what is my record?" and "who has FAAB left?" had no grounded
 * answer even though `redraft_rosters` holds all of it (986 rows across 71
 * leagues, measured 2026-08-25).
 *
 * ⚠ ZERO IS NOT THE SAME AS UNKNOWN, AND PRE-SEASON IS NEITHER. Of those 986
 * rosters exactly TWO carry a win, a loss or a point — because the 2026 season
 * has not kicked off. Rendering a table of 0-0 rows would be technically true and
 * practically a lie: it reads as a standings table, and a model handed one will
 * talk about "the current standings" as though games had been played. When no
 * game has been played this block says so in words and lists no records at all.
 */

/** A full league fits comfortably; beyond this the prompt is being abused. */
const MAX_MANAGERS = 20

type RosterRow = {
  ownerId: string
  ownerName: string
  teamName: string | null
  wins: number
  losses: number
  ties: number
  pointsFor: number
  pointsAgainst: number
  streak: string | null
  playoffSeed: number | null
  faabBalance: number | null
  isEliminated: boolean
}

function hasPlayedGames(rows: RosterRow[]): boolean {
  return rows.some((r) => r.wins > 0 || r.losses > 0 || r.ties > 0 || r.pointsFor > 0)
}

function describeManager(r: RosterRow, isViewer: boolean): string {
  const who = r.teamName ? `${r.teamName} (${r.ownerName})` : r.ownerName
  const parts = [
    `${who}${isViewer ? ' ← THIS USER' : ''}`,
    `${r.wins}-${r.losses}${r.ties > 0 ? `-${r.ties}` : ''}`,
    `PF ${r.pointsFor.toFixed(1)}`,
    `PA ${r.pointsAgainst.toFixed(1)}`,
  ]
  if (r.streak) parts.push(`streak ${r.streak}`)
  if (r.playoffSeed != null) parts.push(`seed ${r.playoffSeed}`)
  if (r.faabBalance != null) parts.push(`FAAB ${r.faabBalance}`)
  if (r.isEliminated) parts.push('ELIMINATED')
  return `- ${parts.join(' | ')}`
}

/**
 * Standings and per-manager facts for the league in scope. Returns null when
 * there is no redraft season on file, so the prompt gains no empty section.
 */
export async function buildLeagueStandingsContext(
  leagueId: string,
  userId: string,
): Promise<string | null> {
  if (!leagueId || !userId) return null

  let season: { id: string; season: number } | null
  try {
    season = await prisma.redraftSeason.findFirst({
      where: { leagueId },
      orderBy: { season: 'desc' },
      select: { id: true, season: true },
    })
  } catch {
    return null
  }
  if (!season) return null

  let rows: RosterRow[]
  try {
    rows = (await prisma.redraftRoster.findMany({
      where: { seasonId: season.id },
      take: MAX_MANAGERS,
      select: {
        ownerId: true,
        ownerName: true,
        teamName: true,
        wins: true,
        losses: true,
        ties: true,
        pointsFor: true,
        pointsAgainst: true,
        streak: true,
        playoffSeed: true,
        faabBalance: true,
        isEliminated: true,
      },
    })) as unknown as RosterRow[]
  } catch {
    return null
  }
  if (rows.length === 0) return null

  const viewer = rows.find((r) => r.ownerId === userId) ?? null
  const lines: string[] = [`LEAGUE STANDINGS AND MANAGERS — ${season.season} season, ${rows.length} teams.`]

  if (!hasPlayedGames(rows)) {
    /*
     * The pre-season case, which is the CURRENT case for almost every league on
     * the platform. Listing 0-0 rows here is what would make a model narrate
     * standings that do not exist yet.
     */
    lines.push(
      'NO GAMES HAVE BEEN PLAYED YET this season: every record is 0-0 and there are no standings, no points for or against, and no streaks. Do NOT describe standings, rank anyone, or say who is performing well. If asked, say the season has not started.',
    )
    const withFaab = rows.filter((r) => r.faabBalance != null)
    if (withFaab.length > 0) {
      lines.push(
        `Pre-season facts that ARE known — FAAB budgets: ${withFaab
          .map((r) => `${r.teamName ?? r.ownerName} ${r.faabBalance}`)
          .join(', ')}.`,
      )
    }
    if (viewer) {
      lines.push(
        `This user manages ${viewer.teamName ?? viewer.ownerName}${
          viewer.faabBalance != null ? ` (FAAB ${viewer.faabBalance})` : ''
        }.`,
      )
    }
    return lines.join('\n')
  }

  const sorted = [...rows].sort((a, b) => {
    if (a.playoffSeed != null && b.playoffSeed != null) return a.playoffSeed - b.playoffSeed
    if (b.wins !== a.wins) return b.wins - a.wins
    return b.pointsFor - a.pointsFor
  })

  lines.push('Standings (use ONLY these numbers; do not compute your own):')
  for (const r of sorted) lines.push(describeManager(r, viewer?.ownerId === r.ownerId))

  if (viewer) {
    lines.push(
      `THIS USER manages ${viewer.teamName ?? viewer.ownerName}: ${viewer.wins}-${viewer.losses}${
        viewer.ties > 0 ? `-${viewer.ties}` : ''
      }, ${viewer.pointsFor.toFixed(1)} points for.`,
    )
  } else {
    // Better to say it than to let the model pick a team and call it theirs.
    lines.push(
      'This user does not hold a team in this league, so do not attribute any of the above rosters to them.',
    )
  }

  return lines.join('\n')
}
