/**
 * IR eligibility by injury/status designation and the league's IR flags. Pure and client-safe: the
 * server's roster validation (`rosterValidationService`) and the lineup screen's "Move to IR" control
 * both read this one rule, so the client never offers a move the server is certain to reject.
 */
export type IrRules = {
  irAllowOut: boolean | null
  irAllowCovid: boolean | null
  irAllowSuspended: boolean | null
  irAllowNA: boolean | null
  irAllowDNR: boolean | null
  irAllowDoubtful: boolean | null
}

export function isIrEligibleStatus(rules: IrRules, status: string | null | undefined): boolean {
  const st = String(status ?? '').trim().toUpperCase()
  if (['IR', 'PUP', 'OUT_IR', 'RESERVE'].includes(st)) return true
  if (st === 'OUT' && rules.irAllowOut) return true
  if (['COVID', 'COVID-19'].includes(st) && rules.irAllowCovid) return true
  if (['SUSP', 'SUSPENDED'].includes(st) && rules.irAllowSuspended) return true
  if (st === 'N/A' && rules.irAllowNA) return true
  if (['DNR', 'DID_NOT_REPORT'].includes(st) && rules.irAllowDNR) return true
  if (['Q', 'QUESTIONABLE', 'DOUBTFUL', 'D'].includes(st) && rules.irAllowDoubtful) return true
  return false
}
