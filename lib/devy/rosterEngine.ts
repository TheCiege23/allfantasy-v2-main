import type { DevyLeague, DevyPlayerState, DevyRookieTransition, DevyTaxiSlot, Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getScoringEligibility } from '@/lib/devy/scoringEligibilityEngine'

type TaxiEligibilityCheck = { eligible: boolean; reason: string }

function eligibilityString(bucketState: string, playerType: string): string {
  return getScoringEligibility(bucketState, playerType)
}

type Tx = Prisma.TransactionClient

async function countBucketPlayers(leagueId: string, rosterId: string, buckets: string[]): Promise<number> {
  return prisma.devyPlayerState.count({
    where: { leagueId, rosterId, bucketState: { in: buckets } },
  })
}

async function assertActiveCapacity(
  leagueId: string,
  rosterId: string,
  cfg: { activeRosterSize: number; benchSlots: number; irSlots: number },
): Promise<void> {
  const cap = cfg.activeRosterSize + cfg.benchSlots + cfg.irSlots
  const n = await countBucketPlayers(leagueId, rosterId, ['active_starter', 'active_bench', 'ir'])
  if (n >= cap) {
    throw new Error('Active roster is at capacity')
  }
}

/**
 * Promote from taxi or devy toward active NFL roster. Devy cannot jump straight to starter.
 */
export async function promoteToActive(
  leagueId: string,
  rosterId: string,
  playerId: string,
  targetSlot: 'active_starter' | 'active_bench',
): Promise<DevyPlayerState> {
  const cfg = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('Devy league not configured')

  const state = await prisma.devyPlayerState.findUnique({
    where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
  })
  if (!state) throw new Error('Player state not found')

  if (state.bucketState === 'devy' && targetSlot === 'active_starter') {
    throw new Error('Cannot promote devy directly to starter; move to bench first')
  }

  if (state.bucketState !== 'taxi' && state.bucketState !== 'devy') {
    throw new Error('Promotion only supported from taxi or devy')
  }

  await assertActiveCapacity(leagueId, rosterId, cfg)

  const newBucket = targetSlot
  const nextPlayerType = state.bucketState === 'devy' ? 'nfl_rookie' : state.playerType

  return prisma.$transaction(async tx => {
    await tx.devyTaxiSlot.deleteMany({ where: { leagueId, rosterId, playerId } })
    await tx.devyDevySlot.deleteMany({ where: { leagueId, rosterId, playerId } })

    return tx.devyPlayerState.update({
      where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
      data: {
        bucketState: newBucket,
        playerType: nextPlayerType,
        scoringEligibility: eligibilityString(newBucket, nextPlayerType),
        transitionedFrom: state.bucketState,
        transitionedAt: new Date(),
        transitionReason: 'manual_promotion',
      },
    })
  })
}

async function validateTaxiEligibility(
  leagueId: string,
  playerId: string,
  season: number,
): Promise<TaxiEligibilityCheck> {
  const cfg = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (!cfg) return { eligible: false, reason: 'Not a devy league' }

  const state = await prisma.devyPlayerState.findFirst({
    where: { leagueId, playerId },
  })
  if (!state) return { eligible: false, reason: 'Player state not found' }

  if (cfg.taxiRookieOnly && state.playerType !== 'nfl_rookie') {
    if (!cfg.taxiAllowNonRookies) {
      return { eligible: false, reason: 'Taxi is rookie-only in this league' }
    }
    if (state.taxiYearsUsed > cfg.taxiMaxExperienceYears) {
      return { eligible: false, reason: 'Player exceeds taxi experience window' }
    }
  }

  if (cfg.taxiLockDeadline && cfg.taxiLockDeadline.getTime() < Date.now()) {
    return { eligible: false, reason: 'Taxi lock deadline has passed' }
  }

  void season
  return { eligible: true, reason: 'ok' }
}

async function moveToTaxiWithTx(
  tx: Tx,
  cfg: DevyLeague,
  leagueId: string,
  rosterId: string,
  playerId: string,
): Promise<DevyTaxiSlot> {
  const inTaxi = await tx.devyTaxiSlot.count({ where: { leagueId, rosterId } })
  if (inTaxi >= cfg.taxiSlots) throw new Error('Taxi squad is full')

  const state = await tx.devyPlayerState.findUnique({
    where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
  })
  if (!state) throw new Error('Player state not found')

  const slot = await tx.devyTaxiSlot.create({
    data: {
      leagueId,
      rosterId,
      playerId,
      playerName: state.playerName,
      position: state.position,
      taxiYearStart: cfg.season,
      taxiYearsCurrent: 1,
    },
  })

  await tx.devyPlayerState.update({
    where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
    data: {
      bucketState: 'taxi',
      playerType: 'taxi',
      scoringEligibility: eligibilityString('taxi', 'taxi'),
      isTaxiEligible: true,
      transitionedFrom: state.bucketState,
      transitionedAt: new Date(),
      transitionReason: 'devy_entered_nfl',
    },
  })

  return slot
}

export async function moveToTaxi(
  leagueId: string,
  rosterId: string,
  playerId: string,
): Promise<DevyTaxiSlot> {
  const cfg = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('Devy league not configured')

  const taxiCheck = await validateTaxiEligibility(leagueId, playerId, cfg.season)
  if (!taxiCheck.eligible) throw new Error(taxiCheck.reason)

  return prisma.$transaction(tx => moveToTaxiWithTx(tx as Tx, cfg, leagueId, rosterId, playerId))
}

export async function processDevyToRookieTransition(
  leagueId: string,
  playerId: string,
  nflEntryYear: number,
  nflEntryMethod: string,
): Promise<DevyRookieTransition> {
  const cfg = await prisma.devyLeague.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('Devy league not configured')

  const slots = await prisma.devyDevySlot.findMany({
    where: { leagueId, playerId, hasEnteredNFL: false },
  })

  return prisma.$transaction(async tx => {
    for (const s of slots) {
      await tx.devyDevySlot.update({
        where: { id: s.id },
        data: {
          hasEnteredNFL: true,
          nflEntryYear,
          nflEntryStatus: nflEntryMethod.includes('draft') ? 'drafted' : 'undrafted_free_agent',
        },
      })
    }

    const first = slots[0]
    let destinationState = 'free_agent'
    const rosterId: string | null = first?.rosterId ?? null

    if (!first) {
      return tx.devyRookieTransition.create({
        data: {
          leagueId,
          rosterId: null,
          playerId,
          playerName: playerId,
          school: null,
          nflEntryYear,
          nflEntryMethod,
          previousState: 'devy',
          destinationState: 'free_agent',
          wasAutoTransitioned: true,
          wasCommissionerReview: false,
          transitionedAt: new Date(),
        },
      })
    }

    if (cfg.devyGradBehavior === 'move_to_taxi') {
      const inTaxi = await tx.devyTaxiSlot.count({ where: { leagueId, rosterId: first.rosterId } })
      if (inTaxi < cfg.taxiSlots) {
        try {
          await moveToTaxiWithTx(tx as Tx, cfg, leagueId, first.rosterId, playerId)
          await tx.devyDevySlot.deleteMany({ where: { leagueId, rosterId: first.rosterId, playerId } })
          destinationState = 'taxi'
        } catch {
          destinationState = 'commissioner_review'
          await tx.devyDevySlot.update({
            where: { id: first.id },
            data: { transitionQueue: true },
          })
        }
      } else {
        destinationState = 'commissioner_review'
        await tx.devyDevySlot.update({
          where: { id: first.id },
          data: { transitionQueue: true },
        })
      }
    } else if (cfg.devyGradBehavior === 'move_to_active') {
      destinationState = 'active_bench'
      await tx.devyPlayerState.updateMany({
        where: { leagueId, rosterId: first.rosterId, playerId },
        data: {
          bucketState: 'active_bench',
          playerType: 'nfl_rookie',
          scoringEligibility: eligibilityString('active_bench', 'nfl_rookie'),
          transitionedFrom: 'devy',
          transitionedAt: new Date(),
          transitionReason: 'devy_entered_nfl',
        },
      })
      await tx.devyDevySlot.deleteMany({ where: { leagueId, rosterId: first.rosterId, playerId } })
    } else {
      destinationState = 'commissioner_review'
      await tx.devyDevySlot.update({
        where: { id: first.id },
        data: { transitionQueue: true },
      })
    }

    const transition = await tx.devyRookieTransition.create({
      data: {
        leagueId,
        rosterId,
        playerId,
        playerName: first.playerName,
        school: first.school,
        nflEntryYear,
        nflEntryMethod,
        previousState: 'devy',
        destinationState,
        wasAutoTransitioned: true,
        wasCommissionerReview: destinationState === 'commissioner_review',
        transitionedAt: destinationState === 'commissioner_review' ? null : new Date(),
      },
    })

    if (rosterId) {
      await tx.devyPlayerState.updateMany({
        where: { leagueId, rosterId, playerId },
        data: {
          playerType: 'nfl_rookie',
          nflDraftYear: nflEntryYear,
        },
      })
    }

    return transition
  })
}

export async function checkRookieTransitionQueue(leagueId: string): Promise<DevyRookieTransition[]> {
  return prisma.devyRookieTransition.findMany({
    where: {
      leagueId,
      transitionedAt: null,
      destinationState: 'commissioner_review',
    },
    orderBy: { id: 'asc' },
  })
}
