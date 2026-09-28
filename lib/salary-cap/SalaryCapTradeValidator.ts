/**
 * Trade validation for Salary Cap: cap legality both sides, future cap (PROMPT 339). Deterministic only.
 * Integrate with existing trade engine: call before accepting; AI explanation layer only after this.
 */

import { getSalaryCapConfig } from './SalaryCapLeagueConfig'
import { getTotalCapHitForRoster, getEffectiveCap } from './CapCalculationService'
import { prisma } from '@/lib/prisma'
import type { TradeCapImpact } from './types'

export interface TradeCapValidationInput {
  fromRosterId: string
  toRosterId: string
  /** Contract IDs (or player IDs) and salaries moving from fromRosterId to toRosterId. */
  movingToReceiver: { contractId?: string; playerId: string; salary: number }[]
  /** Contract IDs moving from toRosterId to fromRosterId (if any). */
  movingToSender: { contractId?: string; playerId: string; salary: number }[]
}

/**
 * Validate trade for cap: both rosters must remain legal now and in future years.
 * Returns cap impact and legality flags.
 */
export async function validateTradeCap(
  leagueId: string,
  input: TradeCapValidationInput
): Promise<TradeCapImpact> {
  const config = await getSalaryCapConfig(leagueId)
  const errors: string[] = []
  if (!config) {
    return {
      fromRosterId: input.fromRosterId,
      toRosterId: input.toRosterId,
      fromCapHitDelta: 0,
      toCapHitDelta: 0,
      fromLegal: false,
      toLegal: false,
      fromFutureLegal: false,
      toFutureLegal: false,
      errors: ['Not a salary cap league'],
    }
  }
  const invalid = (message: string): TradeCapImpact => ({
    fromRosterId: input.fromRosterId, toRosterId: input.toRosterId,
    fromCapHitDelta: 0, toCapHitDelta: 0, fromLegal: false, toLegal: false,
    fromFutureLegal: false, toFutureLegal: false, errors: [message],
  })
  if (!config.configId) return invalid('Salary cap configuration is not persisted')
  if (!input.fromRosterId || !input.toRosterId || input.fromRosterId === input.toRosterId) {
    return invalid('Trade must involve two distinct rosters')
  }
  const ids = [input.fromRosterId, input.toRosterId]
  const [teams, rosters] = await Promise.all([
    prisma.leagueTeam.findMany({ where: { leagueId, OR: [{ id: { in: ids } }, { externalId: { in: ids } }] },
      select: { id: true, externalId: true } }),
    prisma.roster.findMany({ where: { leagueId, OR: [{ id: { in: ids } }, { platformUserId: { in: ids } }] },
      select: { id: true, platformUserId: true } }),
  ])
  const knownIds = new Set([...teams.flatMap((team) => [team.id, team.externalId]),
    ...rosters.flatMap((roster) => [roster.id, roster.platformUserId])])
  if (ids.some((id) => !knownIds.has(id))) return invalid('Both rosters must belong to this league')
  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { season: true } })
  const capYear = league?.season ?? new Date().getFullYear()
  const contracts = await prisma.playerContract.findMany({
    where: { leagueId, configId: config.configId,
      rosterId: { in: [input.fromRosterId, input.toRosterId] },
      status: { in: ['active', 'tagged', 'option_exercised', 'cut'] } },
    select: { id: true, rosterId: true, playerId: true, salary: true, yearSigned: true, yearsTotal: true,
      status: true, deadMoneyRemaining: true },
  })
  if (contracts.some((c) => !Number.isFinite(c.salary) || c.salary < 0
    || !Number.isInteger(c.yearSigned) || !Number.isInteger(c.yearsTotal) || c.yearsTotal < 1)) {
    return invalid('Stored contract terms are invalid; cap legality cannot be verified')
  }
  const seen = new Set<string>()
  const resolve = (lines: TradeCapValidationInput['movingToReceiver'], rosterId: string) => {
    return lines.flatMap((line) => {
      const matches = contracts.filter((contract) => contract.status !== 'cut' && contract.rosterId === rosterId
        && contract.playerId === line.playerId && (!line.contractId || contract.id === line.contractId)
        && contract.yearSigned <= capYear && contract.yearSigned + contract.yearsTotal > capYear)
      if (matches.length !== 1 || seen.has(matches[0]?.id)) {
        errors.push(`Player ${line.playerId} must have one owned, unexpired contract and appear only once`)
        return []
      }
      const contract = matches[0]
      seen.add(contract.id)
      return [contract]
    })
  }
  const sending = resolve(input.movingToReceiver, input.fromRosterId)
  const receiving = resolve(input.movingToSender, input.toRosterId)
  if (errors.length) return { ...invalid(errors[0]), errors }
  // Only stored salaries count. A submitted salary cannot change cap legality.
  const deltaIn = (year: number) => receiving.filter((c) => c.yearSigned + c.yearsTotal > year)
    .reduce((sum, c) => sum + c.salary, 0) - sending.filter((c) => c.yearSigned + c.yearsTotal > year)
    .reduce((sum, c) => sum + c.salary, 0)
  const deadMoneyYears = contracts.filter((c) => c.status === 'cut').flatMap((c) =>
    c.deadMoneyRemaining && typeof c.deadMoneyRemaining === 'object'
      ? Object.keys(c.deadMoneyRemaining).map(Number).filter(Number.isInteger) : [])
  const lastYear = Math.max(capYear, ...contracts.filter((c) => c.status !== 'cut')
    .map((c) => c.yearSigned + c.yearsTotal - 1), ...deadMoneyYears)
  if (lastYear - capYear > 50) return invalid('Contract horizon is invalid; cap legality cannot be verified')
  const years: NonNullable<TradeCapImpact['years']> = []
  for (let year = capYear; year <= lastYear; year++) {
    const results = await Promise.all([input.fromRosterId, input.toRosterId].map(async (rosterId) => {
      const [hit, ledger] = await Promise.all([
        getTotalCapHitForRoster(config.configId, rosterId, year),
        prisma.salaryCapTeamLedger.findUnique({
          where: { configId_rosterId_capYear: { configId: config.configId, rosterId, capYear: year } },
          select: { rolloverUsed: true },
        }),
      ])
      const delta = rosterId === input.fromRosterId ? deltaIn(year) : -deltaIn(year)
      const cap = getEffectiveCap(config, year, ledger?.rolloverUsed ?? 0)
      const total = hit.totalCapHit + hit.deadMoneyHit + delta
      const legal = total <= cap && (!config.capFloorEnabled || config.capFloorAmount == null || total >= config.capFloorAmount)
      if (!legal) errors.push(`${rosterId === input.fromRosterId ? 'Sender' : 'Receiver'} would be over cap or under floor in ${year}`)
      return { total, cap, legal }
    }))
    years.push({ capYear: year, fromCapHit: results[0].total, toCapHit: results[1].total,
      fromCap: results[0].cap, toCap: results[1].cap, fromLegal: results[0].legal, toLegal: results[1].legal })
  }
  return {
    fromRosterId: input.fromRosterId,
    toRosterId: input.toRosterId,
    fromCapHitDelta: deltaIn(capYear),
    toCapHitDelta: -deltaIn(capYear),
    fromLegal: years[0].fromLegal,
    toLegal: years[0].toLegal,
    fromFutureLegal: years.every((year) => year.fromLegal),
    toFutureLegal: years.every((year) => year.toLegal),
    years,
    errors,
  }
}
