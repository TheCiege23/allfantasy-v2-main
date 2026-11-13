import type { C2CPlayerState } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { getScoringEligibility } from '@/lib/c2c/scoringEngine'
import { validateC2CRosterSlots } from '@/lib/merged-devy-c2c/roster/C2CRosterRules'
import { resolveTaxiLock } from '@/lib/c2c/taxiLockResolver'

export type LineupValidationResult = {
  valid: boolean
  errors: string[]
}

const CAMPUS_BUCKETS = new Set(['campus_starter', 'bench', 'taxi', 'devy', 'ir'])
const CANTON_BUCKETS = new Set(['canton_starter', 'bench', 'taxi', 'devy', 'ir'])

function allowedBucketsForSide(side: string): Set<string> {
  return side === 'campus' ? CAMPUS_BUCKETS : CANTON_BUCKETS
}

export async function movePlayer(
  leagueId: string,
  rosterId: string,
  playerId: string,
  targetBucket: string,
): Promise<C2CPlayerState> {
  const cfg = await prisma.c2CLeague.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('C2C league not found')

  const row = await prisma.c2CPlayerState.findUnique({
    where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
  })
  if (!row) throw new Error('Player not on C2C roster')

  const side = row.playerSide
  if (!allowedBucketsForSide(side).has(targetBucket)) {
    throw new Error(`Invalid bucket ${targetBucket} for playerSide ${side}`)
  }
  if (targetBucket === 'campus_starter' && side !== 'campus') {
    throw new Error('Canton players cannot occupy campus starter slots')
  }
  if (targetBucket === 'canton_starter' && side !== 'canton') {
    throw new Error('Campus players cannot occupy canton starter slots')
  }

  if (targetBucket === 'taxi' || row.bucketState === 'taxi') {
    // Honor both "moving onto taxi" and "moving off taxi" — the deadline
    // governs all taxi edits, not just adds.
    if (targetBucket === 'taxi' && cfg.taxiRookieOnly && !row.isRookieEligible) {
      throw new Error('Taxi is rookie-only for this league')
    }
    const lock = await resolveTaxiLock(leagueId)
    if (lock.isLocked) {
      throw new Error(
        lock.mode === 'preseason'
          ? 'Taxi is locked — preseason deadline has passed.'
          : 'Taxi is locked — season has started.',
      )
    }
  }

  const scoringEligibility = getScoringEligibility(side, targetBucket, cfg.devyScoringEnabled)

  // Project the roster after this move and enforce slot legality (taxi
  // overflow, college-pool overflow, graduated players in college slots)
  // so illegal adds/trades are rejected before persistence.
  const allRows = await prisma.c2CPlayerState.findMany({
    where: { leagueId, rosterId },
    select: { playerId: true, bucketState: true, playerSide: true, classYear: true },
  })
  const projected = allRows.map((r) =>
    r.playerId === playerId ? { ...r, bucketState: targetBucket } : r,
  )
  const collegeSlotsFilled = projected.filter(
    (r) => r.bucketState === 'devy' || (r.bucketState === 'campus_starter' && r.playerSide === 'campus'),
  ).length
  const collegeSlotsGraduatedInCollege = projected.filter(
    (r) =>
      (r.bucketState === 'devy' || r.bucketState === 'campus_starter') &&
      r.classYear === 'graduated',
  ).length
  const taxiCount = projected.filter((r) => r.bucketState === 'taxi').length
  const proRosterCount = projected.filter(
    (r) =>
      r.bucketState === 'canton_starter' ||
      r.bucketState === 'bench' ||
      r.bucketState === 'ir',
  ).length
  const legality = validateC2CRosterSlots({
    config: {
      collegeRosterSize: cfg.devySlots ?? undefined,
      taxiSize: cfg.taxiSlots ?? undefined,
      proBenchSize: cfg.benchSlots ?? undefined,
      proIRSize: cfg.irSlots ?? undefined,
    } as never,
    collegeSlotsFilled,
    collegeSlotsGraduatedInCollege,
    proRosterCount,
    taxiCount,
  })
  if (!legality.legal) {
    throw new Error(`Illegal C2C roster: ${legality.errors.join(' ')}`)
  }

  return prisma.c2CPlayerState.update({
    where: { leagueId_rosterId_playerId: { leagueId, rosterId, playerId } },
    data: { bucketState: targetBucket, scoringEligibility },
  })
}

export async function validateLineup(leagueId: string, rosterId: string): Promise<LineupValidationResult> {
  const cfg = await prisma.c2CLeague.findUnique({ where: { leagueId } })
  if (!cfg) return { valid: false, errors: ['C2C league not found'] }

  const rows = await prisma.c2CPlayerState.findMany({ where: { leagueId, rosterId } })
  const errors: string[] = []

  const campusStarters = rows.filter((r) => r.bucketState === 'campus_starter' && r.playerSide === 'campus')
  const cantonStarters = rows.filter((r) => r.bucketState === 'canton_starter' && r.playerSide === 'canton')

  if (campusStarters.length !== cfg.campusStarterSlots) {
    errors.push(`Campus starters: need ${cfg.campusStarterSlots}, have ${campusStarters.length}`)
  }
  if (cantonStarters.length !== cfg.cantonStarterSlots) {
    errors.push(`Canton starters: need ${cfg.cantonStarterSlots}, have ${cantonStarters.length}`)
  }

  for (const r of rows) {
    if (r.playerSide === 'campus' && r.bucketState === 'canton_starter') {
      errors.push('Campus player in canton starter slot')
    }
    if (r.playerSide === 'canton' && r.bucketState === 'campus_starter') {
      errors.push('Canton player in campus starter slot')
    }
    if (!cfg.devyScoringEnabled && r.bucketState === 'devy' && r.playerType === 'campus_devy') {
      /* stash-only — allowed */
    }
  }

  return { valid: errors.length === 0, errors }
}

