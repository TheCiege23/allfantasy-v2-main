"use client"

import { useState, useEffect, useRef } from "react"
import Link from "next/link"
import { Copy, Check, Users, UserPlus, Gift, Loader2 } from "lucide-react"
import { useLanguage } from "@/components/i18n/LanguageProviderClient"
import { ReferralShareBar } from "@/components/referral/ReferralShareBar"

type Stats = { clicks: number; signups: number; pendingRewards: number; redeemedRewards: number }
type Reward = {
  id: string
  type: string
  label: string
  status: string
  grantedAt: string
  redeemedAt: string | null
  claimLabel?: string
  helperText?: string | null
}

export function ReferralSection() {
  const { t } = useLanguage()
  const [code, setCode] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [stats, setStats] = useState<Stats | null>(null)
  const [rewards, setRewards] = useState<Reward[]>([])
  const [loading, setLoading] = useState(true)
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedCode, setCopiedCode] = useState(false)
  const [redeemingId, setRedeemingId] = useState<string | null>(null)
  const [redeemError, setRedeemError] = useState<string | null>(null)
  const [copyError, setCopyError] = useState<string | null>(null)
  const codeInputRef = useRef<HTMLInputElement>(null)
  const linkInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const [linkRes, statsRes, rewardsRes] = await Promise.all([
          fetch("/api/referral/link"),
          fetch("/api/referral/stats"),
          fetch("/api/referral/rewards"),
        ])
        if (cancelled) return
        if (linkRes.ok) {
          const d = await linkRes.json()
          if (d.code) setCode(d.code)
          if (d.link) setLink(d.link)
        }
        if (statsRes.ok) {
          const d = await statsRes.json()
          if (d.stats) setStats(d.stats)
        }
        if (rewardsRes.ok) {
          const d = await rewardsRes.json()
          if (Array.isArray(d.rewards)) setRewards(d.rewards)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    run()
    return () => { cancelled = true }
  }, [])

  /*
   * `navigator.clipboard` is missing outside a secure context and refused by some in-app
   * browsers, and the old `.then()` had no rejection path — the button simply did nothing.
   * On failure the text is selected in its field so a long-press copy is one step away.
   */
  const copyText = async (text: string, input: HTMLInputElement | null): Promise<boolean> => {
    setCopyError(null)
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      input?.focus()
      input?.select()
      setCopyError("Couldn't copy automatically — the text is selected, so copy it from the field.")
      return false
    }
  }

  const copyLink = async () => {
    if (!link) return
    if (await copyText(link, linkInputRef.current)) {
      setCopiedLink(true)
      setTimeout(() => setCopiedLink(false), 2000)
    }
  }

  const copyCode = async () => {
    if (!code) return
    if (await copyText(code, codeInputRef.current)) {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2000)
    }
  }

  const redeem = async (rewardId: string) => {
    setRedeemingId(rewardId)
    setRedeemError(null)
    try {
      const res = await fetch("/api/referral/rewards/redeem", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rewardId }),
      })
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string }
      // A refused redeem used to vanish: the route's 400 message was read and dropped.
      if (!res.ok || !data.ok) {
        setRedeemError(typeof data.error === "string" && data.error ? data.error : "Couldn't redeem that reward. Please try again.")
      }
      if (res.ok && data.ok) {
        setRewards((prev) =>
          prev.map((r) => (r.id === rewardId ? { ...r, status: "redeemed" as const, redeemedAt: new Date().toISOString() } : r))
        )
        setStats((prev) =>
          prev
            ? {
                ...prev,
                pendingRewards: Math.max(0, prev.pendingRewards - 1),
                redeemedRewards: prev.redeemedRewards + 1,
              }
            : null
        )
      }
    } catch {
      setRedeemError("Couldn't redeem that reward. Check your connection and try again.")
    } finally {
      setRedeemingId(null)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin" style={{ color: "var(--muted)" }} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold" style={{ color: "var(--text)" }}>
          {t("settings.referral.title")}
        </h2>
        <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
          {t("settings.referral.subtitle")}
        </p>
      </div>

      {(code || link) && (
        <div className="rounded-xl border p-4" style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel2) 60%, transparent)" }}>
          {code && (
            <>
              <label htmlFor="referral-code-input" className="text-xs font-medium" style={{ color: "var(--muted)" }}>
                {t("settings.referral.yourCode")}
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-2 mb-4">
                <input
                  id="referral-code-input"
                  ref={codeInputRef}
                  type="text"
                  readOnly
                  value={code}
                  className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm font-mono"
                  style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
                />
                <button
                  type="button"
                  onClick={copyCode}
                  data-testid="referral-copy-code"
                  className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
                  style={{ borderColor: "var(--border)", color: "var(--text)" }}
                >
                  {copiedCode ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copiedCode ? t("settings.referral.copied") : t("settings.referral.copyCode")}
                </button>
              </div>
            </>
          )}
          <label htmlFor="referral-link-input" className="text-xs font-medium" style={{ color: "var(--muted)" }}>
            {t("settings.referral.yourLink")}
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <input
              id="referral-link-input"
              ref={linkInputRef}
              type="text"
              readOnly
              value={link ?? ""}
              className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm"
              style={{ borderColor: "var(--border)", background: "var(--bg)", color: "var(--text)" }}
            />
            <button
              type="button"
              onClick={copyLink}
              data-testid="referral-copy-link"
              className="inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium"
              style={{ borderColor: "var(--border)", color: "var(--text)" }}
            >
              {copiedLink ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copiedLink ? t("settings.referral.copied") : t("settings.referral.copyLink")}
            </button>
          </div>
          {copyError ? (
            <p className="mt-2 text-xs" role="status" style={{ color: "var(--muted2)" }}>
              {copyError}
            </p>
          ) : null}
          {link && (
            <div className="mt-3 pt-3 border-t" style={{ borderColor: "var(--border)" }}>
              <ReferralShareBar referralLink={link} testIdPrefix="referral-share" />
            </div>
          )}
        </div>
      )}

      {stats && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div data-testid="referral-stat-clicks" className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5" style={{ color: "var(--muted)" }} />
              <span className="text-sm" style={{ color: "var(--muted)" }}>{t("settings.referral.statClicks")}</span>
            </div>
            <p className="mt-1 text-2xl font-semibold" style={{ color: "var(--text)" }}>{stats.clicks}</p>
          </div>
          <div data-testid="referral-stat-signups" className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2">
              <UserPlus className="h-5 w-5" style={{ color: "var(--muted)" }} />
              <span className="text-sm" style={{ color: "var(--muted)" }}>{t("settings.referral.statSignups")}</span>
            </div>
            <p className="mt-1 text-2xl font-semibold" style={{ color: "var(--text)" }}>{stats.signups}</p>
          </div>
          <div data-testid="referral-stat-pending-rewards" className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
            <div className="flex items-center gap-2">
              <Gift className="h-5 w-5" style={{ color: "var(--muted)" }} />
              <span className="text-sm" style={{ color: "var(--muted)" }}>{t("settings.referral.statPendingRewards")}</span>
            </div>
            <p className="mt-1 text-2xl font-semibold" style={{ color: "var(--text)" }}>{stats.pendingRewards}</p>
          </div>
          <div data-testid="referral-stat-redeemed-rewards" className="rounded-xl border p-4" style={{ borderColor: "var(--border)" }}>
            <span className="text-sm" style={{ color: "var(--muted)" }}>{t("settings.referral.statRedeemed")}</span>
            <p className="mt-1 text-2xl font-semibold" style={{ color: "var(--text)" }}>{stats.redeemedRewards}</p>
          </div>
        </div>
      )}

      {rewards.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold mb-3" style={{ color: "var(--text)" }}>
            {t("settings.referral.rewardsHeading")}
          </h3>
          {redeemError ? (
            <p className="mb-2 text-xs text-red-600" role="alert" data-testid="referral-redeem-error">
              {redeemError}
            </p>
          ) : null}
          <ul className="space-y-2">
            {rewards.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between gap-4 rounded-xl border px-4 py-3"
                style={{ borderColor: "var(--border)" }}
              >
                <div>
                  <span className="font-medium" style={{ color: "var(--text)" }}>{r.label}</span>
                  <span className="ml-2 text-xs" style={{ color: "var(--muted)" }}>
                    {r.status === "redeemed" ? t("settings.referral.statusClaimed") : r.status === "claimable" ? t("settings.referral.statusReady") : t("settings.referral.statusPending")}
                  </span>
                  {r.helperText ? (
                    <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
                      {r.helperText}
                    </p>
                  ) : null}
                </div>
                {r.status === "claimable" && (
                  <button
                    type="button"
                    disabled={redeemingId === r.id}
                    onClick={() => redeem(r.id)}
                    data-testid={`referral-redeem-${r.id}`}
                    className="rounded-lg border px-3 py-1.5 text-sm font-medium disabled:opacity-50"
                    style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
                  >
                    {redeemingId === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : r.claimLabel ?? t("settings.referral.claim")}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!link && !code && !loading && (
        <p className="text-sm" style={{ color: "var(--muted)" }}>
          {t("settings.referral.loadFailed")}{" "}
          <Link href="/referral" className="underline">{t("settings.referral.openDashboard")}</Link>{" "}
          {t("settings.referral.tryRefresh")}
        </p>
      )}
    </div>
  )
}
