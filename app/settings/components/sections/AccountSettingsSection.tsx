"use client"

import { useState } from "react"
import { signOut } from "next-auth/react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { useEntitlements } from "@/hooks/useEntitlements"

export function AccountSettingsSection({
  accountCreatedAt,
  planLabel,
}: {
  accountCreatedAt: string | null
  planLabel: string | null
}) {
  const { t, tInterpolate } = useLanguage()
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState("")
  // No caller currently passes a real planLabel prop (it's always null) — this page never queried
  // a real plan before. Fall back to a live client-side entitlement check rather than always
  // showing "Free" regardless of the user's actual subscription.
  const ents = useEntitlements()

  const createdLabel = accountCreatedAt
    ? new Date(accountCreatedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null

  // A fetch error must never be conflated with a verified free plan — the hook's own catch path
  // leaves hasSupreme/etc. at their last-known (false, on a first-load failure) value rather than
  // proving "free," so this checks ents.error explicitly instead of trusting those booleans alone.
  const derivedPlanDisplay = ents.error
    ? "Unable to verify"
    : ents.hasSupreme
      ? "AF Supreme"
      : ents.hasCommissioner
        ? "AF Commissioner"
        : ents.hasPro
          ? "AF Pro"
          : ents.hasWarRoom
            ? "AF Legacy"
            : t("settings.account.planFree")
  const planDisplay = planLabel?.trim() || (ents.loading ? "..." : derivedPlanDisplay)

  const deletionMailto = `mailto:support@allfantasy.ai?subject=${encodeURIComponent(
    "Account deletion request"
  )}&body=${encodeURIComponent(
    "I confirm I want my AllFantasy account deleted. My username / email on file: "
  )}`

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{t("settings.account.title")}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {t("settings.account.subtitle")}
        </p>
      </div>

      <div
        className="rounded-xl border p-4 space-y-3"
        style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium" style={{ color: "var(--text)" }}>{t("settings.account.plan")}</span>
          <span
            className="rounded-full border px-3 py-0.5 text-xs font-semibold"
            style={{ borderColor: "var(--accent-cyan)", color: "var(--accent-cyan)" }}
          >
            {planDisplay}
          </span>
        </div>
        {ents.isAdminBypassAccount && (
          <p className="text-xs italic" style={{ color: "var(--muted)" }} data-testid="settings-account-bypass-notice">
            Admin bypass — not a real Stripe subscription.
          </p>
        )}
        {createdLabel && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {tInterpolate("settings.account.memberSince", { date: createdLabel })}
          </p>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="rounded-xl border px-4 py-2 text-sm font-semibold"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
          data-testid="settings-account-sign-out"
        >
          Sign out
        </button>
      </div>

      <div className="rounded-xl border border-red-500/30 p-4 space-y-3" style={{ background: "var(--panel2)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--accent-red-strong)" }}>
          {t("settings.account.deleteHeading")}
        </p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>{t("settings.account.deleteIntro")}</p>
        <button
          type="button"
          onClick={() => {
            setDeleteOpen(true)
            setDeleteConfirm("")
          }}
          className="rounded-xl border px-4 py-2 text-sm font-semibold"
          style={{
            borderColor: "color-mix(in srgb, var(--accent-red) 55%, var(--border))",
            color: "var(--accent-red-strong)",
          }}
          data-testid="settings-account-delete-open"
        >
          {t("settings.account.startDeletion")}
        </button>
      </div>

      {deleteOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="delete-account-title"
        >
          <div
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <h3 id="delete-account-title" className="text-lg font-semibold" style={{ color: "var(--text)" }}>
              {t("settings.account.confirmDeletionTitle")}
            </h3>
            <p className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {t("settings.account.confirmDeletionBeforeWord")}{" "}
              <span className="font-mono font-semibold text-white">DELETE</span>{" "}
              {t("settings.account.confirmDeletionAfterWord")}
            </p>
            <input
              type="text"
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
              placeholder={t("settings.account.deletePlaceholder")}
              autoComplete="off"
              data-testid="settings-account-delete-confirm-input"
            />
            <div className="mt-4 flex flex-wrap gap-2">
              {deleteConfirm === "DELETE" ? (
                <a
                  href={deletionMailto}
                  className="rounded-xl border px-4 py-2 text-sm font-semibold"
                  style={{
                    borderColor: "color-mix(in srgb, var(--accent-red) 55%, var(--border))",
                    color: "var(--accent-red-strong)",
                  }}
                  data-testid="settings-account-delete-email"
                >
                  {t("settings.account.emailSupportDelete")}
                </a>
              ) : (
                <span
                  className="rounded-xl border px-4 py-2 text-sm font-semibold opacity-40"
                  style={{
                    borderColor: "color-mix(in srgb, var(--accent-red) 55%, var(--border))",
                    color: "var(--accent-red-strong)",
                  }}
                >
                  {t("settings.account.emailSupportDelete")}
                </span>
              )}
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                className="rounded-xl border px-4 py-2 text-sm font-semibold"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {t("settings.actions.cancel")}
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="text-xs" style={{ color: "var(--muted)" }}>{t("settings.account.deletionFooter")}</p>
    </div>
  )
}
