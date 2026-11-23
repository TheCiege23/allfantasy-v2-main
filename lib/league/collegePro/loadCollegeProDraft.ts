import 'server-only'
import { prisma } from '@/lib/prisma'
import { canCommissionerAct } from '@/lib/league/commissionerAccess'
import { liveLeagueDrafts } from '@/lib/sleeper/liveLeagueFeed'
import { athleteIdsByFantraxId, collegeSnapshotRoster, latestDraftPicksOnFile, type CollegeDraftSport } from './draftPicksOnFile'
import { buildDraftPipelineReport, type DraftPipelineReport, type FranchiseMoveUp, type RookiePoolPlayer } from './draftPipeline'
import { buildDraftChecklist, readChecklistTicks, type ChecklistStep } from './draftChecklist'
import { sleeperDraftCards } from './drafts'
import { normalizeCollegeSport } from './format'
import { loadPairContext, readLeaguePair, resolveCollegeProPair, type PairContext } from './leaguePair'
import { halfLabel } from './pairLink'

/**
 * The Draft tab's pipeline for a paired college + pro league: your drafted college players moving
 * up, the rookie pool, and — for the commissioner — the offseason checklist. Stored rows only, except
 * the pro half's Sleeper draft list (through the shared, cached live feed) for the commissioner's
 * "rookie draft scheduled" step.
 */

export type CollegeProDraftPayload =
  | { applies: false }
  | {
      applies: true
      /** Null until a draft's results are on file. */
      year: number | null
      proLabel: string
      pro: { leagueId: string; name: string; platform: string }
      college: { leagueId: string; name: string }
      /** The viewer's own franchise's players moving up, when any. */
      mine: FranchiseMoveUp | null
      movingUp: FranchiseMoveUp[]
      rookiePool: RookiePoolPlayer[]
      unlinked: number
      /** Only for a commissioner of the pro half. */
      checklist: ChecklistStep[] | null
      canEditChecklist: boolean
    }

const collegeDraftSport = (sport: string | null | undefined): CollegeDraftSport | null => {
  const s = normalizeCollegeSport(sport)
  return s === 'NCAAF' || s === 'NCAAB' ? s : null
}

/** The league-wide report for a pair, or null when no draft's results are on file. Shared with the notices. */
export async function draftReportForPair(ctx: PairContext, collegeSport: CollegeDraftSport, now: Date): Promise<DraftPipelineReport | null> {
  if (!ctx.college.platformLeagueId || String(ctx.college.platform ?? '').toLowerCase() !== 'fantrax') return null
  const stored = await latestDraftPicksOnFile(collegeSport, now)
  if (!stored) return null
  const roster = await collegeSnapshotRoster(ctx.college.platformLeagueId)
  const athleteIdOf = await athleteIdsByFantraxId(collegeSport, roster.map((r) => r.fantraxId))
  return buildDraftPipelineReport({
    year: stored.year,
    picks: stored.picks,
    collegeRoster: roster,
    athleteIdOf,
    collegeTeams: ctx.collegeTeams,
    proTeams: ctx.proTeams,
    map: ctx.map,
    unlinked: stored.unlinked,
  })
}

export async function loadCollegeProDraft(leagueId: string, userId: string, now = new Date()): Promise<CollegeProDraftPayload> {
  const row = await prisma.league.findUnique({ where: { id: leagueId }, select: { id: true, settings: true } })
  if (!row) return { applies: false }
  const recorded = readLeaguePair(row.settings)
  const memberOf = (ids: string[]) =>
    prisma.league.count({ where: { id: { in: ids }, OR: [{ userId }, { teams: { some: { claimedByUserId: userId } } }] } })
  if ((await memberOf(recorded ? [leagueId, recorded.otherLeagueId] : [leagueId])) === 0) return { applies: false }

  let ctx = await loadPairContext(leagueId, userId)
  if (!ctx) {
    await resolveCollegeProPair(leagueId, userId, { includeOperationalSummary: false }).catch(() => null)
    ctx = await loadPairContext(leagueId, userId)
  }
  if (!ctx) return { applies: false }

  const leagues = await prisma.league.findMany({ where: { id: { in: [ctx.pro.id, ctx.college.id] } }, select: { id: true, name: true, sport: true } })
  const meta = (id: string) => leagues.find((l) => l.id === id)
  const sport = collegeDraftSport(meta(ctx.college.id)?.sport) ?? (String(meta(ctx.pro.id)?.sport ?? '').toUpperCase() === 'NBA' ? 'NCAAB' : 'NCAAF')
  const proLabel = halfLabel(meta(ctx.pro.id)?.sport)
  const proName = meta(ctx.pro.id)?.name?.trim() || 'Pro league'
  const collegeName = meta(ctx.college.id)?.name?.trim() || 'College league'
  const proPlatform = String(ctx.pro.platform ?? '').toLowerCase()

  const [report, isCommissioner, canEdit] = await Promise.all([
    draftReportForPair(ctx, sport, now),
    canCommissionerAct(ctx.pro.id, userId, 'view').catch(() => false),
    canCommissionerAct(ctx.pro.id, userId, 'rosters').catch(() => false),
  ])

  let checklist: ChecklistStep[] | null = null
  if (isCommissioner) {
    const proDrafts =
      proPlatform === 'sleeper' && ctx.pro.platformLeagueId
        ? await liveLeagueDrafts(ctx.pro.platformLeagueId).then((d) => sleeperDraftCards(d ?? []), () => null)
        : null
    checklist = buildDraftChecklist({
      report,
      ticks: report ? readChecklistTicks(ctx.pro.settings, report.year) : {},
      proLabel,
      proLeagueName: proName,
      proPlatform,
      collegeLeagueName: collegeName,
      proDrafts,
    })
  }

  const mine = report?.movingUp.find((f) => (ctx!.collegeKey && f.collegeKey === ctx!.collegeKey) || (ctx!.proKey && f.proKey === ctx!.proKey)) ?? null
  return {
    applies: true,
    year: report?.year ?? null,
    proLabel,
    pro: { leagueId: ctx.pro.id, name: proName, platform: proPlatform },
    college: { leagueId: ctx.college.id, name: collegeName },
    mine,
    movingUp: report?.movingUp ?? [],
    rookiePool: report?.rookiePool ?? [],
    unlinked: report?.unlinked ?? 0,
    checklist,
    canEditChecklist: canEdit && report != null,
  }
}
