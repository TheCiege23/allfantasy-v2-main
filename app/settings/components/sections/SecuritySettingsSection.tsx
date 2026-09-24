"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import {
  Mail,
  Phone,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  Loader2,
  Clock,
} from "lucide-react"
import { isAllowedSessionIdleMinutes } from "@/lib/auth/session-idle-constants"
import {
  getSecurityStatus,
  getContactSummary,
  updateContactEmail,
  startPhoneVerification,
  checkPhoneCode,
  sendVerificationEmail,
  changePassword,
} from "@/lib/security-settings"
import type { SettingsProfile } from "./settings-types"
import { SmsConsentCheckbox } from "@/components/legal/SmsConsentCheckbox"

export function SecuritySettingsSection({
  profile,
  onRefetch,
}: {
  profile: SettingsProfile
  onRefetch: () => void
}) {
  const { t } = useLanguage()
  const status = getSecurityStatus(profile)
  const contact = getContactSummary(profile)

  const [emailSending, setEmailSending] = useState(false)
  const [emailResult, setEmailResult] = useState<"sent" | "already" | "error" | "rate_limited" | null>(null)
  const [emailEdit, setEmailEdit] = useState(false)
  const [emailInput, setEmailInput] = useState(profile?.email ?? "")
  const [emailCurrentPassword, setEmailCurrentPassword] = useState("")
  const [showEmailCurrentPassword, setShowEmailCurrentPassword] = useState(false)
  const [emailSaving, setEmailSaving] = useState(false)
  const [emailSaveResult, setEmailSaveResult] = useState<
    "saved" | "saved_no_email" | "invalid" | "duplicate" | "wrong_password" | "password_required" | "error" | null
  >(null)

  const [phoneEdit, setPhoneEdit] = useState(false)
  const [phoneInput, setPhoneInput] = useState(profile?.phone ?? "")
  const [phoneSending, setPhoneSending] = useState(false)
  const [phoneCodeSent, setPhoneCodeSent] = useState(false)
  const [smsConsent, setSmsConsent] = useState(false)
  const [phoneCode, setPhoneCode] = useState("")
  const [phoneVerifying, setPhoneVerifying] = useState(false)
  const [phoneResult, setPhoneResult] = useState<"verified" | "invalid" | "error" | "rate_limited" | null>(null)
  const [phoneErrorMessage, setPhoneErrorMessage] = useState<string | null>(null)

  const [passwordFormOpen, setPasswordFormOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [passwordChanging, setPasswordChanging] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordSuccess, setPasswordSuccess] = useState(false)
  const [idleSaving, setIdleSaving] = useState(false)
  const [idleError, setIdleError] = useState<string | null>(null)

  useEffect(() => {
    if (!emailEdit) {
      setEmailInput(profile?.email ?? "")
      setEmailCurrentPassword("")
      setShowEmailCurrentPassword(false)
    }
  }, [profile?.email, emailEdit])

  useEffect(() => {
    if (!phoneEdit) {
      setPhoneInput(profile?.phone ?? "")
    }
  }, [profile?.phone, phoneEdit])

  const handleStartEmailEdit = () => {
    setEmailEdit(true)
    setEmailResult(null)
    setEmailSaveResult(null)
    setEmailInput(profile?.email ?? "")
    setEmailCurrentPassword("")
  }

  const handleCancelEmailEdit = () => {
    setEmailEdit(false)
    setEmailInput(profile?.email ?? "")
    setEmailCurrentPassword("")
    setShowEmailCurrentPassword(false)
    setEmailSaveResult(null)
  }

  const handleSaveEmail = async () => {
    setEmailSaveResult(null)
    const nextEmail = emailInput.trim().toLowerCase()
    if (!nextEmail || !nextEmail.includes("@")) {
      setEmailSaveResult("invalid")
      return
    }
    setEmailSaving(true)
    const result = await updateContactEmail({
      email: nextEmail,
      currentPassword: status.hasPassword ? emailCurrentPassword : undefined,
      returnTo: "/settings?tab=security",
    })
    setEmailSaving(false)

    if (result.ok) {
      setEmailEdit(false)
      setEmailCurrentPassword("")
      setEmailSaveResult(result.verificationEmailSent ? "saved" : "saved_no_email")
      onRefetch()
      return
    }

    if (result.invalidEmail) setEmailSaveResult("invalid")
    else if (result.duplicateEmail) setEmailSaveResult("duplicate")
    else if (result.wrongPassword) setEmailSaveResult("wrong_password")
    else if (result.requiresPassword) setEmailSaveResult("password_required")
    else setEmailSaveResult("error")
  }

  const handleSendVerificationEmail = async () => {
    setEmailSending(true)
    setEmailResult(null)
    setEmailSaveResult(null)
    const result = await sendVerificationEmail("/settings?tab=security")
    setEmailSending(false)
    if (result.ok && result.alreadyVerified) setEmailResult("already")
    else if (result.ok) setEmailResult("sent")
    else if (result.rateLimited) setEmailResult("rate_limited")
    else setEmailResult("error")
  }

  const resolvePhoneErrorMessage = (error?: string) => {
    switch (error) {
      case "PHONE_VERIFY_NOT_CONFIGURED":
        return t("settings.security.phoneError.notConfigured")
      case "INVALID_PHONE":
        return t("settings.security.phoneError.invalidPhone")
      case "UNAUTHENTICATED":
        return t("settings.security.phoneError.unauthenticated")
      case "SEND_FAILED":
        return t("settings.security.phoneError.sendFailed")
      case "VERIFY_FAILED":
        return t("settings.security.phoneError.verifyFailed")
      default:
        return error || t("settings.security.phoneError.generic")
    }
  }

  const handleSendPhoneCode = async () => {
    const trimmed = phoneInput.replace(/[\s()-]/g, "").trim()
    if (!trimmed) return
    setPhoneSending(true)
    setPhoneResult(null)
    setPhoneErrorMessage(null)
    if (!smsConsent) return
    const result = await startPhoneVerification(trimmed.startsWith("+") ? trimmed : `+1${trimmed}`, {
      smsConsent: true,
      consentSource: "settings-security",
    })
    setPhoneSending(false)
    if (result.ok) setPhoneCodeSent(true)
    else if (result.rateLimited) setPhoneResult("rate_limited")
    else {
      setPhoneResult("error")
      setPhoneErrorMessage(resolvePhoneErrorMessage(result.error))
    }
  }

  const handleVerifyPhoneCode = async () => {
    if (!phoneCode.trim()) return
    const trimmed = phoneInput.replace(/[\s()-]/g, "").trim()
    const phone = trimmed.startsWith("+") ? trimmed : `+1${trimmed}`
    setPhoneVerifying(true)
    setPhoneResult(null)
    setPhoneErrorMessage(null)
    const result = await checkPhoneCode(phone, phoneCode)
    setPhoneVerifying(false)
    if (result.ok) {
      setPhoneResult("verified")
      setPhoneErrorMessage(null)
      setPhoneCodeSent(false)
      setPhoneCode("")
      setPhoneEdit(false)
      onRefetch()
    } else if (result.error === "INVALID_CODE") setPhoneResult("invalid")
    else if (result.error === "RATE_LIMITED") setPhoneResult("rate_limited")
    else {
      setPhoneResult("error")
      setPhoneErrorMessage(resolvePhoneErrorMessage(result.error))
    }
  }

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordError(null)
    if (newPassword !== confirmPassword) {
      setPasswordError(t("settings.security.passwordMismatch"))
      return
    }
    if (newPassword.length < 8 || !/[A-Za-z]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
      setPasswordError(t("settings.security.passwordRules"))
      return
    }
    setPasswordChanging(true)
    const result = await changePassword(currentPassword, newPassword)
    setPasswordChanging(false)
    if (result.ok) {
      setPasswordSuccess(true)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setTimeout(() => {
        setPasswordFormOpen(false)
        setPasswordSuccess(false)
      }, 2000)
    } else {
      setPasswordError(result.message ?? result.error ?? t("settings.security.passwordChangeFailed"))
    }
  }

  const cancelPhoneEdit = () => {
    setPhoneEdit(false)
    setPhoneInput(profile?.phone ?? "")
    setPhoneCodeSent(false)
    setPhoneCode("")
    setSmsConsent(false)
    setPhoneResult(null)
    setPhoneErrorMessage(null)
  }

  async function saveSessionIdle(value: string) {
    setIdleSaving(true)
    setIdleError(null)
    const minutes =
      value === "" || value === "off" ? null : Number.parseInt(value, 10)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionIdleTimeoutMinutes: minutes,
        }),
      })
      const data = (await res.json().catch(() => ({}))) as { error?: string }
      if (!res.ok) {
        setIdleError(data?.error ?? t("settings.security.idleSaveFailed"))
        return
      }
      if (typeof window !== "undefined") {
        if (minutes == null || minutes === 0) {
          localStorage.removeItem("af_session_idle_minutes")
        } else {
          localStorage.setItem("af_session_idle_minutes", String(minutes))
        }
        window.dispatchEvent(new Event("af-session-idle-updated"))
      }
      onRefetch()
    } finally {
      setIdleSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>{t("settings.security.title")}</h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>{t("settings.security.subtitle")}</p>
      </div>

      <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{t("settings.security.twoFactorTitle")}</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>{t("settings.security.twoFactorBody")}</p>
      </div>

      <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{t("settings.security.sessionsTitle")}</p>
        <p className="text-xs" style={{ color: "var(--muted)" }}>{t("settings.security.sessionsBody")}</p>
      </div>

      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <div className="flex items-start gap-2">
          <Clock className="mt-0.5 h-4 w-4 shrink-0" style={{ color: "var(--muted)" }} />
          <div>
            <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{t("settings.security.idleTitle")}</p>
            <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--muted)" }}>
              {t("settings.security.idleBody")}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="session-idle-select" className="sr-only">
            {t("settings.security.idleSelectAria")}
          </label>
          <select
            id="session-idle-select"
            data-testid="settings-session-idle-timeout"
            disabled={idleSaving}
            className="rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
            value={
              profile?.sessionIdleTimeoutMinutes != null &&
              isAllowedSessionIdleMinutes(profile.sessionIdleTimeoutMinutes)
                ? String(profile.sessionIdleTimeoutMinutes)
                : "off"
            }
            onChange={(e) => void saveSessionIdle(e.target.value)}
          >
            <option value="off">{t("settings.security.idleOptionOff")}</option>
            <option value="30">{t("settings.security.idleOption30m")}</option>
            <option value="60">{t("settings.security.idleOption1h")}</option>
            <option value="240">{t("settings.security.idleOption4h")}</option>
            <option value="720">{t("settings.security.idleOption12h")}</option>
            <option value="1440">{t("settings.security.idleOption24h")}</option>
          </select>
          {idleSaving ? (
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--muted)" }} />
          ) : null}
        </div>
        {idleError ? (
          <p className="text-xs text-red-500">{idleError}</p>
        ) : null}
      </div>

      {/* Security status card */}
      <div className="rounded-xl border p-4 space-y-2" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <p className="text-sm font-medium" style={{ color: "var(--text)" }}>{t("settings.security.statusTitle")}</p>
        <ul className="space-y-1.5 text-sm" style={{ color: "var(--muted)" }}>
          <li className="flex items-center gap-2">
            {status.emailVerified ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-amber-500" />}
            {t("settings.security.rowEmail")}: {status.emailVerified ? t("settings.security.verified") : t("settings.security.notVerified")}
          </li>
          <li className="flex items-center gap-2">
            {!status.phoneSet ? <XCircle className="h-4 w-4 text-amber-500" /> : status.phoneVerified ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-amber-500" />}
            {t("settings.security.rowPhone")}: {!status.phoneSet ? t("settings.security.notSet") : status.phoneVerified ? t("settings.security.verified") : t("settings.security.notVerified")}
          </li>
          <li className="flex items-center gap-2">
            {status.hasPassword ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <XCircle className="h-4 w-4 text-amber-500" />}
            {t("settings.security.rowPassword")}: {status.hasPassword ? t("settings.security.passwordSet") : t("settings.security.passwordNotSet")}
          </li>
          {status.recoveryOptions.length > 0 && (
            <li className="flex items-center gap-2">
              <span style={{ color: "var(--muted)" }}>{t("settings.security.rowRecovery")}: {status.recoveryOptions.join(", ")}</span>
            </li>
          )}
        </ul>
      </div>

      {/* Email */}
      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text)" }}>
              <Mail className="h-4 w-4" />
              {t("settings.security.emailHeading")}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>{contact.email ?? "—"}</p>
          </div>
          {!emailEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleStartEmailEdit}
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {t("settings.security.editEmail")}
              </button>
              {!contact.emailVerified && contact.email && (
                <button
                  type="button"
                  disabled={emailSending}
                  onClick={handleSendVerificationEmail}
                  className="rounded-lg border px-3 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  {emailSending ? <><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> {t("settings.security.sendingEmail")}</> : t("settings.security.sendVerification")}
                </button>
              )}
              <Link
                href="/verify?method=email&returnTo=%2Fsettings%3Ftab%3Dsecurity"
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {t("settings.security.verifyChangeLink")}
              </Link>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleCancelEmailEdit}
              className="rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              {t("settings.actions.cancel")}
            </button>
          )}
        </div>
        {emailEdit && (
          <div className="pt-2 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--muted2)" }}>{t("settings.security.newEmail")}</label>
              <input
                type="email"
                value={emailInput}
                onChange={(e) => setEmailInput(e.target.value)}
                placeholder={t("settings.security.emailPlaceholder")}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
              />
            </div>
            {status.hasPassword && (
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--muted2)" }}>{t("settings.security.currentPassword")}</label>
                <div className="relative">
                  <input
                    type={showEmailCurrentPassword ? "text" : "password"}
                    value={emailCurrentPassword}
                    onChange={(e) => setEmailCurrentPassword(e.target.value)}
                    autoComplete="current-password"
                    className="w-full rounded-lg border px-3 py-2 pr-10 text-sm"
                    style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
                  />
                  <button
                    type="button"
                    onClick={() => setShowEmailCurrentPassword((s) => !s)}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    aria-label={showEmailCurrentPassword ? t("settings.security.ariaHide") : t("settings.security.ariaShow")}
                    style={{ color: "var(--muted)" }}
                  >
                    {showEmailCurrentPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <p className="mt-1 text-[11px]" style={{ color: "var(--muted)" }}>
                  {t("settings.security.emailPasswordHint")}
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={emailSaving || !emailInput.trim() || (status.hasPassword && !emailCurrentPassword.trim())}
                onClick={handleSaveEmail}
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--accent-cyan)", color: "var(--text)" }}
              >
                {emailSaving ? <><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> {t("settings.actions.saving")}</> : t("settings.security.saveEmail")}
              </button>
              <button
                type="button"
                onClick={handleCancelEmailEdit}
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {t("settings.actions.cancel")}
              </button>
            </div>
          </div>
        )}
        {emailResult === "sent" && <p className="text-xs text-emerald-600">{t("settings.security.checkEmailInbox")}</p>}
        {emailResult === "already" && <p className="text-xs" style={{ color: "var(--muted)" }}>{t("settings.security.emailAlreadyVerified")}</p>}
        {emailResult === "rate_limited" && <p className="text-xs text-amber-600">{t("settings.security.rateLimitedShort")}</p>}
        {emailResult === "error" && <p className="text-xs text-red-600">{t("settings.security.emailSendFailed")}</p>}
        {emailSaveResult === "saved" && <p className="text-xs text-emerald-600">{t("settings.security.emailUpdatedVerify")}</p>}
        {emailSaveResult === "saved_no_email" && <p className="text-xs text-amber-600">{t("settings.security.emailUpdatedNoVerifyEmail")}</p>}
        {emailSaveResult === "invalid" && <p className="text-xs text-red-600">{t("settings.security.invalidEmail")}</p>}
        {emailSaveResult === "duplicate" && <p className="text-xs text-red-600">{t("settings.security.duplicateEmail")}</p>}
        {emailSaveResult === "wrong_password" && <p className="text-xs text-red-600">{t("settings.security.wrongPassword")}</p>}
        {emailSaveResult === "password_required" && <p className="text-xs text-red-600">{t("settings.security.passwordRequiredForEmail")}</p>}
        {emailSaveResult === "error" && <p className="text-xs text-red-600">{t("settings.security.emailUpdateFailed")}</p>}
      </div>

      {/* Phone */}
      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text)" }}>
              <Phone className="h-4 w-4" />
              {t("settings.security.phoneHeading")}
            </p>
            <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
              {profile?.phone ? (profile.phoneVerifiedAt ? t("settings.security.verified") : t("settings.security.notVerified")) : t("settings.security.notSet")}
              {profile?.phone && ` · ${profile.phone}`}
            </p>
          </div>
          {!phoneEdit ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPhoneEdit(true)}
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {t("settings.security.updatePhone")}
              </button>
              <Link
                href="/verify?method=phone&returnTo=%2Fsettings%3Ftab%3Dsecurity"
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {t("settings.security.verifyAddLink")}
              </Link>
            </div>
          ) : (
            <button type="button" onClick={cancelPhoneEdit} className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              {t("settings.actions.cancel")}
            </button>
          )}
        </div>
        {phoneEdit && (
          <div className="pt-2 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--muted2)" }}>{t("settings.security.phoneNumber")}</label>
              <input
                type="tel"
                value={phoneInput}
                onChange={(e) => setPhoneInput(e.target.value)}
                placeholder={t("settings.security.phonePlaceholder")}
                className="w-full rounded-lg border px-3 py-2 text-sm"
                style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
              />
            </div>
            <SmsConsentCheckbox id="settings-sms-consent" checked={smsConsent} onChange={setSmsConsent} />
            {!phoneCodeSent ? (
              <button
                type="button"
                disabled={phoneSending || !phoneInput.trim() || !smsConsent}
                onClick={handleSendPhoneCode}
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {phoneSending ? <Loader2 className="h-4 w-4 animate-spin inline" /> : null} {t("settings.security.sendVerificationCode")}
              </button>
            ) : (
              <>
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: "var(--muted2)" }}>{t("settings.security.code")}</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={phoneCode}
                    onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, ""))}
                    placeholder={t("settings.security.codePlaceholder")}
                    className="w-full rounded-lg border px-3 py-2 text-sm font-mono"
                    style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={phoneVerifying || !phoneCode.trim()}
                    onClick={handleVerifyPhoneCode}
                    className="rounded-lg border px-3 py-2 text-sm font-medium"
                    style={{ borderColor: "var(--accent-cyan)", color: "var(--text)" }}
                  >
                    {phoneVerifying ? <><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> {t("settings.security.verifying")}</> : t("settings.security.verify")}
                  </button>
                  <button
                    type="button"
                    disabled={phoneSending}
                    onClick={handleSendPhoneCode}
                    className="rounded-lg border px-3 py-2 text-sm font-medium"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    {phoneSending ? <Loader2 className="h-4 w-4 animate-spin inline" /> : null} {t("settings.security.resendCode")}
                  </button>
                </div>
                {phoneResult === "verified" && <p className="text-xs text-emerald-600">{t("settings.security.phoneVerifiedUpdating")}</p>}
                {phoneResult === "invalid" && <p className="text-xs text-red-600">{t("settings.security.invalidCode")}</p>}
                {phoneResult === "rate_limited" && <p className="text-xs text-amber-600">{t("settings.security.rateLimitedMinutes")}</p>}
                {phoneResult === "error" && <p className="text-xs text-red-600">{phoneErrorMessage ?? t("settings.security.phoneError.generic")}</p>}
              </>
            )}
          </div>
        )}
      </div>

      {/* Password */}
      <div className="rounded-xl border p-4 space-y-3" style={{ borderColor: "var(--border)", background: "var(--panel2)" }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Lock className="h-4 w-4" />
            {t("settings.security.passwordHeading")}
          </p>
          {!passwordFormOpen ? (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPasswordFormOpen(true)}
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {t("settings.security.changePassword")}
              </button>
              <Link
                href="/forgot-password"
                className="rounded-lg border px-3 py-2 text-sm font-medium"
                style={{ borderColor: "var(--border)", color: "var(--text)" }}
              >
                {t("settings.security.forgotPassword")}
              </Link>
            </div>
          ) : (
            <button type="button" onClick={() => { setPasswordFormOpen(false); setPasswordError(null); setCurrentPassword(""); setNewPassword(""); setConfirmPassword(""); }} className="rounded-lg border px-3 py-2 text-sm font-medium" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
              {t("settings.actions.cancel")}
            </button>
          )}
        </div>
        {passwordFormOpen && (
          <form onSubmit={handleChangePassword} className="pt-2 border-t space-y-3" style={{ borderColor: "var(--border)" }}>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--muted2)" }}>{t("settings.security.currentPassword")}</label>
              <div className="relative">
                <input
                  type={showCurrent ? "text" : "password"}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 pr-10 text-sm"
                  style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowCurrent((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--muted)" }} aria-label={showCurrent ? t("settings.security.ariaHide") : t("settings.security.ariaShow")}>
                  {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--muted2)" }}>{t("settings.security.newPassword")}</label>
              <div className="relative">
                <input
                  type={showNew ? "text" : "password"}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 pr-10 text-sm"
                  style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowNew((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--muted)" }} aria-label={showNew ? t("settings.security.ariaHide") : t("settings.security.ariaShow")}>
                  {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "var(--muted2)" }}>{t("settings.security.confirmNewPassword")}</label>
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full rounded-lg border px-3 py-2 pr-10 text-sm"
                  style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
                  autoComplete="new-password"
                />
                <button type="button" onClick={() => setShowConfirm((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs" style={{ color: "var(--muted)" }} aria-label={showConfirm ? t("settings.security.ariaHide") : t("settings.security.ariaShow")}>
                  {showConfirm ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
            {passwordError && <p className="text-xs text-red-600">{passwordError}</p>}
            {passwordSuccess && <p className="text-xs text-emerald-600">{t("settings.security.passwordUpdated")}</p>}
            <button
              type="submit"
              disabled={passwordChanging || !currentPassword || !newPassword || !confirmPassword}
              className="rounded-lg border px-4 py-2 text-sm font-medium"
              style={{ borderColor: "var(--accent-cyan)", color: "var(--text)" }}
            >
              {passwordChanging ? <><Loader2 className="h-4 w-4 animate-spin inline mr-1" /> {t("settings.actions.saving")}</> : t("settings.security.saveNewPassword")}
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
