"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { useEntitlements } from "@/hooks/useEntitlements"
import { TokenBalanceWidget } from "@/components/tokens/TokenBalanceWidget"
import { isAppleApp, manageAppleSubscriptions } from "@/lib/monetization/apple-iap-client"

/** Status-chip copy per EntitlementStatus; an unlisted status still renders its raw value. */
const BILLING_STATUS_KEYS: Record<string, string> = {
  active: "settings.billing.statusActive",
  grace: "settings.billing.statusGrace",
  past_due: "settings.billing.statusPastDue",
  expired: "settings.billing.statusExpired",
}

export function BillingSettingsSection() {
  const { t, tInterpolate } = useLanguage()
  const ents = useEntitlements()
  // Set by /api/subscription/billing-portal when Stripe could not open a portal session.
  const portalError = useSearchParams()?.get("billing") === "portal_error"
  /*
   * Inside the iOS app, "Manage billing" opens Apple's own subscription sheet (StoreKit, through the
   * same bridge /pricing's "Manage Subscriptions" uses) — a subscription bought in the app can only
   * be changed or cancelled there, and the app does not hand Stripe pages to Apple's reviewers.
   * Read after mount: the bridge exists only in the client, so the server render is the web button.
   */
  const [appleApp, setAppleApp] = useState(false)
  const [appleManageError, setAppleManageError] = useState<string | null>(null)
  useEffect(() => {
    setAppleApp(isAppleApp())
  }, [])

  if (ents.loading) {
    return <div className="animate-pulse h-20 rounded-xl bg-white/[0.05]" data-testid="settings-billing-loading" />
  }

  const snap = ents.snapshot
  const hasAnySub = ents.hasAnyPaid
  const status = snap?.status ?? "none"

  return (
    <section className="space-y-4" data-testid="settings-billing-section">
      <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{t("settings.nav.billing")}</h2>

      <div className="rounded-xl border p-5" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-xs uppercase tracking-wider" style={{ color: "var(--muted2)" }}>{t("settings.billing.currentPlan")}</p>
            {hasAnySub ? (
              <div className="flex flex-wrap items-center gap-2">
                {/* The hub's plan chip: gold for the top plan, neutral for the rest. */}
                {ents.hasSupreme && (
                  <span className="ns-hub-chip" data-tone="plan">
                    AF Supreme
                  </span>
                )}
                {!ents.hasSupreme && ents.hasCommissioner && <span className="ns-hub-chip">AF Commissioner</span>}
                {!ents.hasSupreme && ents.hasPro && <span className="ns-hub-chip">AF Pro</span>}
                {!ents.hasSupreme && ents.hasWarRoom && <span className="ns-hub-chip">AF Legacy</span>}
              </div>
            ) : ents.error ? (
              /*
               * ⚠ A FAILED LOOKUP IS NOT A FREE PLAN. The hook keeps its booleans at their last-known
               * value (false on a first-load failure), so this read "AF Free" to a paying subscriber
               * whenever entitlements failed to load — while Account and the hub said "Unable to
               * verify". Same words as those two now.
               */
              <p className="text-sm font-semibold text-white" data-testid="settings-billing-unverified">
                {t("settings.billing.unableToVerify")}
              </p>
            ) : (
              <p className="text-sm font-semibold text-white">{t("settings.billing.afFree")}</p>
            )}
          </div>

          <span
            className={[
              "rounded-full border px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide",
              status === "active"
                ? "border-green-500/30 bg-green-500/10 text-green-300"
                : status === "grace"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : status === "past_due"
                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                    : "border-white/[0.1] bg-white/[0.03] text-white/40",
            ].join(" ")}
          >
            {status === "none"
              ? ents.error
                ? t("settings.billing.statusUnknown")
                : t("settings.billing.statusFree")
              : BILLING_STATUS_KEYS[status]
                ? t(BILLING_STATUS_KEYS[status])
                : status.replace(/_/g, " ")}
          </span>
        </div>

        {snap?.currentPeriodEnd && (
          <p className="mt-2 text-xs" style={{ color: "var(--muted2)" }}>
            {status === "active" ? t("settings.billing.renews") : t("settings.billing.accessUntil")}{" "}
            {new Date(snap.currentPeriodEnd).toLocaleDateString()}
          </p>
        )}

        {status === "past_due" && (
          <div className="alert-error mt-3 rounded-xl border p-3 text-xs">
            {t("settings.billing.paymentFailed")}
          </div>
        )}

        {status === "grace" && snap?.gracePeriodEnd && (
          <div className="alert-warn mt-3 rounded-xl border p-3 text-xs">
            {tInterpolate("settings.billing.graceNotice", {
              date: new Date(snap.gracePeriodEnd).toLocaleDateString(),
            })}
          </div>
        )}

        {ents.isAdminBypassAccount && (
          <p className="mt-3 text-[11px] italic" style={{ color: "var(--muted2)" }} data-testid="settings-billing-bypass-notice">
            {t("settings.billing.bypassNotice")}
          </p>
        )}
      </div>

      {/* AI Token balance */}
      <div data-testid="settings-billing-tokens">
        <TokenBalanceWidget />
        <div className="mt-2 flex items-center justify-between gap-2">
          {/* Hidden in an iOS build that sells nothing: the /tokens link inside it is hidden
              there (3.1.1), which left "tokens can be purchased in ." — a sentence about
              buying, with its link cut out. An IAP build sells tokens and shows it whole. */}
          <p className="text-[11px]" style={{ color: "var(--muted2)" }} data-ios-purchase="">
            {t("settings.billing.tokensCanBePurchasedIn")}{" "}
            <Link href="/tokens" className="underline hover:text-white/80">
              {t("settings.billing.tokenCenterLabel")}
            </Link>
            {hasAnySub ? t("settings.billing.tokensPlanHint") : ""}.
          </p>
          <Link
            href="/tokens"
            className="shrink-0 text-[11px] font-semibold underline hover:text-white/80"
            style={{ color: "var(--muted2)" }}
            data-testid="settings-billing-token-history-link"
          >
            {t("settings.billing.viewHistory")}
          </Link>
        </div>
      </div>

      {portalError && (
        <p className="text-xs text-red-600" role="alert" data-testid="settings-billing-portal-error">
          {t("settings.billing.portalError")}
        </p>
      )}

      {appleManageError && (
        <p className="text-xs text-red-600" role="alert" data-testid="settings-billing-apple-error">
          {appleManageError}
        </p>
      )}

      {ents.error && (
        <p className="text-xs text-red-400" data-testid="settings-billing-error">
          {ents.error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {hasAnySub && !ents.isAdminBypassAccount && appleApp ? (
          <button
            type="button"
            onClick={() => {
              setAppleManageError(null)
              void manageAppleSubscriptions().catch(() => setAppleManageError(t("settings.billing.appleManageError")))
            }}
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:opacity-90"
            style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            data-testid="settings-billing-manage-apple"
          >
            {t("settings.billing.manageInAppStore")}
          </button>
        ) : hasAnySub && !ents.isAdminBypassAccount ? (
          <a
            href="/api/subscription/billing-portal"
            className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-4 py-2 text-sm font-semibold transition hover:opacity-90"
            style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
            data-testid="settings-billing-manage"
          >
            {t("settings.billing.manageBilling")}
            <svg
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              className="h-3.5 w-3.5"
              aria-hidden
            >
              <path d="M3.5 8h9M9 5l3.5 3L9 11" strokeLinecap="round" />
            </svg>
          </a>
        ) : null}
        <Link
          href="/pricing"
          className="ns-btn-primary"
          data-testid="settings-billing-pricing"
        >
          {hasAnySub ? t("settings.billing.changePlan") : t("settings.billing.viewPlans")}
        </Link>
      </div>
    </section>
  )
}
