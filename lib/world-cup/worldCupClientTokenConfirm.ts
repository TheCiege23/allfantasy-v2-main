import { approvePaidToolQuote } from '@/lib/tokens/paidToolClient'
export type WorldCupTokenConfirmationResponse = {
  code?: string
  error?: string
  message?: string
  preview?: {
    tokenCost?: number
    balanceBefore?: number
    balanceAfter?: number
    label?: string
  }
}

export function isWorldCupTokenConfirmationResponse(
  status: number,
  body: unknown
): body is WorldCupTokenConfirmationResponse {
  return (
    status === 409 &&
    typeof body === "object" &&
    body !== null &&
    (body as { code?: unknown }).code === "token_confirmation_required"
  )
}

export function formatWorldCupTokenConfirmationMessage(
  body: WorldCupTokenConfirmationResponse
): string {
  const cost =
    typeof body.preview?.tokenCost === "number" && Number.isFinite(body.preview.tokenCost)
      ? body.preview.tokenCost
      : null
  const balanceAfter =
    typeof body.preview?.balanceAfter === "number" && Number.isFinite(body.preview.balanceAfter)
      ? body.preview.balanceAfter
      : null

  const costLine =
    cost != null
      ? `This World Cup AI action costs ${cost} token${cost === 1 ? "" : "s"}.`
      : "This World Cup AI action requires tokens."
  const balanceLine =
    balanceAfter != null
      ? ` Your balance after this action will be ${balanceAfter}.`
      : ""

  return body.message ? `${body.message}${balanceLine}` : `${costLine}${balanceLine}`
}

export function confirmWorldCupTokenSpend(
  body: WorldCupTokenConfirmationResponse
): boolean {
  if (typeof window === "undefined" || typeof window.confirm !== "function") {
    return false
  }
  return window.confirm(formatWorldCupTokenConfirmationMessage(body)) && approvePaidToolQuote(body)
}
