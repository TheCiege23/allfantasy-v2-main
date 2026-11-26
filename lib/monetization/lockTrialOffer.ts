import { messagesFor, defineMessages } from '@/lib/i18n/messages'
import { getMonetizationCatalogItemBySku, type MonetizationSku } from '@/lib/monetization/catalog'
import { normalizePlanFamilyInput } from '@/lib/monetization/upgradeDestination'
import { TRIAL_SKUS } from '@/lib/monetization/freeTrial'
import { trialAppliesTo, type TrialOffer } from '@/lib/monetization/useTrialOffer'

/**
 * "Try AF Pro free for 7 days" on the lock cards (2026-11-24). Measured over the 30 days before: 17
 * paywall views by 8 people, 0 clicks — and no lock said the trial existed; only /pricing and /upgrade
 * did. PURE and client-safe; the hook that feeds it is `useLockTrialOffer.ts`.
 *
 * ⚠ NO SECOND RULE. Who is eligible is `/api/monetization/trial-eligibility` (an account that never
 * had a subscription, web only, `AF_PRO_TRIAL_DAYS`), and checkout decides again on the server. This
 * only maps a lock's plan to the SKU its link sells and words the offer.
 *
 * ⚠ ONLY THE PLAN THE TRIAL COVERS. A lock asking for AF Commissioner or AF Legacy says nothing about a
 * trial — the trial is AF Pro's (`TRIAL_SKUS`), and the lock link sells the MONTHLY plan
 * (`monthlyUpgradeHref`), so the SKU is `af_pro_monthly` and the price line is its catalog price.
 *
 * ⚠ ONLY `eligible === true`. Signed out (`null`) a lock card is not the place to promise a trial.
 */

/** The SKU a lock for `requiredPlan` sells, if the trial can start on it; null otherwise. */
export function lockTrialSku(requiredPlan: string | null | undefined): string | null {
  if (!requiredPlan) return null
  const raw = requiredPlan.trim().toLowerCase()
  if (TRIAL_SKUS.includes(raw)) return raw
  return normalizePlanFamilyInput(requiredPlan) === 'af_pro' ? 'af_pro_monthly' : null
}

export const lockTrialMessages = defineMessages({
  en: {
    cta: (days: number, plan: string): string => `Try ${plan} free for ${days} days`,
    then: (price: string): string => `Then ${price}/mo, cancel anytime`,
  },
  es: {
    cta: (days, plan) => `Prueba ${plan} gratis durante ${days} días`,
    then: (price) => `Después ${price}/mes, cancela cuando quieras`,
  },
})

export type LockTrialCopy = { cta: string; then: string | null }

/** The words, or null when the offer does not apply to this lock. */
export function lockTrialCopy(
  offer: TrialOffer,
  requiredPlan: string | null | undefined,
  language?: string | null,
): LockTrialCopy | null {
  const sku = lockTrialSku(requiredPlan)
  if (!sku || offer.eligible !== true || !trialAppliesTo(offer, sku)) return null
  const m = messagesFor(lockTrialMessages, language)
  // The catalog is the price /pricing prints (app/pricing/page.tsx reads the same amountUsd). No price →
  // no price line, never a hard-coded one.
  const amount = getMonetizationCatalogItemBySku(sku as MonetizationSku)?.amountUsd
  const price = typeof amount === 'number' && amount > 0 ? `$${amount.toFixed(2)}` : null
  return { cta: m.cta(offer.days, 'AF Pro'), then: price ? m.then(price) : null }
}
