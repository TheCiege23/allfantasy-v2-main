import type { Prisma } from '@prisma/client'
import { getSalaryCapConfig } from './SalaryCapLeagueConfig'
import { getEffectiveCap } from './CapCalculationService'
import type { SalaryCapConfig } from './types'

export const tradeContractSelect = {
  id: true, configId: true, rosterId: true, playerId: true, salary: true,
  yearSigned: true, yearsTotal: true, contractYear: true, status: true, deadMoneyRemaining: true,
} as const
export type TradeContractState = Prisma.PlayerContractGetPayload<{ select: typeof tradeContractSelect }>
export type ContractMove = { playerId: string; fromRosterId: string; toRosterId: string }
export type SalarySettlementEvidence = { before: TradeContractState[]; after: TradeContractState[] }
const statuses = ['active', 'tagged', 'option_exercised', 'cut']

export class SalaryCapSettlementRefused extends Error {
  constructor(message: string) { super(message); this.name = 'SalaryCapSettlementRefused' }
}

export async function readTradeContracts(db: Prisma.TransactionClient, leagueId: string, configId: string, rosterIds: string[]) {
  return db.playerContract.findMany({
    where: { leagueId, configId, rosterId: { in: rosterIds }, status: { in: statuses } },
    select: tradeContractSelect, orderBy: { id: 'asc' },
  })
}

/** All participants are projected together; pairwise checks misprice multi-team salary swaps. */
async function validateAndRefreshLedgers(
  tx: Prisma.TransactionClient, config: SalaryCapConfig, rosterIds: string[], contracts: TradeContractState[],
) {
  const capYear = config.season ?? new Date().getFullYear()
  if (!Number.isInteger(capYear) || capYear < 1900 || capYear > 3000
    || !Number.isFinite(config.startupCap) || config.startupCap < 0
    || !Number.isFinite(config.capGrowthPercent) || config.capGrowthPercent < -100
    || (config.capFloorEnabled && config.capFloorAmount != null
      && (!Number.isFinite(config.capFloorAmount) || config.capFloorAmount < 0))) {
    throw new SalaryCapSettlementRefused('Salary cap rules are invalid; trade cannot be processed')
  }
  const deadYears: number[] = []
  for (const c of contracts) {
    if (!Number.isSafeInteger(c.salary) || c.salary < 0 || !Number.isInteger(c.yearSigned)
      || !Number.isInteger(c.yearsTotal) || c.yearsTotal < 1) {
      throw new SalaryCapSettlementRefused('Stored contract terms are invalid; trade cannot be processed')
    }
    if (c.status === 'cut' && c.deadMoneyRemaining != null) {
      if (typeof c.deadMoneyRemaining !== 'object' || Array.isArray(c.deadMoneyRemaining)) {
        throw new SalaryCapSettlementRefused('Stored dead money is invalid; trade cannot be processed')
      }
      for (const [year, amount] of Object.entries(c.deadMoneyRemaining)) {
        if (!/^\d{4}$/.test(year) || !Number.isInteger(Number(year))
          || typeof amount !== 'number' || !Number.isSafeInteger(amount) || amount < 0) {
          throw new SalaryCapSettlementRefused('Stored dead money is invalid; trade cannot be processed')
        }
        deadYears.push(Number(year))
      }
    }
  }
  const lastYear = Math.max(capYear, ...contracts.filter(c => c.status !== 'cut')
    .map(c => c.yearSigned + c.yearsTotal - 1), ...deadYears)
  if (lastYear - capYear > 50) throw new SalaryCapSettlementRefused('Contract horizon is invalid; trade cannot be processed')
  const ledgers = await tx.salaryCapTeamLedger.findMany({
    where: { configId: config.configId, rosterId: { in: rosterIds }, capYear: { gte: capYear, lte: lastYear } },
    select: { leagueId: true, rosterId: true, capYear: true, rolloverUsed: true },
  })
  if (ledgers.some(l => l.leagueId !== config.leagueId)) throw new SalaryCapSettlementRefused('Salary ledger league mismatch')
  const rolloverByYear = new Map(ledgers.map(l => [`${l.rosterId}:${l.capYear}`, l.rolloverUsed]))
  const rows = []
  for (let year = capYear; year <= lastYear; year++) {
    for (const rosterId of rosterIds) {
      const owned = contracts.filter(c => c.rosterId === rosterId)
      const totalCapHit = owned.filter(c => c.status !== 'cut' && c.yearSigned <= year
        && c.yearSigned + c.yearsTotal > year).reduce((sum, c) => sum + c.salary, 0)
      const deadMoneyHit = owned.filter(c => c.status === 'cut').reduce((sum, c) => {
        const money = c.deadMoneyRemaining as Record<string, number> | null
        return sum + (money?.[String(year)] ?? 0)
      }, 0)
      const where = { configId_rosterId_capYear: { configId: config.configId, rosterId, capYear: year } }
      const rolloverUsed = rolloverByYear.get(`${rosterId}:${year}`) ?? 0
      if (!Number.isSafeInteger(rolloverUsed) || rolloverUsed < 0) throw new SalaryCapSettlementRefused('Stored rollover is invalid')
      const cap = getEffectiveCap(config, year, rolloverUsed)
      const total = totalCapHit + deadMoneyHit
      if (!Number.isSafeInteger(cap) || !Number.isSafeInteger(total) || total > cap) {
        throw new SalaryCapSettlementRefused(`Salary cap: roster ${rosterId} would exceed its cap in ${year}`)
      }
      if (config.capFloorEnabled && config.capFloorAmount != null && total < config.capFloorAmount) {
        throw new SalaryCapSettlementRefused(`Salary cap: roster ${rosterId} would fall below its cap floor in ${year}`)
      }
      rows.push({ where, rosterId, capYear: year, totalCapHit, deadMoneyHit, rolloverUsed, capSpace: cap - total })
    }
  }
  // No ledger writes until every participant and commitment year has passed.
  for (const { where, ...row } of rows) {
    await tx.salaryCapTeamLedger.upsert({ where,
      create: { ...row, leagueId: config.leagueId, configId: config.configId },
      update: { totalCapHit: row.totalCapHit, deadMoneyHit: row.deadMoneyHit, capSpace: row.capSpace },
    })
  }
}

/** Runs only inside the same transaction as roster moves and the execution snapshot. */
export async function settleTradeContracts(
  tx: Prisma.TransactionClient, leagueId: string, rosterIds: string[], moves: ContractMove[],
): Promise<SalarySettlementEvidence | undefined> {
  const config = await getSalaryCapConfig(leagueId, tx)
  if (!config) return undefined
  if (!config.configId) throw new SalaryCapSettlementRefused('Persist salary cap rules before processing a trade')
  const all = await tx.playerContract.findMany({
    where: { leagueId, configId: config.configId, status: { in: statuses },
      OR: [{ rosterId: { in: rosterIds } }, { playerId: { in: moves.map(m => m.playerId) } }] },
    select: tradeContractSelect, orderBy: { id: 'asc' },
  })
  const before = all.filter(c => rosterIds.includes(c.rosterId))
  const after = before.map(c => ({ ...c }))
  const seen = new Set<string>()
  const year = config.season ?? new Date().getFullYear()
  for (const move of moves) {
    if (!move.playerId || move.fromRosterId === move.toRosterId
      || !rosterIds.includes(move.fromRosterId) || !rosterIds.includes(move.toRosterId)
      || seen.has(move.playerId)) throw new SalaryCapSettlementRefused('Invalid or repeated salary contract transfer')
    const matches = all.filter(c => c.playerId === move.playerId && c.status !== 'cut'
      && c.yearSigned <= year && c.yearSigned + c.yearsTotal > year)
    if (matches.length !== 1 || matches[0].rosterId !== move.fromRosterId) {
      throw new SalaryCapSettlementRefused(`Player ${move.playerId} must have exactly one owned, unexpired salary contract`)
    }
    seen.add(move.playerId)
    after.find(c => c.id === matches[0].id)!.rosterId = move.toRosterId
  }
  await validateAndRefreshLedgers(tx, config, rosterIds, after)
  for (const original of before) {
    const next = after.find(c => c.id === original.id)!
    if (original.rosterId === next.rosterId) continue
    const updated = await tx.playerContract.updateMany({
      where: { id: original.id, leagueId, configId: config.configId, rosterId: original.rosterId,
        playerId: original.playerId, status: original.status, salary: original.salary,
        yearSigned: original.yearSigned, yearsTotal: original.yearsTotal, contractYear: original.contractYear },
      data: { rosterId: next.rosterId },
    })
    if (updated.count !== 1) throw new SalaryCapSettlementRefused('Salary contract changed during trade processing')
  }
  return { before, after }
}

/** Stable comparison catches a later extension, cut, acquisition or contract transfer. */
export function contractStateFingerprint(contracts: TradeContractState[]): string {
  return JSON.stringify([...contracts].sort((a, b) => a.id.localeCompare(b.id)).map(c => ({
    ...c, deadMoneyRemaining: c.deadMoneyRemaining && typeof c.deadMoneyRemaining === 'object'
      ? Object.fromEntries(Object.entries(c.deadMoneyRemaining).sort(([a], [b]) => a.localeCompare(b))) : c.deadMoneyRemaining,
  })))
}
