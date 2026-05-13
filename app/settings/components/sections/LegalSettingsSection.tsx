"use client"

import Link from "next/link"
import { CheckCircle2, XCircle } from "lucide-react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { formatInTimezone } from "@/lib/preferences/TimezoneFormattingResolver"
import type { SettingsProfile } from "./settings-types"

export function LegalSettingsSection({
  profile,
}: {
  profile: SettingsProfile
}) {
  const { t } = useLanguage()
  const legalState = profile?.settings?.legalAcceptanceState

  function StatusRow({ label, ok }: { label: string; ok: boolean | undefined }) {
    return (
      <li className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
        {ok
          ? <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-label="Yes" />
          : <XCircle className="h-4 w-4 shrink-0 text-amber-500" aria-label="No" />}
        <span>{label}: <span className={ok ? "text-emerald-500" : "text-amber-500"} style={{ color: undefined }}>{ok ? t("settings.legal.yes") : t("settings.legal.no")}</span></span>
      </li>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
          {t("settings.legal.title")}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {t("settings.legal.subtitle")}
        </p>
      </div>

      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{t("settings.legal.acceptanceState")}</p>
        <ul className="space-y-2">
          <StatusRow label={t("settings.legal.ageVerified")} ok={legalState?.ageVerified} />
          <StatusRow label={t("settings.legal.disclaimerAccepted")} ok={legalState?.disclaimerAccepted} />
          <StatusRow label={t("settings.legal.termsAccepted")} ok={legalState?.termsAccepted} />
        </ul>
        <p className="text-xs pt-1 border-t" style={{ color: "var(--muted)", borderColor: "var(--border)" }}>
          {t("settings.legal.acceptedAt")}:{" "}
          <span style={{ color: "var(--muted2)" }}>
            {legalState?.acceptedAt
              ? formatInTimezone(legalState.acceptedAt, profile?.timezone, undefined, profile?.preferredLanguage)
              : t("settings.legal.notRecorded")}
          </span>
        </p>
      </div>

      <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>Legal documents</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/disclaimer" className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
            {t("settings.legal.linkDisclaimer")}
          </Link>
          <Link href="/terms" className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
            {t("settings.legal.linkTerms")}
          </Link>
          <Link href="/privacy" className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
            {t("settings.legal.linkPrivacy")}
          </Link>
          <Link href="/cookie-policy" className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
            {t("settings.legal.linkCookies")}
          </Link>
          <Link href="/data-deletion" className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
            {t("settings.legal.linkDataDeletion")}
          </Link>
        </div>
      </div>
    </div>
  )
}
