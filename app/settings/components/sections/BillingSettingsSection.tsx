"use client"

import Link from "next/link"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { useEntitlements } from "@/hooks/useEntitlements"
import { TokenBalanceWidget } from "@/components/tokens/TokenBalanceWidget"

export function BillingSettingsSection() {
  const { t, tInterpolate } = useLanguage()
  const ents = useEntitlements()

  if (ents.loading) {
    return <div className="animate-pulse h-20 rounded-xl bg-white/[0.05]" data-testid="settings-billing-loading" />
  }

  const snap = ents.snapshot
  const hasAnySub = ents.hasAnyPaid
  const status = snap?.status ?? "none"

  return (
    <section className="space-y-4" data-testid="settings-billing-section">
      <h2 className="text-sm font-bold uppercase tracking-wider" style={{ color: "var(--muted2)" }}>{t("settings.nav.billing")}</h2>

      <div className="rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--panel)" }}>
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="mb-1 text-xs uppercase tracking-wider" style={{ color: "var(--muted2)" }}>{t("settings.billing.currentPlan")}</p>
            {hasAnySub ? (
              <div className="flex flex-wrap items-center gap-2">
                {ents.hasSupreme && (
                  <span className="rounded-full border border-purple-400/30 bg-purple-500/10 px-2.5 py-0.5 text-xs font-bold text-purple-300">
                    AF Supreme
                  </span>
                )}
                {!ents.hasSupreme && ents.hasCommissioner && (
                  <span className="rounded-full border border-violet-400/30 bg-violet-500/10 px-2.5 py-0.5 text-xs font-bold text-violet-300">
                    AF Commissioner
                  </span>
                )}
                {!ents.hasSupreme && ents.hasPro && (
                  <span className="rounded-full border border-sky-400/30 bg-sky-500/10 px-2.5 py-0.5 text-xs font-bold text-sky-300">
                    AF Pro
                  </span>
                )}
                {!ents.hasSupreme && ents.hasWarRoom && (
                  <span className="rounded-full border border-amber-400/30 bg-amber-500/10 px-2.5 py-0.5 text-xs font-bold text-amber-300">
                    AF Legacy
                  </span>
                )}
              </div>
            ) : (
              <p className="text-sm font-semibold text-white">{t("settings.billing.afFree")}</p>
            )}
          </div>

          <span
            className={[
              "rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide",
              status === "active"
                ? "border-green-500/30 bg-green-500/10 text-green-300"
                : status === "grace"
                  ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
                  : status === "past_due"
                    ? "border-red-500/30 bg-red-500/10 text-red-300"
                    : "border-white/[0.1] bg-white/[0.03] text-white/40",
            ].join(" ")}
          >
            {status === "none" ? t("settings.billing.statusFree") : status.replace(/_/g, " ")}
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
            Admin bypass — this plan is not a real Stripe subscription.
          </p>
        )}
      </div>

      {/* AI Token balance */}
      <div data-testid="settings-billing-tokens">
        <TokenBalanceWidget />
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px]" style={{ color: "var(--muted2)" }}>
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

      {ents.error && (
        <p className="text-xs text-red-400" data-testid="settings-billing-error">
          {ents.error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {hasAnySub && !ents.isAdminBypassAccount ? (
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
          className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl bg-gradient-to-r from-violet-500 to-purple-500 px-4 py-2 text-sm font-bold text-[#0b0714] transition hover:from-violet-400 hover:to-purple-400"
          data-testid="settings-billing-pricing"
        >
          {hasAnySub ? t("settings.billing.changePlan") : t("settings.billing.viewPlans")}
        </Link>
      </div>
    </section>
  )
}
