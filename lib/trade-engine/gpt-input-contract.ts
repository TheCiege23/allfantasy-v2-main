import type { TradeDriverData, TradeVerdict, TradeLean } from './trade-engine'
import type { AcceptDriver } from './types'

type GptInputContract = {
  mode: 'TRADE_EVALUATOR' | 'INSTANT'
  verdict: TradeVerdict
  lean: TradeLean
  acceptProb: number

  drivers: Array<{
    id: string
    direction: string
    strength: string
    value: number
    evidence: Record<string, unknown>
  }>

  confidenceDrivers: Array<{
    id: string
    direction: string
    strength: string
    value: number
    evidence: Record<string, unknown>
  }>

  constraints: {
    mustReferenceDriverIds: boolean
    maxBullets: number
    noExternalNumbers: boolean
    failIfMissingDrivers: boolean
  }
}

export function buildGptInputContract(
  mode: 'TRADE_EVALUATOR' | 'INSTANT',
  driverData: TradeDriverData,
  overrides?: { maxBullets?: number },
): GptInputContract {
  const mapDriver = (d: AcceptDriver) => ({
    id: d.id,
    direction: d.direction,
    strength: d.strength,
    value: Math.round(d.value * 1000) / 1000,
    evidence: { ...d.evidence },
  })

  return {
    mode,
    verdict: driverData.verdict,
    lean: driverData.lean,
    acceptProb: Math.round(driverData.acceptProbability * 1000) / 1000,

    drivers: driverData.acceptDrivers.map(mapDriver),
    confidenceDrivers: driverData.confidenceDrivers.map(mapDriver),

    constraints: {
      mustReferenceDriverIds: true,
      maxBullets: overrides?.maxBullets ?? 3,
      noExternalNumbers: true,
      failIfMissingDrivers: true,
    },
  }
}

export function buildGptUserPrompt(contract: GptInputContract): string {
  const driverBlock = JSON.stringify(contract.drivers, null, 2)
  const confidenceBlock = JSON.stringify(contract.confidenceDrivers, null, 2)

  return `Generate structured JSON:

1) "bullets": array of exactly ${contract.constraints.maxBullets} objects, each: { "text": "analysis sentence", "driverId": "driver_id" }
2) "sensitivity": one object: { "text": "sensitivity sentence", "driverId": "confidenceDriver_id" }

Use only the provided drivers and confidenceDrivers.
Each bullet must reference exactly one driver ID from the drivers array.
Sensitivity must reference exactly one confidenceDriver ID.

Trade Lean: ${contract.lean}
Verdict: ${contract.verdict}
Acceptance Probability: ${contract.acceptProb}

drivers:
${driverBlock}

confidenceDrivers:
${confidenceBlock}`
}

type StructuredBullet = {
  text: string
  driverId: string
}

type StructuredSensitivity = {
  text: string
  driverId: string
}

type GptNarrativeOutput = {
  bullets: StructuredBullet[]
  sensitivity: StructuredSensitivity
}

type ValidationResult = {
  valid: boolean
  cleaned: GptNarrativeOutput | null
  violations: string[]
}

const REQUIRED_DRIVER_IDS = ['ar_market_mismatch', 'ar_volatility_delta']

export function shouldSkipGpt(contract: GptInputContract): 'ok' | 'INCOMPLETE_DRIVER_SET' {
  if (contract.drivers.length < 3) return 'INCOMPLETE_DRIVER_SET'
  const ids = new Set(contract.drivers.map(d => d.id))
  for (const req of REQUIRED_DRIVER_IDS) {
    if (!ids.has(req)) return 'INCOMPLETE_DRIVER_SET'
  }
  return 'ok'
}

const BANNED_PATTERNS = [
  /top[- ]?\d+\s+(WR|RB|QB|TE|K|DEF|DST|flex)/i,
  /\b(WR|RB|QB|TE)\d{1,2}\b/,
  /\b(elite|bust|sleeper|breakout|boom|stud)\b/i,
  /\bKTC\b/i,
  /\bKeepTradeCut\b/i,
  /\btrade value\b/i,
  /\bmarket value\b/i,
  /\bhistorically\b/i,
  /\btrends?\s+(upward|downward|higher|lower)\b/i,
  /\byounger\s+(so|than|means)\b/i,
  /\bage\s+(advantage|curve|premium)\b/i,
  /\boldest?\s+(so|means|therefore)\b/i,
  /\b(dynasty|redraft)\s+rank/i,
  /\bADP\b/,
  /\bconsensus\s+rank/i,
  /\bECR\b/,
  /\boverall\s+(WR|RB|QB|TE)\b/i,
]

function extractNumbers(text: string): number[] {
  const matches = text.match(/[\d]+\.?\d*/g)
  return matches ? matches.map(Number) : []
}

function collectAllowedNumbers(contract: GptInputContract): Set<string> {
  const allowed = new Set<string>()
  const addFromEvidence = (evidence: Record<string, unknown>) => {
    const raw = evidence.raw
    if (typeof raw === 'number') {
      allowed.add(String(raw))
      allowed.add(String(Math.abs(raw)))
      allowed.add(raw.toFixed(1))
      allowed.add(Math.abs(raw).toFixed(1))
      allowed.add(raw.toFixed(2))
      allowed.add(Math.abs(raw).toFixed(2))
      allowed.add(String(Math.round(raw)))
      allowed.add(String(Math.round(Math.abs(raw))))
    }
  }
  for (const d of contract.drivers) addFromEvidence(d.evidence)
  for (const d of contract.confidenceDrivers) addFromEvidence(d.evidence)

  allowed.add(String(contract.acceptProb))
  allowed.add(String(Math.round(contract.acceptProb * 100)))

  allowed.add('1')
  allowed.add('2')
  allowed.add('3')
  return allowed
}

export function validateGptNarrativeOutput(
  raw: unknown,
  contract: GptInputContract,
): ValidationResult {
  const violations: string[] = []

  if (typeof raw === 'string' && raw.trim() === 'INCOMPLETE_DRIVER_SET') {
    return { valid: false, cleaned: null, violations: ['INCOMPLETE_DRIVER_SET'] }
  }

  const obj = raw as Record<string, unknown>
  if (!obj || typeof obj !== 'object') {
    return { valid: false, cleaned: null, violations: ['not_an_object'] }
  }

  const bullets = obj.bullets
  const sensitivity = obj.sensitivity

  if (!Array.isArray(bullets)) {
    return { valid: false, cleaned: null, violations: ['bullets_not_array'] }
  }
  if (!sensitivity || typeof sensitivity !== 'object') {
    return { valid: false, cleaned: null, violations: ['sensitivity_not_object'] }
  }

  const validDriverIds = new Set(contract.drivers.map(d => d.id))
  const validConfDriverIds = new Set(contract.confidenceDrivers.map(d => d.id))
  const allowedNumbers = collectAllowedNumbers(contract)

  const validBullets: StructuredBullet[] = []
  for (let i = 0; i < bullets.length; i++) {
    const bullet = bullets[i] as Record<string, unknown>
    if (!bullet || typeof bullet !== 'object') {
      violations.push(`bullet_${i}_not_object`)
      continue
    }

    const text = typeof bullet.text === 'string' ? bullet.text : ''
    const driverId = typeof bullet.driverId === 'string' ? bullet.driverId : ''

    if (!text.trim()) {
      violations.push(`bullet_${i}_empty_text`)
      continue
    }
    if (!driverId) {
      violations.push(`bullet_${i}_missing_driver_id`)
      continue
    }
    if (!validDriverIds.has(driverId)) {
      violations.push(`bullet_${i}_invalid_driver_id:${driverId}`)
      continue
    }

    let banned = false
    for (const pat of BANNED_PATTERNS) {
      if (pat.test(text)) {
        violations.push(`bullet_${i}_banned_pattern:${pat.source}`)
        banned = true
        break
      }
    }
    if (banned) continue

    const nums = extractNumbers(text)
    let hasIllegalNumber = false
    for (const n of nums) {
      if (!allowedNumbers.has(String(n))) {
        violations.push(`bullet_${i}_illegal_number:${n}`)
        hasIllegalNumber = true
        break
      }
    }
    if (hasIllegalNumber) continue

    validBullets.push({ text, driverId })
  }

  const sensObj = sensitivity as Record<string, unknown>
  const sensText = typeof sensObj.text === 'string' ? sensObj.text : ''
  const sensDriverId = typeof sensObj.driverId === 'string' ? sensObj.driverId : ''
  let validSensitivity: StructuredSensitivity | null = null

  if (!sensText.trim()) {
    violations.push('sensitivity_empty_text')
  } else if (!sensDriverId) {
    violations.push('sensitivity_missing_driver_id')
  } else if (!validConfDriverIds.has(sensDriverId)) {
    violations.push(`sensitivity_invalid_confidence_driver_id:${sensDriverId}`)
  } else {
    let sensBanned = false
    for (const pat of BANNED_PATTERNS) {
      if (pat.test(sensText)) {
        violations.push(`sensitivity_banned_pattern:${pat.source}`)
        sensBanned = true
        break
      }
    }
    if (!sensBanned) {
      validSensitivity = { text: sensText, driverId: sensDriverId }
    }
  }

  const referencedAcceptDriverIds = new Set(validBullets.map(b => b.driverId))
  if (referencedAcceptDriverIds.size === 0) {
    violations.push('no_accept_driver_referenced')
  }

  const requiredCount = contract.constraints.maxBullets
  if (validBullets.length !== requiredCount) {
    violations.push(`expected_${requiredCount}_bullets_got_${validBullets.length}`)
  }

  const strictPass =
    validBullets.length === requiredCount &&
    validSensitivity !== null &&
    referencedAcceptDriverIds.size > 0

  if (!strictPass) {
    return { valid: false, cleaned: null, violations }
  }

  return {
    valid: true,
    cleaned: { bullets: validBullets.slice(0, requiredCount), sensitivity: validSensitivity! },
    violations,
  }
}

export const GPT_NARRATIVE_SYSTEM_PROMPT = `You are a narrative formatter for a deterministic trade evaluation engine.

You are NOT allowed to:
- Compute new values
- Infer missing data
- Reference player values not explicitly provided
- Use any numbers that are not inside driver.evidence.raw
- Mention internal formulas or weights

You MUST:
- Only reference driver IDs that appear in the provided drivers array
- Base every claim on driver.evidence
- If required drivers are missing, output exactly: INCOMPLETE_DRIVER_SET

You are a formatter, not a decision-maker. Do not speculate. Do not add statistics not provided.

If drivers array is empty or missing critical drivers:
Return exactly: INCOMPLETE_DRIVER_SET

Return ONLY valid JSON in this EXACT structure:
{
  "bullets": [
    { "text": "analysis sentence here", "driverId": "ar_need_fit" },
    { "text": "analysis sentence here", "driverId": "ar_market_mismatch" },
    { "text": "analysis sentence here", "driverId": "ar_volatility_delta" }
  ],
  "sensitivity": {
    "text": "sensitivity sentence here",
    "driverId": "cf_data_completeness"
  }
}

Each bullet.driverId must be a valid driver ID from the drivers array.
sensitivity.driverId must be a valid confidenceDriver ID from the confidenceDrivers array.
`
