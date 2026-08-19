import { Prisma } from "@prisma/client"
import { prisma } from "@/lib/prisma"
import {
  buildDevAdminRefundLedgerEntry,
  buildDevAdminSpendLedgerEntry,
  buildDevAdminTokenBalanceSnapshot,
  buildDevAdminTokenSpendPreview,
  isSubscriptionEntitlementBypassUserId,
} from "@/lib/dev-admin/access"
import {
  TOKEN_ENTRY_TYPES,
  TOKEN_PACKAGE_SEEDS,
  TOKEN_REFUND_RULE_SEEDS,
  TOKEN_SPEND_RULE_SEEDS,
  type TokenRefundRuleCode,
  type TokenSpendRuleCode,
} from "@/lib/tokens/constants"
import { EntitlementResolver, type EntitlementSnapshot } from "@/lib/subscription/EntitlementResolver"
import { getTokenSpendRuleMatrixEntry } from "@/lib/tokens/pricing-matrix"
import {
  resolveTokenChargeDecisionForEntitlement,
  resolveTokenChargeDecisionForUser,
  type TokenChargeDecision,
} from "@/lib/tokens/subscription-policy"

const SEED_SYNC_TTL_MS = 5 * 60_000
let lastSeedSyncAtMs = 0
let seedSyncPromise: Promise<void> | null = null

type LedgerRow = {
  id: string
  entryType: string
  tokenDelta: number
  balanceBefore: number
  balanceAfter: number
  tokenPackageSku: string | null
  spendRuleCode: string | null
  refundRuleCode: string | null
  sourceType: string | null
  sourceId: string | null
  description: string | null
  metadata: unknown
  createdAt: Date
  spendRule?: { featureLabel: string } | null
}

export type TokenBalanceSnapshot = {
  balance: number
  lifetimePurchased: number
  lifetimeSpent: number
  lifetimeRefunded: number
  updatedAt: string
}

export type TokenSpendRuleView = {
  code: string
  category: string
  featureLabel: string
  description: string
  tokenCost: number
  baseTokenCost: number
  pricingTier: "low" | "mid" | "high"
  requiredPlan: string | null
  discountPct: number
  chargeMode: "tokens_only" | "subscriber_discounted_tokens"
  subscriptionEligible: boolean
  policyMessage: string
  monthlyIncludedPremiumCredits: number | null
  supportsUnlimitedLowTierInFuture: boolean
  requiresConfirmation: boolean
  isActive: boolean
}

export type TokenSpendPreview = {
  ruleCode: string
  featureLabel: string
  tokenCost: number
  baseTokenCost: number
  pricingTier: "low" | "mid" | "high"
  requiredPlan: string | null
  discountPct: number
  chargeMode: "tokens_only" | "subscriber_discounted_tokens"
  subscriptionEligible: boolean
  policyMessage: string
  monthlyIncludedPremiumCredits: number | null
  supportsUnlimitedLowTierInFuture: boolean
  currentBalance: number
  canSpend: boolean
  requiresConfirmation: boolean
}

export type TokenLedgerEntryView = {
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

export class TokenSpendRuleNotFoundError extends Error {
  constructor(ruleCode: string) {
    super(`Unknown or inactive token spend rule: ${ruleCode}`)
    this.name = "TokenSpendRuleNotFoundError"
  }
}

export class TokenSpendConfirmationRequiredError extends Error {
  constructor(readonly ruleCode: string, readonly tokenCost: number) {
    super(`Token spend confirmation required for ${ruleCode}`)
    this.name = "TokenSpendConfirmationRequiredError"
  }
}

export class TokenInsufficientBalanceError extends Error {
  constructor(readonly requiredTokens: number, readonly currentBalance: number) {
    super("Insufficient token balance")
    this.name = "TokenInsufficientBalanceError"
  }
}

export class TokenRefundNotAllowedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "TokenRefundNotAllowedError"
  }
}

function toLedgerView(row: LedgerRow): TokenLedgerEntryView {
  return {
    id: row.id,
    entryType: row.entryType,
    tokenDelta: Number(row.tokenDelta || 0),
    balanceBefore: Number(row.balanceBefore || 0),
    balanceAfter: Number(row.balanceAfter || 0),
    tokenPackageSku: row.tokenPackageSku ?? null,
    spendRuleCode: row.spendRuleCode ?? null,
    spendFeatureLabel: row.spendRule?.featureLabel ?? null,
    refundRuleCode: row.refundRuleCode ?? null,
    sourceType: row.sourceType ?? null,
    sourceId: row.sourceId ?? null,
    description: row.description ?? null,
    metadata: row.metadata ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

async function syncSeedDataIfNeeded(): Promise<void> {
  const now = Date.now()
  if (now - lastSeedSyncAtMs < SEED_SYNC_TTL_MS) return

  if (!seedSyncPromise) {
    seedSyncPromise = (async () => {
      const db = prisma as any

      await Promise.all([
        ...TOKEN_PACKAGE_SEEDS.map((pack) =>
          db.tokenPackage.upsert({
            where: { sku: pack.sku },
            update: {
              title: pack.title,
              description: pack.description,
              tokenAmount: pack.tokenAmount,
              priceUsdCents: pack.priceUsdCents,
              isActive: pack.isActive,
            },
            create: {
              sku: pack.sku,
              title: pack.title,
              description: pack.description,
              tokenAmount: pack.tokenAmount,
              priceUsdCents: pack.priceUsdCents,
              isActive: pack.isActive,
            },
          })
        ),
        ...TOKEN_SPEND_RULE_SEEDS.map((rule) =>
          db.tokenSpendRule.upsert({
            where: { code: rule.code },
            update: {
              category: rule.category,
              featureLabel: rule.featureLabel,
              description: rule.description,
              tokenCost: rule.tokenCost,
              requiresConfirmation: rule.requiresConfirmation,
              isActive: rule.isActive,
              metadata: rule.metadata ?? null,
            },
            create: {
              code: rule.code,
              category: rule.category,
              featureLabel: rule.featureLabel,
              description: rule.description,
              tokenCost: rule.tokenCost,
              requiresConfirmation: rule.requiresConfirmation,
              isActive: rule.isActive,
              metadata: rule.metadata ?? null,
            },
          })
        ),
        ...TOKEN_REFUND_RULE_SEEDS.map((rule) =>
          db.tokenRefundRule.upsert({
            where: { code: rule.code },
            update: {
              description: rule.description,
              maxAgeMinutes: rule.maxAgeMinutes,
              isActive: rule.isActive,
              metadata: rule.metadata ?? null,
            },
            create: {
              code: rule.code,
              description: rule.description,
              maxAgeMinutes: rule.maxAgeMinutes,
              isActive: rule.isActive,
              metadata: rule.metadata ?? null,
            },
          })
        ),
      ])

      lastSeedSyncAtMs = Date.now()
      seedSyncPromise = null
    })().catch((error) => {
      seedSyncPromise = null
      throw error
    })
  }

  await seedSyncPromise
}

export class TokenSpendService {
  private async getActiveRule(ruleCode: string) {
    const rule = await (prisma as any).tokenSpendRule.findUnique({
      where: { code: ruleCode },
      select: {
        code: true,
        featureLabel: true,
        tokenCost: true,
        requiresConfirmation: true,
        isActive: true,
      },
    })
    if (!rule || !rule.isActive) {
      throw new TokenSpendRuleNotFoundError(String(ruleCode))
    }
    return rule
  }

  private buildPreviewFromContext(input: {
    rule: {
      code: string
      featureLabel: string
      tokenCost: number
      requiresConfirmation: boolean
    }
    entitlement: EntitlementSnapshot
    currentBalance: number
  }): TokenSpendPreview {
    const baseTokenCost = Math.max(1, Number(input.rule.tokenCost || 1))
    const decision = resolveTokenChargeDecisionForEntitlement({
      entitlement: input.entitlement,
      ruleCode: String(input.rule.code),
      baseTokenCost,
    })
    const tokenCost = Math.max(1, Number(decision.effectiveTokenCost || baseTokenCost))
    const matrixEntry = getTokenSpendRuleMatrixEntry(String(input.rule.code))
    return {
      ruleCode: String(input.rule.code),
      featureLabel: String(input.rule.featureLabel),
      tokenCost,
      baseTokenCost,
      pricingTier: matrixEntry?.tier ?? "mid",
      requiredPlan: matrixEntry?.requiredPlan ?? null,
      discountPct: decision.discountPct,
      chargeMode: decision.chargeMode,
      subscriptionEligible: decision.subscriptionEligible,
      policyMessage: decision.policyMessage,
      monthlyIncludedPremiumCredits: decision.monthlyIncludedPremiumCredits,
      supportsUnlimitedLowTierInFuture: decision.supportsUnlimitedLowTierInFuture,
      currentBalance: Number(input.currentBalance || 0),
      canSpend: Number(input.currentBalance || 0) >= tokenCost,
      requiresConfirmation: Boolean(input.rule.requiresConfirmation),
    }
  }

  async getBalance(userId: string, userEmail?: string | null): Promise<TokenBalanceSnapshot> {
    if (isSubscriptionEntitlementBypassUserId(userId, userEmail)) {
      return buildDevAdminTokenBalanceSnapshot()
    }

    await syncSeedDataIfNeeded()
    const balance = await (prisma as any).userTokenBalance.upsert({
      where: { userId },
      update: {},
      create: { userId },
      select: {
        balance: true,
        lifetimePurchased: true,
        lifetimeSpent: true,
        lifetimeRefunded: true,
        updatedAt: true,
      },
    })

    return {
      balance: Number(balance.balance || 0),
      lifetimePurchased: Number(balance.lifetimePurchased || 0),
      lifetimeSpent: Number(balance.lifetimeSpent || 0),
      lifetimeRefunded: Number(balance.lifetimeRefunded || 0),
      updatedAt: new Date(balance.updatedAt).toISOString(),
    }
  }

  async getSpendRules(options?: {
    activeOnly?: boolean
    userId?: string | null
    /** When resolving per-user pricing, include session email so ADMIN_EMAILS bypass matches entitlements. */
    userEmail?: string | null
  }): Promise<TokenSpendRuleView[]> {
    await syncSeedDataIfNeeded()
    const activeOnly = options?.activeOnly ?? true
    const userId = options?.userId?.trim()
    const rows = await (prisma as any).tokenSpendRule.findMany({
      where: activeOnly ? { isActive: true } : undefined,
      orderBy: [{ category: "asc" }, { tokenCost: "asc" }, { featureLabel: "asc" }],
      select: {
        code: true,
        category: true,
        featureLabel: true,
        description: true,
        tokenCost: true,
        requiresConfirmation: true,
        isActive: true,
      },
    })

    let entitlement: EntitlementSnapshot | null = null
    if (userId) {
      entitlement = await new EntitlementResolver().resolveSnapshot(userId, options?.userEmail)
    }

    return rows.map((row: any) => ({
      ...(() => {
        const code = String(row.code)
        const baseTokenCost = Math.max(1, Number(row.tokenCost ?? 1))
        const matrixEntry = getTokenSpendRuleMatrixEntry(code)
        const decision = entitlement
          ? resolveTokenChargeDecisionForEntitlement({
              entitlement,
              ruleCode: code,
              baseTokenCost,
            })
          : null
        return {
          code,
          category: String(row.category),
          featureLabel: String(row.featureLabel),
          description: String(row.description ?? ""),
          tokenCost: decision?.effectiveTokenCost ?? baseTokenCost,
          baseTokenCost,
          pricingTier: matrixEntry?.tier ?? "mid",
          requiredPlan: matrixEntry?.requiredPlan ?? null,
          discountPct: decision?.discountPct ?? 0,
          chargeMode: decision?.chargeMode ?? "tokens_only",
          subscriptionEligible: decision?.subscriptionEligible ?? false,
          policyMessage:
            decision?.policyMessage ?? "Tokens apply at standard rate for this feature.",
          monthlyIncludedPremiumCredits:
            decision?.monthlyIncludedPremiumCredits ?? null,
          supportsUnlimitedLowTierInFuture:
            decision?.supportsUnlimitedLowTierInFuture ?? false,
          requiresConfirmation: Boolean(row.requiresConfirmation),
          isActive: Boolean(row.isActive),
        }
      })(),
    }))
  }

  async previewSpend(
    userId: string,
    ruleCode: TokenSpendRuleCode | string,
    userEmail?: string | null
  ): Promise<TokenSpendPreview> {
    if (isSubscriptionEntitlementBypassUserId(userId, userEmail)) {
      return buildDevAdminTokenSpendPreview(String(ruleCode))
    }

    await syncSeedDataIfNeeded()
    const [rule, balance, entitlement] = await Promise.all([
      this.getActiveRule(String(ruleCode)),
      this.getBalance(userId, userEmail),
      new EntitlementResolver().resolveSnapshot(userId, userEmail),
    ])
    return this.buildPreviewFromContext({
      rule,
      entitlement,
      currentBalance: Number(balance.balance || 0),
    })
  }

  async previewSpendWithEntitlement(input: {
    userId: string
    ruleCode: TokenSpendRuleCode | string
    entitlement: EntitlementSnapshot
    currentBalance?: number
    userEmail?: string | null
  }): Promise<TokenSpendPreview> {
    if (isSubscriptionEntitlementBypassUserId(input.userId, input.userEmail)) {
      return buildDevAdminTokenSpendPreview(String(input.ruleCode))
    }

    await syncSeedDataIfNeeded()
    const rule = await this.getActiveRule(String(input.ruleCode))
    const currentBalance =
      typeof input.currentBalance === "number"
        ? Number(input.currentBalance)
        : Number((await this.getBalance(input.userId, input.userEmail)).balance || 0)

    return this.buildPreviewFromContext({
      rule,
      entitlement: input.entitlement,
      currentBalance,
    })
  }

  async listUsageHistory(
    userId: string,
    options?: { limit?: number; offset?: number }
  ): Promise<TokenLedgerEntryView[]> {
    await syncSeedDataIfNeeded()
    const limit = Math.max(1, Math.min(100, Number(options?.limit ?? 30)))
    const offset = Math.max(0, Number(options?.offset ?? 0))

    const rows = (await (prisma as any).tokenLedger.findMany({
      where: { userId },
      include: {
        spendRule: {
          select: { featureLabel: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    })) as LedgerRow[]

    return rows.map(toLedgerView)
  }

  async listLedgerForAdmin(options?: {
    userId?: string | null
    limit?: number
    offset?: number
  }): Promise<TokenLedgerEntryView[]> {
    await syncSeedDataIfNeeded()
    const limit = Math.max(1, Math.min(200, Number(options?.limit ?? 50)))
    const offset = Math.max(0, Number(options?.offset ?? 0))
    const userId = options?.userId?.trim()

    const rows = (await (prisma as any).tokenLedger.findMany({
      where: userId ? { userId } : undefined,
      include: {
        spendRule: {
          select: { featureLabel: true },
        },
      },
      orderBy: { createdAt: "desc" },
      skip: offset,
      take: limit,
    })) as LedgerRow[]

    return rows.map(toLedgerView)
  }

  async grantTokensFromPackagePurchase(input: {
    userId: string
    packageSku: string
    sourceType: string
    sourceId?: string | null
    description?: string | null
    metadata?: Record<string, unknown> | null
    idempotencyKey?: string | null
  }): Promise<TokenLedgerEntryView> {
    await syncSeedDataIfNeeded()
    const idempotencyKey = input.idempotencyKey?.trim() || null

    return (prisma as any).$transaction(async (tx: any) => {
      if (idempotencyKey) {
        const existing = await tx.tokenLedger.findUnique({
          where: { idempotencyKey },
          include: { spendRule: { select: { featureLabel: true } } },
        })
        if (existing) return toLedgerView(existing as LedgerRow)
      }

      const tokenPackage = await tx.tokenPackage.findUnique({
        where: { sku: input.packageSku },
        select: { sku: true, tokenAmount: true, isActive: true },
      })
      if (!tokenPackage || !tokenPackage.isActive) {
        throw new Error(`Unknown token package sku: ${input.packageSku}`)
      }

      const balanceRow = await tx.userTokenBalance.upsert({
        where: { userId: input.userId },
        update: {},
        create: { userId: input.userId },
        select: { id: true },
      })

      await tx.userTokenBalance.update({
        where: { id: balanceRow.id },
        data: {
          balance: { increment: tokenPackage.tokenAmount },
          lifetimePurchased: { increment: tokenPackage.tokenAmount },
        },
      })

      const updated = await tx.userTokenBalance.findUnique({
        where: { id: balanceRow.id },
        select: { balance: true },
      })

      const balanceAfter = Number(updated?.balance || 0)
      const balanceBefore = balanceAfter - Number(tokenPackage.tokenAmount)

      const created = await tx.tokenLedger.create({
        data: {
          userId: input.userId,
          userTokenBalanceId: balanceRow.id,
          entryType: TOKEN_ENTRY_TYPES.PURCHASE,
          tokenDelta: Number(tokenPackage.tokenAmount),
          balanceBefore,
          balanceAfter,
          tokenPackageSku: tokenPackage.sku,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          idempotencyKey,
          description: input.description ?? null,
          metadata: input.metadata ?? null,
        },
        include: {
          spendRule: {
            select: { featureLabel: true },
          },
        },
      })

      return toLedgerView(created as LedgerRow)
    })
  }

  /**
   * Grant monthly subscription credits for a billing cycle.
   *
   * Called from the `invoice.payment_succeeded` Stripe webhook handler for
   * `subscription_cycle` and `subscription_create` billing reasons.
   *
   * Uses `subscription_credit:{invoiceId}` as the idempotency key — exactly-once
   * delivery even on Stripe retries.  Does NOT require a tokenPackage DB row;
   * writes directly to the balance and ledger.
   *
   * Returns null (non-throwing) if tokenAmount is 0 or negative.
   */
  async grantMonthlySubscriptionCredits(input: {
    userId: string
    tokenAmount: number
    planFamily: string
    invoiceId: string
    billingReason: string
  }): Promise<TokenLedgerEntryView | null> {
    if (!input.tokenAmount || input.tokenAmount <= 0) return null

    const idempotencyKey = `subscription_credit:${input.invoiceId}`

    return (prisma as any).$transaction(async (tx: any) => {
      // Idempotency: skip if we already granted for this invoice
      const existing = await tx.tokenLedger.findUnique({
        where: { idempotencyKey },
        include: { spendRule: { select: { featureLabel: true } } },
      })
      if (existing) return toLedgerView(existing as LedgerRow)

      const balanceRow = await tx.userTokenBalance.upsert({
        where: { userId: input.userId },
        update: {},
        create: { userId: input.userId },
        select: { id: true },
      })

      await tx.userTokenBalance.update({
        where: { id: balanceRow.id },
        data: {
          balance: { increment: input.tokenAmount },
          lifetimePurchased: { increment: input.tokenAmount },
        },
      })

      const updated = await tx.userTokenBalance.findUnique({
        where: { id: balanceRow.id },
        select: { balance: true },
      })

      const balanceAfter = Number(updated?.balance || 0)
      const balanceBefore = balanceAfter - input.tokenAmount

      const created = await tx.tokenLedger.create({
        data: {
          userId: input.userId,
          userTokenBalanceId: balanceRow.id,
          entryType: TOKEN_ENTRY_TYPES.PURCHASE,
          tokenDelta: input.tokenAmount,
          balanceBefore,
          balanceAfter,
          tokenPackageSku: null,
          sourceType: "subscription_included_credit",
          sourceId: input.invoiceId,
          idempotencyKey,
          description: `Subscription included credit — ${input.planFamily} (${input.billingReason})`,
          metadata: {
            planFamily: input.planFamily,
            invoiceId: input.invoiceId,
            billingReason: input.billingReason,
            grantType: "subscription_included_credit",
          },
        },
        include: {
          spendRule: { select: { featureLabel: true } },
        },
      })

      return toLedgerView(created as LedgerRow)
    })
  }

  async spendTokensForRule(input: {
    userId: string
    ruleCode: TokenSpendRuleCode | string
    confirmed: boolean
    sourceType: string
    sourceId?: string | null
    description?: string | null
    metadata?: Record<string, unknown> | null
    idempotencyKey?: string | null
    /** Session email — enables ADMIN_EMAILS platform-admin bypass for token charges. */
    userEmail?: string | null
  }): Promise<TokenLedgerEntryView> {
    if (isSubscriptionEntitlementBypassUserId(input.userId, input.userEmail)) {
      return buildDevAdminSpendLedgerEntry({
        ruleCode: String(input.ruleCode),
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        description: input.description ?? null,
        metadata: input.metadata ?? null,
      })
    }

    await syncSeedDataIfNeeded()
    const idempotencyKey = input.idempotencyKey?.trim() || null

    return (prisma as any).$transaction(async (tx: any) => {
      if (idempotencyKey) {
        const existing = await tx.tokenLedger.findUnique({
          where: { idempotencyKey },
          include: { spendRule: { select: { featureLabel: true } } },
        })
        if (existing) return toLedgerView(existing as LedgerRow)
      }

      const rule = await tx.tokenSpendRule.findUnique({
        where: { code: input.ruleCode },
        select: {
          code: true,
          tokenCost: true,
          requiresConfirmation: true,
          isActive: true,
        },
      })

      if (!rule || !rule.isActive) {
        throw new TokenSpendRuleNotFoundError(String(input.ruleCode))
      }

      const baseTokenCost = Math.max(1, Number(rule.tokenCost || 1))
      const decision: TokenChargeDecision = await resolveTokenChargeDecisionForUser({
        userId: input.userId,
        ruleCode: String(rule.code),
        baseTokenCost,
      })
      const tokenCost = Math.max(1, Number(decision.effectiveTokenCost || baseTokenCost))
      if (rule.requiresConfirmation && !input.confirmed) {
        throw new TokenSpendConfirmationRequiredError(String(rule.code), tokenCost)
      }

      const balanceRow = await tx.userTokenBalance.upsert({
        where: { userId: input.userId },
        update: {},
        create: { userId: input.userId },
        select: { id: true, balance: true, reservedBalance: true },
      })

      // Spendable EXCLUDES currently-held reservations, so an ordinary spend can never consume reserved tokens.
      const spendable = Number(balanceRow.balance || 0) - Number(balanceRow.reservedBalance || 0)
      if (spendable < tokenCost) {
        throw new TokenInsufficientBalanceError(tokenCost, Math.max(0, spendable))
      }

      // Atomic conditional spend guarded on spendable = balance - reserved_balance (correct under READ
      // COMMITTED via EvalPlanQual). A reservation racing this spend cannot cause an overspend.
      const affected = await tx.$executeRaw(Prisma.sql`
        UPDATE "user_token_balances"
        SET "balance" = "balance" - ${tokenCost},
            "lifetimeSpent" = "lifetimeSpent" + ${tokenCost},
            "updatedAt" = ${new Date()}
        WHERE "id" = ${balanceRow.id} AND ("balance" - "reserved_balance") >= ${tokenCost}`)

      if (Number(affected) !== 1) {
        const latest = await tx.userTokenBalance.findUnique({
          where: { id: balanceRow.id },
          select: { balance: true, reservedBalance: true },
        })
        throw new TokenInsufficientBalanceError(
          tokenCost,
          Math.max(0, Number(latest?.balance || 0) - Number(latest?.reservedBalance || 0)),
        )
      }

      const updated = await tx.userTokenBalance.findUnique({
        where: { id: balanceRow.id },
        select: { balance: true },
      })
      const balanceAfter = Number(updated?.balance || 0)
      const balanceBefore = balanceAfter + tokenCost

      const created = await tx.tokenLedger.create({
        data: {
          userId: input.userId,
          userTokenBalanceId: balanceRow.id,
          entryType: TOKEN_ENTRY_TYPES.SPEND,
          tokenDelta: tokenCost * -1,
          balanceBefore,
          balanceAfter,
          spendRuleCode: String(rule.code),
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          idempotencyKey,
          description: input.description ?? null,
          metadata: {
            ...(input.metadata ?? {}),
            pricingPolicy: {
              baseTokenCost,
              effectiveTokenCost: tokenCost,
              discountPct: decision.discountPct,
              chargeMode: decision.chargeMode,
              subscriptionEligible: decision.subscriptionEligible,
            },
          },
        },
        include: {
          spendRule: {
            select: { featureLabel: true },
          },
        },
      })

      return toLedgerView(created as LedgerRow)
    })
  }

  async refundSpendByLedger(input: {
    userId: string
    spendLedgerId: string
    refundRuleCode: TokenRefundRuleCode | string
    sourceType?: string
    sourceId?: string | null
    description?: string | null
    metadata?: Record<string, unknown> | null
    idempotencyKey?: string | null
    userEmail?: string | null
  }): Promise<TokenLedgerEntryView> {
    if (isSubscriptionEntitlementBypassUserId(input.userId, input.userEmail)) {
      return buildDevAdminRefundLedgerEntry({
        refundRuleCode: String(input.refundRuleCode),
        sourceType: input.sourceType ?? "refund_for_spend",
        sourceId: input.sourceId ?? input.spendLedgerId,
        description: input.description ?? null,
        metadata: input.metadata ?? null,
      })
    }

    await syncSeedDataIfNeeded()
    const idempotencyKey = input.idempotencyKey?.trim() || null

    return (prisma as any).$transaction(async (tx: any) => {
      if (idempotencyKey) {
        const existing = await tx.tokenLedger.findUnique({
          where: { idempotencyKey },
          include: { spendRule: { select: { featureLabel: true } } },
        })
        if (existing) return toLedgerView(existing as LedgerRow)
      }

      const refundRule = await tx.tokenRefundRule.findUnique({
        where: { code: input.refundRuleCode },
        select: { code: true, maxAgeMinutes: true, isActive: true },
      })
      if (!refundRule || !refundRule.isActive) {
        throw new TokenRefundNotAllowedError(`Unknown or inactive refund rule: ${input.refundRuleCode}`)
      }

      const originalSpend = await tx.tokenLedger.findFirst({
        where: {
          id: input.spendLedgerId,
          userId: input.userId,
          entryType: TOKEN_ENTRY_TYPES.SPEND,
        },
        select: {
          id: true,
          userTokenBalanceId: true,
          tokenDelta: true,
          createdAt: true,
        },
      })
      if (!originalSpend) {
        throw new TokenRefundNotAllowedError("Original spend ledger entry not found")
      }

      const existingRefund = await tx.tokenLedger.findFirst({
        where: {
          userId: input.userId,
          entryType: TOKEN_ENTRY_TYPES.REFUND,
          sourceType: "refund_for_spend",
          sourceId: originalSpend.id,
        },
        select: { id: true },
      })
      if (existingRefund?.id) {
        const row = await tx.tokenLedger.findUnique({
          where: { id: existingRefund.id },
          include: { spendRule: { select: { featureLabel: true } } },
        })
        return toLedgerView(row as LedgerRow)
      }

      if (refundRule.maxAgeMinutes && Number(refundRule.maxAgeMinutes) > 0) {
        const maxAgeMs = Number(refundRule.maxAgeMinutes) * 60_000
        if (Date.now() - new Date(originalSpend.createdAt).getTime() > maxAgeMs) {
          throw new TokenRefundNotAllowedError("Refund window has expired for this spend entry")
        }
      }

      const refundAmount = Math.abs(Number(originalSpend.tokenDelta || 0))
      if (refundAmount <= 0) {
        throw new TokenRefundNotAllowedError("Invalid spend amount for refund")
      }

      await tx.userTokenBalance.update({
        where: { id: originalSpend.userTokenBalanceId },
        data: {
          balance: { increment: refundAmount },
          lifetimeRefunded: { increment: refundAmount },
        },
      })

      const updated = await tx.userTokenBalance.findUnique({
        where: { id: originalSpend.userTokenBalanceId },
        select: { balance: true },
      })
      const balanceAfter = Number(updated?.balance || 0)
      const balanceBefore = balanceAfter - refundAmount

      const created = await tx.tokenLedger.create({
        data: {
          userId: input.userId,
          userTokenBalanceId: originalSpend.userTokenBalanceId,
          entryType: TOKEN_ENTRY_TYPES.REFUND,
          tokenDelta: refundAmount,
          balanceBefore,
          balanceAfter,
          refundRuleCode: String(refundRule.code),
          sourceType: input.sourceType ?? "refund_for_spend",
          sourceId: input.sourceId ?? originalSpend.id,
          idempotencyKey,
          description: input.description ?? null,
          metadata: input.metadata ?? null,
        },
        include: {
          spendRule: {
            select: { featureLabel: true },
          },
        },
      })

      return toLedgerView(created as LedgerRow)
    })
  }
}
