"use client"

import Link from "next/link"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { formatInTimezone } from "@/lib/preferences/TimezoneFormattingResolver"
import type { SettingsProfile } from "./settings-types"

/**
 * Handoff 17b's "in Settings → Legal" panel.
 *
 * ⚠ THE AGREEMENT BADGES READ THE REAL USER RECORD — 17b's build note asks for
 * exactly that, "not static". `legalAcceptanceState` comes off the settings
 * profile, so a document the user actually agreed to at sign-up shows the badge
 * and one they have merely not opened shows the chevron. Hardcoding "agreed" on
 * every row would turn a compliance record into decoration, and it is the kind of
 * thing that only ever gets discovered during a dispute.
 *
 * ⚠ A ROW WITHOUT A RECORDED AGREEMENT IS NOT MARKED "NOT AGREED". Only the
 * disclaimer and the Terms are gated at sign-up; the privacy policy and the
 * no-gambling policy are documents to read, not checkboxes. Showing them as
 * outstanding obligations would claim the user owes a consent nobody ever asked
 * them for.
 */

type LegalDoc = {
  key: string
  href: string
  label: string
  /** Undefined when this document is informational rather than gated. */
  agreed?: boolean
}

export function LegalSettingsSection({ profile }: { profile: SettingsProfile }) {
  const { t } = useLanguage()
  const legalState = profile?.settings?.legalAcceptanceState

  const acceptedAtLabel = legalState?.acceptedAt
    ? formatInTimezone(
        legalState.acceptedAt,
        profile?.timezone,
        undefined,
        profile?.preferredLanguage,
      )
    : null

  const docs: LegalDoc[] = [
    {
      key: "terms",
      href: "/terms",
      label: t("settings.legal.linkTerms"),
      agreed: legalState?.termsAccepted,
    },
    {
      key: "disclaimer",
      href: "/disclaimer",
      label: t("settings.legal.linkDisclaimer"),
      agreed: legalState?.disclaimerAccepted,
    },
    { key: "privacy", href: "/privacy", label: t("settings.legal.linkPrivacy") },
    { key: "no-gambling", href: "/no-gambling-policy", label: t("settings.legal.linkNoGambling") },
    { key: "cookies", href: "/privacy", label: t("settings.legal.linkCookies") },
    { key: "deletion", href: "/data-deletion", label: t("settings.legal.linkDataDeletion") },
  ]

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

      <ul className="space-y-2">
        {docs.map((doc) => (
          <li key={doc.key}>
            <Link
              href={doc.href}
              className="flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-sm font-medium transition hover:opacity-90"
              style={{
                borderColor: "var(--border)",
                background: "var(--panel2)",
                color: "var(--text)",
              }}
            >
              <span>{doc.label}</span>
              {doc.agreed ? (
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.12em]"
                  style={{ color: "var(--good, #34d399)" }}
                >
                  {t("settings.legal.agreedAtSignup")}
                </span>
              ) : (
                <span aria-hidden style={{ color: "var(--muted)" }}>
                  ›
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      <div
        className="space-y-2 rounded-xl border p-4"
        style={{ borderColor: "var(--border)", background: "var(--panel2)" }}
      >
        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>
          {t("settings.legal.acceptanceState")}
        </p>
        <ul className="space-y-1 text-sm" style={{ color: "var(--muted)" }}>
          <li>
            {t("settings.legal.ageVerified")}:{" "}
            {legalState?.ageVerified ? t("settings.legal.yes") : t("settings.legal.no")}
          </li>
          <li>
            {t("settings.legal.acceptedAt")}: {acceptedAtLabel ?? t("settings.legal.notRecorded")}
          </li>
        </ul>
      </div>

      {/*
        17b's footnote. Sign-up cannot complete without BOTH gated agreements, and
        the panel says so rather than leaving the two green badges above to imply it.
      */}
      <p className="text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
        Sign-up can&apos;t complete until you agree to both the fantasy-sports disclaimer (no
        gambling, no DFS) and the Terms.
      </p>
    </div>
  )
}
