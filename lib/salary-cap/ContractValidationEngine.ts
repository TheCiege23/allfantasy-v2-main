/**
 * Contract validation: bid legality, roster size, contract length, cap (PROMPT 339). Deterministic only.
 */

import { getSalaryCapConfig } from './SalaryCapLeagueConfig'
import { getOrCreateLedger } from './CapCalculationService'
import type { ContractBidInput } from './types'

interface ValidationResult {
  valid: boolean
  errors: string[]
}

/** Validate a contract bid (waiver/FA): salary, years, cap room. */
export async function validateContractBid(
  leagueId: string,
  bid: ContractBidInput
): Promise<ValidationResult> {
  const config = await getSalaryCapConfig(leagueId)
  if (!config) return { valid: false, errors: ['Not a salary cap league'] }
  const errors: string[] = []
  if (bid.salary < config.minimumSalary) {
    errors.push(`Salary below minimum ${config.minimumSalary}`)
  }
  if (bid.years < config.contractMinYears || bid.years > config.contractMaxYears) {
    errors.push(`Years must be ${config.contractMinYears}-${config.contractMaxYears}`)
  }
  const capYear = new Date().getFullYear()
  const ledger = await getOrCreateLedger(config, bid.rosterId, capYear)
  if (bid.salary > ledger.capSpace) {
    errors.push(`Insufficient cap space (have ${ledger.capSpace}, bid ${bid.salary})`)
  }
  return {
    valid: errors.length === 0,
    errors,
  }
}

/** Validate auction bid during startup: budget and holdback. */
export async function validateAuctionBid(
  leagueId: string,
  rosterId: string,
  bidAmount: number,
  contractYears: number
): Promise<ValidationResult> {
  const config = await getSalaryCapConfig(leagueId)
  if (!config) return { valid: false, errors: ['Not a salary cap league'] }
  const errors: string[] = []
  if (contractYears < config.contractMinYears || contractYears > config.contractMaxYears) {
    errors.push(`Years must be ${config.contractMinYears}-${config.contractMaxYears}`)
  }
  const capYear = new Date().getFullYear()
  const ledger = await getOrCreateLedger(config, rosterId, capYear)
  const minReserve = config.auctionHoldback
  if (ledger.capSpace - bidAmount < minReserve) {
    errors.push(`Must retain at least ${minReserve} cap (holdback)`)
  }
  if (bidAmount > ledger.capSpace) {
    errors.push(`Bid exceeds cap space ${ledger.capSpace}`)
  }
  return {
    valid: errors.length === 0,
    errors,
  }
}
