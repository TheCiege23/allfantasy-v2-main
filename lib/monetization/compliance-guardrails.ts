type MonetizationComplianceCode =
  | "in_app_dues_not_allowed"
  | "in_app_payout_not_allowed"
  | "in_app_prize_pool_not_allowed"

const PROHIBITED_INTENT_PATTERNS: Array<{
  regex: RegExp
  code: MonetizationComplianceCode
}> = [
  { regex: /(dues?|league[_\s-]*dues?)/i, code: "in_app_dues_not_allowed" },
  { regex: /(payout|winnings?)/i, code: "in_app_payout_not_allowed" },
  { regex: /(prize|reward[_\s-]*pool|contest[_\s-]*payout|prize[_\s-]*pool)/i, code: "in_app_prize_pool_not_allowed" },
  { regex: /(entry[_\s-]*fee|first[_\s-]*bracket[_\s-]*fee)/i, code: "in_app_dues_not_allowed" },
]

const COMPLIANCE_MESSAGES: Record<MonetizationComplianceCode, string> = {
  in_app_dues_not_allowed:
    "AllFantasy does not process league dues in-app. Use external FanCred setup managed by the commissioner.",
  in_app_payout_not_allowed:
    "AllFantasy does not process payouts or winnings in-app. Payout operations must be handled externally through FanCred.",
  in_app_prize_pool_not_allowed:
    "AllFantasy does not create or manage in-app prize/reward pools. Paid league prizes are handled externally through FanCred.",
}

export class MonetizationComplianceError extends Error {
  readonly code: MonetizationComplianceCode
  readonly statusCode: number

  constructor(code: MonetizationComplianceCode, statusCode = 400) {
    super(COMPLIANCE_MESSAGES[code])
    this.name = "MonetizationComplianceError"
    this.code = code
    this.statusCode = statusCode
  }
}

export function isMonetizationComplianceError(error: unknown): error is MonetizationComplianceError {
  return error instanceof MonetizationComplianceError
}

function stringifyMetadataValue(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "string") return value
  if (typeof value === "number" || typeof value === "boolean") return String(value)
  return ""
}

function getFlattenedMetadataText(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return ""
  return Object.entries(metadata)
    .map(([key, value]) => `${key}:${stringifyMetadataValue(value)}`)
    .join(" ")
}

function resolveComplianceCode(intentOrMetadataText: string): MonetizationComplianceCode | null {
  for (const entry of PROHIBITED_INTENT_PATTERNS) {
    if (entry.regex.test(intentOrMetadataText)) {
      return entry.code
    }
  }
  return null
}

export function assertNoLeagueSettlementIntent(
  intent: string,
  metadata?: Record<string, unknown>
): void {
  const intentText = String(intent ?? "").trim()
  const intentCode = resolveComplianceCode(intentText)
  if (intentCode) {
    throw new MonetizationComplianceError(intentCode)
  }

  const metadataText = getFlattenedMetadataText(metadata)
  if (!metadataText) return
  const metadataCode = resolveComplianceCode(metadataText)
  if (metadataCode) {
    throw new MonetizationComplianceError(metadataCode)
  }
}
