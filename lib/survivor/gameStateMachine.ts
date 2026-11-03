/**
 * Survivor game state coordinator: phase/week transitions, Redraft→Survivor weekly score bridge, tribal hooks.
 * Delegates rules to existing engines (tribe, voting, exile, idol, immunity).
 */

import type { SurvivorGameState } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { assignPlayersToTribes, executeMerge, executeTribeSwap } from '@/lib/survivor/tribeEngine'
import { seedIdolsAfterDraft, expireIdolsAtMerge } from '@/lib/survivor/idolEngine'
import { openTribalCouncil, lockVoting } from '@/lib/survivor/votingEngine'
import { scoreExileWeek } from '@/lib/survivor/exileEngine'
import { openFinale, openJuryPhase } from '@/lib/survivor/juryEngine'
import { clearWeeklyImmunity } from '@/lib/survivor/immunityEngine'
import { postHostMessage } from '@/lib/survivor/hostEngine'
import { logSurvivorAuditEntry } from '@/lib/survivor/auditEntry'
import { getSurvivorConfig } from '@/lib/survivor/SurvivorLeagueConfig'
import { scheduleTribalReminders } from '@/lib/survivor/notificationEngine'
import { publishSurvivorRedraftEvent } from '@/lib/survivor/survivorRedraftStreamHub'
import { SURVIVOR_SETTINGS_TRIBAL_VOTE_WINDOW_HOURS } from '@/lib/survivor/survivorCommissionerSettings'
import { scoreRosterForWeek } from '@/lib/redraft/scoringEngine'
import { applySurvivorSitOutToScoring } from '@/lib/survivor/SurvivorSitOutEngine'
import { readSurvivorFullSeasonPlan } from '@/lib/survivor/survivorFullSeasonPlan'
import { planWeekForInstant } from './survivorPlanCalendar'
import { openTribalCouncil as openVerifiedCouncil, closeVoteWindow } from '@/lib/survivor/survivorCouncilService'
import { tallyCouncil, revealCouncil } from '@/lib/survivor/survivorVoteTallyService'
import { resolveAutonomousCouncil } from '@/lib/survivor/survivorAutonomousCouncil'
import { afterWeeklyScoresFinalized } from '@/lib/survivor/shareCards/hooks'
import { finishCouncilReadIfComplete } from '@/lib/survivor/survivorCouncilReadFinish'
import { nextTorchCeremonyDeadline } from '@/lib/survivor/survivorCeremonySchedule'
import { normalizeSurvivorFoundationSettings } from '@/lib/survivor/normalizeSurvivorSettings'
import { scoreNbaSurvivorAllGamesRoster, scoreNbaSurvivorOneGameRoster } from './survivorNbaWeeklyScoring'
import { applySurvivorMergeCast } from './survivorMergeCast'
import { awardTribeImmunity, clearExpiredTribeImmunity } from './survivorTribeImmunity'
import { pickAttendingTribeId, resolveWeekImmuneTribeIds } from './survivorCouncilImmunity'
import { loadWeekCouncilProgress } from './survivorWeekCouncilProgress'
import { getActiveSurpriseTribeWeek } from './survivorSurpriseTribes'
import { postImmunityWinLine } from './leagueChatPoster'
import { survivorWeekOneExclusion, survivorWeekOneStartDay } from './survivorWeekOneScoring'

/** SurvivorPlayer.redraftRosterId is the legacy Roster id; resolve its actual season roster. */
export async function sumRedraftStartersFantasy(
  rosterId: string,
  week: number,
  season: { id: string; leagueId: string; season: number },
): Promise<{ pts: number; allFinalized: boolean }> {
  const league = await prisma.league.findUnique({ where: { id: season.leagueId }, select: { sport: true, survivorMode: true, settings: true } })
  if (league?.survivorMode && league.sport === 'NBA') {
    const score = { leagueId: season.leagueId, legacyRosterId: rosterId, week, season: season.season }
    return normalizeSurvivorFoundationSettings(league.settings as Record<string, unknown>).nbaWeeklyScoringMode === 'one_game_per_player'
      ? scoreNbaSurvivorOneGameRoster(score)
      : scoreNbaSurvivorAllGamesRoster(score)
  }
  const bridge = await prisma.roster.findFirst({
    where: { id: rosterId, leagueId: season.leagueId }, select: { redraftRosterId: true },
  })
  if (!bridge?.redraftRosterId) return { pts: 0, allFinalized: false }
  const actual = await prisma.redraftRoster.findFirst({
    where: { id: bridge.redraftRosterId, seasonId: season.id, leagueId: season.leagueId }, select: { id: true },
  })
  if (!actual) return { pts: 0, allFinalized: false }
  // The commissioner's week-1 window ("Thursday and Friday players will not count"): Survivor's own
  // week-1 total only, never the base league's matchup score (lib/survivor/survivorWeekOneScoring.ts).
  const weekOneStartDay = league ? survivorWeekOneStartDay(league, week) : null
  // A "forced bench" disadvantage (lib/survivor/survivorForcedBench.ts): that player's points from a
  // starting slot do not count toward Survivor's score this week, even if the lineup saves let him in.
  const benched = league?.survivorMode
    ? await import('./survivorForcedBench').then((m) => m.loadForcedBench(season.leagueId, rosterId, week)).catch(() => new Set<string>())
    : new Set<string>()
  const score = await scoreRosterForWeek({ leagueId: season.leagueId, rosterId: actual.id, week, seasonYear: season.season, ...(weekOneStartDay || benched.size ? { collectPlayerPoints: true } : {}) })
  const allFinalized = score.starterCount > 0 && score.scoredStarterCount === score.starterCount && score.missingPlayerIds.length === 0 && score.allFinal
  if (benched.size && score.playerPoints) {
    const { forcedBenchStarterPoints } = await import('./survivorForcedBench')
    const off = forcedBenchStarterPoints(score.playerPoints, benched)
    if (off) score.points = Math.round((score.points - off) * 100) / 100
  }
  if (weekOneStartDay && score.playerPoints) {
    const excluded = await survivorWeekOneExclusion({ sport: String(league?.sport ?? 'NFL'), season: season.season, week, startDay: weekOneStartDay, redraftRosterId: actual.id, playerPoints: benched.size ? score.playerPoints.filter((p) => !benched.has(p.playerId)) : score.playerPoints })
      .catch((error) => {
        console.warn('[survivor] week-1 window not applied', error instanceof Error ? error.message : error)
        return 0
      })
    return { pts: Math.round((score.points - excluded) * 100) / 100, allFinalized }
  }
  return { pts: score.points, allFinalized }
}

export async function getOrCreateSurvivorGameState(leagueId: string): Promise<SurvivorGameState> {
  const existing = await prisma.survivorGameState.findUnique({ where: { leagueId } })
  if (existing) return existing
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorPhase: true },
  })
  return prisma.survivorGameState.create({
    data: {
      leagueId,
      phase: league?.survivorPhase ?? 'pre_draft',
      currentWeek: 0,
    },
  })
}

async function logPhaseTransition(
  leagueId: string,
  fromPhase: string,
  toPhase: string,
  week: number,
  triggeredBy: string,
  triggeredByUserId?: string | null,
  notes?: string,
): Promise<void> {
  await prisma.survivorPhaseTransition.create({
    data: {
      leagueId,
      fromPhase,
      toPhase,
      week,
      triggeredBy,
      triggeredByUserId: triggeredByUserId ?? undefined,
      notes,
    },
  })
}

export type AdvancePhaseOptions = {
  /** Target phase (maps to `League.survivorPhase` string and automation row). */
  toPhase: string
  notes?: string
}

/**
 * Moves the season to `opts.toPhase` and runs the appropriate setup hooks once.
 */
export async function advancePhase(
  leagueId: string,
  triggeredBy: string,
  triggeredByUserId: string | undefined,
  opts: AdvancePhaseOptions,
): Promise<SurvivorGameState> {
  const gs = await getOrCreateSurvivorGameState(leagueId)
  const fromPhase = gs.phase
  const toPhase = opts.toPhase
  if (fromPhase === toPhase) return gs

  await logPhaseTransition(leagueId, fromPhase, toPhase, gs.currentWeek, triggeredBy, triggeredByUserId, opts.notes)

  if (toPhase === 'pre_merge' || toPhase === 'drafting') {
    // Native leagues set up tribes and player-bound idols when the draft completes
    // (survivorPhase2Init). The legacy helpers would reshuffle tribes and seed
    // placeholder idols on top, so a forced phase change must not rerun them.
    const setup = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
    const nativeSetup = (setup?.settings as Record<string, unknown> | null)?.survivorFoundationSettingsVersion === 1
    if (!nativeSetup) {
      await assignPlayersToTribes(leagueId, 'auto').catch(() => {})
      await seedIdolsAfterDraft(leagueId, 'random').catch(() => {})
    }
    const active = await prisma.survivorPlayer.count({ where: { leagueId, playerState: 'active' } })
    const tribeRows = await prisma.survivorTribe.count({
      where: { leagueId, isActive: true },
    })
    await prisma.survivorGameState.update({
      where: { leagueId },
      data: {
        phase: toPhase,
        preMergeStartedAt: new Date(),
        activePlayerCount: active,
        activeTribeCount: tribeRows,
        draftCompletedAt: new Date(),
      },
    })
    await prisma.league.update({ where: { id: leagueId }, data: { survivorPhase: 'pre_merge' } })
    await postHostMessage(leagueId, 'season_start', { week: gs.currentWeek }, 'league_chat').catch(() => {})
  } else if (toPhase === 'post_swap') {
    await executeTribeSwap(leagueId, gs.currentWeek, 'random_shuffle').catch(() => {})
    await prisma.league.update({ where: { id: leagueId }, data: { survivorPhase: 'post_swap' } })
    await prisma.survivorGameState.update({ where: { leagueId }, data: { phase: 'post_swap' } })
  } else if (toPhase === 'merging' || toPhase === 'merge') {
    await executeMerge(leagueId, gs.currentWeek).catch(() => {})
    // The legacy merge only moves member rows; this moves the cast and opens the merge chat.
    await applySurvivorMergeCast(leagueId, gs.currentWeek)
    await expireIdolsAtMerge(leagueId).catch(() => {})
    await prisma.survivorGameState.update({
      where: { leagueId },
      data: { phase: 'post_merge', mergeTriggeredAt: new Date() },
    })
    await prisma.league.update({ where: { id: leagueId }, data: { survivorPhase: 'merge' } })
  } else if (toPhase === 'jury') {
    await openJuryPhase(leagueId)
    await prisma.league.update({ where: { id: leagueId }, data: { survivorPhase: 'jury' } })
    await prisma.survivorGameState.update({
      where: { leagueId },
      data: { phase: 'jury', juryStartedAt: new Date() },
    })
  } else if (toPhase === 'finale') {
    const finalists = await prisma.survivorPlayer.findMany({
      where: { leagueId, isFinalist: true },
      select: { userId: true },
    })
    await openFinale(
      leagueId,
      finalists.length ? finalists.map((f) => f.userId) : [],
    ).catch(() => {})
    await prisma.league.update({ where: { id: leagueId }, data: { survivorPhase: 'finale' } })
    await prisma.survivorGameState.update({
      where: { leagueId },
      data: { phase: 'finale', finaleStartedAt: new Date() },
    })
  } else if (toPhase === 'complete') {
    const { generateSeasonSnapshot } = await import('@/lib/survivor/snapshotEngine')
    await generateSeasonSnapshot(leagueId).catch(() => {})
    await prisma.league.update({ where: { id: leagueId }, data: { survivorPhase: 'complete' } })
    await prisma.survivorGameState.update({
      where: { leagueId },
      data: { phase: 'complete', seasonCompletedAt: new Date() },
    })
  } else {
    await prisma.league.update({ where: { id: leagueId }, data: { survivorPhase: toPhase } })
    await prisma.survivorGameState.update({ where: { leagueId }, data: { phase: toPhase } })
  }

  return getOrCreateSurvivorGameState(leagueId)
}

export async function advanceWeek(leagueId: string): Promise<void> {
  const gs = await getOrCreateSurvivorGameState(leagueId)
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const plan = readSurvivorFullSeasonPlan(league?.settings)
  const next = plan && gs.currentWeek < plan.startWeek ? plan.startWeek : gs.currentWeek + 1
  if (plan) {
    const calendarWeek = planWeekForInstant(plan.sport, plan.season, new Date()) ?? 0
    if (next > plan.endWeek || next > calendarWeek) return
    if (gs.currentWeek >= plan.startWeek) {
      if (!gs.weekScoringFinalAt || gs.activeCouncilId) return
      // Every council the week owes must have sent someone home (a double week owes two).
      if (plan.eliminationWeeks.includes(gs.currentWeek)) {
        const progress = await loadWeekCouncilProgress(leagueId, gs.currentWeek, plan.eliminationWeeks)
        if (!progress.done) return
      }
      if (plan.exileReturnWeek === gs.currentWeek) {
        const settled = await prisma.survivorAuditEntry.findFirst({ where: { leagueId, action: 'scheduled_exile_return_resolved' }, select: { id: true } })
        if (!settled) return
      }
    }
  }
  await clearWeeklyImmunity(leagueId)
  const changed = await prisma.$transaction(async tx => {
    const result = await tx.survivorGameState.updateMany({
      where: { leagueId, currentWeek: gs.currentWeek },
      data: {
        currentWeek: next,
        weekStartedAt: new Date(),
        needsChallengeLock: true,
        needsTribalLock: plan ? plan.eliminationWeeks.includes(next) : true,
        weekScoringFinalAt: null,
        activeCouncilId: null,
        tribalRevealAt: null,
        tribalCompleteAt: null,
      },
    })
    if (!result.count) return result
    // A raided team's boost ends with the week. A team that used a claim has
    // already moved to the back of the waiver order, so its priority stays put.
    const boosts = await tx.survivorAuditEntry.findMany({
      where: { leagueId, week: gs.currentWeek, action: 'steal_three_waiver_boost' },
      orderBy: { createdAt: 'asc' },
      select: { relatedEntityId: true, data: true },
    })
    const restoreByRoster = new Map<string, { previous: number; boosted: number }>()
    for (const boost of boosts) {
      const rosterId = boost.relatedEntityId
      if (!rosterId) continue
      const data = boost.data && typeof boost.data === 'object' && !Array.isArray(boost.data) ? boost.data : {}
      const previous = Number(data.previousPriority)
      const boosted = Number(data.boostedPriority)
      if (!Number.isInteger(previous) || !Number.isInteger(boosted)) continue
      const original = restoreByRoster.get(rosterId)?.previous ?? previous
      restoreByRoster.set(rosterId, { previous: original, boosted })
    }
    for (const [rosterId, priorities] of restoreByRoster) {
      await tx.redraftRoster.updateMany({ where: { id: rosterId, leagueId, waiverPriority: priorities.boosted }, data: { waiverPriority: priorities.previous } })
    }
    return result
  })
  if (!changed.count) return
  await logSurvivorAuditEntry({
    leagueId,
    week: next,
    category: 'automation',
    action: 'WEEK_ADVANCED',
    data: { week: next },
    isVisibleToPublic: true,
  })

  const { ensureSystemWeeklyChallenge } = await import('@/lib/survivor/challengeEngine')
  await ensureSystemWeeklyChallenge(leagueId, next).catch(() => {})
}

export async function syncWeeklyScores(leagueId: string, week: number): Promise<void> {
  // A paused season is frozen: no rescoring, no immunity changes, and the
  // pause marker in lastError stays put until the commissioner resumes.
  const game = await prisma.survivorGameState.findUnique({ where: { leagueId }, select: { pausedSnapshot: true } })
  if (game?.pausedSnapshot != null) return
  // No lineup-lock hook exists in Survivor; the first score sync after the lock takes the
  // necklace off (each row carries the lock instant it expires at).
  await clearExpiredTribeImmunity(leagueId)
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
  })
  if (!season) return

  const players = await prisma.survivorPlayer.findMany({
    where: { leagueId, playerState: 'active' },
  })

  for (const sp of players) {
    if (!sp.redraftRosterId) continue
    const { pts, allFinalized } = await sumRedraftStartersFantasy(sp.redraftRosterId, week, season)
    const previous = await prisma.survivorWeeklyScore.findUnique({ where: { leagueId_userId_week: { leagueId, userId: sp.userId, week } }, select: { pointBoostApplied: true, pointPenaltyApplied: true } })
    const boost = previous?.pointBoostApplied ?? 0
    const pen = previous?.pointPenaltyApplied ?? 0
    const final = pts + boost - pen
    await prisma.survivorWeeklyScore.upsert({
      where: {
        leagueId_userId_week: { leagueId, userId: sp.userId, week },
      },
      create: {
        leagueId,
        userId: sp.userId,
        week,
        fantasyScore: pts,
        pointBoostApplied: boost,
        pointPenaltyApplied: pen,
        finalScore: final,
        tribeId: sp.tribeId,
        isFinalized: allFinalized,
        finalizedAt: allFinalized ? new Date() : null,
      },
      update: {
        fantasyScore: pts,
        finalScore: final,
        tribeId: sp.tribeId,
        isFinalized: allFinalized,
        finalizedAt: allFinalized ? new Date() : null,
      },
    })
  }

  await applySurvivorSitOutToScoring(leagueId, week)

  // Exile is a separate weekly contest. Historical main-island score rows for
  // an exiled manager must never win tribe or individual immunity.
  const activeUserIds = players.map(player => player.userId)
  const scores = await prisma.survivorWeeklyScore.findMany({ where: { leagueId, week, userId: { in: activeUserIds } } })
  const byTribe = new Map<string, number>()
  for (const s of scores) {
    if (!s.tribeId || !s.countedTowardTribeTotal) continue
    byTribe.set(s.tribeId, (byTribe.get(s.tribeId) ?? 0) + s.finalScore)
  }
  let bestTribe: string | null = null
  let best = -Infinity
  for (const [tid, tot] of [...byTribe.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (tot > best) {
      best = tot
      bestTribe = tid
    }
  }

  let bestPlayer: string | null = null
  let bestP = -Infinity
  for (const s of [...scores].sort((a, b) => a.userId.localeCompare(b.userId))) {
    if (s.finalScore > bestP) {
      bestP = s.finalScore
      bestPlayer = s.userId
    }
  }

  const leagueRow = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { survivorPhase: true },
  })
  const phase = leagueRow?.survivorPhase
  const postMerge = phase === 'merge' || phase === 'post_merge' || phase === 'jury' || phase === 'finale'

  await prisma.survivorGameState.update({
    where: { leagueId },
    data: {
      immuneTribeId: postMerge ? null : bestTribe,
      immunePlayerId: postMerge ? bestPlayer : null,
      lastAutomationRun: new Date(),
      lastError: null,
    },
  })
}

export async function allScoresFinalizedForWeek(leagueId: string, week: number): Promise<boolean> {
  const season = await prisma.redraftSeason.findFirst({ where: { leagueId }, orderBy: { createdAt: 'desc' } })
  if (!season) return false
  const players = await prisma.survivorPlayer.findMany({
    where: { leagueId, playerState: 'active' },
    select: { redraftRosterId: true },
  })
  const rosterIds = [...new Set(players.map((p) => p.redraftRosterId).filter(Boolean))] as string[]
  if (rosterIds.length === 0) return false
  for (const rid of rosterIds) {
    const { allFinalized } = await sumRedraftStartersFantasy(rid, week, season)
    if (!allFinalized) return false
  }
  return true
}

export async function finalizeWeeklyScores(leagueId: string, week: number): Promise<void> {
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const plan = readSurvivorFullSeasonPlan(league?.settings)
  const active = await prisma.survivorPlayer.findMany({ where: { leagueId, playerState: 'active' }, select: { userId: true } })
  await prisma.survivorWeeklyScore.updateMany({
    where: { leagueId, week, userId: { in: active.map(player => player.userId) } },
    data: { isFinalized: true, finalizedAt: new Date() },
  })
  await prisma.survivorGameState.update({
    where: { leagueId },
    data: {
      weekScoringFinalAt: new Date(),
      needsTribalLock: plan ? plan.eliminationWeeks.includes(week) : true,
    },
  })
  // Final scores decide the necklace: top score in each tribe headed to Tribal Council.
  await awardTribeImmunity(leagueId, week, { post: (winner, awardWeek) => postImmunityWinLine(leagueId, winner, awardWeek) }).catch(() => {})
  // Share cards: the immunity winner's card, once scores are final. Runs AFTER the award above so
  // the capture reads the SurvivorTribeImmunity rows it just wrote.
  afterWeeklyScoresFinalized(leagueId, week)
}

function tribalVoteWindowHoursFromLeague(settings: unknown): number {
  if (settings && typeof settings === 'object' && !Array.isArray(settings)) {
    const raw = (settings as Record<string, unknown>)[SURVIVOR_SETTINGS_TRIBAL_VOTE_WINDOW_HOURS]
    if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0 && raw <= 168) return raw
  }
  return 24
}

export async function triggerTribalOpen(leagueId: string): Promise<void> {
  const gs = await getOrCreateSurvivorGameState(leagueId)
  const config = await getSurvivorConfig(leagueId)
  if (!config) return

  const leagueRow = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { settings: true },
  })
  const plan = readSurvivorFullSeasonPlan(leagueRow?.settings)
  if (plan && !plan.eliminationWeeks.includes(gs.currentWeek)) return
  const hours = tribalVoteWindowHoursFromLeague(leagueRow?.settings)
  const deadline = plan ? nextTorchCeremonyDeadline(new Date(), leagueRow?.settings) : new Date(Date.now() + hours * 60 * 60 * 1000)

  const tribes = await prisma.survivorTribe.findMany({
    where: { leagueId, isActive: true },
    select: { id: true },
  })
  // The lowest scoring tribe that is not immune attends, planned season or not. Immunity is the
  // top tribe (the top two under that rule) plus any tribe that won it through a challenge, from
  // the same resolver the necklace uses, so a tribe told it is safe is never sent. The unplanned
  // path used to send the FIRST non-immune tribe, which with three or more tribes was wrong.
  // A surprise two-tribe week after the merge: only its two temporary tribes count, the score
  // sync's merged pick does not, and the lower tribe alone attends.
  const surprise = await getActiveSurpriseTribeWeek(leagueId, gs.currentWeek)
  const immunity = await resolveWeekImmuneTribeIds(leagueId, gs.currentWeek, {
    settings: normalizeSurvivorFoundationSettings(leagueRow?.settings as Record<string, unknown> | null),
    tribeIds: surprise ? surprise.tribeIds : tribes.map((t) => t.id),
    scoreImmuneTribeId: surprise ? null : gs.immuneTribeId,
  })
  let losingTribe = immunity.attendingTribeId
  const tribeId = losingTribe

  if (plan) {
    // A planned week opens its councils one at a time: the next only once the last has sent
    // someone home, and never more than the plan schedules (two in a double-elimination week).
    const progress = await loadWeekCouncilProgress(leagueId, gs.currentWeek, plan.eliminationWeeks)
    if (!progress.canOpenNext) return
    // The second council of a pre-merge double week goes to the next-lowest tribe that is not
    // immune and has not attended this week. With nobody else left, the same tribe goes back.
    if (progress.attendedTribeIds.length) {
      losingTribe = pickAttendingTribeId({
        totals: immunity.totals,
        tribeIds: surprise ? surprise.tribeIds : tribes.map((t) => t.id),
        immuneTribeIds: [...immunity.immuneTribeIds, ...progress.attendedTribeIds],
        tieBreak: immunity.tieBreak,
      }) ?? losingTribe
    }
    const merged = !surprise && (Boolean(gs.mergeTriggeredAt) || ['merge', 'post_merge', 'jury', 'finale'].includes(gs.phase))
    const opened = await openVerifiedCouncil(leagueId, { week: gs.currentWeek, attendingTribeId: merged ? null : losingTribe, voteDeadlineAt: deadline, ...(surprise ? { scope: 'surprise' as const } : {}) })
    if (!opened.ok) throw new Error(opened.error)
    await scheduleTribalReminders(leagueId, deadline)
    return
  }

  const { id: councilId } = await openTribalCouncil(leagueId, gs.currentWeek, tribeId, deadline)

  await prisma.survivorGameState.update({
    where: { leagueId },
    data: {
      activeCouncilId: councilId,
      tribalOpenedAt: new Date(),
      tribalDeadline: deadline,
      needsTribalLock: false,
    },
  })

  await scheduleTribalReminders(leagueId, deadline)
}

export async function processTribalDeadline(leagueId: string): Promise<void> {
  const gs = await prisma.survivorGameState.findUnique({ where: { leagueId } })
  if (!gs?.activeCouncilId || gs.pausedSnapshot != null) return
  const council = await prisma.survivorTribalCouncil.findUnique({ where: { id: gs.activeCouncilId } })
  if (!council) return
  const dl = council.votingDeadline ?? council.voteDeadlineAt
  if (dl && new Date(dl) > new Date()) return
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { settings: true } })
  const plan = readSurvivorFullSeasonPlan(league?.settings)
  if (plan && plan.eliminationWeeks.includes(council.week)) {
    // A previous tick may have closed, tallied, or revealed this council before
    // failing. Resume from that persisted state rather than leaving it stranded.
    if (!['voting_open', 'closed', 'voting_closed', 'revealed', 'tie_pending'].includes(council.status)) return
    if (council.status === 'voting_open') {
      const closed = await closeVoteWindow(leagueId, council.id)
      if (!closed.ok) throw new Error(closed.error)
    }
    const latest = await prisma.survivorTribalCouncil.findUnique({ where: { id: council.id } })
    if (!latest) return
    if (!latest.isRevealed && !latest.eliminatedUserId && (!Array.isArray(latest.revealSequence) || latest.revealSequence.length === 0)) {
      const tallied = await tallyCouncil(leagueId, council.id)
      if (!tallied.ok) throw new Error(tallied.error)
    }
    await resolveAutonomousCouncil(leagueId, council.id)
    // A read a host already opened is finished here even when auto-reveal is off.
    if (!latest.isRevealed && normalizeSurvivorFoundationSettings(league?.settings as Record<string, unknown> | null).autoReveal === false) return
    const revealed = await revealCouncil(leagueId, council.id)
    if (!revealed.ok) throw new Error(revealed.error)
    // The verdict and the elimination wait for the last ballot of the read; a later tick finishes them.
    const finished = await finishCouncilReadIfComplete(leagueId, council.id)
    if (!finished.ok) throw new Error(finished.error)
    if (finished.complete && finished.elimination && !finished.elimination.ok) throw new Error(finished.elimination.error)
    return
  }
  // Leagues without a full-season plan: lockVoting opens the read; a later tick finishes it (verdict,
  // elimination) once the last ballot has been released.
  if (council.isRevealed) {
    const finished = await finishCouncilReadIfComplete(leagueId, council.id)
    if (!finished.ok) throw new Error(finished.error)
    return
  }
  if (council.status !== 'voting_open') return
  const locked = await lockVoting(gs.activeCouncilId)
  if (!locked.ok) throw new Error(locked.error)
}

export type PhaseAdvanceSuggestion = {
  toPhase: string
  reason: string
}

/**
 * Next phase from league rules + game row (read-only). Returns null if no automatic transition applies.
 */
export async function computeAutomaticNextPhase(leagueId: string): Promise<PhaseAdvanceSuggestion | null> {
  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: {
      survivorMode: true,
      survivorSwapWeek: true,
      survivorSwapTrigger: true,
      survivorMergeWeek: true,
      survivorMergeTrigger: true,
      survivorMergeAtCount: true,
      survivorJuryStart: true,
      survivorPhase: true,
      settings: true,
    },
  })
  if (!league?.survivorMode) return null

  const gs = await getOrCreateSurvivorGameState(leagueId)
  const phase = gs.phase
  const week = Math.max(0, gs.currentWeek)
  const leaguePhase = league.survivorPhase ?? 'pre_draft'

  const active = await prisma.survivorPlayer.count({
    where: { leagueId, playerState: 'active' },
  })

  if (phase === 'complete' || leaguePhase === 'complete') return null
  if (phase === 'pre_draft' || phase === 'drafting') return null

  // Tribe swap
  if (phase === 'pre_merge' && (leaguePhase === 'pre_merge' || leaguePhase === 'drafting')) {
    const swapWeek = league.survivorSwapWeek
    if (swapWeek != null && week >= swapWeek) {
      return { toPhase: 'post_swap', reason: 'survivor_swap_week' }
    }
    const st = league.survivorSwapTrigger ?? 'manual'
    if (/^\d+$/.test(st)) {
      const n = parseInt(st, 10)
      if (active > 0 && active <= n) {
        return { toPhase: 'post_swap', reason: 'survivor_swap_player_count' }
      }
    }
  }

  // Merge
  const gsPreMerge = phase === 'pre_merge' || phase === 'post_swap'
  const leaguePreMerge = leaguePhase === 'pre_merge' || leaguePhase === 'post_swap'
  if (gsPreMerge && leaguePreMerge) {
    const mergeWeek = league.survivorMergeWeek ?? 7
    const mergeAt = league.survivorMergeAtCount ?? 10
    const trig = league.survivorMergeTrigger ?? 'week'
    const hitWeek = trig === 'week' && week >= mergeWeek
    const hitCount = (trig === 'player_count' || trig === 'players_remaining') && active > 0 && active <= mergeAt
    if (hitWeek || hitCount) {
      return { toPhase: 'merge', reason: hitWeek ? 'merge_week' : 'merge_player_count' }
    }
  }

  // First post-merge elimination → jury
  if (phase === 'post_merge' && leaguePhase === 'merge') {
    const jMode = league.survivorJuryStart ?? 'post_merge_vote_1'
    if (jMode !== 'manual') {
      const closedMerge = await prisma.survivorTribalCouncil.count({
        where: {
          leagueId,
          phase: 'merge',
          closedAt: { not: null },
          OR: [{ eliminatedUserId: { not: null } }, { eliminatedRosterId: { not: null } }],
        },
      })
      if (closedMerge >= 1) {
        return { toPhase: 'jury', reason: 'post_merge_elimination' }
      }
    }
  }

  if ((phase === 'jury' || leaguePhase === 'jury') && active === 3) {
    const plan = readSurvivorFullSeasonPlan(league.settings)
    if (plan && week < plan.finaleWeek) return null
    return { toPhase: 'finale', reason: 'final_three' }
  }

  if (phase === 'finale' || leaguePhase === 'finale') {
    const session = await prisma.jurySession.findUnique({
      where: { leagueId },
      select: { winnerId: true },
    })
    if (session?.winnerId) {
      return { toPhase: 'complete', reason: 'jury_winner_revealed' }
    }
  }

  return null
}

/**
 * Applies `computeAutomaticNextPhase` when it returns a target; clears `needsPhaseAdvance` after a successful advance.
 */
export async function tryAutomaticPhaseAdvance(
  leagueId: string,
): Promise<{ advanced: boolean; toPhase?: string; reason?: string }> {
  const suggestion = await computeAutomaticNextPhase(leagueId)
  if (!suggestion) {
    return { advanced: false }
  }

  const gsBefore = await getOrCreateSurvivorGameState(leagueId)

  await advancePhase(leagueId, 'automatic', undefined, {
    toPhase: suggestion.toPhase,
    notes: suggestion.reason,
  })

  await prisma.survivorGameState.update({
    where: { leagueId },
    data: { needsPhaseAdvance: false },
  })

  const gsAfter = await getOrCreateSurvivorGameState(leagueId)
  const season = await prisma.redraftSeason.findFirst({
    where: { leagueId },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  })
  if (season) {
    publishSurvivorRedraftEvent(season.id, {
      type: 'phase_changed',
      leagueId,
      from: gsBefore.phase,
      to: gsAfter.phase,
      week: gsAfter.currentWeek,
    })
  }

  return { advanced: true, toPhase: suggestion.toPhase, reason: suggestion.reason }
}

export { scoreExileWeek }
