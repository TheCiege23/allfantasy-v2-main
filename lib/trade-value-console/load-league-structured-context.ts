import 'server-only'

import { prisma } from '@/lib/prisma'

type LeagueStructuredContextNotes = {
  /** Playoff / season outcome from `LeagueSeason` when synced */
  playoffNote: string | null
  /** Top ranks from `SeasonStandingFact` when present */
  standingsNote: string | null
  /** `MatchupFact` row count for the season */
  matchupNote: string | null
  /** `DraftFact` row count for the season */
  draftNote: string | null
  /** Waiver + trade activity from warehouse + app tables when present */
  waiverTradeNote: string | null
}

/**
 * Loads short, factual strings from AllFantasy DB / warehouse only (no fabrication).
 * Any missing sync yields null for that slice.
 */
export async function loadLeagueStructuredContextNotes(leagueId: string): Promise<LeagueStructuredContextNotes | null> {
  if (!leagueId?.trim()) return null

  try {
    const league = await prisma.league.findFirst({
      where: { id: leagueId.trim() },
      select: { season: true },
    })
    if (!league) return null

    const seasonYear = league.season ?? new Date().getFullYear()

    const [
      latestLeagueSeason,
      standings,
      matchupCount,
      draftCount,
      waiverFactCount,
      tradeFactCount,
      appWaiverTxCount,
    ] = await Promise.all([
      prisma.leagueSeason.findFirst({
        where: { leagueId: leagueId.trim() },
        orderBy: { season: 'desc' },
        select: {
          season: true,
          championName: true,
          runnerUpName: true,
          regularSeasonWinnerName: true,
          status: true,
        },
      }),
      prisma.seasonStandingFact.findMany({
        where: { leagueId: leagueId.trim(), season: seasonYear },
        orderBy: [{ rank: 'asc' }],
        take: 8,
        select: {
          teamId: true,
          wins: true,
          losses: true,
          ties: true,
          rank: true,
        },
      }),
      prisma.matchupFact.count({
        where: { leagueId: leagueId.trim(), season: seasonYear },
      }),
      prisma.draftFact.count({
        where: { leagueId: leagueId.trim(), season: seasonYear },
      }),
      prisma.transactionFact.count({
        where: { leagueId: leagueId.trim(), season: seasonYear, type: 'waiver_add' },
      }),
      prisma.transactionFact.count({
        where: { leagueId: leagueId.trim(), season: seasonYear, type: 'trade' },
      }),
      prisma.waiverTransaction.count({ where: { leagueId: leagueId.trim() } }),
    ])

    let playoffNote: string | null = null
    if (latestLeagueSeason && (latestLeagueSeason.championName || latestLeagueSeason.runnerUpName)) {
      const bits: string[] = []
      bits.push(`Season ${latestLeagueSeason.season}`)
      if (latestLeagueSeason.status) bits.push(`status ${latestLeagueSeason.status}`)
      if (latestLeagueSeason.championName) bits.push(`champion ${latestLeagueSeason.championName}`)
      if (latestLeagueSeason.runnerUpName) bits.push(`runner-up ${latestLeagueSeason.runnerUpName}`)
      if (latestLeagueSeason.regularSeasonWinnerName) bits.push(`RS leader ${latestLeagueSeason.regularSeasonWinnerName}`)
      playoffNote = `${bits.join(' · ')}.`
    }

    let standingsNote: string | null = null
    const ranked = standings.filter((s) => s.rank != null && s.rank > 0)
    if (ranked.length > 0) {
      const top = ranked.slice(0, 4).map((s) => {
        const t = s.ties ? `-${s.ties}` : ''
        return `#${s.rank} (${s.wins}-${s.losses}${t})`
      })
      standingsNote = `Standings warehouse ${seasonYear}: ${top.join(' · ')} (${ranked.length} teams).`
    }

    const matchupNote =
      matchupCount > 0 ? `${matchupCount} matchup fact rows for ${seasonYear}.` : null

    const draftNote = draftCount > 0 ? `${draftCount} draft pick rows for ${seasonYear}.` : null

    let waiverTradeNote: string | null = null
    const wtParts: string[] = []
    if (waiverFactCount > 0) wtParts.push(`${waiverFactCount} waiver_add facts`)
    if (tradeFactCount > 0) wtParts.push(`${tradeFactCount} trade facts`)
    if (appWaiverTxCount > 0) wtParts.push(`${appWaiverTxCount} app waiver transactions`)
    if (wtParts.length > 0) waiverTradeNote = `Activity: ${wtParts.join(' · ')}.`

    return {
      playoffNote,
      standingsNote,
      matchupNote,
      draftNote,
      waiverTradeNote,
    }
  } catch (e) {
    console.warn('[trade-value-console] loadLeagueStructuredContextNotes', e)
    return null
  }
}

export function formatStructuredContextForReasoning(notes: LeagueStructuredContextNotes | null): string {
  if (!notes) return ''
  const parts = [
    notes.playoffNote,
    notes.standingsNote,
    notes.matchupNote,
    notes.draftNote,
    notes.waiverTradeNote,
  ].filter((s): s is string => Boolean(s?.trim()))
  if (!parts.length) return ''
  return ` Synced history: ${parts.join(' ')}`
}

export function highlightsFromStructuredNotes(notes: LeagueStructuredContextNotes | null): string[] | undefined {
  if (!notes) return undefined
  const h = [notes.playoffNote, notes.standingsNote, notes.matchupNote, notes.draftNote, notes.waiverTradeNote].filter(
    (s): s is string => Boolean(s?.trim()),
  )
  return h.length ? h : undefined
}
