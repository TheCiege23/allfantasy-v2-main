import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { render, renderHook, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useTokenBalance } from '@/hooks/useTokenBalance'
import { usePostPurchaseSync } from '@/hooks/usePostPurchaseSync'
import { getMonetizationCatalogItemBySku } from '@/lib/monetization/catalog'
import { SUBSCRIPTION_TOKEN_POLICY_CONFIG } from '@/lib/tokens/subscription-policy'
import { AccountSettingsSection } from '@/app/settings/components/sections/AccountSettingsSection'
import { BillingSettingsSection } from '@/app/settings/components/sections/BillingSettingsSection'
import { toast } from 'sonner'

const root = resolve(__dirname, '..')
function read(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8')
}

/**
 * Honesty Pack — Billing Truth. Every billing/entitlement/token value shown to a user must come
 * from a real source or clearly say it's unavailable — never guessed, cached-stale, hardcoded, or
 * fabricated on a fetch failure. Source-scan contracts follow this repo's existing no-stub-leakage
 * pattern; the token-balance hook test follows the existing renderHook + fetch-mock convention
 * (see chimmy-alert-actions-hook.test.ts).
 *
 * `fetchMock` is declared once at module scope (not per-describe) because `vi.stubGlobal` mutates
 * the real global — a second `vi.stubGlobal('fetch', ...)` in a later describe block would silently
 * replace the first describe block's mock for the whole file, since describe bodies all run during
 * collection before any `it` executes.
 */
const fetchMock = vi.fn()
vi.stubGlobal('fetch', fetchMock)

vi.mock('@/components/i18n/LanguageProviderClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/i18n/LanguageProviderClient')>()
  return { ...actual, useLanguage: () => actual.defaultLanguageValue }
})

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams('success=true'),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), error: vi.fn(), custom: vi.fn() },
}))

describe('Billing Truth — useTokenBalance never fabricates a zero balance on failure', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('returns balance: null (not 0) when the balance fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
    const { result } = renderHook(() => useTokenBalance())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.balance).toBeNull()
    expect(result.current.error).toBeTruthy()
  })

  it('returns the real balance (including a genuine 0) when the fetch succeeds', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        balance: 0,
        updatedAt: '2026-01-01T00:00:00.000Z',
        isAdminBypassAccount: false,
        lifetimePurchased: 0,
        lifetimeSpent: 0,
        lifetimeRefunded: 0,
      }),
    })
    const { result } = renderHook(() => useTokenBalance())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(result.current.balance).toBe(0)
    expect(result.current.error).toBeNull()
  })
})

describe('Billing Truth — AF Supreme token grant consistency', () => {
  it('the catalog display value matches the real grant policy (regression guard for the 1500 vs 1000 drift)', () => {
    const monthly = getMonetizationCatalogItemBySku('af_supreme_monthly')
    const yearly = getMonetizationCatalogItemBySku('af_supreme_yearly')
    const policy = SUBSCRIPTION_TOKEN_POLICY_CONFIG.plans.supreme

    expect(monthly?.tokenAmount).toBe(policy.monthlyIncludedPremiumCredits)
    expect(yearly?.tokenAmount).toBe(policy.yearlyIncludedPremiumCredits)
  })

  it('the spotlight marketing copy does not hardcode a different number than the catalog', () => {
    const monthly = getMonetizationCatalogItemBySku('af_supreme_monthly')
    const yearly = getMonetizationCatalogItemBySku('af_supreme_yearly')
    const copy = read('components/monetization/AFSupremeBundleSpotlight.tsx')
    expect(copy).toContain(`Includes ${monthly?.tokenAmount?.toLocaleString()} tokens monthly`)
    expect(copy).toContain(`${yearly?.tokenAmount?.toLocaleString()} yearly`)
  })
})

describe('Billing Truth — admin bypass is disclosed, not shown as a real subscription', () => {
  it('the entitlements API exposes isAdminBypassAccount, mirroring /api/tokens/balance', () => {
    const route = read('app/api/subscription/entitlements/route.ts')
    expect(route).toContain('isSubscriptionEntitlementBypassUserId')
    expect(route).toContain('isAdminBypassAccount')
  })

  it('useEntitlement and useEntitlements both surface isAdminBypassAccount to consumers', () => {
    expect(read('hooks/useEntitlement.ts')).toContain('isAdminBypassAccount')
    expect(read('hooks/useEntitlements.ts')).toContain('isAdminBypassAccount')
  })

  it('BillingSettingsSection discloses bypass accounts and hides the dead-end Manage Billing link', () => {
    const src = read('app/settings/components/sections/BillingSettingsSection.tsx')
    expect(src).toContain('ents.isAdminBypassAccount')
    expect(src).toContain('!ents.isAdminBypassAccount')
  })
})

describe('Billing Truth — Account tab shows a real plan, not a hardcoded Free', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('AccountSettingsSection derives a real plan from useEntitlements instead of trusting a null prop', () => {
    const src = read('app/settings/components/sections/AccountSettingsSection.tsx')
    expect(src).toContain('useEntitlements')
    expect(src).toContain('derivedPlanDisplay')
  })

  // Regression test for a review-caught bug: the original derivedPlanDisplay only checked
  // `ents.loading`, never `ents.error`, so a genuine fetch failure fell through the same
  // tier-priority chain as a verified free plan and rendered "Free" — indistinguishable from a
  // real, checked answer. This must render "Unable to verify" instead.
  it('renders "Unable to verify" (not "Free") when the entitlements fetch fails', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })

    render(<AccountSettingsSection accountCreatedAt={null} planLabel={null} />)

    await screen.findByText('Unable to verify')
    expect(screen.queryByText('Free')).toBeNull()
  })

  it('renders the real plan name once entitlements load successfully', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        entitlement: { plans: ['supreme'], status: 'active', currentPeriodEnd: null, gracePeriodEnd: null },
        isAdminBypassAccount: false,
      }),
    })

    render(<AccountSettingsSection accountCreatedAt={null} planLabel={null} />)

    await screen.findByText('AF Supreme')
  })
})

describe('Billing Truth — Billing tab shows a real plan, not a hardcoded Free', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  function mockTokenBalanceSuccess() {
    return Promise.resolve({
      ok: true,
      json: async () => ({
        balance: 0,
        updatedAt: '2026-01-01T00:00:00.000Z',
        isAdminBypassAccount: false,
        lifetimePurchased: 0,
        lifetimeSpent: 0,
        lifetimeRefunded: 0,
      }),
    })
  }

  // Regression test for a review-caught bug: BillingSettingsSection (the actual Billing tab, one of
  // this PR's own 5 headline "fixed" surfaces) never checked `ents.error` before deriving `hasAnySub`
  // and the plan/status display -- a genuine entitlements fetch failure rendered "Free" and a "FREE"
  // status pill, identical to a verified free account, with the real error appearing only as a small
  // line far below. This must render "Unable to verify" instead, the same fix already applied to
  // SettingsChrome.tsx and AccountSettingsSection.tsx.
  it('renders "Unable to verify" (not "Free") when the entitlements fetch fails', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/subscription/entitlements')) {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({ error: 'boom' }) })
      }
      if (url.includes('/api/tokens/balance')) return mockTokenBalanceSuccess()
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })

    render(<BillingSettingsSection />)

    // Both the plan-text spot and the status pill share the same verificationFailed flag, so
    // "Unable to verify" must appear twice -- neither may fall back to "AF Free" / "Free".
    const errorSurfaces = await screen.findAllByText('Unable to verify')
    expect(errorSurfaces.length).toBe(2)
    expect(screen.queryByText('AF Free')).toBeNull()
    expect(screen.queryByText('Free')).toBeNull()
  })

  it('renders the real plan and status once entitlements load successfully', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/subscription/entitlements')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            entitlement: { plans: ['supreme'], status: 'active', currentPeriodEnd: null, gracePeriodEnd: null },
            isAdminBypassAccount: false,
          }),
        })
      }
      if (url.includes('/api/tokens/balance')) return mockTokenBalanceSuccess()
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })

    render(<BillingSettingsSection />)

    await screen.findByText('AF Supreme')
    expect(screen.queryByText('Unable to verify')).toBeNull()
  })

  it('renders a genuine free account as Free, not conflated with an error state', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/subscription/entitlements')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            entitlement: { plans: [], status: 'none', currentPeriodEnd: null, gracePeriodEnd: null },
            isAdminBypassAccount: false,
          }),
        })
      }
      if (url.includes('/api/tokens/balance')) return mockTokenBalanceSuccess()
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })

    render(<BillingSettingsSection />)

    await screen.findByText('AF Free')
    expect(screen.queryByText('Unable to verify')).toBeNull()
  })
})

describe('Billing Truth — checkout success is never claimed without real verification', () => {
  beforeEach(() => {
    fetchMock.mockReset()
  })

  it('usePostPurchaseSync no longer treats no_session as equivalent to a verified sync', () => {
    const src = read('hooks/usePostPurchaseSync.ts')
    expect(src).not.toContain("syncStatus === 'synced' || syncStatus === 'no_session'")
    expect(src).toContain("if (syncStatus === 'no_session')")
  })

  it('the donate success page no longer asserts unverified payment confirmation', () => {
    const src = read('app/donate/success/page.tsx')
    expect(src).not.toContain('>Payment confirmed<')
    expect(src).not.toContain('Bracket Lab Pass unlocked')
  })

  // Regression test for direct navigation to a success URL without a completed payment: a bare
  // `?success=true` (no session_id) must never resolve as a verified purchase, since the server
  // has nothing to check it against. `next/navigation` is mocked at module scope to exactly this
  // URL shape (see top of file).
  it('never reports success when the URL claims success but carries no session_id to verify', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/api/monetization/post-purchase-sync')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            syncStatus: 'no_session',
            syncMessage: 'No checkout session id provided. Refreshed current state.',
            sessionId: null,
            syncEvidence: { subscription: false, tokens: false },
          }),
        })
      }
      if (url.includes('/api/subscription/entitlements')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            entitlement: { plans: [], status: 'none', currentPeriodEnd: null, gracePeriodEnd: null },
            isAdminBypassAccount: false,
            hasAccess: false,
          }),
        })
      }
      if (url.includes('/api/tokens/balance')) {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            balance: 0,
            updatedAt: '',
            isAdminBypassAccount: false,
            lifetimePurchased: 0,
            lifetimeSpent: 0,
            lifetimeRefunded: 0,
          }),
        })
      }
      return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
    })

    const { result } = renderHook(() => usePostPurchaseSync())

    await waitFor(() => expect(result.current.state.phase).toBe('idle'))

    expect(result.current.state.phase).not.toBe('success')
    expect(toast.success).not.toHaveBeenCalled()
  })
})

describe('Billing Truth — no upgrade nag for already-entitled users', () => {
  it('ImproveTradeModal does not show the Pro upsell to users who already have Pro/Supreme', () => {
    const src = read('app/components/ImproveTradeModal.tsx')
    expect(src).toContain('alreadyHasPro')
    expect(src).toContain('moreCount >= MAX_MORE_CLICKS && !alreadyHasPro')
  })
})

describe('Billing Truth — /api/monetization/context never fabricates a safe response on backend failure', () => {
  // Regression test for a review-caught bug: the route swallowed a real EntitlementResolver /
  // TokenBalanceResolver failure into a fabricated { plans: [], status: 'none' } / { balance: 0 }
  // 200 response -- indistinguishable from a real, verified free/zero-balance account. useMonetizationContext
  // already correctly treats a non-2xx response as unavailable (setError + setData(null)); the route
  // just needed to stop hiding the failure behind a 200.
  it('returns a real error status (not a fake 200) when the entitlement resolver fails', async () => {
    vi.resetModules()
    vi.doMock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com' } }) }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/subscription/EntitlementResolver', () => ({
      EntitlementResolver: class {
        resolveForUser() {
          return Promise.reject(new Error('db unreachable'))
        }
      },
    }))
    vi.doMock('@/lib/tokens/TokenBalanceResolver', () => ({
      TokenBalanceResolver: class {
        resolveForUser() {
          return Promise.resolve({ balance: 42, lifetimePurchased: 0, lifetimeSpent: 0, lifetimeRefunded: 0, updatedAt: '' })
        }
      },
    }))

    const { GET } = await import('@/app/api/monetization/context/route')
    const req = new Request('http://localhost/api/monetization/context')
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(json.entitlement).toBeUndefined()
    expect(json.tokenBalance).toBeUndefined()

    vi.doUnmock('next-auth')
    vi.doUnmock('@/lib/auth')
    vi.doUnmock('@/lib/subscription/EntitlementResolver')
    vi.doUnmock('@/lib/tokens/TokenBalanceResolver')
    vi.resetModules()
  })

  it('returns a real error status (not a fake 200) when the token balance resolver fails', async () => {
    vi.resetModules()
    vi.doMock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'user-1', email: 'u@example.com' } }) }))
    vi.doMock('@/lib/auth', () => ({ authOptions: {} }))
    vi.doMock('@/lib/subscription/EntitlementResolver', () => ({
      EntitlementResolver: class {
        resolveForUser() {
          return Promise.resolve({
            entitlement: { plans: [], status: 'none', currentPeriodEnd: null, gracePeriodEnd: null },
            hasAccess: false,
            message: 'Upgrade to access this feature.',
          })
        }
      },
    }))
    vi.doMock('@/lib/tokens/TokenBalanceResolver', () => ({
      TokenBalanceResolver: class {
        resolveForUser() {
          return Promise.reject(new Error('db unreachable'))
        }
      },
    }))

    const { GET } = await import('@/app/api/monetization/context/route')
    const req = new Request('http://localhost/api/monetization/context')
    const res = await GET(req)
    const json = await res.json()

    expect(res.status).toBeGreaterThanOrEqual(500)
    expect(json.tokenBalance).toBeUndefined()

    vi.doUnmock('next-auth')
    vi.doUnmock('@/lib/auth')
    vi.doUnmock('@/lib/subscription/EntitlementResolver')
    vi.doUnmock('@/lib/tokens/TokenBalanceResolver')
    vi.resetModules()
  })
})

describe('Billing Truth — no fabricated per-league token event history', () => {
  it('the Survivor Exile Tokens page no longer hardcodes the same 4 events for every league', () => {
    const src = read('app/survivor/[leagueId]/exile/tokens/page.tsx')
    expect(src).not.toContain('Exile challenge winner')
    expect(src).not.toContain('Stat hunt correct')
  })
})
