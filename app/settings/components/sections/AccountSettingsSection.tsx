"use client"

import { useState } from "react"
import { signOut } from "next-auth/react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"

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

  const createdLabel = accountCreatedAt
    ? new Date(accountCreatedAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null

  const planDisplay = planLabel?.trim() || t("settings.account.planFree")

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
        {createdLabel && (
          <p className="text-sm" style={{ color: "var(--muted)" }}>
            {tInterpolate("settings.account.memberSince", { date: createdLabel })}
          </p>
        )}
      </div>

      {/* Session actions */}
      <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Session</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>
          Sign out of your account on this device.
        </p>
        <button
          type="button"
          onClick={() => signOut({ callbackUrl: "/" })}
          className="mt-1 rounded-xl border px-4 py-2 text-sm font-semibold"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
          data-testid="settings-account-sign-out"
        >
          Sign out
        </button>
      </div>

      {/* Danger zone */}
      <div className="rounded-xl border border-red-500/40 bg-red-500/5 p-5 space-y-3 ring-1 ring-red-500/20">
        <div className="flex items-start gap-3">
          <div className="text-red-500 mt-0.5">
            <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="text-sm font-semibold text-red-500">Danger Zone</p>
            <p className="mt-0.5 text-xs font-medium text-red-600">{t("settings.account.deleteHeading")}</p>
            <p className="mt-1 text-xs text-red-500/80">{t("settings.account.deleteIntro")}</p>
          </div>
        </div>
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
