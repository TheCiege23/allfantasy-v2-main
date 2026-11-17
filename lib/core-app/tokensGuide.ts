/**
 * /tokens in plain words (2026-11-14). The owner's ask: every page should say what it is for and what
 * to do. The token centre led with a bare number ("Your balance: 1,000,000,000"), put the 13-row price
 * list before the packs, and titled its history "Recent spend" while every row on the owner's account
 * was a top-up — "Daily free allowance (20 token floor)", "Stripe purchase: AllFantasy AI Tokens (5)" —
 * plus a red "0".
 *
 * Pure, so the rules are testable and TokenCentreV4 stays a renderer.
 */

export type TokensHeadline =
  | { kind: 'loading' }
  /** The read failed. /tokens is behind sign-in (app/tokens/layout.tsx), so this is never "signed out". */
  | { kind: 'unavailable' }
  | { kind: 'balance'; balance: number; questions: number | null }

/** What the top of the page says: the balance, and what it buys in the one unit people know. */
export function tokensHeadline(balance: number | null, loading: boolean, chimmyCost: number | null): TokensHeadline {
  if (balance == null) return loading ? { kind: 'loading' } : { kind: 'unavailable' }
  const questions = chimmyCost && chimmyCost > 0 ? Math.floor(balance / chimmyCost) : null
  return { kind: 'balance', balance, questions }
}

/** One ledger row as the history API sends it (TokenSpendService `toLedgerView`). */
export type LedgerEntryInput = {
  id?: unknown
  entryType?: unknown
  tokenDelta?: unknown
  delta?: unknown
  sourceType?: unknown
  spendFeatureLabel?: unknown
  description?: unknown
  tokenPackageSku?: unknown
  label?: unknown
  createdAt?: unknown
}

export type ActivityRow = {
  id: string
  /** What the screen phrases; `label` carries the action name where there is one. */
  kind: 'dailyTopUp' | 'bought' | 'refund' | 'spend' | 'other'
  label: string | null
  delta: number
  createdAt: string | null
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

/**
 * A ledger row in plain words, or null for a row that changed nothing.
 *
 * - The daily free top-up is recognised by its source, and by the wording older rows carry, so
 *   "Daily free allowance (20 token floor)" and "Daily free floor: 2 Chimmy questions" both read
 *   "Daily free top-up".
 * - A purchase says how many tokens it bought, never the Stripe product name.
 * - A spend keeps the action's own label, as before.
 */
export function activityRow(e: LedgerEntryInput, index: number): ActivityRow | null {
  const delta = Number(e.tokenDelta ?? e.delta ?? 0)
  if (!Number.isFinite(delta) || delta === 0) return null
  const id = String(e.id ?? index)
  const createdAt = str(e.createdAt)
  const type = str(e.entryType)
  const description = str(e.description)
  if (str(e.sourceType) === 'daily_free_tokens' || (description && /^Daily free/i.test(description))) {
    return { id, kind: 'dailyTopUp', label: null, delta, createdAt }
  }
  if (type === 'purchase') return { id, kind: 'bought', label: null, delta, createdAt }
  if (type === 'refund') return { id, kind: 'refund', label: str(e.spendFeatureLabel), delta, createdAt }
  const label = str(e.spendFeatureLabel) ?? description ?? str(e.tokenPackageSku) ?? str(e.label)
  if (type === 'spend') return { id, kind: 'spend', label, delta, createdAt }
  return { id, kind: 'other', label: label ?? type, delta, createdAt }
}
