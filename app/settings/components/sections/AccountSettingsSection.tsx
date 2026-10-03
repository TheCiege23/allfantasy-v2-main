"use client"

import { useEffect, useRef, useState } from "react"
import { signOutAndPurge } from "@/lib/pwa/signOutAndPurge"
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
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  // No caller currently passes a real planLabel prop (it's always null) — this page never queried
  // a real plan before. Fall back to a live client-side entitlement check rather than always
  // showing "Free" regardless of the user's actual subscription.
  const ents = useEntitlements()
  /*
   * /api/user/delete cancels Stripe billing before it erases anything (lib/account/
   * cancelSubscriptionsOnDelete) — immediately, with no refund for the rest of the period — so the
   * dialog says so. An App Store subscription is the one we cannot cancel: Apple only lets the
   * user do that. Same paid gate as BillingSettingsSection.
   */
  const hasLiveSubscription = ents.hasAnyPaid && !ents.isAdminBypassAccount

  /*
   * The delete dialog is modal, so it behaves like one: Escape closes it (never mid-deletion),
   * Tab / Shift+Tab cycle INSIDE it rather than walking out into the page behind, the page does
   * not scroll under it on a phone, and closing hands focus back to "Start deletion" instead of
   * dropping it on <body>. Focus enters on the confirm input (autoFocus below).
   */
  const openerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (!deleteOpen) {
      if (wasOpen.current) {
        wasOpen.current = false
        openerRef.current?.focus()
      }
      return
    }
    wasOpen.current = true

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (!deleteBusy) {
          e.preventDefault()
          setDeleteOpen(false)
        }
        return
      }
      if (e.key !== "Tab") return
      const panel = dialogRef.current
      if (!panel) return
      const items = Array.from(
        panel.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), a[href], select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      )
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.removeEventListener("keydown", onKey)
      document.body.style.overflow = previousOverflow
    }
  }, [deleteOpen, deleteBusy])

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

  // Real erasure flow (app/api/user/delete): revokes OAuth links + reset tokens,
  // nulls the password hash, and anonymizes PII in one transaction. This button
  // used to be a mailto to support while that tested endpoint already existed.
  const handleDeleteAccount = async () => {
    if (deleteConfirm !== "DELETE" || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      const res = await fetch("/api/user/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: true }),
      })
      if (!res.ok) {
        // The route explains a refused deletion (e.g. billing could not be cancelled, so nothing
        // was deleted); show that rather than a generic failure.
        const data = (await res.json().catch(() => ({}))) as { error?: unknown }
        setDeleteError(
          typeof data.error === "string" && data.error ? data.error : "Account deletion failed. Please try again.",
        )
        return
      }
      // PII is erased and auth is revoked — sign the user out and leave.
      await signOutAndPurge({ callbackUrl: "/" })
    } catch {
      setDeleteError("Account deletion failed. Please try again.")
    } finally {
      setDeleteBusy(false)
    }
  }

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
          onClick={() => void signOutAndPurge({ callbackUrl: "/" })}
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
          ref={openerRef}
          type="button"
          onClick={() => {
            setDeleteOpen(true)
            setDeleteConfirm("")
            setDeleteError(null)
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
          aria-describedby="delete-account-desc"
        >
          <div
            ref={dialogRef}
            className="w-full max-w-md rounded-2xl border p-5 shadow-xl"
            style={{ borderColor: "var(--border)", background: "var(--panel)" }}
          >
            <h3 id="delete-account-title" className="text-lg font-semibold" style={{ color: "var(--text)" }}>
              {t("settings.account.confirmDeletionTitle")}
            </h3>
            <p id="delete-account-desc" className="mt-2 text-sm" style={{ color: "var(--muted)" }}>
              {t("settings.account.confirmDeletionBeforeWord")}{" "}
              <span className="font-mono font-semibold text-white">DELETE</span>{" "}
              {t("settings.account.confirmDeletionAfterWord")}
            </p>
            {hasLiveSubscription ? (
              <p
                className="mt-3 rounded-lg border px-3 py-2 text-xs"
                style={{ borderColor: "color-mix(in srgb, #fbbf24 45%, transparent)", color: "#fbbf24" }}
                data-testid="settings-account-delete-subscription-warning"
              >
                Deleting your account cancels your AllFantasy subscription right away, with no refund for the
                rest of the billing period. If you subscribed in the iPhone app, cancel it in your iPhone
                Settings → your name → Subscriptions — Apple doesn&apos;t let us cancel it for you.
              </p>
            ) : null}
            <input
              type="text"
              id="delete-account-confirm"
              /* The name matches the visible sentence's opening words ("Type DELETE to confirm"), so
                 voice control can target it by what is on screen; the full sentence, including that
                 data is erased immediately, is read as its description when focus lands here. */
              aria-label="Type DELETE to confirm"
              aria-describedby="delete-account-desc"
              autoFocus
              value={deleteConfirm}
              onChange={(e) => setDeleteConfirm(e.target.value)}
              className="mt-3 w-full rounded-lg border px-3 py-2 text-sm outline-none"
              style={{ borderColor: "var(--border)", background: "var(--panel2)", color: "var(--text)" }}
              placeholder={t("settings.account.deletePlaceholder")}
              autoComplete="off"
              data-testid="settings-account-delete-confirm-input"
            />
            {deleteError && (
              <p className="mt-2 text-xs" style={{ color: "var(--accent-red-strong)" }}>
                {deleteError}
              </p>
            )}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void handleDeleteAccount()}
                disabled={deleteConfirm !== "DELETE" || deleteBusy}
                className="rounded-xl border px-4 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                style={{
                  borderColor: "color-mix(in srgb, var(--accent-red) 55%, var(--border))",
                  color: "var(--accent-red-strong)",
                }}
                data-testid="settings-account-delete-submit"
              >
                {deleteBusy ? t("settings.account.deleting") : t("settings.account.confirmDeleteCta")}
              </button>
              <button
                type="button"
                onClick={() => setDeleteOpen(false)}
                disabled={deleteBusy}
                data-testid="settings-account-delete-cancel"
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
