import { closeExpiredExileRosters, finalizeExileRosterResults } from '@/lib/survivor/exileRosterService'
import { NextRequest, NextResponse } from 'next/server'
import { requireCronAuth } from '@/app/api/cron/_auth'
import { prisma } from '@/lib/prisma'
import {
  getOrCreateSurvivorGameState,
  syncWeeklyScores,
  finalizeWeeklyScores,
  allScoresFinalizedForWeek,
  triggerTribalOpen,
  processTribalDeadline,
  tryAutomaticPhaseAdvance,
} from '@/lib/survivor/gameStateMachine'
import { lockChallengeSubmissions, tallyChallengeResults } from '@/lib/survivor/challengeEngine'
import { processNotificationQueue } from '@/lib/survivor/notificationEngine'
import { scoreExileWeek, processReturnFromExile } from '@/lib/survivor/exileEngine'
import { expireStaleIdols } from '@/lib/survivor/SurvivorIdolRegistry'
import {
  processExileTeamClaims,
  awardWeeklyExileTeamToken,
} from '@/lib/survivor/exileTeamDraft'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const SCORE_SYNC_PHASES = ['pre_merge', 'post_swap', 'merge', 'post_merge', 'jury', 'finale']

function phaseAllowsScoreSync(phase: string | null | undefined): boolean {
  if (!phase) return false
  return SCORE_SYNC_PHASES.includes(phase)
}

async function runAutomation(req: NextRequest) {
  if (!requireCronAuth(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const errors: string[] = []
  let processed = 0

  const leagues = await prisma.league.findMany({
    where: {
      survivorMode: true,
      survivorPhase: { notIn: ['pre_draft', 'drafting', 'complete'] },
    },
    select: { id: true, survivorPhase: true },
  })

  for (const L of leagues) {
    const leagueId = L.id
    try {
      const gs = await getOrCreateSurvivorGameState(leagueId)
      const phase = gs.phase
      if (phase === 'pre_draft' || phase === 'complete') continue

      const season = await prisma.redraftSeason.findFirst({
        where: { leagueId },
        orderBy: { createdAt: 'desc' },
      })
      const week = Math.max(1, gs.currentWeek || season?.currentWeek || 1)

      if (gs.needsChallengeLock && gs.activeChallengeId) {
        const ch = await prisma.survivorChallenge.findUnique({ where: { id: gs.activeChallengeId } })
        const lockAt = ch?.locksAt ?? ch?.lockAt
        if (ch && lockAt && new Date(lockAt) <= new Date()) {
          await lockChallengeSubmissions(ch.id)
          await tallyChallengeResults(ch.id)
          await prisma.survivorGameState.update({
            where: { leagueId },
            data: {
              needsChallengeLock: false,
              challengeLockedAt: new Date(),
              challengeResultAt: new Date(),
            },
          })
        }
      }

      const leaguePhase = L.survivorPhase ?? phase
      if (phaseAllowsScoreSync(phase) || phaseAllowsScoreSync(leaguePhase)) {
        await syncWeeklyScores(leagueId, week)
      }

      await tryAutomaticPhaseAdvance(leagueId)

      let gsMid = await prisma.survivorGameState.findUnique({ where: { leagueId } })
      if (
        gsMid &&
        (await allScoresFinalizedForWeek(leagueId, week)) &&
        !gsMid.weekScoringFinalAt
      ) {
        await finalizeWeeklyScores(leagueId, week)
        gsMid = await prisma.survivorGameState.findUnique({ where: { leagueId } })
      }

      if (gsMid?.needsTribalLock && gsMid.weekScoringFinalAt && !gsMid.activeCouncilId) {
        await triggerTribalOpen(leagueId)
      }

      const gsTribal = await prisma.survivorGameState.findUnique({ where: { leagueId } })
      if (
        gsTribal?.activeCouncilId &&
        gsTribal.tribalDeadline &&
        new Date(gsTribal.tribalDeadline) <= new Date() &&
        !gsTribal.tribalRevealAt
      ) {
        await processTribalDeadline(leagueId)
      }

      await closeExpiredExileRosters(leagueId)
      const closedWeeks = await prisma.exileWeeklyEntry.findMany({ where: { leagueId }, select: { week: true }, distinct: ['week'] })
      for (const closed of closedWeeks) {
        if (await finalizeExileRosterResults(leagueId, closed.week)) await scoreExileWeek(leagueId, closed.week)
      }
      const gsExile = await prisma.survivorGameState.findUnique({ where: { leagueId } })
      if (gsExile?.needsExileScore && gsExile.weekScoringFinalAt) {
        const scored = await scoreExileWeek(leagueId, week)
        if (scored) await prisma.survivorGameState.update({
          where: { leagueId },
          data: { needsExileScore: false },
        })
      }

      if (gsExile?.weekScoringFinalAt && !gsExile.needsExileScore) await processReturnFromExile(leagueId, { week })

      try {
        await expireStaleIdols(leagueId, week)
      } catch (idolErr) {
        const msg = idolErr instanceof Error ? idolErr.message : String(idolErr)
        errors.push(`${leagueId}: expireStaleIdols ${msg}`)
      }

      try {
        await processExileTeamClaims(leagueId, week)
        await awardWeeklyExileTeamToken(leagueId)
      } catch (exileErr) {
        const msg = exileErr instanceof Error ? exileErr.message : String(exileErr)
        errors.push(`${leagueId}: exileTeamDraft ${msg}`)
      }

      await processNotificationQueue(leagueId)

      await prisma.survivorGameState.update({
        where: { leagueId },
        data: {
          lastAutomationRun: new Date(),
          lastError: null,
        },
      })
      processed++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      errors.push(`${leagueId}: ${msg}`)
      await prisma.survivorGameState
        .update({
          where: { leagueId },
          data: { lastError: msg },
        })
        .catch(() => {})
    }
  }

  return NextResponse.json({ processed, errors })
}

/** Vercel Cron invokes GET; manual triggers may use POST. */
export async function GET(req: NextRequest) {
  return runAutomation(req)
}

export async function POST(req: NextRequest) {
  return runAutomation(req)
}
