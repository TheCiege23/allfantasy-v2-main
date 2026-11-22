/** Phase 1 arithmetic only. This module never reads email or writes payment state. */
export type DuesEntryType = "payment" | "late_fee" | "refund" | "payout" | "adjustment"
export type DuesEntryAmount = { type: DuesEntryType; amountCents: number }
export type DerivedDuesStatus = "paid" | "partial" | "unpaid" | "overdue"

const MAX_CENTS = 2_147_483_647

function cents(value: number, signed = false): number {
  if (!Number.isInteger(value) || value > MAX_CENTS || value < (signed ? -2_147_483_648 : 0)) {
    throw new RangeError("Amounts must be whole integer cents within the database range.")
  }
  return value
}

function add(left: number, right: number): number {
  const result = left + right
  if (!Number.isSafeInteger(result)) throw new RangeError("Ledger total exceeds safe integer precision.")
  return result
}

/**
 * Payments credit dues; refunds reverse that credit; late fees increase the assessment.
 * Signed adjustments credit/debit the paid balance. Payouts are tracked separately and
 * never undo dues paid. The caller supplies entries for one member and connection.
 * A suggestion/identity mapping is not proof of payment; no matching happens here.
 */
export function deriveLeagueSafeDues(input: {
  duesAmountCents: number
  memberDuesAmountCents?: number | null
  entries: readonly DuesEntryAmount[]
  dueAt?: Date | null
  asOf: Date
}) {
  cents(input.duesAmountCents)
  if (input.memberDuesAmountCents != null) cents(input.memberDuesAmountCents)
  if (!Number.isFinite(input.asOf.getTime()) ||
      (input.dueAt != null && !Number.isFinite(input.dueAt.getTime()))) {
    throw new RangeError("Assessment dates must be valid.")
  }
  let dueCents = input.memberDuesAmountCents ?? input.duesAmountCents
  let paidCents = 0
  let payoutCents = 0
  for (const entry of input.entries) {
    const amount = cents(entry.amountCents, entry.type === "adjustment")
    if (amount === 0) throw new RangeError("Ledger entries must have a nonzero amount.")
    switch (entry.type) {
      case "payment": paidCents = add(paidCents, amount); break
      case "refund": paidCents = add(paidCents, -amount); break
      case "late_fee": dueCents = add(dueCents, amount); break
      case "adjustment": paidCents = add(paidCents, amount); break
      case "payout": payoutCents = add(payoutCents, amount); break
      default: throw new TypeError("Unknown ledger entry type.")
    }
  }
  const balanceCents = add(dueCents, -paidCents)
  const owedCents = Math.max(0, balanceCents)
  const creditCents = Math.max(0, -balanceCents)
  const status: DerivedDuesStatus = owedCents === 0 ? "paid"
    : input.dueAt && input.asOf.getTime() > input.dueAt.getTime() ? "overdue"
    : paidCents > 0 ? "partial" : "unpaid"
  return { dueCents, paidCents, owedCents, creditCents, payoutCents, status }
}
