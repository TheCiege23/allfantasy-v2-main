'use client'

import { useEffect, useState } from 'react'

type EntitlementData = {
  entitlement: {
    plans: string[]
    status: 'active' | 'grace' | 'past_due' | 'expired' | 'none'
    currentPeriodEnd: string | null
    gracePeriodEnd: string | null
  }
  hasAccess: boolean
  message: string
  requiredPlan: string | null
  upgradePath: string
}

const FALLBACK: EntitlementData = {
  entitlement: { plans: [], status: 'none', currentPeriodEnd: null, gracePeriodEnd: null },
  hasAccess: false,
  message: 'Sign in to check access.',
  requiredPlan: null,
  upgradePath: '/pricing',
}

function isValidEntitlement(json: unknown): json is EntitlementData {
  if (!json || typeof json !== 'object') return false
  const o = json as Record<string, unknown>
  return (
    o.entitlement !== null &&
    typeof o.entitlement === 'object' &&
    typeof o.hasAccess === 'boolean'
  )
}

const BUNDLE_GRANTS: Record<string, string[]> = {
  pro: ['pro', 'all_access', 'supreme'],
  commissioner: ['commissioner', 'all_access', 'supreme'],
  war_room: ['war_room', 'all_access', 'supreme'],
}

function hasBundleAccess(plans: string[], planFamily: string): boolean {
  return (BUNDLE_GRANTS[planFamily] ?? [planFamily]).some((p) => plans.includes(p))
}

export default function SubscriptionEntitlementHarnessClient() {
  const [entData, setEntData] = useState<EntitlementData | null>(null)
  const [gateResult, setGateResult] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/subscription/entitlements?feature=ai_chat')
      .then((r) => r.json())
      .then((json: unknown) => {
        setEntData(isValidEntitlement(json) ? json : FALLBACK)
      })
      .catch(() => setEntData(FALLBACK))
  }, [])

  async function checkFeatureGate() {
    try {
      const res = await fetch('/api/subscription/feature-gate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ featureId: 'ai_chimmy_chat_message' }),
      })
      const json = await res.json()
      setGateResult(json.message ?? (res.ok ? 'Access granted.' : 'Feature locked.'))
    } catch {
      setGateResult('Feature gate check failed.')
    }
  }

  const current = entData ?? FALLBACK
  const plans = (current.entitlement as EntitlementData['entitlement'])?.plans ?? []
  const status = (current.entitlement as EntitlementData['entitlement'])?.status ?? 'none'
  const { hasAccess, message, upgradePath } = current

  return (
    <div
      className="min-h-screen bg-[#0a0a0f] p-8 text-white"
      data-testid="subscription-entitlement-harness"
    >
      {entData === null ? (
        <div data-testid="harness-loading" className="text-white/60">Loading entitlement…</div>
      ) : (
        <>
          <div data-testid="entitlement-status" className="mb-4 text-sm text-white/60">
            Status: {status}
          </div>

          {!hasAccess && (
            <div className="mb-6 space-y-3">
              <p data-testid="locked-feature-status-message" className="text-sm text-red-400">
                {message}
              </p>
              <div className="flex gap-3">
                <a
                  href={upgradePath ?? '/pricing'}
                  data-testid="locked-feature-upgrade-link"
                  className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                >
                  View plans
                </a>
                <a
                  href="/tokens?ruleCode=ai_chimmy_chat_message"
                  data-testid="locked-feature-token-fallback-link"
                  className="rounded bg-gray-700 px-4 py-2 text-sm font-medium text-white hover:bg-gray-600"
                >
                  Use tokens instead
                </a>
              </div>
            </div>
          )}

          {hasAccess && (
            <div className="mb-6">
              <a
                href="/app/home"
                data-testid="entitled-feature-link"
                className="rounded bg-green-700 px-4 py-2 text-sm font-medium text-white hover:bg-green-600"
              >
                Open feature
              </a>
            </div>
          )}

          <div className="mb-6">
            <button
              data-testid="backend-feature-gate-check-button"
              onClick={checkFeatureGate}
              className="rounded bg-purple-700 px-4 py-2 text-sm font-medium text-white hover:bg-purple-600"
              type="button"
            >
              Check backend feature gate
            </button>
            {gateResult !== null && (
              <p data-testid="backend-feature-gate-result" className="mt-2 text-sm text-white/80">
                {gateResult}
              </p>
            )}
          </div>

          <div className="space-y-2 text-sm">
            <div data-testid="bundle-check-pro">
              Pro access: {hasBundleAccess(plans, 'pro') ? 'granted' : 'denied'}
            </div>
            <div data-testid="bundle-check-commissioner">
              Commissioner access: {hasBundleAccess(plans, 'commissioner') ? 'granted' : 'denied'}
            </div>
            <div data-testid="bundle-check-warroom">
              AF Legacy access: {hasBundleAccess(plans, 'war_room') ? 'granted' : 'denied'}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
