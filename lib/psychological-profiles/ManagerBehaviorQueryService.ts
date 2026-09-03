/**
 * ManagerBehaviorQueryService — query psychological profiles by league, manager, sport.
 */

import { prisma } from '@/lib/prisma'
import type { ProfileLabel } from './types'
import { getPsychSportLabel, normalizeSportForPsych } from './SportBehaviorResolver'
import { EVIDENCE_FLOORS, type DimensionConfidence, type PsychDimension } from './ProfileEvidenceFloor'

/**
 * Which evidence stream each score actually rests on.
 *
 * Every score column is `Float @default(0)`, so an unprofiled or unobservable
 * manager is stored as 0 and is indistinguishable, at read time, from someone
 * measured to be genuinely unaggressive. Rendering that gives a UI a confident
 * "0% risk tolerance" for a manager we have never watched — the same fabrication
 * as a trade grading C on no data.
 *
 * The raw columns stay as they are: internal consumers (drama detection,
 * relationship scoring) do arithmetic on them and a null would change behaviour
 * across modules. `displayScores` is the honest projection, and anything shown
 * to a person should read from it.
 */
const SCORE_DIMENSION: Record<string, PsychDimension[]> = {
  // 45% trade frequency, so trade is the load-bearing input.
  aggressionScore: ['trade'],
  tradeFrequencyScore: ['trade'],
  // Risk blends acquisition mix and trade timing; both are trade-side.
  riskToleranceScore: ['trade'],
  waiverFocusScore: ['roster'],
  // An equal-weight average of trade frequency, waiver focus and lineup churn.
  // Satisfied by either contributing stream — but NOT by draft, which feeds none
  // of the three. Gating this on "any dimension observed" let a well-documented
  // draft history license an activity score of 0, reporting a completely
  // inactive manager on the strength of data that says nothing about activity.
  activityScore: ['trade', 'roster'],
}

export type DisplayScores = {
  aggressionScore: number | null
  activityScore: number | null
  tradeFrequencyScore: number | null
  waiverFocusScore: number | null
  riskToleranceScore: number | null
}

export type ProfileEvidenceSummaryView = {
  dimensions: Record<PsychDimension, { evidenceCount: number; sufficient: boolean; confidence: DimensionConfidence | null }>
  observedDimensions: PsychDimension[]
  missingDimensions: PsychDimension[]
  anySufficient: boolean
}

const EVIDENCE_COUNT_TYPES = [
  'trade_evidence_count',
  'draft_evidence_count',
  'roster_evidence_count',
]

const EVIDENCE_TYPE_FOR_DIMENSION: Record<PsychDimension, string> = {
  trade: 'trade_evidence_count',
  draft: 'draft_evidence_count',
  roster: 'roster_evidence_count',
}

/**
 * Rebuild the evidence summary from the counts persisted alongside the profile.
 *
 * A profile written before these records existed has no counts. That is reported
 * as unmeasured rather than assumed sufficient — the failure mode of guessing
 * here is exactly the one this whole gate exists to prevent.
 */
export function summarizeEvidenceRecords(
  records: Array<{ evidenceType: string; value: number }>
): ProfileEvidenceSummaryView {
  const dims = {} as ProfileEvidenceSummaryView['dimensions']
  for (const dimension of ['trade', 'draft', 'roster'] as PsychDimension[]) {
    const rec = records.find((r) => r.evidenceType === EVIDENCE_TYPE_FOR_DIMENSION[dimension])
    const floor = EVIDENCE_FLOORS[dimension]
    const evidenceCount = rec ? Math.max(0, Math.round(rec.value)) : 0
    const sufficient = rec != null && evidenceCount >= floor.min
    dims[dimension] = {
      evidenceCount,
      sufficient,
      confidence: !sufficient
        ? null
        : evidenceCount >= floor.confident
          ? 'high'
          : evidenceCount >= floor.min * 2
            ? 'moderate'
            : 'low',
    }
  }
  const observed = (Object.keys(dims) as PsychDimension[]).filter((d) => dims[d].sufficient)
  return {
    dimensions: dims,
    observedDimensions: observed,
    missingDimensions: (Object.keys(dims) as PsychDimension[]).filter((d) => !dims[d].sufficient),
    anySufficient: observed.length > 0,
  }
}

/** Null out every score whose backing dimension was never observed. */
export function gateScores(
  raw: {
    aggressionScore: number
    activityScore: number
    tradeFrequencyScore: number
    waiverFocusScore: number
    riskToleranceScore: number
  },
  evidence: ProfileEvidenceSummaryView
): DisplayScores {
  const keep = (key: keyof DisplayScores): number | null => {
    const contributors = SCORE_DIMENSION[key]
    if (!contributors || contributors.length === 0) return null
    const observed = contributors.some((d) => evidence.dimensions[d]?.sufficient)
    return observed ? raw[key] : null
  }
  return {
    aggressionScore: keep('aggressionScore'),
    activityScore: keep('activityScore'),
    tradeFrequencyScore: keep('tradeFrequencyScore'),
    waiverFocusScore: keep('waiverFocusScore'),
    riskToleranceScore: keep('riskToleranceScore'),
  }
}

export interface ManagerPsychProfileView {
  id: string
  leagueId: string
  managerId: string
  sport: string
  sportLabel: string
  profileLabels: ProfileLabel[]
  aggressionScore: number
  activityScore: number
  tradeFrequencyScore: number
  waiverFocusScore: number
  riskToleranceScore: number
  updatedAt: Date
  evidenceCount?: number
  /** Evidence-gated scores. Null means unmeasured — render it as such, never 0. */
  displayScores?: DisplayScores
  evidenceSummary?: ProfileEvidenceSummaryView
  /**
   * Set ONLY when this profile was read from a sibling mirror of the same external league
   * rather than from the league id asked for. Absent is the normal case.
   *
   * Never silently substituted: a caller that cares which row answered can see it, in the same
   * spirit as the grounding packet's `servedFrom`. See `resolveProfiledSiblingLeagueId`.
   */
  servedFromSiblingLeagueId?: string
}

/**
 * Find another League row for the SAME external league that already has profiles.
 *
 * 🛑 WHY THIS EXISTS. A League row is per importing USER — `enumerate.ts` says so directly:
 * "Multiple `League` rows (one per importing user) can mirror the same external league+season."
 * Profiling is keyed on the League ROW, so the second and third person to import a league get
 * nothing until the profiler's own rotation reaches their row, even though byte-identical
 * profiles already exist for the same 12 managers.
 *
 * Measured 2026-09-03: 23 users were in exactly that state, across 19 of the 23 mirrored
 * leagues in production. The three rows for one league each carried the SAME 960 draft facts
 * and the same 12 rosters — the evidence is not merely similar, it is the same evidence.
 *
 * ⚠ THIS IS NOT A DEDUPE, AND IT MUST NOT BECOME ONE. The mirror rows are correct and
 * intended; nothing here merges or deletes anything. It only answers "has this same external
 * league already been profiled elsewhere" on the READ path.
 *
 * ⚠ NO NEW DATA IS EXPOSED. A profile is keyed on the PLATFORM manager id (the Sleeper/ESPN
 * user), which is identical across mirrors, and describes the league's managers — not the
 * importing user. Two rows for one external league describe the same twelve people. Matching
 * requires the same platform, the same external league id AND the same season, so nothing
 * from a different league or year can answer.
 */
async function resolveProfiledSiblingLeagueId(leagueId: string): Promise<string | null> {
  const self = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { platform: true, platformLeagueId: true, season: true },
  })
  // An empty external id is the "not connected to a platform" case — it has no siblings.
  if (!self?.platformLeagueId) return null

  const siblings = await prisma.league.findMany({
    where: {
      platform: self.platform,
      platformLeagueId: self.platformLeagueId,
      season: self.season,
      id: { not: leagueId },
    },
    select: { id: true },
  })
  if (siblings.length === 0) return null

  /*
   * Pick the sibling whose profiles are FRESHEST, not merely the first found — with three
   * mirrors it is entirely possible for two to be profiled at different times, and serving the
   * older one would be a silent downgrade.
   */
  const newest = await prisma.managerPsychProfile.findFirst({
    where: { leagueId: { in: siblings.map((r) => r.id) } },
    orderBy: { updatedAt: 'desc' },
    select: { leagueId: true },
  })
  return newest?.leagueId ?? null
}

export async function getProfileByLeagueAndManager(
  leagueId: string,
  managerId: string
): Promise<ManagerPsychProfileView | null> {
  const p = await prisma.managerPsychProfile.findUnique({
    where: { leagueId_managerId: { leagueId, managerId } },
    include: {
      _count: { select: { evidence: true } },
      evidence: {
        where: { evidenceType: { in: EVIDENCE_COUNT_TYPES } },
        select: { evidenceType: true, value: true },
      },
    },
  })
  if (p) return toView(p)

  // Nothing for this row — see if a sibling mirror of the same external league has it.
  const siblingId = await resolveProfiledSiblingLeagueId(leagueId)
  if (!siblingId) return null
  const fromSibling = await prisma.managerPsychProfile.findUnique({
    where: { leagueId_managerId: { leagueId: siblingId, managerId } },
    include: {
      _count: { select: { evidence: true } },
      evidence: {
        where: { evidenceType: { in: EVIDENCE_COUNT_TYPES } },
        select: { evidenceType: true, value: true },
      },
    },
  })
  if (!fromSibling) return null
  return { ...toView(fromSibling), servedFromSiblingLeagueId: siblingId }
}

export async function listProfilesByLeague(
  leagueId: string,
  options?: {
    sport?: string
    season?: number
    limit?: number
    managerAId?: string
    managerBId?: string
  }
): Promise<ManagerPsychProfileView[]> {
  const sportNorm = normalizeSportForPsych(options?.sport)
  const seasonStart = options?.season != null ? new Date(Date.UTC(options.season, 0, 1)) : null
  const seasonEnd = options?.season != null ? new Date(Date.UTC(options.season + 1, 0, 1)) : null
  const where = {
    leagueId,
    ...(sportNorm ? { sport: sportNorm } : {}),
    ...(seasonStart && seasonEnd
      ? { evidence: { some: { createdAt: { gte: seasonStart, lt: seasonEnd } } } }
      : {}),
    ...(options?.managerAId && options?.managerBId
      ? { managerId: { in: [options.managerAId, options.managerBId] } }
      : {}),
  }
  const list = await prisma.managerPsychProfile.findMany({
    where,
    include: {
      _count: { select: { evidence: true } },
      evidence: {
        where: { evidenceType: { in: EVIDENCE_COUNT_TYPES } },
        select: { evidenceType: true, value: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: options?.limit ?? 50,
  })
  if (list.length > 0) return list.map(toView)

  /*
   * ⚠ ONLY ON A COMPLETELY EMPTY RESULT. A partial result is this league's own answer and must
   * stand: mixing a sibling's rows into it would silently blend two profiling runs, and the
   * caller could not tell which manager came from where.
   */
  const siblingId = await resolveProfiledSiblingLeagueId(leagueId)
  if (!siblingId) return []
  const fromSibling = await prisma.managerPsychProfile.findMany({
    where: { ...where, leagueId: siblingId },
    include: {
      _count: { select: { evidence: true } },
      evidence: {
        where: { evidenceType: { in: EVIDENCE_COUNT_TYPES } },
        select: { evidenceType: true, value: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: options?.limit ?? 50,
  })
  return fromSibling.map((row) => ({ ...toView(row), servedFromSiblingLeagueId: siblingId }))
}

export async function getProfileById(profileId: string): Promise<ManagerPsychProfileView | null> {
  const p = await prisma.managerPsychProfile.findUnique({
    where: { id: profileId },
    include: {
      _count: { select: { evidence: true } },
      evidence: {
        where: { evidenceType: { in: EVIDENCE_COUNT_TYPES } },
        select: { evidenceType: true, value: true },
      },
    },
  })
  if (!p) return null
  return toView(p)
}

export async function compareManagerProfiles(
  leagueId: string,
  managerAId: string,
  managerBId: string,
  sport?: string
): Promise<{
  managerA: ManagerPsychProfileView | null
  managerB: ManagerPsychProfileView | null
}> {
  const rows = await listProfilesByLeague(leagueId, {
    sport,
    managerAId,
    managerBId,
    limit: 2,
  })
  return {
    managerA: rows.find((r) => r.managerId === managerAId) ?? null,
    managerB: rows.find((r) => r.managerId === managerBId) ?? null,
  }
}

export async function listProfileEvidence(
  profileId: string,
  options?: { limit?: number; season?: number }
): Promise<
  Array<{
    id: string
    evidenceType: string
    value: number
    sourceReference: string | null
    createdAt: Date
  }>
> {
  const seasonStart = options?.season != null ? new Date(Date.UTC(options.season, 0, 1)) : null
  const seasonEnd = options?.season != null ? new Date(Date.UTC(options.season + 1, 0, 1)) : null
  return prisma.profileEvidenceRecord.findMany({
    where: {
      profileId,
      ...(seasonStart && seasonEnd
        ? { createdAt: { gte: seasonStart, lt: seasonEnd } }
        : {}),
    },
    orderBy: { createdAt: 'desc' },
    take: options?.limit ?? 100,
    select: {
      id: true,
      evidenceType: true,
      value: true,
      sourceReference: true,
      createdAt: true,
    },
  })
}

function toView(p: {
  id: string
  leagueId: string
  managerId: string
  sport: string
  profileLabels: unknown
  aggressionScore: number
  activityScore: number
  tradeFrequencyScore: number
  waiverFocusScore: number
  riskToleranceScore: number
  updatedAt: Date
  _count?: { evidence: number }
  evidence?: Array<{ evidenceType: string; value: number }>
}): ManagerPsychProfileView {
  const labels = Array.isArray(p.profileLabels) ? (p.profileLabels as ProfileLabel[]) : []
  return {
    id: p.id,
    leagueId: p.leagueId,
    managerId: p.managerId,
    sport: p.sport,
    sportLabel: getPsychSportLabel(p.sport),
    profileLabels: labels.filter((l): l is ProfileLabel => typeof l === 'string'),
    aggressionScore: p.aggressionScore,
    activityScore: p.activityScore,
    tradeFrequencyScore: p.tradeFrequencyScore,
    waiverFocusScore: p.waiverFocusScore,
    riskToleranceScore: p.riskToleranceScore,
    updatedAt: p.updatedAt,
    evidenceCount: p._count?.evidence,
    ...(p.evidence
      ? (() => {
          const evidenceSummary = summarizeEvidenceRecords(p.evidence)
          return { evidenceSummary, displayScores: gateScores(p, evidenceSummary) }
        })()
      : {}),
  }
}
