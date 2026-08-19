import type { EntitlementStatus, SubscriptionPlanId } from "@/lib/subscription/types"
import { isAdminEmailAllowed } from "@/lib/adminAuth"
import { isAllFantasyTestEmail } from "@/lib/auth/admin"
import { getTokenSpendRuleMatrixEntry, type TokenPricingTier } from "@/lib/tokens/pricing-matrix"

const DEV_ADMIN_PLANS: readonly SubscriptionPlanId[] = ["supreme"]
const DEV_ADMIN_STATUS: EntitlementStatus = "active"
const DEV_ADMIN_BALANCE = 1_000_000_000

type DevAdminEntitlementSnapshot = {
  plans: SubscriptionPlanId[]
  status: EntitlementStatus
  currentPeriodEnd: string | null
  gracePeriodEnd: string | null
}

type DevAdminTokenBalanceSnapshot = {
  balance: number
  lifetimePurchased: number
  lifetimeSpent: number
  lifetimeRefunded: number
  updatedAt: string
}

type DevAdminTokenSpendPreview = {
  ruleCode: string
  featureLabel: string
  tokenCost: number
  baseTokenCost: number
  pricingTier: TokenPricingTier
  requiredPlan: SubscriptionPlanId | null
  discountPct: number
  chargeMode: "subscriber_discounted_tokens"
  subscriptionEligible: boolean
  policyMessage: string
  monthlyIncludedPremiumCredits: number | null
  supportsUnlimitedLowTierInFuture: boolean
  currentBalance: number
  canSpend: boolean
  requiresConfirmation: boolean
}

type DevAdminTokenLedgerEntryView = {
  id: string
  entryType: string
  tokenDelta: number
  balanceBefore: number
  balanceAfter: number
  tokenPackageSku: string | null
  spendRuleCode: string | null
  spendFeatureLabel: string | null
  refundRuleCode: string | null
  sourceType: string | null
  sourceId: string | null
  description: string | null
  metadata: unknown
  createdAt: string
}

/**
 * Permanent app-owner / developer accounts that always get admin access
 * regardless of the DEV_ADMIN_USER_IDS environment variable.
 */
const STATIC_ADMIN_USER_IDS = new Set<string>([
  '944bb9f1-7a25-455b-8ef2-66146dbf3553', // theciege24 — app owner (supabase)
  '3a7ffd10-b1a5-4a40-8d07-232364596735', // TheCiege24 — current app owner account
])

function parseDevAdminUserIds(rawValue: string | undefined): Set<string> {
  if (!rawValue) return new Set()
  return new Set(
    rawValue
      .split(/[\n\r,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

/** App user ids (same as Supabase `auth.users.id` when accounts are linked) that skip AI token / monetization notifications. */
function parseTokenNotificationBypassUserIds(rawValue: string | undefined): Set<string> {
  if (!rawValue) return new Set()
  return new Set(
    rawValue
      .split(/[\n\r,;]+/)
      .map((value) => value.trim())
      .filter(Boolean)
  )
}

function getRuleMeta(ruleCode: string): {
  featureLabel: string
  baseTokenCost: number
  pricingTier: TokenPricingTier
  requiredPlan: SubscriptionPlanId | null
} {
  const matrixEntry = getTokenSpendRuleMatrixEntry(ruleCode)
  return {
    featureLabel: matrixEntry?.featureLabel ?? `Dev admin bypass for ${ruleCode}`,
    baseTokenCost: Math.max(0, Number(matrixEntry?.tokenCost ?? 0)),
    pricingTier: matrixEntry?.tier ?? "low",
    requiredPlan: matrixEntry?.requiredPlan ?? null,
  }
}

export function isDevAdminUserId(userId: string | null | undefined): boolean {
  const normalizedUserId = String(userId ?? "").trim()
  if (!normalizedUserId) return false
  if (STATIC_ADMIN_USER_IDS.has(normalizedUserId)) return true
  return parseDevAdminUserIds(process.env.DEV_ADMIN_USER_IDS).has(normalizedUserId)
}

/**
 * When true, `dispatchNotification` can skip channels for notifications that look like
 * AI token balance, purchases, or monetization nudges (see `shouldSuppressTokenMonetizationNotification`).
 * Includes `TOKEN_NOTIFICATION_BYPASS_USER_IDS` and `DEV_ADMIN_USER_IDS` (admin token bypass).
 */
export function isTokenNotificationBypassUserId(userId: string | null | undefined): boolean {
  const normalizedUserId = String(userId ?? "").trim()
  if (!normalizedUserId) return false
  if (parseTokenNotificationBypassUserIds(process.env.TOKEN_NOTIFICATION_BYPASS_USER_IDS).has(normalizedUserId)) {
    return true
  }
  return isDevAdminUserId(userId)
}

/**
 * Full subscription + AI + token-ledger bypass for internal / QA testing (same snapshot as dev admin).
 * Use Prisma `AppUser.id` (matches `session.user.id` / Supabase auth user id when linked).
 *
 * Covers: {@link isTokenNotificationBypassUserId} (TOKEN list + dev admin + static admin) and
 * optional `AI_ENTITLEMENT_BYPASS_USER_IDS` for an explicit QA list without reusing other env names.
 */
/**
 * Full bypass for subscriptions + token metering. Pass `email` when available so accounts in
 * `ADMIN_EMAILS` match platform admin / “super admin” the same way `/admin` does (not only env user-id lists).
 */
export function isSubscriptionEntitlementBypassUserId(
  userId: string | null | undefined,
  email?: string | null
): boolean {
  // Static + configured all-access emails always bypass
  if (isAllFantasyTestEmail(email)) return true
  const normalizedUserId = String(userId ?? "").trim()
  if (normalizedUserId) {
    if (parseDevAdminUserIds(process.env.AI_ENTITLEMENT_BYPASS_USER_IDS).has(normalizedUserId)) {
      return true
    }
  }
  if (isTokenNotificationBypassUserId(userId)) return true
  if (email && isAdminEmailAllowed(email)) return true
  return false
}

export function buildDevAdminEntitlementSnapshot(): DevAdminEntitlementSnapshot {
  return {
    plans: [...DEV_ADMIN_PLANS],
    status: DEV_ADMIN_STATUS,
    currentPeriodEnd: null,
    gracePeriodEnd: null,
  }
}

export function buildDevAdminTokenBalanceSnapshot(): DevAdminTokenBalanceSnapshot {
  return {
    balance: DEV_ADMIN_BALANCE,
    lifetimePurchased: DEV_ADMIN_BALANCE,
    lifetimeSpent: 0,
    lifetimeRefunded: 0,
    updatedAt: new Date().toISOString(),
  }
}

export function buildDevAdminTokenSpendPreview(ruleCode: string): DevAdminTokenSpendPreview {
  const ruleMeta = getRuleMeta(String(ruleCode))
  return {
    ruleCode: String(ruleCode),
    featureLabel: ruleMeta.featureLabel,
    tokenCost: 0,
    baseTokenCost: ruleMeta.baseTokenCost,
    pricingTier: ruleMeta.pricingTier,
    requiredPlan: ruleMeta.requiredPlan,
    discountPct: 100,
    chargeMode: "subscriber_discounted_tokens",
    subscriptionEligible: true,
    policyMessage: "Dev admin bypass active. Token charge skipped.",
    monthlyIncludedPremiumCredits: null,
    supportsUnlimitedLowTierInFuture: true,
    currentBalance: DEV_ADMIN_BALANCE,
    canSpend: true,
    requiresConfirmation: false,
  }
}

export function buildDevAdminSpendLedgerEntry(input: {
  ruleCode: string
  sourceType?: string | null
  sourceId?: string | null
  description?: string | null
  metadata?: Record<string, unknown> | null
}): DevAdminTokenLedgerEntryView {
  const ruleMeta = getRuleMeta(String(input.ruleCode))
  const timestamp = new Date().toISOString()
  return {
    id: `dev-admin-spend:${String(input.ruleCode)}:${Date.now()}`,
    entryType: "spend",
    tokenDelta: 0,
    balanceBefore: DEV_ADMIN_BALANCE,
    balanceAfter: DEV_ADMIN_BALANCE,
    tokenPackageSku: null,
    spendRuleCode: String(input.ruleCode),
    spendFeatureLabel: ruleMeta.featureLabel,
    refundRuleCode: null,
    sourceType: input.sourceType ?? null,
    sourceId: input.sourceId ?? null,
    description: input.description ?? "Dev admin bypass token spend",
    metadata: {
      ...(input.metadata ?? {}),
      devAdminBypass: true,
    },
    createdAt: timestamp,
  }
}

export function buildDevAdminRefundLedgerEntry(input: {
  refundRuleCode: string
  sourceType?: string | null
  sourceId?: string | null
  description?: string | null
  metadata?: Record<string, unknown> | null
}): DevAdminTokenLedgerEntryView {
  const timestamp = new Date().toISOString()
  return {
    id: `dev-admin-refund:${String(input.refundRuleCode)}:${Date.now()}`,
    entryType: "refund",
    tokenDelta: 0,
    balanceBefore: DEV_ADMIN_BALANCE,
    balanceAfter: DEV_ADMIN_BALANCE,
    tokenPackageSku: null,
    spendRuleCode: null,
    spendFeatureLabel: null,
    refundRuleCode: String(input.refundRuleCode),
    sourceType: input.sourceType ?? "refund_for_spend",
    sourceId: input.sourceId ?? null,
    description: input.description ?? "Dev admin bypass refund",
    metadata: {
      ...(input.metadata ?? {}),
      devAdminBypass: true,
    },
    createdAt: timestamp,
  }
}
