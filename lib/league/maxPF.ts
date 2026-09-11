import { prisma } from '@/lib/prisma'
import { CURRENT_FRANCHISES_INCLUDING_UNKNOWN } from '@/lib/league-import/teamLifecycle'

export type ReverseMaxPfRow = {
  slot: number
  ownerId: string
  ownerName: string
  maxPF: number
  isPlayoff: boolean
  playoffFinish: number | null
}

/**
 * Reverse Max PF order for draft: non-playoff teams by lowest "max PF" proxy first;
 * playoff teams by finish (champion last). Uses SeasonResult when available.
 */
export async function computeReverseMaxPfOrder(leagueId: string): Promise<{
  rows: ReverseMaxPfRow[]
  warning: string | null
}> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { id: true, season: true, leagueSize: true },
  })
  if (!league) {
    return { rows: [], warning: 'League not found' }
  }

  const prevSeason = String((league.season ?? new Date().getFullYear()) - 1)
  /* Max points-for is a CURRENT standings statistic; a departed team must not win it. */
  const teams = await prisma.leagueTeam.findMany({
    where: { ...CURRENT_FRANCHISES_INCLUDING_UNKNOWN, leagueId },
    orderBy: { externalId: 'asc' },
  })

  const results = await prisma.seasonResult.findMany({
    where: { leagueId, season: prevSeason },
  })

  if (results.length === 0) {
    return {
      rows: [],
      warning: `No season results for ${prevSeason}. Play a season or sync history first.`,
    }
  }

  const byRoster = new Map<string, { pf: number; champion: boolean }>()
  for (const r of results) {
    const pf = r.pointsFor != null ? Number(r.pointsFor) : 0
    byRoster.set(r.rosterId, { pf, champion: r.champion })
  }

  type Enriched = {
    teamId: string
    teamName: string
    ownerName: string
    maxPF: number
    isPlayoff: boolean
    champion: boolean
    wins: number
  }

  const enriched: Enriched[] = teams.map((t) => {
    const match = byRoster.get(t.externalId) ?? byRoster.get(t.id)
    const maxPF = match?.pf ?? t.pointsFor ?? 0
    const champion = match?.champion ?? false
    return {
      teamId: t.id,
      teamName: t.teamName,
      ownerName: t.ownerName,
      maxPF,
      champion,
      wins: t.wins,
      isPlayoff: false,
    }
  })

  const sortedByWins = [...enriched].sort((a, b) => b.wins - a.wins)
  const playoffCut = Math.max(1, Math.min(6, Math.ceil(enriched.length / 2)))
  const playoffIds = new Set(sortedByWins.slice(0, playoffCut).map((x) => x.teamId))
  for (const e of enriched) {
    if (e.champion) e.isPlayoff = true
    else if (playoffIds.has(e.teamId)) e.isPlayoff = true
  }

  const nonPlayoff = enriched.filter((e) => !e.isPlayoff)
  const playoffNonChamp = enriched.filter((e) => e.isPlayoff && !e.champion)
  const champion = enriched.find((e) => e.champion) ?? null

  nonPlayoff.sort((a, b) => a.maxPF - b.maxPF)
  playoffNonChamp.sort((a, b) => a.wins - b.wins || a.maxPF - b.maxPF)

  const ordered: Enriched[] = [...nonPlayoff, ...playoffNonChamp]
  if (champion) ordered.push(champion)

  const teamCount = league.leagueSize ?? enriched.length
  const rows: ReverseMaxPfRow[] = ordered.map((e, i) => ({
    slot: i + 1,
    ownerId: e.teamId,
    ownerName: e.teamName || e.ownerName,
    maxPF: e.maxPF,
    isPlayoff: e.isPlayoff,
    playoffFinish: e.champion ? teamCount : e.isPlayoff ? i + 1 : null,
  }))

  return { rows, warning: null }
}
