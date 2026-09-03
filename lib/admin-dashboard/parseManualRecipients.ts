/**
 * Pure parsing/validation for the email broadcast "manual recipient list" audience.
 *
 * ⚠ DELIBERATELY HAS NO `server-only` IMPORT AND NO SIDE EFFECTS. This exists so
 * both the client compose panel (a live, honest recipient count as the operator
 * types) and the server (the real, enforced count) run the IDENTICAL logic.
 * AdminEmailCenterService.ts is `server-only`, and importing anything from a
 * server-only module into client code fails the build by design — pulling this
 * pair of pure functions out is what makes sharing them possible at all, rather
 * than the client silently drifting from a hand-copied approximation.
 */

/**
 * Splits on comma, semicolon, newline, or whitespace so a paste from anywhere — a
 * spreadsheet column, a comma list, one-per-line — parses the same way.
 */
export function parseManualRecipientInput(raw: string): string[] {
  return raw
    .split(/[\s,;]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
}

/**
 * Deliberately loose — filters obvious junk from a pasted list, not a full RFC
 * 5322 validator. Resend rejects a genuinely malformed address on its own; this
 * exists so a stray blank line or a pasted name-without-email is visibly dropped
 * rather than silently vanishing and getting reported as an opt-out.
 */
export function isPlausibleEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
