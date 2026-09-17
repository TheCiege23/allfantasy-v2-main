/**
 * GUILLOTINE AF WAR ROOM — canonical context builder.
 *
 * The ONLY file in the guillotine War Room that performs DB I/O. It assembles a
 * deterministic, serializable `GuillotineWarRoomContext` from the REAL guillotine layer:
 *  - `getGuillotineConfig` (elimination cadence + danger margin + tiebreaker),
 *  - `getDangerTiers` (chop_zone/danger/safe + pointsFromChopZone — the elimination line),
 *  - `GuillotineRosterState` (eliminated teams) + `GuillotinePeriodScore` (scores),
 *  - legacy `Roster` (lineup + FAAB), enriched via `SportsPlayer`,
 *  - `GuillotineWaiverRelease` (dropped-player pool from eliminated rosters),
 *  - redraft ADP + projections + injuries for player signals.
 *
 * SURVIVAL-FIRST and NO fabrication: it NEVER calls OpenAI and NEVER invents eliminated
 * teams, scores, the elimination line, FAAB, projections, or the dropped pool. When a source
 * is empty it sets the matching `availability` flag and records a `missingDataFlags` entry.
 */

import { prisma } from '@/lib/prisma'
import { isOrphanPlatformUserId } from '@/lib/orphan-ai-manager/orphan-platform-ids'
import { resolveLeagueAccess } from '@/lib/league-access'
import { getEffectiveLeagueRosterTemplate } from '@/lib/league/getEffectiveLeagueRosterTemplate'
import { getNormalizedLineupSections } from '@/lib/roster/LineupTemplateValidation'
import { buildPlayerKey } from '@/lib/adp/computeAllFantasyAdp'
import { getGuillotineConfig } from '@/lib/guillotine/GuillotineLeagueConfig'
import { getDangerTiers } from '@/lib/guillotine/GuillotineDangerEngine'
import { fetchAdpByPlayerKey } from '@/lib/redraft-war-room/redraftFreeAgentPool'
import { fetchRedraftInjuryNews, injuryNameKey } from '@/lib/redraft-war-room/redraftInjuryNews'
import type {
  DangerTier,
  DataState,
  GuillotineDataAvailability,
  GuillotineDroppedPlayer,
  GuillotinePlayerFact,
  GuillotineRosterSettings,
  GuillotineStandingRow,
  GuillotineTeamSummary,
  GuillotineWarRoomContext,
} from './types'

export interface BuildGuillotineWarRoomContextInput {
  leagueId: string
  userId: string | null | undefined
}

export type BuildGuillotineWarRoomContextResult =
  | { ok: true; context: GuillotineWarRoomContext }
  | { ok: false; status: 401 | 403 | 404; error: string }

const FLEX_RE = /FLEX|^UTIL$|^SUPER_UTIL$/i

function isStarterSlotType(slotType: string | null | undefined): boolean {
  const s = String(slotType ?? '').toLowerCase()
  return s !== 'bench' && s !== 'taxi' && s !== 'devy' && s !== 'ir' && s !== 'reserve'
}

function pickStr(obj: Record<string, unknown>, keys: string[]): string | null {
  for (const k of keys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return null
}

export async function buildGuillotineWarRoomContext(
  input: BuildGuillotineWarRoomContextInput,
): Promise<BuildGuillotineWarRoomContextResult> {
  const { leagueId, userId } = input
  if (!userId) return { ok: false, status: 401, error: 'Unauthorized' }

  const access = await resolveLeagueAccess(leagueId, userId)
  if (!access?.isMember) return { ok: false, status: 403, error: 'Forbidden' }

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      sport: true,
      season: true,
      guillotineMode: true,
      leagueVariant: true,
      settings: true,
      rosters: { select: { id: true, platformUserId: true, playerData: true, faabRemaining: true } },
      teams: { select: { teamName: true, ownerName: true, platformUserId: true } },
    },
  })
  if (!league) return { ok: false, status: 404, error: 'League not found' }
  const isGuillotine = league.guillotineMode === true || String(league.leagueVariant ?? '') === 'guillotine'
  if (!isGuillotine) return { ok: false, status: 404, error: 'Not a guillotine league' }

  const sport = String(league.sport ?? 'NFL')
  const season = Number(league.season ?? new Date().getFullYear())
  const settingsRecord = (league.settings as Record<string, unknown> | null) ?? {}

  const config = await getGuillotineConfig(leagueId)
  const configState: DataState = config ? 'available' : 'missing'

  // Current period = latest GuillotinePeriodScore week, else config start, else 1.
  const latestScore = await prisma.guillotinePeriodScore
    .findFirst({ where: { leagueId }, orderBy: { weekOrPeriod: 'desc' }, select: { weekOrPeriod: true, createdAt: true } })
    .catch(() => null)
  const currentWeek = latestScore?.weekOrPeriod ?? config?.eliminationStartWeek ?? 1

  // --- roster template → required starters ---
  const requiredByPosition: Record<string, number> = {}
  let totalStarterSlots = 0
  let benchSlots = 0
  let flexCount = 0
  let rosterRulesState: DataState = 'available'
  try {
    const tmpl = await getEffectiveLeagueRosterTemplate(leagueId)
    for (const s of tmpl.template.slots) {
      const starter = s.starterCount ?? 0
      if (starter > 0) {
        totalStarterSlots += starter
        const name = String(s.slotName ?? '')
        if (FLEX_RE.test(name) || s.isFlexibleSlot) flexCount += starter
        else {
          const pos = (s.allowedPositions?.length ?? 0) === 1 ? s.allowedPositions[0].toUpperCase() : name.toUpperCase()
          requiredByPosition[pos] = (requiredByPosition[pos] ?? 0) + starter
        }
      }
      benchSlots += s.benchCount ?? 0
    }
  } catch {
    rosterRulesState = 'missing'
  }
  if (flexCount > 0) {
    requiredByPosition.RB = (requiredByPosition.RB ?? 0) + Math.ceil(flexCount * 0.4)
    requiredByPosition.WR = (requiredByPosition.WR ?? 0) + Math.ceil(flexCount * 0.4)
    requiredByPosition.TE = (requiredByPosition.TE ?? 0) + Math.ceil(flexCount * 0.2)
  }
  const roster: GuillotineRosterSettings = { totalStarterSlots, benchSlots, requiredByPosition }

  // --- elimination state + danger tiers ---
  type RosterStateRow = { rosterId: string; choppedAt: Date | null; choppedInPeriod: number | null }
  const rosterStates = (await prisma.guillotineRosterState
    .findMany({ where: { leagueId }, select: { rosterId: true, choppedAt: true, choppedInPeriod: true } })
    .catch(() => [])) as RosterStateRow[]
  const stateByRoster = new Map(rosterStates.map((s) => [s.rosterId, s]))

  const dangerRows = await getDangerTiers({ leagueId, weekOrPeriod: currentWeek }).catch(() => [])
  const dangerByRoster = new Map(dangerRows.map((d) => [d.rosterId, d]))

  type PeriodScoreRow = { rosterId: string; periodPoints: number; seasonPointsCumul: number }
  const periodScores = (await prisma.guillotinePeriodScore
    .findMany({ where: { leagueId, weekOrPeriod: currentWeek }, select: { rosterId: true, periodPoints: true, seasonPointsCumul: true } })
    .catch(() => [])) as PeriodScoreRow[]
  const periodByRoster = new Map(periodScores.map((s) => [s.rosterId, s]))

  const teamByUser = new Map<string, { teamName: string; ownerName: string }>()
  for (const t of league.teams) if (t.platformUserId) teamByUser.set(t.platformUserId, { teamName: t.teamName, ownerName: t.ownerName })

  // --- player providers ---
  const adpByKey = await fetchAdpByPlayerKey(sport, season)
  const injuryNews = await fetchRedraftInjuryNews(sport)

  // parse rosters
  type RawPlayer = { rosterId: string; playerId: string; playerName: string; position: string; team: string | null; slotType: string }
  const rawByRoster = new Map<string, RawPlayer[]>()
  for (const r of league.rosters) {
    const sections = getNormalizedLineupSections(r.playerData)
    const arr: RawPlayer[] = []
    for (const sec of ['starters', 'bench', 'ir'] as const) {
      for (const item of sections[sec]) {
        const id = pickStr(item, ['id', 'playerId', 'player_id'])
        if (!id) continue
        arr.push({
          rosterId: r.id,
          playerId: id,
          playerName: pickStr(item, ['name', 'full_name', 'fullName', 'playerName', 'displayName']) ?? id,
          position: (pickStr(item, ['position', 'pos']) ?? 'UNK').toUpperCase(),
          team: pickStr(item, ['team', 'nflTeam', 'proTeam', 'teamAbbr'])?.toUpperCase() ?? null,
          slotType: sec === 'starters' ? 'starter' : sec,
        })
      }
    }
    rawByRoster.set(r.id, arr)
  }

  const allIds = [...rawByRoster.values()].flat().map((p) => p.playerId)
  type ProjRow = { playerId: string; projectedPoints: number }
  const projRows = allIds.length
    ? ((await prisma.fantasyProjection
        .findMany({ where: { sport, season: String(season), week: currentWeek, playerId: { in: allIds } }, select: { playerId: true, projectedPoints: true } })
        .catch(() => [])) as ProjRow[])
    : []
  const projByPlayer = new Map(projRows.map((p) => [p.playerId, p.projectedPoints]))

  function toPlayerFact(p: RawPlayer): GuillotinePlayerFact {
    const adp = adpByKey.get(buildPlayerKey(p.playerName, p.position)) ?? null
    const proj = projByPlayer.get(p.playerId)
    return {
      playerId: p.playerId,
      playerName: p.playerName,
      position: p.position,
      team: p.team,
      slotType: p.slotType,
      isStarterSlot: isStarterSlotType(p.slotType),
      injuryStatus: injuryNews.injuryByName.get(injuryNameKey(p.playerName))?.status ?? null,
      adp,
      weekProjection: typeof proj === 'number' ? Math.round(proj * 100) / 100 : null,
      seasonAvgActual: null,
      hasNoValueSignal: adp == null && proj == null,
    }
  }

  type LeagueRosterRow = { id: string; platformUserId: string | null; playerData: unknown; faabRemaining: number | null }
  const teams: GuillotineTeamSummary[] = (league.rosters as LeagueRosterRow[]).map((r) => {
    const meta = r.platformUserId ? teamByUser.get(r.platformUserId) : undefined
    const st = stateByRoster.get(r.id)
    return {
      rosterId: r.id,
      ownerId: r.platformUserId ?? r.id,
      // An orphan's key is a placeholder, not a name.
      ownerName: meta?.ownerName ?? (isOrphanPlatformUserId(r.platformUserId ?? '') ? null : r.platformUserId) ?? 'Team',
      teamName: meta?.teamName ?? null,
      isUserTeam: r.platformUserId === userId,
      eliminated: Boolean(st?.choppedAt),
      faabRemaining: r.faabRemaining ?? null,
      players: (rawByRoster.get(r.id) ?? []).map(toPlayerFact),
    }
  })
  const userRosterId = teams.find((t) => t.isUserTeam)?.rosterId ?? null

  // --- survival standings (active ranked safest-first by cumulative, + eliminated) ---
  const standings: GuillotineStandingRow[] = teams.map((t) => {
    const danger = dangerByRoster.get(t.rosterId)
    const score = periodByRoster.get(t.rosterId)
    const tier: DangerTier = t.eliminated ? 'unknown' : ((danger?.tier as DangerTier) ?? 'unknown')
    return {
      rosterId: t.rosterId,
      ownerName: t.ownerName,
      teamName: t.teamName,
      isUserTeam: t.isUserTeam,
      eliminated: t.eliminated,
      choppedInPeriod: stateByRoster.get(t.rosterId)?.choppedInPeriod ?? null,
      rank: t.eliminated ? null : (danger?.rank ?? null),
      seasonPointsCumul: danger?.seasonPointsCumul ?? score?.seasonPointsCumul ?? 0,
      periodPoints: score?.periodPoints ?? null,
      tier,
      pointsFromChopZone: t.eliminated ? null : (danger?.pointsFromChopZone ?? null),
    }
  })
  // Active teams sorted safest-first (higher rank number from danger engine = safer; rank 1 = chop zone).
  standings.sort((a, b) => {
    if (a.eliminated !== b.eliminated) return a.eliminated ? 1 : -1
    return (b.rank ?? 0) - (a.rank ?? 0)
  })

  const activeTeamCount = teams.filter((t) => !t.eliminated).length
  const eliminatedTeamCount = teams.filter((t) => t.eliminated).length

  // --- dropped-player pool (eliminated rosters' released players) ---
  type ReleaseRow = { playerId: string; playerName: string; position: string; team: string | null; eliminatedRosterId: string; availableAt: Date | null }
  const releases = (await prisma.guillotineWaiverRelease
    .findMany({
      where: { leagueId, releaseStatus: { in: ['pending', 'available'] } },
      select: { playerId: true, playerName: true, position: true, team: true, eliminatedRosterId: true, availableAt: true },
      orderBy: { availableAt: 'asc' },
      take: 60,
    })
    .catch(() => [])) as ReleaseRow[]
  const droppedPlayers: GuillotineDroppedPlayer[] = releases.map((r) => ({
    playerId: r.playerId,
    playerName: r.playerName,
    position: (r.position || 'UNK').toUpperCase(),
    team: r.team?.toUpperCase() ?? null,
    fromEliminatedRosterId: r.eliminatedRosterId ?? null,
    availableAt: r.availableAt ? r.availableAt.toISOString() : null,
    adp: adpByKey.get(buildPlayerKey(r.playerName, r.position)) ?? null,
  }))

  // --- availability contract ---
  const eliminationLineState: DataState = dangerRows.length > 0 ? 'available' : 'missing'
  const periodScoresState: DataState = periodScores.length > 0 ? 'available' : 'missing'
  const faabState: DataState = teams.some((t) => t.faabRemaining != null) ? 'available' : 'missing'
  const allPlayers = teams.flatMap((t) => t.players)
  const availability: GuillotineDataAvailability = {
    config: configState,
    rosters: league.rosters.length > 0 ? 'available' : 'missing',
    periodScores: periodScoresState,
    eliminationLine: eliminationLineState,
    rosterStates: rosterStates.length > 0 ? 'available' : 'missing',
    playerValues: adpByKey.size > 0 ? 'available' : 'missing',
    projections: projByPlayer.size > 0 ? 'available' : 'missing',
    injuries: injuryNews.injuryByName.size > 0 || allPlayers.some((p) => p.injuryStatus) ? 'available' : 'missing',
    news: injuryNews.newsCount > 0 ? 'available' : 'missing',
    faab: faabState,
    droppedPlayerPool: droppedPlayers.length > 0 ? 'available' : 'missing',
  }

  const missingDataFlags: string[] = []
  if (availability.config === 'missing') missingDataFlags.push('Guillotine config not found — elimination cadence unknown.')
  if (availability.eliminationLine === 'missing')
    missingDataFlags.push('No projected/period scores yet — the elimination line and survival margin cannot be computed (limited).')
  if (availability.periodScores === 'missing')
    missingDataFlags.push('No period scores recorded yet for the current week.')
  if (availability.projections === 'missing')
    missingDataFlags.push('No weekly projections — survival risk uses scores/standings only.')
  if (availability.faab === 'missing') missingDataFlags.push('FAAB budgets unavailable — FAAB plan is qualitative only.')
  if (availability.droppedPlayerPool === 'missing')
    missingDataFlags.push('No eliminated-team dropped-player pool available yet.')
  if (availability.injuries === 'missing') missingDataFlags.push('No injury data available.')

  const settings = {
    eliminationStartWeek: config?.eliminationStartWeek ?? 1,
    eliminationEndWeek: config?.eliminationEndWeek ?? null,
    teamsPerChop: config?.teamsPerChop ?? 1,
    dangerMarginPoints: config?.dangerMarginPoints ?? 10,
    tiebreaker: config?.tiebreakerOrder?.[0] ?? 'season_points',
    rosterReleaseTiming: config?.rosterReleaseTiming ?? 'next_waiver_run',
    tradesEnabled: settingsRecord.tradesEnabled === true || settingsRecord.allowTrades === true,
  }

  const survivalAvailable = eliminationLineState === 'available'

  const context: GuillotineWarRoomContext = {
    leagueId,
    leagueType: 'guillotine',
    sport,
    season,
    currentWeek,
    scoring: { sport, scoringPreset: String((settingsRecord.scoringSettings as Record<string, unknown> | undefined)?.preset ?? 'PPR').toUpperCase() },
    roster,
    guillotine: settings,
    userRosterId,
    isCommissioner: access.isCommissioner,
    standings,
    activeTeamCount,
    eliminatedTeamCount,
    teams,
    droppedPlayers,
    availability,
    freshness: {
      generatedAt: new Date().toISOString(),
      scoresAsOf: latestScore?.createdAt ? latestScore.createdAt.toISOString() : null,
      injuriesAsOf: injuryNews.injuriesAsOf ? injuryNews.injuriesAsOf.toISOString() : null,
    },
    missingDataFlags,
    featureAvailability: {
      survivalRisk: survivalAvailable,
      rosterRisk: availability.rosters === 'available',
      lineupSafety: availability.rosters === 'available' && rosterRulesState === 'available',
      waivers: availability.rosters === 'available',
      faabPlan: availability.rosters === 'available',
      droppedPlayers: availability.droppedPlayerPool === 'available',
      tradeAnalyze: settings.tradesEnabled,
      weeklyPlan: availability.rosters === 'available',
    },
  }

  return { ok: true, context }
}
