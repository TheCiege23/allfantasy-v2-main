import 'server-only'
import { prisma } from '@/lib/prisma'
import { readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { stripLeadingTribeIcon } from '@/lib/survivor/survivorVisuals'
import { toShareMomentRecord } from '@/lib/survivor/shareCards/momentStore'
import {
  buildLeagueRecords,
  buildSeasonTimeline,
  buildTrophyCase,
  type ChampionshipRow,
  type LeagueRecord,
  type SeasonStoryMoment,
  type SeasonTimelineNode,
  type TrophyRecord,
} from './seasonStory'

/**
 * Loads the public facts behind the season story (survivor-core §3) and hands them to the pure
 * builders in ./seasonStory. Every query here is an allowlist: share moments (written only after a
 * reveal, see momentCapture), revealed swaps, jury seats, the merged tribe and championship rows.
 * Votes, ballots, idol holdings and audit rows are never read.
 */

export interface SeasonStoryView {
  leagueName: string
  sport: string
  season: number
  seasons: number[]
  nodes: SeasonTimelineNode[]
  trophies: TrophyRecord[]
  records: LeagueRecord[]
}

function isMissingTable(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code
  return code === 'P2021' || code === 'P2022'
}

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn()
  } catch (error) {
    if (isMissingTable(error)) return fallback
    throw error
  }
}

export function momentRowToStory(row: Parameters<typeof toShareMomentRecord>[0]): SeasonStoryMoment | null {
  const record = toShareMomentRecord(row)
  // A week recap is the league's own summary of a council the story already shows, not a moment.
  if (!record || record.type === 'recap') return null
  const p = record.payload
  return {
    id: record.id,
    type: record.type,
    week: record.week,
    final: record.final,
    published: record.publishedAt != null,
    displayName: p.displayName,
    season: typeof p.season === 'number' ? p.season : null,
    tribeName: p.tribeName ?? null,
    tally: p.tally ?? null,
    weeks: p.weeks ?? null,
    exileWeeks: p.exileWeeks ?? null,
    immunityWins: p.immunityWins ?? null,
    idolName: p.idolName ?? null,
  }
}

export async function loadSeasonStory(leagueId: string, requestedSeason: number | null, now: Date = new Date()): Promise<SeasonStoryView | null> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true, sport: true, season: true, settings: true, survivorMergeWeek: true } })
  if (!league) return null
  const currentSeason = Number(league.season)
  const [momentRows, championships, swaps, jurors, mergedTribe, draft] = await Promise.all([
    safe(() => prisma.survivorShareMoment.findMany({ where: { leagueId, final: true }, orderBy: [{ week: 'asc' }, { createdAt: 'asc' }], take: 500 }), []),
    safe(() => prisma.leagueChampionship.findMany({ where: { leagueId }, select: { season: true, teamName: true, playoffRecord: true } }), [] as ChampionshipRow[]),
    safe(() => prisma.survivorTribeSwap.findMany({ where: { leagueId, revealedAt: { not: null, lte: now } }, select: { week: true, revealedAt: true } }), []),
    safe(() => prisma.survivorJuryMember.findMany({ where: { leagueId }, select: { rosterId: true, votedOutWeek: true } }), []),
    safe(() => prisma.survivorTribe.findFirst({ where: { leagueId, isMerged: true }, select: { name: true, _count: { select: { members: true } } } }), null),
    safe(() => prisma.draftSession.findFirst({ where: { leagueId, status: 'completed', NOT: { sessionKind: 'mock' } }, select: { id: true } }), null),
  ])
  const moments = momentRows.map(momentRowToStory).filter((m): m is SeasonStoryMoment => m != null)

  const jurorRosterIds = jurors.map(j => j.rosterId)
  const players = jurorRosterIds.length
    ? await safe(() => prisma.survivorPlayer.findMany({ where: { leagueId, redraftRosterId: { in: jurorRosterIds } }, select: { redraftRosterId: true, displayName: true } }), [])
    : []
  const nameByRoster = new Map(players.map(p => [p.redraftRosterId, p.displayName]))

  const seasons = [...new Set([currentSeason, ...championships.map(c => c.season), ...moments.map(m => m.season).filter((s): s is number => s != null)])]
    .filter(Number.isInteger)
    .sort((a, b) => b - a)
  const season = requestedSeason != null && seasons.includes(requestedSeason) ? requestedSeason : currentSeason

  const plan = readSurvivorFullSeasonPlan(league.settings)
  const nodes = buildSeasonTimeline({
    season,
    currentSeason,
    firstWeek: plan?.startWeek ?? 1,
    lastWeek: plan?.endWeek ?? 13,
    draftComplete: Boolean(draft),
    moments,
    swaps,
    jurors: jurors.map(j => ({ votedOutWeek: j.votedOutWeek, displayName: nameByRoster.get(j.rosterId) ?? 'A manager' })),
    mergeWeek: mergedTribe ? league.survivorMergeWeek ?? null : null,
    mergedTribeName: mergedTribe ? stripLeadingTribeIcon(mergedTribe.name) || mergedTribe.name : null,
    mergedCount: mergedTribe?._count.members ?? null,
    now,
  })

  return {
    leagueName: league.name ?? 'Survivor league',
    sport: String(league.sport),
    season,
    seasons,
    nodes,
    trophies: buildTrophyCase(championships, moments, String(league.sport)),
    records: buildLeagueRecords(moments, championships),
  }
}
