/**
 * Server-only read model for Tournament Shell UI (App Router RSC).
 * Not part of advancement/scoring engines — presentation data only.
 */
import 'server-only'

import { prisma } from '@/lib/prisma'
import { DEFAULT_TOURNAMENT_SETTINGS } from '@/lib/tournament-mode/constants'
import type { TournamentSettings } from '@/lib/tournament-mode/types'
import type { DraftPhaseKey, DraftScheduleV1, PhaseDraftPlan, PhaseScheduleFields } from '@/lib/tournament/draft-schedule-types'
import { getQualificationAdvancementTotal } from '@/lib/tournament-mode/tournament-sport-cutoffs'

export type SerializedConference = {
  id: string
  name: string
  slug: string
  theme: string | null
  colorHex: string | null
  conferenceNumber: number
}

export type SerializedRound = {
  id: string
  roundNumber: number
  roundType: string
  roundLabel: string
  weekStart: number
  weekEnd: number
  status: string
}

export type SerializedTournamentLeague = {
  id: string
  name: string
  slug: string
  roundId: string
  conferenceId: string | null
  leagueId: string | null
  status: string
  teamSlots: number
  currentTeamCount: number
  draftScheduledAt: string | null
  colorHex: string | null
  logoUrl: string | null
  advancersCount: number
}

type SerializedParticipant = {
  id: string
  userId: string
  displayName: string
  avatarUrl: string | null
  status: string
  currentRoundNumber: number
  furthestRoundReached: number
  currentConferenceId: string | null
  currentLeagueId: string | null
  careerWins: number
  careerLosses: number
  careerPointsFor: number
  careerPointsAgainst: number
  advancementHistory: unknown
}

type SerializedAnnouncement = {
  id: string
  type: string
  title: string
  content: string
  roundNumber: number | null
  createdAt: string
  isPosted: boolean
}

type SerializedShell = {
  id: string
  name: string
  sport: string
  status: string
  maxParticipants: number
  currentParticipantCount: number
  conferenceCount: number
  leaguesPerConference: number
  teamsPerLeague: number
  namingMode: string
  currentRoundNumber: number
  totalRounds: number
  advancersPerLeague: number
  wildcardCount: number
  bubbleEnabled: boolean
  bubbleSize: number
  bubbleScoringMode: string
  scoringSystem: string
  draftType: string
  waiverType: string
  openingRosterSize: number
  tournamentRosterSize: number
  eliteRosterSize: number
  faabResetOnRedraft: boolean
  draftClockSeconds: number
  simultaneousDrafts: boolean
  tiebreakerMode: string
  standingsVisibility: string
}

export type LegacyFeederLeagueRow = {
  tournamentLeagueId: string
  leagueId: string
  name: string
  inviteCode: string
  joinUrl: string
  conferenceName: string
}

export type SerializedMiniCommissionerAssignment = {
  leagueId: string
  leagueName: string
  userId: string
  displayName: string
  username: string | null
}

export type SerializedPendingLeagueSettingRequest = {
  id: string
  leagueId: string
  leagueName: string
  requesterDisplayName: string
  createdAt: string
  proposedPatchKeys: string[]
}

/** Hub waitlist (legacy tournaments): enabled in hubSettings; capacity from feeder leagues or participant pool. */
type LegacyWaitlistUiPayload = {
  waitlistEnabled: boolean
  maxWaitlist: number
  /** No open roster slots across feeder leagues, or at participant pool cap when there are no feeders. */
  registrationFull: boolean
  viewerOnWaitlist: boolean
}

function parseHubWaitlistFromJson(hubSettings: unknown): { waitlistEnabled: boolean; maxWaitlist: number } {
  const hub =
    typeof hubSettings === 'object' && hubSettings !== null && !Array.isArray(hubSettings)
      ? (hubSettings as Record<string, unknown>)
      : {}
  const waitlistEnabled = hub.waitlistEnabled === true
  const max =
    typeof hub.maxWaitlist === 'number' && Number.isFinite(hub.maxWaitlist) && hub.maxWaitlist > 0
      ? Math.floor(hub.maxWaitlist)
      : 500
  return { waitlistEnabled, maxWaitlist: max }
}

function computeLegacyRegistrationFull(opts: {
  leagueRows: { leagueId: string | null }[]
  leagueById: Map<
    string,
    { leagueSize: number | null; _count?: { teams: number } }
  >
  participantCount: number
  participantPoolSize: number
}): boolean {
  const withIds = opts.leagueRows.filter((l): l is typeof l & { leagueId: string } => Boolean(l.leagueId))
  if (withIds.length === 0) {
    return opts.participantCount >= opts.participantPoolSize
  }
  const anyOpen = withIds.some((row) => {
    const lg = opts.leagueById.get(row.leagueId)
    if (!lg) return true
    const cap = lg.leagueSize ?? 12
    const filled = lg._count?.teams ?? 0
    return filled < cap
  })
  return !anyOpen
}

async function loadLegacyViewerOnWaitlist(tournamentId: string, userId: string | null): Promise<boolean> {
  if (!userId) return false
  try {
    const w = await prisma.legacyTournamentWaitlistEntry.findUnique({
      where: { tournamentId_userId: { tournamentId, userId } },
    })
    return Boolean(w)
  } catch {
    return false
  }
}

export type TournamentLayoutPayload = {
  shell: SerializedShell
  conferences: SerializedConference[]
  rounds: SerializedRound[]
  tournamentLeagues: SerializedTournamentLeague[]
  participant: SerializedParticipant | null
  isCommissioner: boolean
  announcements: SerializedAnnouncement[]
  /** Wizard-created (`LegacyTournament`) vs `TournamentShell` hub. */
  hubKind: 'shell' | 'legacy'
  /** Feeder leagues + invite links (legacy tournaments; commissioner hub). */
  legacyFeederLeagues?: LegacyFeederLeagueRow[]
  /** Deputy commissioners (legacy; main commissioner view). */
  legacyMiniCommissioners?: SerializedMiniCommissionerAssignment[]
  /** Pending `league.settings` proposals (legacy; main commissioner). */
  legacyPendingLeagueSettingRequests?: SerializedPendingLeagueSettingRequest[]
  /** League IDs where the viewer is the assigned mini-commissioner (legacy). */
  viewerMiniCommissionerLeagueIds?: string[]
  /** Waitlist affordances (legacy hub); omit when not applicable. */
  legacyWaitlistUi?: LegacyWaitlistUiPayload
}

function dt(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null
}

function slugifySegment(s: string, fallback: string): string {
  const x = s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48)
  return x || fallback
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asFiniteInt(value: unknown, fallback: number): number {
  const next = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(next) ? Math.floor(next) : fallback
}

function normalizeLowerString(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback
  const normalized = value.trim().toLowerCase().replace(/\s+/g, '_')
  return normalized || fallback
}

function parseDraftSchedule(raw: unknown): DraftScheduleV1 | null {
  const root = asRecord(raw)
  const phases = asRecord(root.draftScheduleV1).phases
  if (typeof phases === 'object' && phases !== null && !Array.isArray(phases)) {
    return { phases: phases as DraftScheduleV1['phases'] }
  }
  return null
}

function resolveLegacyPhaseKey(phase: string | null | undefined, roundIndex: number): DraftPhaseKey {
  const normalized = String(phase ?? '').toLowerCase()
  if (roundIndex <= 0 || normalized.includes('qual')) return 'startup'
  if (normalized.includes('champ') || normalized.includes('final') || normalized.includes('elite')) {
    return 'redraft_finals'
  }
  return 'redraft_first'
}

function resolveDraftPhaseFields(
  schedule: DraftScheduleV1 | null,
  key: DraftPhaseKey,
  leagueId: string | null | undefined,
): { fields: PhaseScheduleFields | null; simultaneousDrafts: boolean } {
  const phases = schedule?.phases ?? {}
  const plan = (phases[key] ?? null) as PhaseDraftPlan | null
  if (!plan) return { fields: null, simultaneousDrafts: true }

  if (plan.mode === 'per_league' && leagueId) {
    return {
      fields: plan.perLeague?.[leagueId] ?? plan.uniform ?? null,
      simultaneousDrafts: false,
    }
  }

  if (plan.mode === 'grouped' && leagueId) {
    const group = plan.groups?.find((candidate) => candidate.leagueIds.includes(leagueId))
    return {
      fields: group?.schedule ?? plan.uniform ?? null,
      simultaneousDrafts: false,
    }
  }

  return { fields: plan.uniform ?? null, simultaneousDrafts: plan.mode === 'uniform' }
}

function buildAdvancersByLeagueId(
  leagueIds: string[],
  totalAdvancers: number,
): Map<string, number> {
  const counts = new Map<string, number>()
  if (leagueIds.length === 0) return counts
  const base = Math.floor(totalAdvancers / leagueIds.length)
  const remainder = Math.max(0, totalAdvancers % leagueIds.length)
  leagueIds.forEach((id, index) => {
    counts.set(id, base + (index < remainder ? 1 : 0))
  })
  return counts
}

function deriveRepresentativeLeagueSettings(
  leagueRows: Array<{ settings: unknown }> | Array<{ settings: unknown } | undefined>,
  settings: TournamentSettings,
): {
  scoringSystem: string
  waiverType: string
  openingRosterSize: number
  tournamentRosterSize: number
  eliteRosterSize: number
} {
  const representative = leagueRows
    .map((row) => asRecord(row?.settings))
    .find((settings) => Object.keys(settings).length > 0) ?? {}

  const openingRosterSize = asFiniteInt(representative.rosterSize, 15)
  const qualificationBenchSize = Math.max(0, asFiniteInt(representative.benchSize, settings.benchSpotsQualification ?? 7))
  const eliminationBenchSize = Math.max(0, settings.benchSpotsElimination ?? 2)
  const starterSlots = Math.max(1, openingRosterSize - qualificationBenchSize)
  const tournamentRosterSize = Math.max(1, starterSlots + eliminationBenchSize)

  return {
    scoringSystem: normalizeLowerString(representative.scoring, 'ppr'),
    waiverType: normalizeLowerString(representative.waiverType, 'faab'),
    openingRosterSize,
    tournamentRosterSize,
    eliteRosterSize: tournamentRosterSize,
  }
}

function resolveLegacyBubbleEnabled(settings: TournamentSettings, raw: unknown): boolean {
  const record = asRecord(raw)
  return record.bubbleEnabled === true || settings.bubbleWeekEnabled === true
}

function mergeLegacySettings(raw: unknown): TournamentSettings {
  const patch =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Partial<TournamentSettings>)
      : {}
  const merged = { ...DEFAULT_TOURNAMENT_SETTINGS, ...patch }
  const dt = String(merged.draftType ?? 'snake').toLowerCase()
  if (dt === 'linear') {
    merged.draftType = 'snake'
  }
  const ilsRaw = merged.initialLeagueSize as unknown
  if (ilsRaw === 'auto' || typeof ilsRaw !== 'number' || !Number.isFinite(ilsRaw)) {
    merged.initialLeagueSize = 12
  }
  if (merged.eliminationAdvancementPerLeague == null || typeof merged.eliminationAdvancementPerLeague !== 'number') {
    merged.eliminationAdvancementPerLeague = DEFAULT_TOURNAMENT_SETTINGS.eliminationAdvancementPerLeague
  }
  return merged
}

/**
 * Last-resort payload when the full legacy graph fails (orphan relations, Prisma include errors, etc.).
 * Any row in `LegacyTournament` should still open `/tournament/[id]` instead of 404.
 */
async function loadLegacyTournamentLayoutPayloadLoose(
  tournamentId: string,
  userId: string | null,
): Promise<TournamentLayoutPayload | null> {
  const t = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
  })
  if (!t) return null

  const settings = mergeLegacySettings(t.settings)
  const rawSettings = asRecord(t.settings)
  const draftSchedule = parseDraftSchedule(t.hubSettings)
  const startupDraftPlan = resolveDraftPhaseFields(draftSchedule, 'startup', null)
  const representativeLeagueSettings = deriveRepresentativeLeagueSettings([], settings)
  const bubbleEnabled = resolveLegacyBubbleEnabled(settings, rawSettings)
  const participantCount = await prisma.legacyTournamentParticipant
    .count({ where: { tournamentId: t.id } })
    .catch(() => 0)
  const placeholderRoundId = `${t.id}:loose-round`

  const { waitlistEnabled, maxWaitlist } = parseHubWaitlistFromJson(t.hubSettings)
  const registrationFullLoose = participantCount >= settings.participantPoolSize
  const viewerOnWaitlistLoose =
    waitlistEnabled && (await loadLegacyViewerOnWaitlist(t.id, userId))

  const serializedShell: SerializedShell = {
    id: t.id,
    name: t.name,
    sport: t.sport,
    status: t.status,
    maxParticipants: settings.participantPoolSize,
    currentParticipantCount: participantCount,
    conferenceCount: 0,
    leaguesPerConference: 1,
    teamsPerLeague: typeof settings.initialLeagueSize === 'number' ? settings.initialLeagueSize : 12,
    namingMode: settings.leagueNamingMode,
    currentRoundNumber: 1,
    totalRounds: 1,
    advancersPerLeague: 1,
    wildcardCount: Math.max(0, asFiniteInt(rawSettings.wildcardCount, 0)),
    bubbleEnabled,
    bubbleSize: bubbleEnabled ? Math.max(0, asFiniteInt(rawSettings.bubbleSize, 8)) : 0,
    bubbleScoringMode: normalizeLowerString(rawSettings.bubbleScoringMode, 'cumulative_points'),
    scoringSystem: representativeLeagueSettings.scoringSystem,
    draftType: normalizeLowerString(startupDraftPlan.fields?.draftMode, settings.draftType),
    waiverType: representativeLeagueSettings.waiverType,
    openingRosterSize: representativeLeagueSettings.openingRosterSize,
    tournamentRosterSize: representativeLeagueSettings.tournamentRosterSize,
    eliteRosterSize: representativeLeagueSettings.eliteRosterSize,
    faabResetOnRedraft: settings.faabResetByRound,
    draftClockSeconds: asFiniteInt(startupDraftPlan.fields?.pickTimerSec, asFiniteInt(rawSettings.draftClockSeconds, 90)),
    simultaneousDrafts: startupDraftPlan.simultaneousDrafts,
    tiebreakerMode: 'points_for',
    standingsVisibility: 'league_only',
  }

  return {
    shell: serializedShell,
    conferences: [],
    rounds: [
      {
        id: placeholderRoundId,
        roundNumber: 1,
        roundType: 'qualification',
        roundLabel: 'Qualification',
        weekStart: 1,
        weekEnd: 18,
        status: 'pending',
      },
    ],
    tournamentLeagues: [],
    participant: null,
    isCommissioner: Boolean(userId && t.creatorId === userId),
    announcements: [],
    hubKind: 'legacy',
    legacyWaitlistUi: {
      waitlistEnabled,
      maxWaitlist,
      registrationFull: registrationFullLoose,
      viewerOnWaitlist: viewerOnWaitlistLoose,
    },
  }
}

async function loadLegacyTournamentLayoutPayload(
  tournamentId: string,
  userId: string | null,
): Promise<TournamentLayoutPayload | null> {
  const t = await prisma.legacyTournament.findUnique({
    where: { id: tournamentId },
    include: {
      conferences: { orderBy: { orderIndex: 'asc' } },
      rounds: { orderBy: { roundIndex: 'asc' } },
      leagues: {
        include: {
          conference: true,
        },
        orderBy: [{ conferenceId: 'asc' }, { orderInConference: 'asc' }],
      },
      announcements: { orderBy: { createdAt: 'desc' }, take: 24 },
    },
  })

  if (!t) return null

  const leagueIds = [...new Set(t.leagues.map((l) => l.leagueId).filter(Boolean))]
  const leagueRows =
    leagueIds.length > 0
      ? await prisma.league
          .findMany({
            where: { id: { in: leagueIds } },
            select: {
              id: true,
              name: true,
              leagueSize: true,
              settings: true,
              logoUrl: true,
              avatarUrl: true,
              _count: { select: { teams: true } },
            },
          })
          .catch(() => [])
      : []
  const leagueById = new Map(leagueRows.map((l) => [l.id, l]))

  const settings = mergeLegacySettings(t.settings)
  const rawSettings = asRecord(t.settings)
  const draftSchedule = parseDraftSchedule(t.hubSettings)
  const dbFirstRound = t.rounds[0]
  const primaryRoundId = dbFirstRound?.id ?? `${t.id}:legacy-round-placeholder`
  const primaryRoundIndex = dbFirstRound?.roundIndex ?? 0

  const participantCount = await prisma.legacyTournamentParticipant.count({
    where: { tournamentId: t.id },
  })

  const feederLeagueCount = Math.max(1, t.leagues.length)
  const advancementTotal =
    settings.qualificationAdvancementTotal ??
    getQualificationAdvancementTotal(String(t.sport), settings.participantPoolSize)
  const advancersPerLeagueDisplay = Math.max(1, Math.floor(advancementTotal / feederLeagueCount))
  const qualificationLeagueIds = t.leagues
    .filter((league) => league.roundIndex === primaryRoundIndex)
    .map((league) => league.id)
  const qualificationAdvancersByLeagueId = buildAdvancersByLeagueId(qualificationLeagueIds, advancementTotal)
  const representativeLeagueSettings = deriveRepresentativeLeagueSettings(leagueRows, settings)
  const startupDraftPlan = resolveDraftPhaseFields(draftSchedule, 'startup', t.leagues[0]?.leagueId ?? null)
  const bubbleEnabled = resolveLegacyBubbleEnabled(settings, rawSettings)
  const bubbleSize = bubbleEnabled ? Math.max(0, asFiniteInt(rawSettings.bubbleSize, 8)) : 0
  const eliminationAdvancersPerLeague = Math.max(
    1,
    (typeof settings.eliminationAdvancementPerLeague === 'number'
      ? settings.eliminationAdvancementPerLeague
      : DEFAULT_TOURNAMENT_SETTINGS.eliminationAdvancementPerLeague) ?? 1,
  )
  const roundsByIndex = new Map(t.rounds.map((round) => [round.roundIndex, round]))

  const serializedShell: SerializedShell = {
    id: t.id,
    name: t.name,
    sport: t.sport,
    status: t.status,
    maxParticipants: settings.participantPoolSize,
    currentParticipantCount: participantCount,
    conferenceCount: t.conferences.length,
    leaguesPerConference: Math.max(1, Math.ceil(t.leagues.length / Math.max(1, t.conferences.length))),
    teamsPerLeague: typeof settings.initialLeagueSize === 'number' ? settings.initialLeagueSize : 12,
    namingMode: settings.leagueNamingMode,
    currentRoundNumber: primaryRoundIndex + 1,
    totalRounds: Math.max(t.rounds.length, 1),
    advancersPerLeague: advancersPerLeagueDisplay,
    wildcardCount: Math.max(0, asFiniteInt(rawSettings.wildcardCount, 0)),
    bubbleEnabled,
    bubbleSize,
    bubbleScoringMode: normalizeLowerString(rawSettings.bubbleScoringMode, 'cumulative_points'),
    scoringSystem: representativeLeagueSettings.scoringSystem,
    draftType: normalizeLowerString(startupDraftPlan.fields?.draftMode, settings.draftType),
    waiverType: representativeLeagueSettings.waiverType,
    openingRosterSize: representativeLeagueSettings.openingRosterSize,
    tournamentRosterSize: representativeLeagueSettings.tournamentRosterSize,
    eliteRosterSize: representativeLeagueSettings.eliteRosterSize,
    faabResetOnRedraft: settings.faabResetByRound,
    draftClockSeconds: asFiniteInt(startupDraftPlan.fields?.pickTimerSec, asFiniteInt(rawSettings.draftClockSeconds, 90)),
    simultaneousDrafts: startupDraftPlan.simultaneousDrafts,
    tiebreakerMode: Array.isArray(settings.qualificationTiebreakers)
      ? String(settings.qualificationTiebreakers[0] ?? 'points_for')
      : 'points_for',
    standingsVisibility:
      settings.universalPageVisibility === 'public'
        ? 'all'
        : settings.universalPageVisibility === 'private'
          ? 'commissioner_only'
          : 'league_only',
  }

  const lp =
    userId != null
      ? await prisma.legacyTournamentParticipant.findUnique({
          where: { tournamentId_userId: { tournamentId: t.id, userId } },
        })
      : null

  let serializedParticipant: SerializedParticipant | null = null
  if (lp) {
    const appUser = await prisma.appUser.findUnique({
      where: { id: lp.userId },
      select: { displayName: true, username: true, email: true, avatarUrl: true },
    })
    const displayName =
      appUser?.displayName?.trim() ||
      appUser?.username?.trim() ||
      appUser?.email?.trim() ||
      'Manager'
    const leagueKey = lp.currentLeagueId ?? lp.qualificationLeagueId
    const tlForParticipant = leagueKey
      ? t.leagues.find((row) => row.leagueId === leagueKey)
      : null

    serializedParticipant = {
      id: lp.id,
      userId: lp.userId,
      displayName,
      avatarUrl: appUser?.avatarUrl ?? null,
      status: lp.status,
      currentRoundNumber: lp.advancedAtRoundIndex + 1,
      furthestRoundReached: lp.advancedAtRoundIndex + 1,
      currentConferenceId: lp.conferenceId,
      currentLeagueId: tlForParticipant?.id ?? null,
      careerWins: lp.qualificationWins,
      careerLosses: lp.qualificationLosses,
      careerPointsFor: lp.qualificationPointsFor,
      careerPointsAgainst: lp.qualificationPointsAgainst,
      advancementHistory: null,
    }
  }

  const legacyFeederLeagues: LegacyFeederLeagueRow[] = t.leagues.map((tl) => {
    const lg = tl.leagueId ? leagueById.get(tl.leagueId) : undefined
    const ls = (lg?.settings as Record<string, unknown> | null) ?? {}
    const inviteCode = typeof ls.inviteCode === 'string' ? ls.inviteCode : ''
    const joinUrl = typeof ls.inviteLink === 'string' ? ls.inviteLink : ''
    return {
      tournamentLeagueId: tl.id,
      leagueId: tl.leagueId ?? '',
      name: lg?.name ?? 'League',
      inviteCode,
      joinUrl,
      conferenceName: tl.conference?.name ?? 'Conference',
    }
  })

  const { waitlistEnabled, maxWaitlist } = parseHubWaitlistFromJson(t.hubSettings)
  const registrationFull = computeLegacyRegistrationFull({
    leagueRows: t.leagues,
    leagueById,
    participantCount,
    participantPoolSize: settings.participantPoolSize,
  })
  const viewerOnWaitlist = await loadLegacyViewerOnWaitlist(t.id, userId)

  let legacyMiniCommissioners: SerializedMiniCommissionerAssignment[] | undefined
  let legacyPendingLeagueSettingRequests: SerializedPendingLeagueSettingRequest[] | undefined
  const viewerMiniCommissionerLeagueIds: string[] = []

  if (userId) {
    const mine = await prisma.legacyTournamentMiniCommissioner.findMany({
      where: { tournamentId: t.id, userId },
      select: { leagueId: true },
    })
    viewerMiniCommissionerLeagueIds.push(...mine.map((m) => m.leagueId))
  }

  if (userId && t.creatorId === userId) {
    const [miniRows, pendingRows] = await Promise.all([
      prisma.legacyTournamentMiniCommissioner.findMany({
        where: { tournamentId: t.id },
        include: {
          user: { select: { id: true, username: true, displayName: true } },
          league: { select: { id: true, name: true } },
        },
      }),
      prisma.legacyTournamentLeagueSettingRequest.findMany({
        where: { tournamentId: t.id, status: 'pending' },
        orderBy: { createdAt: 'desc' },
        include: {
          league: { select: { name: true } },
          requester: { select: { displayName: true, username: true } },
        },
      }),
    ])

    legacyMiniCommissioners = miniRows.map((m) => ({
      leagueId: m.leagueId,
      leagueName: m.league?.name ?? 'League',
      userId: m.userId,
      displayName:
        m.user.displayName?.trim() || m.user.username?.trim() || m.user.id,
      username: m.user.username,
    }))

    legacyPendingLeagueSettingRequests = pendingRows.map((r) => {
      const patch = r.proposedPatch
      const keys =
        typeof patch === 'object' && patch !== null && !Array.isArray(patch)
          ? Object.keys(patch as Record<string, unknown>)
          : []
      const requesterDisplayName =
        r.requester.displayName?.trim() ||
        r.requester.username?.trim() ||
        r.requesterId
      return {
        id: r.id,
        leagueId: r.leagueId,
        leagueName: r.league?.name ?? 'League',
        requesterDisplayName,
        createdAt: r.createdAt.toISOString(),
        proposedPatchKeys: keys,
      }
    })
  }

  return {
    shell: serializedShell,
    conferences: t.conferences.map((c, i) => ({
      id: c.id,
      name: c.name,
      slug: slugifySegment(c.name, `conf-${i}`),
      theme: c.theme,
      colorHex: null,
      conferenceNumber: c.orderIndex,
    })),
    rounds:
      t.rounds.length > 0
        ? t.rounds.map((r) => ({
            id: r.id,
            roundNumber: r.roundIndex + 1,
            roundType: r.phase,
            roundLabel: r.name ?? `Round ${r.roundIndex + 1}`,
            weekStart: r.startWeek ?? 1,
            weekEnd: r.endWeek ?? 18,
            status: r.status,
          }))
        : [
            {
              id: primaryRoundId,
              roundNumber: 1,
              roundType: 'qualification',
              roundLabel: 'Qualification',
              weekStart: 1,
              weekEnd: 18,
              status: 'pending',
            },
          ],
    tournamentLeagues: t.leagues.map((tl) => {
      const lg = tl.leagueId ? leagueById.get(tl.leagueId) : undefined
      const label = lg?.name ?? 'League'
      const round = roundsByIndex.get(tl.roundIndex)
      const phaseKey = resolveLegacyPhaseKey(round?.phase ?? tl.phase, tl.roundIndex)
      const draftPlan = resolveDraftPhaseFields(draftSchedule, phaseKey, tl.leagueId)
      return {
        id: tl.id,
        name: label,
        slug: slugifySegment(label, 'league'),
        roundId: round?.id ?? primaryRoundId,
        conferenceId: tl.conferenceId,
        leagueId: tl.leagueId,
        status: tl.phase,
        teamSlots: lg?.leagueSize ?? 12,
        currentTeamCount: lg?._count?.teams ?? 0,
        draftScheduledAt: draftPlan.fields?.scheduledAt ?? null,
        colorHex: null,
        logoUrl: lg?.logoUrl ?? lg?.avatarUrl ?? null,
        advancersCount:
          tl.roundIndex === primaryRoundIndex
            ? qualificationAdvancersByLeagueId.get(tl.id) ?? advancersPerLeagueDisplay
            : eliminationAdvancersPerLeague,
      }
    }),
    participant: serializedParticipant,
    isCommissioner: Boolean(userId && t.creatorId === userId),
    announcements: t.announcements.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title ?? '',
      content: a.body,
      roundNumber: null,
      createdAt: a.createdAt.toISOString(),
      isPosted: true,
    })),
    hubKind: 'legacy',
    legacyFeederLeagues,
    legacyMiniCommissioners,
    legacyPendingLeagueSettingRequests,
    viewerMiniCommissionerLeagueIds:
      viewerMiniCommissionerLeagueIds.length > 0 ? viewerMiniCommissionerLeagueIds : undefined,
    legacyWaitlistUi: {
      waitlistEnabled,
      maxWaitlist,
      registrationFull,
      viewerOnWaitlist,
    },
  }
}

export async function loadTournamentLayoutPayload(
  tournamentId: string,
  userId: string | null,
): Promise<TournamentLayoutPayload | null> {
  const shell = await prisma.tournamentShell.findUnique({
    where: { id: tournamentId },
    include: {
      conferences: { orderBy: { conferenceNumber: 'asc' } },
      rounds: { orderBy: { roundNumber: 'asc' } },
      tournamentLeagues: true,
      announcements: { orderBy: { createdAt: 'desc' }, take: 24 },
    },
  })

  if (!shell) {
    try {
      const full = await loadLegacyTournamentLayoutPayload(tournamentId, userId)
      if (full) return full
    } catch (err) {
      console.error('[loadTournamentLayoutPayload] legacy tournament payload failed', { tournamentId, err })
    }
    // Full graph can return null (missing row) or throw (bad relations); loose row-only load avoids 404 when the hub exists.
    return await loadLegacyTournamentLayoutPayloadLoose(tournamentId, userId)
  }

  const participant = userId
    ? await prisma.tournamentParticipant.findUnique({
        where: { tournamentId_userId: { tournamentId, userId } },
      })
    : null

  const serializedShell: SerializedShell = {
    id: shell.id,
    name: shell.name,
    sport: shell.sport,
    status: shell.status,
    maxParticipants: shell.maxParticipants,
    currentParticipantCount: shell.currentParticipantCount,
    conferenceCount: shell.conferenceCount,
    leaguesPerConference: shell.leaguesPerConference,
    teamsPerLeague: shell.teamsPerLeague,
    namingMode: shell.namingMode,
    currentRoundNumber: shell.currentRoundNumber,
    totalRounds: shell.totalRounds,
    advancersPerLeague: shell.advancersPerLeague,
    wildcardCount: shell.wildcardCount,
    bubbleEnabled: shell.bubbleEnabled,
    bubbleSize: shell.bubbleSize,
    bubbleScoringMode: shell.bubbleScoringMode,
    scoringSystem: shell.scoringSystem,
    draftType: shell.draftType,
    waiverType: shell.waiverType,
    openingRosterSize: shell.openingRosterSize,
    tournamentRosterSize: shell.tournamentRosterSize,
    eliteRosterSize: shell.eliteRosterSize,
    faabResetOnRedraft: shell.faabResetOnRedraft,
    draftClockSeconds: shell.draftClockSeconds,
    simultaneousDrafts: shell.simultaneousDrafts,
    tiebreakerMode: shell.tiebreakerMode,
    standingsVisibility: shell.standingsVisibility,
  }

  return {
    shell: serializedShell,
    conferences: shell.conferences.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      theme: c.theme,
      colorHex: c.colorHex,
      conferenceNumber: c.conferenceNumber,
    })),
    rounds: shell.rounds.map((r) => ({
      id: r.id,
      roundNumber: r.roundNumber,
      roundType: r.roundType,
      roundLabel: r.roundLabel,
      weekStart: r.weekStart,
      weekEnd: r.weekEnd,
      status: r.status,
    })),
    tournamentLeagues: shell.tournamentLeagues.map((tl) => ({
      id: tl.id,
      name: tl.name,
      slug: tl.slug,
      roundId: tl.roundId,
      conferenceId: tl.conferenceId,
      leagueId: tl.leagueId,
      status: tl.status,
      teamSlots: tl.teamSlots,
      currentTeamCount: tl.currentTeamCount,
      draftScheduledAt: dt(tl.draftScheduledAt),
      colorHex: tl.colorHex,
      logoUrl: tl.logoUrl,
      advancersCount: tl.advancersCount,
    })),
    participant: participant
      ? {
          id: participant.id,
          userId: participant.userId,
          displayName: participant.displayName,
          avatarUrl: participant.avatarUrl,
          status: participant.status,
          currentRoundNumber: participant.currentRoundNumber,
          furthestRoundReached: participant.furthestRoundReached,
          currentConferenceId: participant.currentConferenceId,
          currentLeagueId: participant.currentLeagueId,
          careerWins: participant.careerWins,
          careerLosses: participant.careerLosses,
          careerPointsFor: participant.careerPointsFor,
          careerPointsAgainst: participant.careerPointsAgainst,
          advancementHistory: participant.advancementHistory,
        }
      : null,
    isCommissioner: Boolean(userId && shell.commissionerId === userId),
    announcements: shell.announcements.map((a) => ({
      id: a.id,
      type: a.type,
      title: a.title,
      content: a.content,
      roundNumber: a.roundNumber,
      createdAt: a.createdAt.toISOString(),
      isPosted: a.isPosted,
    })),
    hubKind: 'shell',
  }
}
