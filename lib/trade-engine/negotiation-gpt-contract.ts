import type { AcceptDriver, NegotiationToolkit } from './types'
import type { TradeDriverData } from './trade-engine'

type NegotiationGptContract = {
  acceptProb: number
  drivers: Array<{
    id: string
    direction: string
    strength: string
    value: number
    evidence: Record<string, unknown>
  }>
  constraints: {
    mustReferenceDriverIds: boolean
    noExternalNumbers: boolean
    maxCounters: number
    requireDownDriverForCounters: boolean
  }
}

type NegotiationGptOutput = {
  opener: string
  rationale: string
  fallback: string
  counters: Array<{
    description: string
    driverIds: string[]
  }>
}

type NegotiationValidationResult = {
  valid: boolean
  cleaned: NegotiationGptOutput | null
  violations: string[]
}

const BANNED_NEGOTIATION_PATTERNS = [
  /top[- ]?\d+\s+(WR|RB|QB|TE|K|DEF|DST|flex)/i,
  /\b(WR|RB|QB|TE)\d{1,2}\b/,
  /\b(elite|bust|sleeper|breakout|boom|stud)\b/i,
  /\bKTC\b/i,
  /\bKeepTradeCut\b/i,
  /\btrade value\b/i,
  /\bmarket value\b/i,
  /\bADP\b/,
  /\bECR\b/,
  /\bhistorical(ly)?\b/i,
  /\bage[- ]?\d+/i,
]

const PROB_PATTERN = /\d+(\.\d+)?%/

function collectAllowedNumbers(contract: NegotiationGptContract): Set<string> {
  const allowed = new Set<string>()
  for (const d of contract.drivers) {
    if (d.evidence && typeof d.evidence === 'object') {
      for (const val of Object.values(d.evidence)) {
        if (typeof val === 'number') {
          allowed.add(String(val))
          allowed.add(String(Math.round(val)))
          allowed.add(String(Math.abs(val)))
          allowed.add(String(Math.round(Math.abs(val))))
          allowed.add(val.toFixed(1))
          allowed.add(val.toFixed(2))
          allowed.add(Math.abs(val).toFixed(1))
          allowed.add(Math.abs(val).toFixed(2))
        }
      }
    }
  }
  if (contract.acceptProb != null) {
    const pct = Math.round(contract.acceptProb * 100)
    allowed.add(String(pct))
    allowed.add(String(contract.acceptProb))
  }
  return allowed
}

function extractNumbers(text: string): number[] {
  const matches = text.match(/\d+(\.\d+)?/g) || []
  return matches.map(Number)
}

export function shouldSkipNegotiationGpt(
  contract: NegotiationGptContract,
): 'ok' | 'INCOMPLETE_DRIVER_SET' {
  if (contract.drivers.length < 2) return 'INCOMPLETE_DRIVER_SET'
  return 'ok'
}

function hasDownDrivers(contract: NegotiationGptContract): boolean {
  return contract.drivers.some(d => d.direction === 'DOWN')
}

export function buildNegotiationGptContract(
  driverData: TradeDriverData,
): NegotiationGptContract {
  return {
    acceptProb: Math.round(driverData.acceptProbability * 1000) / 1000,
    drivers: driverData.acceptDrivers.map(d => ({
      id: d.id,
      direction: d.direction,
      strength: d.strength,
      value: Math.round(d.value * 1000) / 1000,
      evidence: { ...d.evidence },
    })),
    constraints: {
      mustReferenceDriverIds: true,
      noExternalNumbers: true,
      maxCounters: 2,
      requireDownDriverForCounters: true,
    },
  }
}

export const NEGOTIATION_GPT_SYSTEM_PROMPT = `You are generating negotiation language.

You must:
- Reference at least one accept-rate driver ID in every message via the "driverId" field
- Only reference driver.evidence values — never invent player values or external data
- Never invent player values, market numbers, or any data not in the provided drivers
- Never mention probabilities or percentages unless acceptProb is explicitly provided
- Suggest counters only if a driver.direction == "DOWN" — never suggest counters for UP or NEUTRAL drivers
- Each counter must include a "driverIds" array referencing the DOWN driver(s) it addresses
- If no drivers have direction "DOWN", return: { "noAdjustment": "NO_ADJUSTMENT_NEEDED" }

You must NOT:
- Use tier labels (elite, WR1, etc.)
- Reference KTC, KeepTradeCut, trade value, market value, ADP, or ECR
- Use age-based reasoning or historical trends
- Fabricate statistics or numbers not found in driver evidence

Return ONLY valid JSON in this EXACT structure:
{
  "opener": { "text": "friendly DM message", "driverId": "ar_need_fit" },
  "rationale": { "text": "data-backed reasoning", "driverId": "ar_market_mismatch" },
  "fallback": { "text": "casual alternative", "driverId": "ar_volatility_delta" },
  "counters": [{ "description": { "text": "counter suggestion", "driverId": "ar_market_mismatch" }, "driverIds": ["ar_market_mismatch"] }]
}

Each driverId must be a valid driver ID from the provided drivers array.
If no drivers have direction "DOWN", return:
{ "noAdjustment": "NO_ADJUSTMENT_NEEDED" }`

export function buildNegotiationGptUserPrompt(contract: NegotiationGptContract): string {
  const driverBlock = JSON.stringify(contract.drivers, null, 2)
  const hasDown = hasDownDrivers(contract)

  return `Generate structured JSON:

- "opener": { "text": "friendly DM message", "driverId": "valid_driver_id" }
- "rationale": { "text": "data-backed reasoning", "driverId": "valid_driver_id" }
- "fallback": { "text": "casual alternative if declined", "driverId": "valid_driver_id" }
${hasDown ? `\nAnd "counters": array of up to ${contract.constraints.maxCounters} objects for drivers with direction "DOWN":\n  { "description": { "text": "counter suggestion", "driverId": "down_driver_id" }, "driverIds": ["down_driver_id"] }` : '\nNo drivers have direction "DOWN" — return { "noAdjustment": "NO_ADJUSTMENT_NEEDED" }'}

Each driverId must be a valid driver ID from the drivers array.

Acceptance Probability: ${contract.acceptProb}

drivers:
${driverBlock}`
}

type StructuredMessage = { text: string; driverId: string }

function validateStructuredMessage(
  label: string,
  raw: unknown,
  validDriverIds: Set<string>,
  allowedNumbers: Set<string>,
  acceptProbProvided: boolean,
): { violations: string[]; parsed: StructuredMessage | null } {
  const violations: string[] = []

  if (!raw || typeof raw !== 'object') {
    violations.push(`${label}_not_object`)
    return { violations, parsed: null }
  }

  const msg = raw as Record<string, unknown>
  const text = typeof msg.text === 'string' ? msg.text : ''
  const driverId = typeof msg.driverId === 'string' ? msg.driverId : ''

  if (!text.trim()) {
    violations.push(`${label}_empty_text`)
    return { violations, parsed: null }
  }
  if (!driverId) {
    violations.push(`${label}_missing_driver_id`)
    return { violations, parsed: null }
  }
  if (!validDriverIds.has(driverId)) {
    violations.push(`${label}_invalid_driver_id:${driverId}`)
    return { violations, parsed: null }
  }

  for (const pat of BANNED_NEGOTIATION_PATTERNS) {
    if (pat.test(text)) {
      violations.push(`${label}_banned_pattern:${pat.source}`)
      return { violations, parsed: null }
    }
  }

  if (!acceptProbProvided && PROB_PATTERN.test(text)) {
    violations.push(`${label}_probability_mentioned_without_acceptProb`)
    return { violations, parsed: null }
  }

  const nums = extractNumbers(text)
  for (const n of nums) {
    if (!allowedNumbers.has(String(n))) {
      violations.push(`${label}_illegal_number:${n}`)
      return { violations, parsed: null }
    }
  }

  return { violations, parsed: { text, driverId } }
}

export function validateNegotiationGptOutput(
  raw: unknown,
  contract: NegotiationGptContract,
): NegotiationValidationResult {
  const violations: string[] = []

  if (typeof raw === 'string' && raw.trim() === 'INCOMPLETE_DRIVER_SET') {
    return { valid: false, cleaned: null, violations: ['INCOMPLETE_DRIVER_SET'] }
  }

  const obj = raw as Record<string, unknown>
  if (!obj || typeof obj !== 'object') {
    return { valid: false, cleaned: null, violations: ['not_an_object'] }
  }

  const downDriverIds = new Set(contract.drivers.filter(d => d.direction === 'DOWN').map(d => d.id))
  const noDownDrivers = downDriverIds.size === 0

  if (obj.noAdjustment === 'NO_ADJUSTMENT_NEEDED') {
    if (!noDownDrivers) {
      return { valid: false, cleaned: null, violations: ['no_adjustment_but_down_drivers_exist'] }
    }
    return {
      valid: true,
      cleaned: { opener: '', rationale: '', fallback: '', counters: [] },
      violations: [],
    }
  }

  if (noDownDrivers) {
    return { valid: false, cleaned: null, violations: ['no_down_drivers_but_no_adjustment_not_returned'] }
  }

  const validDriverIds = new Set(contract.drivers.map(d => d.id))
  const allowedNumbers = collectAllowedNumbers(contract)
  const acceptProbProvided = contract.acceptProb != null

  const openerResult = validateStructuredMessage('opener', obj.opener, validDriverIds, allowedNumbers, acceptProbProvided)
  const rationaleResult = validateStructuredMessage('rationale', obj.rationale, validDriverIds, allowedNumbers, acceptProbProvided)
  const fallbackResult = validateStructuredMessage('fallback', obj.fallback, validDriverIds, allowedNumbers, acceptProbProvided)

  violations.push(...openerResult.violations, ...rationaleResult.violations, ...fallbackResult.violations)

  const counters = Array.isArray(obj.counters) ? obj.counters : []
  const validCounters: NegotiationGptOutput['counters'] = []

  for (let i = 0; i < Math.min(counters.length, contract.constraints.maxCounters); i++) {
    const c = counters[i] as Record<string, unknown>
    if (!c || typeof c !== 'object') {
      violations.push(`counter_${i}_not_object`)
      continue
    }

    const descResult = validateStructuredMessage(`counter_${i}`, c.description, validDriverIds, allowedNumbers, acceptProbProvided)
    violations.push(...descResult.violations)

    const cDriverIds = Array.isArray(c.driverIds) ? (c.driverIds as string[]) : []

    if (cDriverIds.length === 0) {
      violations.push(`counter_${i}_no_driver_ids`)
      continue
    }

    let hasDownRef = false
    for (const did of cDriverIds) {
      if (!validDriverIds.has(did)) {
        violations.push(`counter_${i}_invalid_driver_id:${did}`)
      }
      if (downDriverIds.has(did)) hasDownRef = true
    }
    if (!hasDownRef) {
      violations.push(`counter_${i}_not_tied_to_down_driver`)
    }

    if (descResult.parsed && cDriverIds.every(d => validDriverIds.has(d)) && hasDownRef) {
      validCounters.push({ description: descResult.parsed.text, driverIds: cDriverIds })
    }
  }

  const strictPass =
    openerResult.parsed !== null &&
    rationaleResult.parsed !== null &&
    fallbackResult.parsed !== null &&
    !violations.some(v => v.startsWith('counter_'))

  if (!strictPass) {
    return { valid: false, cleaned: null, violations }
  }

  return {
    valid: true,
    cleaned: {
      opener: openerResult.parsed!.text,
      rationale: rationaleResult.parsed!.text,
      fallback: fallbackResult.parsed!.text,
      counters: validCounters,
    },
    violations,
  }
}
