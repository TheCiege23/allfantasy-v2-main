import 'server-only'
import { prisma } from '@/lib/prisma'
import { connectedRosterPlayers, type ConnectedRosterPlayer } from '@/lib/core-app/connectedRoster'
import { buildFantraxLists, sumStarterPoints } from './buildSides'
import { loadCollegePoints } from './collegePoints'
import { combinedTotal } from './format'
import { confidentTeamMatches, effectiveTeamMap, readTeamMap, suggestTeamMatches, type FantraxTeam, type SleeperTeam } from './teamMatch'

/**
 * Combined scoring, head to head: your NFL + college points against your Sleeper opponent's NFL +
 * college points.
 *
 * The opponent is decided by the PRO schedule (Sleeper), the league's head-to-head calendar. Their
 * college team comes from the commissioner's saved map (`League.settings.collegeProTeamMap`, see
 * teamMatch.ts). Their college points are scored exactly as yours are (collegePoints.ts) from their
 * Fantrax starters, because the same scorer on both sides is the only fair comparison.
 */

export const COLLEGE_PRO_TEAM_MAP_KEY = 'collegeProTeamMap'

export type HeadToHead = {
  me: number | null
  opponent: { name: string | null; total: number | null } | null
  /** Why the opponent's combined total cannot be shown yet, in words a commissioner can act on. */
  missing: string | null
}

export type TeamMapEditor = {
  sleeperTeams: SleeperTeam[]
  fantraxTeams: FantraxTeam[]
  saved: Record<string, string>
  /** Pre-filled choices only. Nothing is scored from a suggestion until it is saved. */
  suggested: Record<string, string>
}

/** The college league's teams and every team's roster rows, from the Fantrax snapshot. */
async function readSnapshot(fantraxSnapshotId: string) {
  const snap = await prisma.fantraxLeague.findUnique({ where: { id: fantraxSnapshotId }, select: { standings: true, roster: true } })
  const teams: FantraxTeam[] = (Array.isArray(snap?.standings) ? (snap!.standings as unknown[]) : [])
    .map((r) => r as { team?: unknown; fantraxTeamId?: unknown })
    .filter((r) => typeof r.fantraxTeamId === 'string' && typeof r.team === 'string')
    .map((r) => ({ teamId: r.fantraxTeamId as string, name: r.team as string }))
  const rows = Array.isArray(snap?.roster) ? (snap!.roster as unknown[]) : []
  return { teams, rows }
}

export async function loadHeadToHead(args: {
  proSettings: unknown
  fantraxSnapshotId: string
  myCollegeTeamName: string | null
  myCombined: number | null
  opponentProTotal: number | null
  opponentName: string | null
  myRosterId: string
  opponentRosterId: string | null
  /** The PRO league's teams: Sleeper rosters, or a Fantrax pro league's teams keyed by Fantrax team id. */
  sleeperTeams: SleeperTeam[]
  season: number
  nflWeek: number | null
  wantEditor: boolean
  /** The college sport, for reading the opponent's Fantrax roster. Football by default. */
  collegeSport?: string
  /**
   * Points for the opponent's college players. Football uses the CFBD/RI week reader (the default);
   * basketball passes the daily-sport reader over the pro league's Fantrax period.
   */
  scoreCollegePlayers?: (players: ConnectedRosterPlayer[]) => Promise<Record<string, number> | null>
  /** The college league's `League.settings`, so the opponent is scored under the same rules as you. */
  collegeSettings?: unknown
}): Promise<{ headToHead: HeadToHead; editor: TeamMapEditor | null }> {
  const { teams: fantraxTeams, rows } = await readSnapshot(args.fantraxSnapshotId)
  const saved = readTeamMap((args.proSettings as Record<string, unknown> | null)?.[COLLEGE_PRO_TEAM_MAP_KEY])

  // Your own pair is known from the franchise link: it is how this page found your college team at all.
  const mine = args.myCollegeTeamName
    ? fantraxTeams.find((t) => t.name.trim().toLowerCase() === args.myCollegeTeamName!.trim().toLowerCase())
    : undefined
  const known = mine ? { [args.myRosterId]: mine.teamId } : {}
  const editor = args.wantEditor
    ? { sleeperTeams: args.sleeperTeams, fantraxTeams, saved, suggested: suggestTeamMatches(args.sleeperTeams, fantraxTeams, { ...known, ...saved }) }
    : null

  const base: HeadToHead = { me: args.myCombined, opponent: null, missing: null }
  if (!args.opponentRosterId) return { headToHead: { ...base, missing: 'No head-to-head opponent this week.' }, editor }
  // What is scored: the commissioner's saved choices, then every unambiguous automatic match.
  const teamMap = effectiveTeamMap(saved, confidentTeamMatches(args.sleeperTeams, fantraxTeams, known))
  const oppTeamId = teamMap[args.opponentRosterId]
  if (!oppTeamId) {
    return { headToHead: { ...base, missing: 'Match each pro team to its college team to compare combined scores.' }, editor }
  }
  const oppTeam = fantraxTeams.find((t) => t.teamId === oppTeamId)
  if (!oppTeam || (args.nflWeek == null && !args.scoreCollegePlayers)) {
    return { headToHead: { ...base, missing: "Your opponent's college team could not be read." }, editor }
  }

  const oppRows = rows.filter((r) => String((r as { teamName?: unknown }).teamName ?? '').trim().toLowerCase() === oppTeam.name.trim().toLowerCase())
  const oppPlayers = oppRows.length ? await connectedRosterPlayers('fantrax', args.collegeSport ?? 'NCAAF', oppRows).catch(() => []) : []
  const oppLists = buildFantraxLists(oppPlayers.map((p) => ({ id: p.id, slot: p.rosterSlot ?? null, status: p.rosterStatus ?? null })))
  const oppPoints = args.scoreCollegePlayers
    ? await args.scoreCollegePlayers(oppPlayers).catch(() => null)
    : await loadCollegePoints({
        season: args.season,
        nflWeek: args.nflWeek!,
        players: oppPlayers.map((p) => ({ id: p.id, cfbdId: p.cfbdId ?? null, rollingInsightsId: p.rollingInsightsId ?? null, position: p.position })),
        settings: args.collegeSettings,
      })
        .then((r) => r.points)
        .catch(() => null)
  const oppCollege = oppPoints ? sumStarterPoints(oppLists.starters, oppPoints) : null

  return {
    headToHead: { ...base, opponent: { name: args.opponentName, total: combinedTotal(args.opponentProTotal, oppCollege) } },
    editor,
  }
}
