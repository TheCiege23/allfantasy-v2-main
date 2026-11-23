/**
 * Commissioner Partner Codes — fraud checks (pure).
 *
 * Self-redemption and a second redemption are REFUSED outright. Everything else
 * only FLAGS: a flagged referral counts on neither meter and earns nothing until
 * an admin clears it at /admin/partner-codes, so an honest friend who trips a
 * check is delayed, never lost.
 */

export type RedemptionRefusal = 'own_code' | 'already_redeemed' | 'code_inactive'

export function refuseRedemption(args: {
  redeemerUserId: string
  ownerUserId: string
  redeemerHasRedemption: boolean
  codeStatus: 'active' | 'paused' | 'revoked'
}): RedemptionRefusal | null {
  if (args.codeStatus !== 'active') return 'code_inactive'
  if (args.redeemerUserId === args.ownerUserId) return 'own_code'
  if (args.redeemerHasRedemption) return 'already_redeemed'
  return null
}

export const REFUSAL_COPY: Record<RedemptionRefusal, string> = {
  own_code: "You can't use your own code",
  already_redeemed: "You've already used a partner code",
  code_inactive: "That code isn't active right now",
}

export type FlagReason =
  | 'shared_card'
  | 'owner_card'
  | 'ip_burst'
  | 'disposable_email'
  | 'owner_ip'

export const FLAG_COPY: Record<FlagReason, string> = {
  shared_card: 'Same card used on several signups with this code',
  owner_card: "Paid with the code owner's card",
  ip_burst: 'Many signups from one network in a short time',
  disposable_email: 'Signed up with a throwaway email address',
  owner_ip: "Signed up from the code owner's network",
}

export type FraudSignals = {
  /** Other redemptions OF THIS CODE already paid with the same card fingerprint. */
  sameCardOnCode: number
  /** The code owner's own saved card fingerprints include this one. */
  matchesOwnerCard: boolean
  /** Redemptions of this code from the same IP in the last 24h, this one included. */
  sameIpLast24h: number
  isDisposableEmail: boolean
  matchesOwnerIp: boolean
}

export const SHARED_CARD_LIMIT = 2
export const IP_BURST_LIMIT = 5

export function flagReasons(s: FraudSignals): FlagReason[] {
  const out: FlagReason[] = []
  if (s.matchesOwnerCard) out.push('owner_card')
  if (s.sameCardOnCode >= SHARED_CARD_LIMIT) out.push('shared_card')
  if (s.sameIpLast24h >= IP_BURST_LIMIT) out.push('ip_burst')
  if (s.isDisposableEmail) out.push('disposable_email')
  if (s.matchesOwnerIp) out.push('owner_ip')
  return out
}
