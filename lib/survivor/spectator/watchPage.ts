import 'server-only'
import { prisma } from '@/lib/prisma'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/survivorSettings'
import { readSurvivorEpisode, type SurvivorEpisode } from '@/lib/survivor/survivorEpisode'
import { resolveTribeEmblem } from '@/lib/survivor/survivorTribeIdentity'
import { stripLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { resolveSurvivorCurrentWeek } from '@/lib/survivor/SurvivorTimelineResolver'
import { isSurvivorLeague } from '@/lib/survivor/SurvivorLeagueConfig'
import { tribeTotals } from '@/lib/survivor/survivorCouncilImmunity'
import { unreadEliminations, watchCouncil, watchJury, watchTribes, type WatchCouncil, type WatchTribe } from './watchModel'

/**
 * Everything the public watch page shows (spectator mode), or a reason it shows nothing.
 *
 *  - `null` → 404: unknown id, or not a Survivor league. Indistinguishable, so league existence
 *    does not leak.
 *  - `{ state: 'private' }` → the commissioner has not opened the watch page. Carries nothing.
 *  - `{ state: 'public', ... }` → display names, the tribe race, the live read, episodes and jury.
 *
 * Every query selects the public columns only; the council read never touches the votes relation.
 */
export type WatchPageData =
  | { state: 'private' }
  | {
    state: 'public'
    leagueName: string
    sport: string
    week: number
    phase: string
    merged: boolean
    remaining: number
    tribes: WatchTribe[]
    council: WatchCouncil | null
    episodes: SurvivorEpisode[]
    jury: string[]
  }

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export async function loadSurvivorWatchData(leagueId: string, opts: { now?: Date } = {}): Promise<WatchPageData | null> {
  const now = opts.now ?? new Date()
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true, sport: true, settings: true, survivorRevealMode: true },
  })
  if (!league || !(await isSurvivorLeague(leagueId))) return null
  if (!normalizeSurvivorFoundationSettings(rec(league.settings)).spectatorPageEnabled) return { state: 'private' }

  const week = await resolveSurvivorCurrentWeek(leagueId, null)
  const [game, tribeRows, players, councils, scores, recaps] = await Promise.all([
    prisma.survivorGameState.findUnique({ where: { leagueId }, select: { phase: true, mergeTriggeredAt: true } }),
    prisma.survivorTribe.findMany({
      where: { leagueId, isActive: true },
      orderBy: { slotIndex: 'asc' },
      select: { id: true, name: true, isMerged: true, colorHex: true, logoUrl: true, catalogId: true, primaryColor: true, secondaryColor: true },
    }),
    prisma.survivorPlayer.findMany({
      where: { leagueId },
      select: { userId: true, displayName: true, tribeId: true, playerState: true, eliminatedWeek: true, isJuryMember: true },
    }),
    prisma.survivorTribalCouncil.findMany({
      where: { leagueId },
      // Deliberately no votes relation and no voter columns.
      select: {
        week: true, councilNumber: true, status: true, closedAt: true, voteDeadlineAt: true, attendingTribeId: true,
        eliminatedUserId: true, eliminatedName: true, isTie: true, tiePhase: true,
        isRevealed: true, revealStartsAt: true, revealStep: true, revealSequence: true,
      },
    }),
    week > 0
      ? prisma.survivorWeeklyScore.findMany({ where: { leagueId, week, countedTowardTribeTotal: true }, select: { tribeId: true, finalScore: true, countedTowardTribeTotal: true } })
      : Promise.resolve([]),
    prisma.survivorAuditEntry.findMany({
      where: { leagueId, action: 'weekly_recap_posted', isVisibleToPublic: true },
      orderBy: { week: 'desc' },
      select: { data: true },
      take: 30,
    }),
  ])

  const sport = String(league.sport ?? 'NFL')
  const tribes = tribeRows.map(t => {
    const name = stripLeadingTribeIcon(t.name) || t.name
    return { id: t.id, name, isMerged: t.isMerged, color: t.colorHex, crestUrl: resolveTribeEmblem({ name, logoUrl: t.logoUrl, catalogId: t.catalogId, primaryColor: t.primaryColor, secondaryColor: t.secondaryColor }, sport).crestUrl }
  })
  const pendingOut = unreadEliminations(councils, league.survivorRevealMode, now)
  const watchTribeList = watchTribes({ tribes, players, tribeTotals: Object.fromEntries(tribeTotals(scores)), pendingOut })
  const remaining = watchTribeList.filter(t => t.name !== 'Out of the game').reduce((n, t) => n + t.castaways.filter(c => !c.out).length, 0)

  return {
    state: 'public',
    leagueName: league.name ?? 'Survivor League',
    sport,
    week,
    phase: game?.phase ?? 'pre_draft',
    merged: Boolean(game?.mergeTriggeredAt) || tribes.some(t => t.isMerged),
    remaining,
    tribes: watchTribeList,
    council: watchCouncil(councils, Object.fromEntries(tribes.map(t => [t.id, t.name])), league.survivorRevealMode, now),
    episodes: recaps.flatMap(row => {
      const episode = readSurvivorEpisode(rec(row.data).episode)
      return episode ? [episode] : []
    }),
    jury: watchJury(players, pendingOut),
  }
}
