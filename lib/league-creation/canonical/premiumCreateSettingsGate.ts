import type { EntitlementSnapshot } from '@/lib/subscription/EntitlementResolver'
import {
  expandPlansWithBundle,
  isActiveOrGraceStatus,
} from '@/lib/subscription/feature-access'
import type { SubscriptionPlanId } from '@/lib/subscription/types'
import {
  PREMIUM_ADVANCED_CREATE_KEYS,
  type PremiumAdvancedCreateKey,
} from '@/lib/create-league-v2/simple-create'

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  return value as Record<string, unknown>
}

export function findPremiumCreateSettingKeys(conceptSetup: unknown): PremiumAdvancedCreateKey[] {
  const setup = readRecord(conceptSetup)
  const advancedSetup = readRecord(setup?.advancedSetup)
  if (!advancedSetup) return []

  return PREMIUM_ADVANCED_CREATE_KEYS.filter((key) => advancedSetup[key] === true)
}

export function hasAfCommissionerCreateEntitlement(entitlement: EntitlementSnapshot): boolean {
  if (!isActiveOrGraceStatus(entitlement.status)) return false
  const expanded = expandPlansWithBundle(entitlement.plans as SubscriptionPlanId[])
  return (
    expanded.includes('commissioner') ||
    expanded.includes('supreme')
  )
}
