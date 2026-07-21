import 'server-only'

/**
 * Matchups section data.
 *
 * Reads `RedraftMatchup` for a single week and joins the two `RedraftRoster`
 * rows. Scores, projections, and win probability are stored columns — none of
 * them are modelled here. Where a column is null (projections and win
 * probability both are, until the projection engine has run for the week), the
 * field stays null and the UI omits that element rather than substituting a
 * computed guess.
 *
 * The hero matchup always defaults to the viewer's own, per the locked rule
 * that the personal layer comes first for every role — a commissioner opening
 * Matchups sees THEIR game first, not a league overview.
 */
import { prisma } from '@/lib/prisma'

export type MatchupStatus = 'scheduled' | 'active' | 'final'

export interface MatchupSide {
  rosterId: string
  teamName: string
  ownerName: string
  avatarUrl: string | null
  score: number
  /** Null until the projection engine has run for this week. */
  projected: number | null
  /** 0-100. Null when not computed. */
  winPct: number | null
  record: { wins: number; losses: number; ties: number }
}

export interface MatchupEntry {
  id: string
  week: number
  status: MatchupStatus
  /** `regular`, or a playoff round type. */
  type: string
  isMedianMatchup: boolean
  medianScore: number | null
  home: MatchupSide
  /** Null on a bye week. */
  away: MatchupSide | null
  isViewerMatchup: boolean
  /** Absolute score margin. Null when either side has no score yet. */
  margin: number | null
}

export interface MatchupsSectionData {
  available: boolean
  week: number | null
  /** Weeks that actually have scheduled matchups, for the week switcher. */
  availableWeeks: number[]
  matchups: MatchupEntry[]
  viewerMatchup: MatchupEntry | null
  warnings: string[]
}

const EMPTY: MatchupsSectionData = {
  available: false,
  week: null,
  availableWeeks: [],
  matchups: [],
  viewerMatchup: null,
  warnings: [],
}

function normalizeStatus(raw: string | null | undefined): MatchupStatus {
  const value = (raw ?? '').trim().toLowerCase()
  if (value === 'final') return 'final'
  if (value === 'active' || value === 'live' || value === 'in_progress') return 'active'
  return 'scheduled'
}

export async function loadMatchupsSection(args: {
  leagueId: string
  userId: string
  /** Defaults to the season's current week. */
  week?: number | null
}): Promise<MatchupsSectionData> {
  const warnings: string[] = []

  const season = await prisma.redraftSeason
    .findFirst({
      where: { leagueId: args.leagueId },
      orderBy: { season: 'desc' },
      select: { id: true, currentWeek: true, totalWeeks: true },
    })
    .catch((error) => {
      console.error('[command-center/matchups] season lookup failed', { leagueId: args.leagueId, error })
      return null
    })

  if (!season) {
    return { ...EMPTY, warnings: ['No active season — matchups are unavailable for this league.'] }
  }

  const scheduledWeeks = await prisma.redraftMatchup
    .findMany({
      where: { seasonId: season.id },
      select: { week: true },
      distinct: ['week'],
      orderBy: { week: 'asc' },
    })
    .catch(() => [])

  const availableWeeks = scheduledWeeks.map((row) => row.week)
  if (availableWeeks.length === 0) {
    return { ...EMPTY, warnings: ['No schedule has been generated for this season yet.'] }
  }

  // Prefer the requested week, then the season's current week, then the last
  // week that actually has matchups.
  const requested = args.week ?? null
  const week =
    requested !== null && availableWeeks.includes(requested)
      ? requested
      : availableWeeks.includes(season.currentWeek)
        ? season.currentWeek
        : availableWeeks[availableWeeks.length - 1]

  if (requested !== null && requested !== week) {
    warnings.push(`Week ${requested} has no matchups — showing week ${week} instead.`)
  }

  const rows = await prisma.redraftMatchup
    .findMany({
      where: { seasonId: season.id, week },
      select: {
        id: true,
        week: true,
        type: true,
        status: true,
        isMedianMatchup: true,
        medianScore: true,
        homeScore: true,
        awayScore: true,
        homeProjected: true,
        awayProjected: true,
        homeWinPct: true,
        awayWinPct: true,
        homeRoster: {
          select: {
            id: true,
            teamName: true,
            ownerName: true,
            avatarUrl: true,
            wins: true,
            losses: true,
            ties: true,
          },
        },
        awayRoster: {
          select: {
            id: true,
            teamName: true,
            ownerName: true,
            avatarUrl: true,
            wins: true,
            losses: true,
            ties: true,
          },
        },
      },
    })
    .catch((error) => {
      console.error('[command-center/matchups] matchup load failed', { seasonId: season.id, week, error })
      return []
    })

  let viewerRosterId: string | null = null
  try {
    const { resolveRedraftRosterLookupReadOnly } = await import('@/lib/redraft/redraftRosterIdentity')
    const lookup = await resolveRedraftRosterLookupReadOnly({
      userId: args.userId,
      seasonId: season.id,
      leagueId: args.leagueId,
    })
    viewerRosterId = lookup.roster?.id ?? null
  } catch (error) {
    console.error('[command-center/matchups] roster identity resolve failed', error)
    warnings.push('Could not identify your team, so your matchup is not highlighted.')
  }

  const toSide = (
    roster: {
      id: string
      teamName: string | null
      ownerName: string
      avatarUrl: string | null
      wins: number
      losses: number
      ties: number
    },
    score: number,
    projected: number | null,
    winPct: number | null,
  ): MatchupSide => ({
    rosterId: roster.id,
    teamName: roster.teamName?.trim() || roster.ownerName?.trim() || 'Unnamed team',
    ownerName: roster.ownerName?.trim() || 'Unknown manager',
    avatarUrl: roster.avatarUrl?.trim() || null,
    score,
    projected: typeof projected === 'number' ? projected : null,
    winPct: typeof winPct === 'number' ? Math.round(winPct <= 1 ? winPct * 100 : winPct) : null,
    record: { wins: roster.wins, losses: roster.losses, ties: roster.ties },
  })

  const matchups: MatchupEntry[] = rows.map((row) => {
    const home = toSide(row.homeRoster, row.homeScore, row.homeProjected, row.homeWinPct)
    const away = row.awayRoster
      ? toSide(row.awayRoster, row.awayScore, row.awayProjected, row.awayWinPct)
      : null

    const isViewerMatchup =
      viewerRosterId !== null &&
      (row.homeRoster.id === viewerRosterId || row.awayRoster?.id === viewerRosterId)

    return {
      id: row.id,
      week: row.week,
      status: normalizeStatus(row.status),
      type: row.type,
      isMedianMatchup: row.isMedianMatchup,
      medianScore: typeof row.medianScore === 'number' ? row.medianScore : null,
      home,
      away,
      isViewerMatchup,
      margin: away ? Math.abs(home.score - away.score) : null,
    }
  })

  return {
    available: matchups.length > 0,
    week,
    availableWeeks,
    matchups,
    viewerMatchup: matchups.find((m) => m.isViewerMatchup) ?? null,
    warnings,
  }
}
