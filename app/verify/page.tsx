"use client"

import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import { Suspense, useState, useEffect, type ReactNode } from "react"
import { CheckCircle2, XCircle, Clock, AlertTriangle, Mail, Loader2, Phone, ArrowLeft, ArrowRight } from "lucide-react"
import { AuthStatusHeader, AuthStatusLoadingFallback, AuthStatusShell } from "@/components/auth/AuthStatusShell"

function VerifyContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const status = searchParams?.get("status")
  const error = searchParams?.get("error")
  const verified = searchParams?.get("verified")

  const methodParam = searchParams?.get("method")
  const returnTo = searchParams?.get("returnTo") || ""
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/dashboard"
  const [tab, setTab] = useState<"email" | "phone">(methodParam === "phone" ? "phone" : "email")
  const [sending, setSending] = useState(false)
  const [sendResult, setSendResult] = useState<"sent" | "error" | "already" | "login_required" | "rate_limited" | null>(null)
  const [countdown, setCountdown] = useState(3)

  const [phoneNumber, setPhoneNumber] = useState("")
  const [phoneSending, setPhoneSending] = useState(false)
  const [phoneCodeSent, setPhoneCodeSent] = useState(false)
  const [phoneCode, setPhoneCode] = useState("")
  const [phoneVerifying, setPhoneVerifying] = useState(false)
  const [phoneResult, setPhoneResult] = useState<"verified" | "invalid" | "error" | "rate_limited" | null>(null)
  const [phoneErrorMessage, setPhoneErrorMessage] = useState<string | null>(null)

  const [ageConfirming, setAgeConfirming] = useState(false)
  const [ageResult, setAgeResult] = useState<"confirmed" | "error" | null>(null)

  async function handleConfirmAge() {
    setAgeConfirming(true)
    setAgeResult(null)
    try {
      const res = await fetch("/api/auth/confirm-age", { method: "POST" })
      if (res.ok) {
        setAgeResult("confirmed")
        setTimeout(() => {
          if (window.history.length > 1) {
            router.back()
          } else {
            router.push(safeReturnTo)
          }
        }, 1500)
      } else {
        setAgeResult("error")
      }
    } catch {
      setAgeResult("error")
    } finally {
      setAgeConfirming(false)
    }
  }

  async function handleSendVerification() {
    setSending(true)
    setSendResult(null)
    try {
      const res = await fetch("/api/auth/verify-email/send", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ returnTo: safeReturnTo }),
      })
      const data = await res.json()
      if (res.status === 401) {
        setSendResult("login_required")
      } else if (res.status === 429) {
        setSendResult("rate_limited")
      } else if (res.ok && data.alreadyVerified) {
        setSendResult("already")
      } else if (res.ok) {
        setSendResult("sent")
      } else {
        setSendResult("error")
      }
    } catch {
      setSendResult("error")
    } finally {
      setSending(false)
    }
  }

  async function handleSendPhoneCode() {
    if (!phoneNumber.trim()) return
    setPhoneSending(true)
    setPhoneResult(null)
    setPhoneErrorMessage(null)
    try {
      const res = await fetch("/api/verify/phone/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: phoneNumber.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 429) {
        setPhoneResult("rate_limited")
      } else if (res.ok) {
        setPhoneCodeSent(true)
      } else {
        setPhoneResult("error")
        setPhoneErrorMessage(resolvePhoneErrorMessage(data.error, data.message))
      }
    } catch {
      setPhoneResult("error")
      setPhoneErrorMessage("Verification failed. Please try again.")
    } finally {
      setPhoneSending(false)
    }
  }

  async function handleVerifyPhoneCode() {
    if (!phoneCode.trim()) return
    setPhoneVerifying(true)
    setPhoneResult(null)
    setPhoneErrorMessage(null)
    try {
      const res = await fetch("/api/verify/phone/check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: phoneNumber.trim(), code: phoneCode.trim() }),
      })
      const data = await res.json()
      if (res.ok) {
        setPhoneResult("verified")
        setTimeout(() => router.push(safeReturnTo), 2000)
      } else if (data.error === "INVALID_CODE") {
        setPhoneResult("invalid")
      } else if (res.status === 429) {
        setPhoneResult("rate_limited")
      } else {
        setPhoneResult("error")
        setPhoneErrorMessage(resolvePhoneErrorMessage(data.error, data.message))
      }
    } catch {
      setPhoneResult("error")
      setPhoneErrorMessage("Verification failed. Please try again.")
    } finally {
      setPhoneVerifying(false)
    }
  }

  function resolvePhoneErrorMessage(error?: string, fallback?: string): string {
    switch (error) {
      case "PHONE_VERIFY_NOT_CONFIGURED":
        return "Phone verification is not configured on the server yet."
      case "INVALID_PHONE":
        return "Please enter a valid phone number with country code."
      case "UNAUTHENTICATED":
        return "Please sign in first, then try again."
      case "SEND_FAILED":
        return "The verification text could not be sent right now."
      case "VERIFY_FAILED":
        return "The verification check failed right now."
      default:
        return fallback || "Something went wrong. Please try again."
    }
  }

  function resolveState(): string {
    if (verified === "email" || verified === "phone" || status === "success") return "success"
    if (error === "EXPIRED_LINK" || error === "EXPIRED_TOKEN" || status === "expired") return "expired"
    if (error === "INVALID_LINK" || error === "INVALID_OR_USED_TOKEN" || error === "MISSING_TOKEN" || status === "invalid") return "invalid"
    if (error === "AGE_REQUIRED") return "age_required"
    if (error === "VERIFICATION_REQUIRED") return "verification_required"
    if (error || status === "error") return "error"
    return "pending"
  }

  const state = resolveState()

  useEffect(() => {
    if (state !== "success") return
    if (countdown <= 0) {
      router.push(safeReturnTo)
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [state, countdown, router])

  const configs: Record<string, { icon: ReactNode; title: string; message: string; color: string }> = {
    success: {
      icon: <CheckCircle2 className="h-8 w-8 text-emerald-400" />,
      title: "Verified!",
      message: `Your account has been verified successfully. Redirecting to dashboard in ${countdown}s...`,
      color: "border-emerald-500/20 bg-emerald-500/10",
    },
    expired: {
      icon: <Clock className="h-8 w-8 text-amber-400" />,
      title: "Link expired",
      message: "This verification link has expired. Request a new one below.",
      color: "border-amber-500/20 bg-amber-500/10",
    },
    invalid: {
      icon: <XCircle className="h-8 w-8 text-red-400" />,
      title: "Invalid link",
      message: "This verification link is invalid or has already been used.",
      color: "border-red-500/20 bg-red-500/10",
    },
    age_required: {
      icon: <AlertTriangle className="h-8 w-8 text-amber-400" />,
      title: "Age confirmation required",
      message: "You must confirm you are 18 or older to access this feature.",
      color: "border-amber-500/20 bg-amber-500/10",
    },
    verification_required: {
      icon: <Mail className="h-8 w-8 text-cyan-400" />,
      title: "Verification required",
      message: "Please verify your email or phone number to access leagues and brackets.",
      color: "border-cyan-500/20 bg-cyan-500/10",
    },
    error: {
      icon: <AlertTriangle className="h-8 w-8 text-red-400" />,
      title: "Something went wrong",
      message: "There was an error verifying your account. Please try again.",
      color: "border-red-500/20 bg-red-500/10",
    },
    pending: {
      icon: <Mail className="h-8 w-8 text-cyan-400" />,
      title: "Verify your account",
      message: "Verify your email or phone to unlock leagues and brackets.",
      color: "border-cyan-500/20 bg-cyan-500/10",
    },
  }

  const config = configs[state] || configs.pending
  const showVerifyOptions = state !== "success" && state !== "age_required"

  return (
    <AuthStatusShell>
      <div className="w-full max-w-[440px]">
        <div className="mb-6 flex items-center justify-between gap-3">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 rounded-[10px] border border-violet-400/30 bg-[#1c1535] px-4 py-2.5 text-sm font-medium text-white/75 transition hover:border-violet-300/45 hover:bg-[#211a3e] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Sign In</span>
          </Link>
          <Link
            href={safeReturnTo}
            className="text-sm text-white/50 transition hover:text-white/70"
          >
            Return to dashboard
          </Link>
        </div>

        <AuthStatusHeader
          title="Account verification"
          subtitle="Verify your email or phone to unlock leagues, brackets, and other protected features."
        />

        <div className="rounded-[18px] border border-violet-400/20 bg-[#16102a] p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
          <div className={`mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border ${config.color}`}>
            {config.icon}
          </div>
          <h2 className="mt-5 text-2xl font-semibold text-white">{config.title}</h2>
          <p className="mt-3 text-sm leading-6 text-white/60">{config.message}</p>

          {state === "success" && (
            <Link
              href={safeReturnTo}
              className="mt-7 inline-flex items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90"
            >
              <span>Go to Dashboard</span>
              <ArrowRight className="h-4 w-4" />
            </Link>
          )}

          {state === "age_required" && (
            <div className="space-y-3 pt-4">
              {ageResult === "confirmed" && (
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                  <div className="flex items-center justify-center gap-2">
                    <CheckCircle2 className="h-4 w-4" />
                    Age confirmed! Redirecting back...
                  </div>
                </div>
              )}
              {ageResult === "error" && (
                <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                  Something went wrong. Please try again.
                </div>
              )}
              {ageResult !== "confirmed" && (
                <button
                  onClick={handleConfirmAge}
                  disabled={ageConfirming}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-60"
                >
                  {ageConfirming ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Confirming...
                    </>
                  ) : (
                    "I confirm I am 18 or older"
                  )}
                </button>
              )}
            </div>
          )}
        </div>

        {showVerifyOptions && (
          <div className="mt-4 rounded-[18px] border border-violet-400/20 bg-[#16102a] p-6 shadow-[0_24px_80px_rgba(0,0,0,0.35)]">
            <div className="grid grid-cols-2 gap-2 rounded-[12px] border border-violet-400/20 bg-[#1c1535] p-1">
              <button
                onClick={() => setTab("email")}
                className={`flex items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-medium transition ${
                  tab === "email"
                    ? "bg-[#211a3e] text-white border border-violet-400/30"
                    : "text-white/55 hover:text-white/80"
                }`}
              >
                <Mail className="h-4 w-4" />
                Email
              </button>
              <button
                onClick={() => setTab("phone")}
                className={`flex items-center justify-center gap-2 rounded-[10px] px-4 py-2.5 text-sm font-medium transition ${
                  tab === "phone"
                    ? "bg-[#211a3e] text-white border border-violet-400/30"
                    : "text-white/55 hover:text-white/80"
                }`}
              >
                <Phone className="h-4 w-4" />
                Phone
              </button>
            </div>

            {tab === "email" && (
              <div className="mt-4 space-y-3">
                {sendResult === "sent" && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                    Verification email sent! Check your inbox.
                  </div>
                )}
                {sendResult === "already" && (
                  <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3 text-sm text-cyan-300">
                    Your email is already verified.
                  </div>
                )}
                {sendResult === "login_required" && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-300">
                    Please <Link href="/login" className="font-medium underline">sign in</Link> first, then request verification.
                  </div>
                )}
                {sendResult === "rate_limited" && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-300">
                    Please wait 60 seconds before requesting another email.
                  </div>
                )}
                {sendResult === "error" && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                    Failed to send email. Please try again.
                  </div>
                )}

                <button
                  onClick={handleSendVerification}
                  disabled={sending || sendResult === "sent"}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-60"
                >
                  {sending ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Sending...
                    </>
                  ) : sendResult === "sent" ? (
                    "Email sent!"
                  ) : (
                    "Send verification email"
                  )}
                </button>
              </div>
            )}

            {tab === "phone" && (
              <div className="mt-4 space-y-3">
                {phoneResult === "verified" && (
                  <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-300">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4" />
                      Phone verified! Redirecting...
                    </div>
                  </div>
                )}
                {phoneResult === "invalid" && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                    Invalid code. Please check and try again.
                  </div>
                )}
                {phoneResult === "rate_limited" && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 p-3 text-sm text-amber-300">
                    Too many attempts. Please wait before trying again.
                  </div>
                )}
                {phoneResult === "error" && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-300">
                    {phoneErrorMessage ?? "Something went wrong. Please try again."}
                  </div>
                )}

                {!phoneCodeSent ? (
                  <>
                    <div>
                      <label className="text-[13px] font-semibold tracking-[0.02em] text-white/60">Phone number</label>
                      <input
                        value={phoneNumber}
                        onChange={(e) => setPhoneNumber(e.target.value)}
                        type="tel"
                        className="mt-1.5 w-full rounded-[10px] border border-violet-400/30 bg-[#1c1535] px-3.5 py-3 text-sm text-white outline-none transition placeholder:text-white/35 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10"
                        placeholder="+1 (555) 123-4567"
                        disabled={phoneSending}
                      />
                      <p className="mt-1 text-xs text-white/35">Include country code, like `+1` for US.</p>
                    </div>
                    <button
                      onClick={handleSendPhoneCode}
                      disabled={phoneSending || !phoneNumber.trim()}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-60"
                    >
                      {phoneSending ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Sending code...
                        </>
                      ) : (
                        "Send verification code"
                      )}
                    </button>
                  </>
                ) : phoneResult !== "verified" ? (
                  <>
                    <p className="text-sm text-white/60">
                      We sent a code to <span className="font-medium text-white/80">{phoneNumber}</span>
                    </p>
                    <div>
                      <label className="text-[13px] font-semibold tracking-[0.02em] text-white/60">Verification code</label>
                      <input
                        value={phoneCode}
                        onChange={(e) => setPhoneCode(e.target.value.replace(/\D/g, ""))}
                        type="text"
                        inputMode="numeric"
                        className="mt-1.5 w-full rounded-[10px] border border-violet-400/30 bg-[#1c1535] px-3.5 py-3 text-center font-mono text-lg tracking-widest text-white outline-none transition placeholder:text-white/35 focus:border-cyan-400 focus:ring-4 focus:ring-cyan-500/10"
                        placeholder="000000"
                        maxLength={6}
                        disabled={phoneVerifying}
                        autoFocus
                      />
                    </div>
                    <button
                      onClick={handleVerifyPhoneCode}
                      disabled={phoneVerifying || phoneCode.length < 4}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-[11px] bg-gradient-to-r from-cyan-500 to-blue-500 px-6 py-3 text-sm font-semibold text-white transition hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-60"
                    >
                      {phoneVerifying ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Verifying...
                        </>
                      ) : (
                        "Verify code"
                      )}
                    </button>
                    <button
                      onClick={() => {
                        setPhoneCodeSent(false)
                        setPhoneCode("")
                        setPhoneResult(null)
                      }}
                      className="w-full text-sm text-white/45 transition hover:text-white/70"
                    >
                      Change phone number
                    </button>
                  </>
                ) : null}
              </div>
            )}
          </div>
        )}
      </div>
    </AuthStatusShell>
  )
}

export default function VerifyPage() {
  return (
    <Suspense fallback={<AuthStatusLoadingFallback />}>
      <VerifyContent />
    </Suspense>
  )
}

