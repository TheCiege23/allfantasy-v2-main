import type {
  EntitlementStatus,
  SubscriptionFeatureId,
  SubscriptionPlanId,
} from "@/lib/subscription/types"
import {
  buildDevAdminEntitlementSnapshot,
  isSubscriptionEntitlementBypassUserId,
} from "@/lib/dev-admin/access"
import { prisma } from "@/lib/prisma"
import {
  hasFeatureAccessForPlans,
  isActiveOrGraceStatus,
} from "@/lib/subscription/feature-access"
import { resolveSubscriptionStatus } from "@/lib/subscription/SubscriptionStatusResolver"

export type EntitlementSnapshot = {
  plans: SubscriptionPlanId[]
  status: EntitlementStatus
  currentPeriodEnd: string | null
  gracePeriodEnd: string | null
}

export type EntitlementResolveResult = {
  entitlement: EntitlementSnapshot
  hasAccess: boolean
  message: string
}

const EMPTY_ENTITLEMENT: EntitlementSnapshot = {
  plans: [],
  status: "none",
  currentPeriodEnd: null,
  gracePeriodEnd: null,
}

type DbUserSubscriptionRow = {
  status?: string | null
  sku?: string | null
  currentPeriodEnd?: Date | null
  gracePeriodEnd?: Date | null
  expiresAt?: Date | null
  plan?: {
    code?: string | null
  } | null
}

const PLAN_CODE_TO_ID: Record<string, SubscriptionPlanId> = {
  af_pro: "pro",
  pro: "pro",
  af_commissioner: "commissioner",
  commissioner: "commissioner",
  af_war_room: "war_room",
  war_room: "war_room",
  af_supreme: "supreme",
  supreme: "supreme",
  af_enterprise: "enterprise",
  enterprise: "enterprise",
}

/** Valid tier strings for admin-granted subscriptions — mirrors SubscriptionPlanId. */
const GRANT_TIER_TO_PLAN_ID: Record<string, SubscriptionPlanId> = {
  pro: "pro",
  commissioner: "commissioner",
  war_room: "war_room",
  supreme: "supreme",
  // Owner/enterprise access is granted by assigning this tier (admin-grant path).
  enterprise: "enterprise",
}

function mapSkuToPlanId(sku: string | null | undefined): SubscriptionPlanId | null {
  if (!sku) return null
  const normalized = sku.trim().toLowerCase()
  if (normalized.startsWith("af_pro_")) return "pro"
  if (normalized.startsWith("af_commissioner_")) return "commissioner"
  if (normalized.startsWith("af_war_room_")) return "war_room"
  if (normalized.startsWith("af_supreme_")) return "supreme"
  return null
}

function mapPlanCodeToPlanId(code: string | null | undefined): SubscriptionPlanId | null {
  if (!code) return null
  return PLAN_CODE_TO_ID[code.trim().toLowerCase()] ?? null
}

export class EntitlementResolver {
  async resolveForUser(
    userId: string,
    featureId?: SubscriptionFeatureId,
    email?: string | null
  ): Promise<EntitlementResolveResult> {
    const entitlement = await this.resolveSnapshot(userId, email)
    const hasAccess = featureId
      ? this.hasFeatureAccess(entitlement, featureId)
      : isActiveOrGraceStatus(entitlement.status)

    const message =
      entitlement.status === "past_due"
        ? "Subscription past due. Update billing to restore premium access."
        : entitlement.status === "expired"
          ? "Subscription expired. Renew to restore premium access."
          : hasAccess
            ? "Access granted."
            : "Upgrade to access this feature."

    return {
      entitlement,
      hasAccess,
      message,
    }
  }

  async resolveSnapshot(userId: string, email?: string | null): Promise<EntitlementSnapshot> {
    if (isSubscriptionEntitlementBypassUserId(userId, email)) {
      return buildDevAdminEntitlementSnapshot()
    }

    const now = new Date()

    const [subscriptions, activeGrants] = await Promise.all([
      (prisma as any).userSubscription
        .findMany({
          where: { userId },
          include: { plan: { select: { code: true } } },
          orderBy: [{ currentPeriodEnd: "desc" }, { createdAt: "desc" }],
        })
        .catch(() => []) as Promise<DbUserSubscriptionRow[]>,
      (prisma as any).adminSubscriptionGrant
        .findMany({
          where: {
            userId,
            revokedAt: null,
            expiresAt: { gt: now },
          },
          orderBy: [{ expiresAt: "desc" }],
          select: { tier: true, expiresAt: true },
        })
        .catch(() => []) as Promise<Array<{ tier: string; expiresAt: Date }>>,
    ])

    if (!subscriptions.length && !activeGrants.length) {
      return { ...EMPTY_ENTITLEMENT }
    }
    const statusCounts: Record<EntitlementStatus, number> = {
      active: 0,
      grace: 0,
      past_due: 0,
      expired: 0,
      none: 0,
    }
    const plans = new Set<SubscriptionPlanId>()
    let latestCurrentPeriodEnd: Date | null = null
    let latestGracePeriodEnd: Date | null = null

    for (const subscription of subscriptions) {
      const status = resolveSubscriptionStatus({
        status: subscription.status,
        currentPeriodEnd: subscription.currentPeriodEnd ?? null,
        gracePeriodEnd: subscription.gracePeriodEnd ?? null,
        expiresAt: subscription.expiresAt ?? null,
      }, now)
      statusCounts[status] += 1

      if (subscription.currentPeriodEnd) {
        if (!latestCurrentPeriodEnd || subscription.currentPeriodEnd > latestCurrentPeriodEnd) {
          latestCurrentPeriodEnd = subscription.currentPeriodEnd
        }
      }
      if (subscription.gracePeriodEnd) {
        if (!latestGracePeriodEnd || subscription.gracePeriodEnd > latestGracePeriodEnd) {
          latestGracePeriodEnd = subscription.gracePeriodEnd
        }
      }

      if (!isActiveOrGraceStatus(status)) continue
      const planId =
        mapPlanCodeToPlanId(subscription.plan?.code) ??
        mapSkuToPlanId(subscription.sku)
      if (planId) plans.add(planId)
    }

    // Admin-granted subscriptions always count as 'active' while not revoked + not expired.
    let grantBumpedActive = false
    for (const grant of activeGrants) {
      const planId = GRANT_TIER_TO_PLAN_ID[grant.tier.trim().toLowerCase()]
      if (!planId) continue
      plans.add(planId)
      grantBumpedActive = true
      if (!latestCurrentPeriodEnd || grant.expiresAt > latestCurrentPeriodEnd) {
        latestCurrentPeriodEnd = grant.expiresAt
      }
    }

    const overallStatus: EntitlementStatus = grantBumpedActive
      ? "active"
      : statusCounts.active > 0
        ? "active"
        : statusCounts.grace > 0
          ? "grace"
          : statusCounts.past_due > 0
            ? "past_due"
            : statusCounts.expired > 0
              ? "expired"
              : "none"

    return {
      plans: Array.from(plans),
      status: overallStatus,
      currentPeriodEnd: latestCurrentPeriodEnd ? latestCurrentPeriodEnd.toISOString() : null,
      gracePeriodEnd: latestGracePeriodEnd ? latestGracePeriodEnd.toISOString() : null,
    }
  }

  hasFeatureAccess(entitlement: EntitlementSnapshot, featureId: SubscriptionFeatureId): boolean {
    return hasFeatureAccessForPlans(entitlement.plans, entitlement.status, featureId)
  }
}
