import { prisma } from '@/lib/prisma'
import type { IDPDeadMoney, IDPSalaryRecord, Prisma } from '@prisma/client'

export type CapSummary = {
  totalCap: number
  activeSalary: number
  deadMoney: number
  totalCapUsed: number
  availableCap: number
  capFloorRequired?: number
  isCapCompliant: boolean
  holdbackReserved: number
  /** Spendable room after in-season holdback (for new salary). */
  effectiveSpendableCap: number
}

const ACTIVE_STATUSES = ['active', 'franchise_tagged'] as const

function contractEndYear(rec: Pick<IDPSalaryRecord, 'contractStartYear' | 'contractYears'>): number {
  return rec.contractStartYear + rec.contractYears - 1
}

function isSalaryActiveInSeason(
  rec: Pick<IDPSalaryRecord, 'status' | 'contractStartYear' | 'contractYears'>,
  season: number,
): boolean {
  if (!ACTIVE_STATUSES.includes(rec.status as (typeof ACTIVE_STATUSES)[number])) return false
  return rec.contractStartYear <= season && season <= contractEndYear(rec)
}

/**
 * Either the module-level client or a caller's transaction. Cap reads that feed a settlement
 * decision must be able to run on the settlement's own transaction — see
 * `validateRedraftTradeCapInTransaction`.
 */
type CapDb = Prisma.TransactionClient | typeof prisma

export async function getTeamCapSummary(
  leagueId: string,
  rosterId: string,
  season: number,
  /** Optional, defaulting to `prisma`, so every existing three-argument caller is unchanged. */
  db: CapDb = prisma,
): Promise<CapSummary> {
  const cfg = await db.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) {
    throw new Error('No IDP cap configuration for this league')
  }

  const salaryRows = await db.iDPSalaryRecord.findMany({
    where: { leagueId, rosterId, status: { in: [...ACTIVE_STATUSES] } },
  })
  let activeSalary = 0
  for (const r of salaryRows) {
    if (isSalaryActiveInSeason(r, season)) activeSalary += r.salary
  }

  const deadRows = await db.iDPDeadMoney.findMany({
    where: { leagueId, rosterId, season },
  })
  const deadMoney = deadRows.reduce((s, d) => s + d.currentYearDead, 0)

  const totalCap = cfg.totalCap
  const totalCapUsed = activeSalary + deadMoney
  const availableCap = totalCap - totalCapUsed
  const holdbackReserved = cfg.inSeasonHoldbackEnabled ? totalCap * cfg.inSeasonHoldbackPct : 0
  const effectiveSpendableCap = Math.max(0, availableCap - holdbackReserved)

  const capFloorRequired =
    cfg.capFloorEnabled && cfg.capFloor != null ? totalCap * cfg.capFloor : undefined

  let isCapCompliant = totalCapUsed <= totalCap
  if (isCapCompliant && capFloorRequired != null) {
    isCapCompliant = totalCapUsed >= capFloorRequired
  }

  return {
    totalCap,
    activeSalary,
    deadMoney,
    totalCapUsed,
    availableCap,
    capFloorRequired,
    isCapCompliant,
    holdbackReserved,
    effectiveSpendableCap,
  }
}

export async function validateCapCompliance(
  leagueId: string,
  rosterId: string,
  proposedSalary: number,
  season: number,
): Promise<{ compliant: boolean; overage?: number; message?: string }> {
  const summary = await getTeamCapSummary(leagueId, rosterId, season)
  if (proposedSalary <= summary.effectiveSpendableCap) {
    return { compliant: true }
  }
  const overage = proposedSalary - summary.effectiveSpendableCap
  return {
    compliant: false,
    overage,
    message: `Insufficient cap room (need ${proposedSalary.toFixed(2)}, have ${summary.effectiveSpendableCap.toFixed(2)} effective).`,
  }
}

export function calculateSnakeScaleSalary(
  pickNumber: number,
  totalPicks: number,
  highSalary: number,
  lowSalary: number,
  curve: string,
): number {
  if (totalPicks < 2) return highSalary
  const p = Math.min(Math.max(pickNumber, 1), totalPicks)

  if (curve === 'linear') {
    return highSalary - ((p - 1) / (totalPicks - 1)) * (highSalary - lowSalary)
  }

  if (curve === 'logarithmic') {
    const t = (p - 1) / (totalPicks - 1)
    const logT = Math.log(1 + t * 9) / Math.log(10)
    return highSalary - logT * (highSalary - lowSalary)
  }

  if (curve === 'stepped') {
    const bracket = (n: number) => {
      if (n <= 10) return 0
      if (n <= 30) return 1
      if (n <= 60) return 2
      return 3
    }
    const b0 = bracket(1)
    const b1 = bracket(p)
    const steps = 4
    const stepHigh = highSalary - (b0 / steps) * (highSalary - lowSalary)
    const stepLow = highSalary - ((b1 + 1) / steps) * (highSalary - lowSalary)
    return Math.max(lowSalary, (stepHigh + stepLow) / 2)
  }

  return highSalary - ((p - 1) / (totalPicks - 1)) * (highSalary - lowSalary)
}

export async function refreshCapProjections(leagueId: string, rosterId: string): Promise<void> {
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) return

  const baseSeason = cfg.season
  const salaryRows = await prisma.iDPSalaryRecord.findMany({
    where: { leagueId, rosterId, status: { in: [...ACTIVE_STATUSES] } },
  })

  const deadRows = await prisma.iDPDeadMoney.findMany({ where: { leagueId, rosterId } })

  for (let i = 0; i < 5; i++) {
    const projectionYear = baseSeason + i
    let committedSalary = 0
    for (const r of salaryRows) {
      if (isSalaryActiveInSeason(r, projectionYear)) committedSalary += r.salary
    }

    let deadCapHits = 0
    for (const d of deadRows) {
      if (d.season === projectionYear) deadCapHits += d.currentYearDead
      else if (d.season < projectionYear && d.futureYearsDead > 0) {
        const span = Math.max(0, d.yearsRemainingAtCut - 1)
        if (span > 0) {
          const per = d.futureYearsDead / span
          const y = projectionYear - d.season
          if (y >= 1 && y <= span) deadCapHits += per
        }
      }
    }

    const totalCapUsed = committedSalary + deadCapHits
    const availableCap = cfg.totalCap - totalCapUsed

    await prisma.iDPCapProjection.upsert({
      where: {
        leagueId_rosterId_projectionYear: { leagueId, rosterId, projectionYear },
      },
      create: {
        leagueId,
        rosterId,
        projectionYear,
        committedSalary,
        deadCapHits,
        totalCapUsed,
        availableCap,
      },
      update: {
        committedSalary,
        deadCapHits,
        totalCapUsed,
        availableCap,
      },
    })
  }
}

async function appendCapTransaction(input: {
  leagueId: string
  rosterId: string
  playerId: string
  playerName: string
  isDefensive: boolean
  transactionType: string
  salary: number
  contractYears?: number
  deadMoneyCreated?: number
  capImpact: number
  notes?: string
  season: number
  week?: number
}) {
  await prisma.iDPCapTransaction.create({
    data: {
      leagueId: input.leagueId,
      rosterId: input.rosterId,
      playerId: input.playerId,
      playerName: input.playerName,
      isDefensive: input.isDefensive,
      transactionType: input.transactionType,
      salary: input.salary,
      contractYears: input.contractYears,
      deadMoneyCreated: input.deadMoneyCreated ?? 0,
      capImpact: input.capImpact,
      notes: input.notes,
      season: input.season,
      week: input.week,
    },
  })
}

export async function assignDraftSalary(
  leagueId: string,
  rosterId: string,
  playerId: string,
  playerName: string,
  position: string,
  isDefensive: boolean,
  draftMethod: string,
  draftValue: number,
  contractYears: number,
  acquisitionMethod: string,
  season?: number,
): Promise<IDPSalaryRecord> {
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('No IDP cap configuration for this league')

  const capYear = season ?? cfg.season
  const v = await validateCapCompliance(leagueId, rosterId, draftValue, capYear)
  if (!v.compliant) {
    throw new Error(v.message ?? 'Cap compliance check failed')
  }

  const txType =
    acquisitionMethod === 'waiver'
      ? 'waiver_assign'
      : draftMethod === 'auction' || acquisitionMethod === 'auction'
        ? 'auction_win'
        : draftMethod === 'manual'
          ? 'salary_correction'
          : 'draft_assign'

  const record = await prisma.iDPSalaryRecord.create({
    data: {
      leagueId,
      rosterId,
      playerId,
      playerName,
      position,
      isDefensive,
      salary: draftValue,
      contractYears,
      yearsRemaining: contractYears,
      contractStartYear: capYear,
      status: 'active',
      acquisitionMethod,
    },
  })

  await appendCapTransaction({
    leagueId,
    rosterId,
    playerId,
    playerName,
    isDefensive,
    transactionType: txType,
    salary: draftValue,
    contractYears,
    capImpact: draftValue,
    season: capYear,
    notes: `assignDraftSalary draftMethod=${draftMethod}`,
  })

  await refreshCapProjections(leagueId, rosterId)
  return record
}

export async function processPlayerCut(
  leagueId: string,
  rosterId: string,
  salaryRecordId: string,
  reason?: string,
): Promise<IDPDeadMoney> {
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('No IDP cap configuration for this league')

  const rec = await prisma.iDPSalaryRecord.findFirst({
    where: { id: salaryRecordId, leagueId, rosterId },
  })
  if (!rec) throw new Error('Salary record not found')

  const yr = rec.yearsRemaining
  const currentYearDead = rec.salary
  const futureYearsDead = rec.salary * 0.25 * Math.max(0, yr - 1)
  const totalDeadMoney = currentYearDead + futureYearsDead

  const dead = await prisma.iDPDeadMoney.create({
    data: {
      leagueId,
      rosterId,
      salaryRecordId: rec.id,
      playerId: rec.playerId,
      playerName: rec.playerName,
      reason: reason ?? 'cut',
      currentYearDead,
      futureYearsDead,
      totalDeadMoney,
      yearsRemainingAtCut: yr,
      season: cfg.season,
    },
  })

  await prisma.iDPSalaryRecord.update({
    where: { id: rec.id },
    data: { status: 'cut', cutPenaltyCurrent: totalDeadMoney },
  })

  await appendCapTransaction({
    leagueId,
    rosterId,
    playerId: rec.playerId,
    playerName: rec.playerName,
    isDefensive: rec.isDefensive,
    transactionType: 'cut',
    salary: rec.salary,
    contractYears: rec.yearsRemaining,
    deadMoneyCreated: totalDeadMoney,
    capImpact: -rec.salary,
    notes: reason,
    season: cfg.season,
  })

  await refreshCapProjections(leagueId, rosterId)
  return dead
}

export async function processExtension(
  leagueId: string,
  rosterId: string,
  salaryRecordId: string,
  additionalYears: number,
): Promise<IDPSalaryRecord> {
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('No IDP cap configuration for this league')

  const rec = await prisma.iDPSalaryRecord.findFirst({
    where: { id: salaryRecordId, leagueId, rosterId, status: { in: [...ACTIVE_STATUSES] } },
  })
  if (!rec) throw new Error('Active salary record not found')

  const oldSalary = rec.salary
  const newSalary = rec.salary * (1 + rec.extensionBoostPct)
  const summary = await getTeamCapSummary(leagueId, rosterId, cfg.season)
  const projectedUsed = summary.totalCapUsed - oldSalary + newSalary
  const hold = cfg.inSeasonHoldbackEnabled ? cfg.totalCap * cfg.inSeasonHoldbackPct : 0
  if (projectedUsed > cfg.totalCap + 1e-6) {
    throw new Error('Extension would exceed salary cap')
  }
  if (projectedUsed > cfg.totalCap - hold + 1e-6 && cfg.inSeasonHoldbackEnabled) {
    throw new Error('Extension would violate in-season cap holdback')
  }

  const updated = await prisma.iDPSalaryRecord.update({
    where: { id: rec.id },
    data: {
      salary: newSalary,
      contractYears: rec.contractYears + additionalYears,
      yearsRemaining: rec.yearsRemaining + additionalYears,
      hasBeenExtended: true,
    },
  })

  await appendCapTransaction({
    leagueId,
    rosterId,
    playerId: rec.playerId,
    playerName: rec.playerName,
    isDefensive: rec.isDefensive,
    transactionType: 'extension',
    salary: newSalary,
    contractYears: updated.contractYears,
    capImpact: newSalary - oldSalary,
    season: cfg.season,
  })

  await refreshCapProjections(leagueId, rosterId)
  return updated
}

export async function processFranchiseTag(
  leagueId: string,
  rosterId: string,
  playerId: string,
  playerName: string,
  position: string,
  isDefensive: boolean,
): Promise<IDPSalaryRecord> {
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('No IDP cap configuration for this league')
  if (!cfg.franchiseTagEnabled) throw new Error('Franchise tag is disabled for this league')

  const tagSalary = cfg.franchiseTagValue
  const capYear = cfg.season

  const existing = await prisma.iDPSalaryRecord.findFirst({
    where: { leagueId, rosterId, playerId },
  })

  if (existing) {
    const summary = await getTeamCapSummary(leagueId, rosterId, capYear)
    const projectedUsed = summary.totalCapUsed - existing.salary + tagSalary
    const hold = cfg.inSeasonHoldbackEnabled ? cfg.totalCap * cfg.inSeasonHoldbackPct : 0
    if (projectedUsed > cfg.totalCap + 1e-6) throw new Error('Franchise tag exceeds cap')
    if (projectedUsed > cfg.totalCap - hold + 1e-6 && cfg.inSeasonHoldbackEnabled) {
      throw new Error('Franchise tag violates in-season cap holdback')
    }

    const updated = await prisma.iDPSalaryRecord.update({
      where: { id: existing.id },
      data: {
        salary: tagSalary,
        contractYears: 1,
        yearsRemaining: 1,
        contractStartYear: capYear,
        status: 'franchise_tagged',
        isFranchiseTagged: true,
        playerName,
        position,
        isDefensive,
        acquisitionMethod: 'extension',
      },
    })
    await appendCapTransaction({
      leagueId,
      rosterId,
      playerId,
      playerName,
      isDefensive,
      transactionType: 'franchise_tag',
      salary: tagSalary,
      contractYears: 1,
      capImpact: tagSalary - existing.salary,
      season: capYear,
    })
    await refreshCapProjections(leagueId, rosterId)
    return updated
  }

  const v = await validateCapCompliance(leagueId, rosterId, tagSalary, capYear)
  if (!v.compliant) throw new Error(v.message ?? 'Franchise tag exceeds cap')

  const created = await prisma.iDPSalaryRecord.create({
    data: {
      leagueId,
      rosterId,
      playerId,
      playerName,
      position,
      isDefensive,
      salary: tagSalary,
      contractYears: 1,
      yearsRemaining: 1,
      contractStartYear: capYear,
      status: 'franchise_tagged',
      acquisitionMethod: 'free_agent',
      isFranchiseTagged: true,
    },
  })

  await appendCapTransaction({
    leagueId,
    rosterId,
    playerId,
    playerName,
    isDefensive,
    transactionType: 'franchise_tag',
    salary: tagSalary,
    contractYears: 1,
    capImpact: tagSalary,
    season: capYear,
  })

  await refreshCapProjections(leagueId, rosterId)
  return created
}

export async function processTradeCapTransfer(
  leagueId: string,
  fromRosterId: string,
  toRosterId: string,
  salaryRecordId: string,
  options?: { skipComplianceCheck?: boolean },
): Promise<void> {
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) throw new Error('No IDP cap configuration for this league')

  const rec = await prisma.iDPSalaryRecord.findFirst({
    where: { id: salaryRecordId, leagueId, rosterId: fromRosterId },
  })
  if (!rec) throw new Error('Salary record not found on source roster')

  if (!options?.skipComplianceCheck) {
    const v = await validateCapCompliance(leagueId, toRosterId, rec.salary, cfg.season)
    if (!v.compliant) throw new Error(v.message ?? 'Receiving team cannot absorb salary')
  }

  await prisma.iDPSalaryRecord.update({
    where: { id: rec.id },
    data: { rosterId: toRosterId },
  })

  await appendCapTransaction({
    leagueId,
    rosterId: fromRosterId,
    playerId: rec.playerId,
    playerName: rec.playerName,
    isDefensive: rec.isDefensive,
    transactionType: 'trade_out',
    salary: rec.salary,
    contractYears: rec.yearsRemaining,
    capImpact: -rec.salary,
    season: cfg.season,
  })

  await appendCapTransaction({
    leagueId,
    rosterId: toRosterId,
    playerId: rec.playerId,
    playerName: rec.playerName,
    isDefensive: rec.isDefensive,
    transactionType: 'trade_in',
    salary: rec.salary,
    contractYears: rec.yearsRemaining,
    capImpact: rec.salary,
    season: cfg.season,
  })

  await refreshCapProjections(leagueId, fromRosterId)
  await refreshCapProjections(leagueId, toRosterId)
}

/** After a waiver claim is approved and the player is on the roster — assigns cap hit. */
export async function assignIdpCapSalaryForWaiverClaim(
  leagueId: string,
  rosterId: string,
  playerId: string,
  playerName: string,
  position: string,
  isDefensive: boolean,
  bidAmount: number | null | undefined,
): Promise<IDPSalaryRecord | null> {
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) return null

  const salary = bidAmount != null && bidAmount > 0 ? bidAmount : 1
  return assignDraftSalary(
    leagueId,
    rosterId,
    playerId,
    playerName,
    position,
    isDefensive,
    'waiver',
    salary,
    1,
    'waiver',
    cfg.season,
  )
}

type TradeOfferJson = unknown

function extractPlayerIdsFromOffers(offers: TradeOfferJson): string[] {
  if (!Array.isArray(offers)) return []
  const ids: string[] = []
  for (const o of offers) {
    if (typeof o === 'string') ids.push(o)
    else if (o && typeof o === 'object' && 'playerId' in o) {
      const pid = (o as { playerId?: string }).playerId
      if (typeof pid === 'string') ids.push(pid)
    }
  }
  return ids
}

export type RedraftTradeCapValidation = { ok: true } | { ok: false; message: string }

export async function validateRedraftTradeCap(
  leagueId: string,
  proposerRosterId: string,
  receiverRosterId: string,
  proposerOffers: TradeOfferJson,
  receiverOffers: TradeOfferJson,
): Promise<RedraftTradeCapValidation> {
  return validateRedraftTradeCapOn(prisma, leagueId, proposerRosterId, receiverRosterId, proposerOffers, receiverOffers)
}

/**
 * The same cap check, run on a CALLER-SUPPLIED transaction.
 *
 * 🛑 WHY THIS EXISTS. `/api/redraft/trade-votes` validated the cap BEFORE opening the settlement
 * transaction, then moved salary inside it. Between the two, another settlement or a cut/extension
 * could change either roster's committed salary, and the trade would settle on a verdict computed
 * against numbers that were no longer true — an over-cap roster the check had just "approved".
 *
 * #742 moved the cap TRANSFER inside the transaction and named this as the remaining gap. Running
 * the check on the same `tx`, after the proposal claim, means the numbers it reads are the numbers
 * the transfer then moves.
 *
 * ⚠ Every read goes through `db`, including `getTeamCapSummary`. A check that took its config from
 * the transaction and its salary totals from the module client would look transactional and not be.
 */
export async function validateRedraftTradeCapInTransaction(
  tx: Prisma.TransactionClient,
  leagueId: string,
  proposerRosterId: string,
  receiverRosterId: string,
  proposerOffers: TradeOfferJson,
  receiverOffers: TradeOfferJson,
): Promise<RedraftTradeCapValidation> {
  return validateRedraftTradeCapOn(tx, leagueId, proposerRosterId, receiverRosterId, proposerOffers, receiverOffers)
}

async function validateRedraftTradeCapOn(
  db: CapDb,
  leagueId: string,
  proposerRosterId: string,
  receiverRosterId: string,
  proposerOffers: TradeOfferJson,
  receiverOffers: TradeOfferJson,
): Promise<RedraftTradeCapValidation> {
  const cfg = await db.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) return { ok: true }

  /** Players the proposer is trading away */
  const proposerGives = extractPlayerIdsFromOffers(proposerOffers)
  /** Players the receiver is trading away (proposer receives) */
  const proposerGets = extractPlayerIdsFromOffers(receiverOffers)
  if (proposerGives.length === 0 && proposerGets.length === 0) return { ok: true }

  const season = cfg.season

  const proposerSummary = await getTeamCapSummary(leagueId, proposerRosterId, season, db)
  const receiverSummary = await getTeamCapSummary(leagueId, receiverRosterId, season, db)

  const salarySum = async (rosterId: string, playerIds: string[]) => {
    if (playerIds.length === 0) return 0
    const rows = await db.iDPSalaryRecord.findMany({
      where: {
        leagueId,
        rosterId,
        playerId: { in: playerIds },
        status: { in: [...ACTIVE_STATUSES] },
      },
    })
    return rows.reduce((s, r) => s + (isSalaryActiveInSeason(r, season) ? r.salary : 0), 0)
  }

  const giveFromProposer = await salarySum(proposerRosterId, proposerGives)
  const getFromReceiver = await salarySum(receiverRosterId, proposerGets)
  const giveFromReceiver = getFromReceiver
  const getFromProposer = giveFromProposer

  const proposerAfter = proposerSummary.totalCapUsed - giveFromProposer + getFromReceiver
  const receiverAfter = receiverSummary.totalCapUsed - giveFromReceiver + getFromProposer

  const hold = cfg.inSeasonHoldbackEnabled ? cfg.totalCap * cfg.inSeasonHoldbackPct : 0

  if (proposerAfter > cfg.totalCap + 1e-6) {
    return { ok: false, message: 'Trade would put proposer over the salary cap.' }
  }
  if (receiverAfter > cfg.totalCap + 1e-6) {
    return { ok: false, message: 'Trade would put receiver over the salary cap.' }
  }
  if (proposerAfter > cfg.totalCap - hold + 1e-6 && cfg.inSeasonHoldbackEnabled) {
    return { ok: false, message: 'Trade would violate in-season cap holdback (proposer).' }
  }
  if (receiverAfter > cfg.totalCap - hold + 1e-6 && cfg.inSeasonHoldbackEnabled) {
    return { ok: false, message: 'Trade would violate in-season cap holdback (receiver).' }
  }

  return { ok: true }
}

export async function applyRedraftTradeCapTransfers(
  leagueId: string,
  proposerRosterId: string,
  receiverRosterId: string,
  proposerOffers: TradeOfferJson,
  receiverOffers: TradeOfferJson,
): Promise<void> {
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) return

  const proposerGives = extractPlayerIdsFromOffers(proposerOffers)
  const proposerGets = extractPlayerIdsFromOffers(receiverOffers)

  type Move = { rec: IDPSalaryRecord; toRosterId: string }
  const moves: Move[] = []

  for (const pid of proposerGives) {
    const rec = await prisma.iDPSalaryRecord.findFirst({
      where: {
        leagueId,
        rosterId: proposerRosterId,
        playerId: pid,
        status: { in: [...ACTIVE_STATUSES] },
      },
    })
    if (rec) moves.push({ rec, toRosterId: receiverRosterId })
  }

  for (const pid of proposerGets) {
    const rec = await prisma.iDPSalaryRecord.findFirst({
      where: {
        leagueId,
        rosterId: receiverRosterId,
        playerId: pid,
        status: { in: [...ACTIVE_STATUSES] },
      },
    })
    if (rec) moves.push({ rec, toRosterId: proposerRosterId })
  }

  if (moves.length === 0) return

  await prisma.$transaction(async (tx) => {
    for (const { rec, toRosterId } of moves) {
      const fromRosterId = rec.rosterId
      await tx.iDPSalaryRecord.update({
        where: { id: rec.id },
        data: { rosterId: toRosterId },
      })
      await tx.iDPCapTransaction.create({
        data: {
          leagueId,
          rosterId: fromRosterId,
          playerId: rec.playerId,
          playerName: rec.playerName,
          isDefensive: rec.isDefensive,
          transactionType: 'trade_out',
          salary: rec.salary,
          contractYears: rec.yearsRemaining,
          deadMoneyCreated: 0,
          capImpact: -rec.salary,
          season: cfg.season,
        },
      })
      await tx.iDPCapTransaction.create({
        data: {
          leagueId,
          rosterId: toRosterId,
          playerId: rec.playerId,
          playerName: rec.playerName,
          isDefensive: rec.isDefensive,
          transactionType: 'trade_in',
          salary: rec.salary,
          contractYears: rec.yearsRemaining,
          deadMoneyCreated: 0,
          capImpact: rec.salary,
          season: cfg.season,
        },
      })
    }
  })

  const rosterIds = new Set<string>([proposerRosterId, receiverRosterId])
  for (const r of rosterIds) {
    await refreshCapProjections(leagueId, r)
  }
}

export type RedraftTradeCapTransferResult = {
  /** IDP salary records actually moved. 0 for a league with no `IDPCapConfig`. */
  moved: number
  /** `IDPCapTransaction` row ids created here, in creation order (trade_out, trade_in per move). */
  transactionIds: string[]
}

/**
 * The same cap transfer as `applyRedraftTradeCapTransfers`, run on a CALLER-SUPPLIED transaction.
 *
 * 🛑 WHY THIS EXISTS. The non-transactional version opens its own `$transaction`, so the cap moves
 * are atomic among themselves and atomic with NOTHING ELSE. `/api/redraft/trade-votes` called it
 * before opening the transaction that claims the proposal and moves rosters, which left two real
 * failure modes:
 *
 *  - **Half-applied settlement.** Cap transfer commits, then `settleRedraftTradeAssets` throws
 *    (bad ownership, insufficient FAAB) or the claim loses its race. The salary records have already
 *    moved and nothing rolls them back: IDP cap says the trade happened, the rosters say it did not.
 *  - **Double-applied cap.** Two racing finalizers (double-click, or vote-threshold against
 *    commissioner-approve) BOTH ran the cap transfer before either tried to claim the proposal,
 *    because the claim lived in the later transaction. One won the claim; the loser had already
 *    moved salary a second time and then returned 409.
 *
 * Called inside the settlement transaction AFTER the conditional claim, both close: the loser of the
 * race never reaches this function, and any later throw rolls the cap movement back with everything
 * else.
 *
 * ⚠ It does NOT refresh `IDPCapProjection`. That is a derived view, and recomputing it from inside
 * the transaction would write projections for a settlement that may still roll back. The caller
 * refreshes AFTER commit — see `refreshCapProjections`, which the non-transactional version calls
 * post-commit for exactly the same reason. Dropping that call is a silent regression: the ledger
 * (`IDPCapTransaction`) stays right and the projection goes stale, which nothing type-checks.
 *
 * ⚠ Rows are created one at a time rather than with `createMany` so each id can be returned. The
 * trade execution snapshot needs them for `dependencies.sourceTransactionIds`; that writer does not
 * exist yet, and the ids are returned now so it does not have to re-derive them later.
 */
export async function applyRedraftTradeCapTransfersInTransaction(
  tx: Prisma.TransactionClient,
  leagueId: string,
  proposerRosterId: string,
  receiverRosterId: string,
  proposerOffers: TradeOfferJson,
  receiverOffers: TradeOfferJson,
): Promise<RedraftTradeCapTransferResult> {
  const cfg = await tx.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) return { moved: 0, transactionIds: [] }

  const directions = [
    ...extractPlayerIdsFromOffers(proposerOffers).map((playerId) => ({
      playerId,
      fromRosterId: proposerRosterId,
      toRosterId: receiverRosterId,
    })),
    ...extractPlayerIdsFromOffers(receiverOffers).map((playerId) => ({
      playerId,
      fromRosterId: receiverRosterId,
      toRosterId: proposerRosterId,
    })),
  ]

  let moved = 0
  const transactionIds: string[] = []

  for (const direction of directions) {
    const rec = await tx.iDPSalaryRecord.findFirst({
      where: {
        leagueId,
        rosterId: direction.fromRosterId,
        playerId: direction.playerId,
        status: { in: [...ACTIVE_STATUSES] },
      },
    })
    if (!rec) continue

    await tx.iDPSalaryRecord.update({
      where: { id: rec.id },
      data: { rosterId: direction.toRosterId },
    })

    const tradeOut = await tx.iDPCapTransaction.create({
      data: {
        leagueId,
        rosterId: direction.fromRosterId,
        playerId: rec.playerId,
        playerName: rec.playerName,
        isDefensive: rec.isDefensive,
        transactionType: 'trade_out',
        salary: rec.salary,
        contractYears: rec.yearsRemaining,
        deadMoneyCreated: 0,
        capImpact: -rec.salary,
        season: cfg.season,
      },
    })
    const tradeIn = await tx.iDPCapTransaction.create({
      data: {
        leagueId,
        rosterId: direction.toRosterId,
        playerId: rec.playerId,
        playerName: rec.playerName,
        isDefensive: rec.isDefensive,
        transactionType: 'trade_in',
        salary: rec.salary,
        contractYears: rec.yearsRemaining,
        deadMoneyCreated: 0,
        capImpact: rec.salary,
        season: cfg.season,
      },
    })

    transactionIds.push(tradeOut.id, tradeIn.id)
    moved += 1
  }

  return { moved, transactionIds }
}

export async function expireContractsForNewSeason(
  leagueId: string,
  newSeason: number,
): Promise<{ expired: number }> {
  const cfg = await prisma.iDPCapConfig.findUnique({ where: { leagueId } })
  if (!cfg) return { expired: 0 }

  const previousSeason = newSeason - 1
  const candidates = await prisma.iDPSalaryRecord.findMany({
    where: {
      leagueId,
      status: 'active',
    },
  })

  let expired = 0
  for (const rec of candidates) {
    if (contractEndYear(rec) !== previousSeason) continue

    await prisma.iDPSalaryRecord.update({
      where: { id: rec.id },
      data: { status: 'expired', yearsRemaining: 0 },
    })

    await appendCapTransaction({
      leagueId,
      rosterId: rec.rosterId,
      playerId: rec.playerId,
      playerName: rec.playerName,
      isDefensive: rec.isDefensive,
      transactionType: 'contract_expired',
      salary: rec.salary,
      capImpact: -rec.salary,
      season: newSeason,
      notes: `Rolled from season ${previousSeason}`,
    })

    if (!cfg.isDynastyMode || !cfg.contractsCarryOver) {
      await prisma.redraftRosterPlayer.updateMany({
        where: { rosterId: rec.rosterId, playerId: rec.playerId, droppedAt: null },
        data: { droppedAt: new Date() },
      })
    }

    expired += 1
  }

  await prisma.iDPCapConfig.update({
    where: { leagueId },
    data: { season: newSeason },
  })

  return { expired }
}
