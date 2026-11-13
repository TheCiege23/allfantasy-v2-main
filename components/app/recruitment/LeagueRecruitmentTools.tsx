"use client"

import { useState, useCallback, useEffect } from "react"
import { Link2, Copy, RefreshCw, AtSign, Mail, Globe, Loader2, Check, MessageCircle } from "lucide-react"
import { buildInviteShareUrl } from "@/lib/invite-engine/shareUrls"

interface LeagueRecruitmentToolsProps {
  leagueId: string
  /** Initial invite from parent (joinUrl, inviteCode). */
  initialInvite?: {
    joinUrl: string | null
    inviteCode: string | null
    inviteExpiresAt?: string | null
    inviteExpired?: boolean
  } | null
  /** Whether current user is commissioner. */
  isCommissioner: boolean
}

export function LeagueRecruitmentTools({
  leagueId,
  initialInvite,
  isCommissioner,
}: LeagueRecruitmentToolsProps) {
  const [invite, setInvite] = useState(initialInvite ?? null)
  const [invitePanelOpen, setInvitePanelOpen] = useState(true)
  const [loadingInvite, setLoadingInvite] = useState(!initialInvite)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [regenerating, setRegenerating] = useState(false)
  const [copied, setCopied] = useState(false)
  const [username, setUsername] = useState("")
  const [usernameSending, setUsernameSending] = useState(false)
  const [usernameResult, setUsernameResult] = useState<{ inviteUrl?: string; sentTo?: string; error?: string } | null>(null)
  const [email, setEmail] = useState("")
  const [emailSending, setEmailSending] = useState(false)
  const [emailResult, setEmailResult] = useState<{ sent?: boolean; inviteUrl?: string; error?: string } | null>(null)
  const [publicListing, setPublicListing] = useState(false)
  const [publicListingLoading, setPublicListingLoading] = useState(false)
  const [publicVisibilityBase, setPublicVisibilityBase] = useState<"private" | "invite_only" | "password_protected">("private")

  const base = `/api/commissioner/leagues/${encodeURIComponent(leagueId)}`
  const joinUrl = invite?.joinUrl ?? (invite?.inviteCode ? `${typeof window !== "undefined" ? window.location.origin : ""}/join?code=${encodeURIComponent(invite.inviteCode)}` : null)
  const inviteExpired =
    invite?.inviteExpired ?? (invite?.inviteExpiresAt ? new Date(invite.inviteExpiresAt).getTime() < Date.now() : false)
  const inviteShareMessage = "Join my fantasy league on AllFantasy!"
  const smsShareUrl = joinUrl ? buildInviteShareUrl(joinUrl, "sms", { message: inviteShareMessage }) : ""
  const emailShareUrl = joinUrl
    ? buildInviteShareUrl(joinUrl, "email", {
        message: inviteShareMessage,
        subject: "Join my fantasy league on AllFantasy",
      })
    : ""
  const twitterShareUrl = joinUrl ? buildInviteShareUrl(joinUrl, "twitter", { message: inviteShareMessage }) : ""
  const redditShareUrl = joinUrl ? buildInviteShareUrl(joinUrl, "reddit", { message: inviteShareMessage }) : ""

  const fetchInvite = useCallback(async () => {
    setLoadingInvite(true)
    setInviteError(null)
    try {
      const res = await fetch(`${base}/invite`, { cache: "no-store" })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setInviteError(typeof data?.error === "string" ? data.error : "Failed to load invite link.")
        return
      }
      setInvite({
        joinUrl: data.joinUrl ?? null,
        inviteCode: data.inviteCode ?? null,
        inviteExpiresAt: data.inviteExpiresAt ?? null,
        inviteExpired: !!data.inviteExpired,
      })
    } finally {
      setLoadingInvite(false)
    }
  }, [base])

  useEffect(() => {
    if (initialInvite) setInvite(initialInvite)
    else if (isCommissioner) fetchInvite()
  }, [initialInvite, isCommissioner, fetchInvite])

  const copyLink = useCallback(() => {
    if (!joinUrl) return
    navigator.clipboard.writeText(joinUrl).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }, [joinUrl])

  const regenerate = useCallback(async () => {
    if (!isCommissioner) return
    setRegenerating(true)
    setInviteError(null)
    try {
      const res = await fetch(`${base}/invite`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ regenerate: true }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setInviteError(typeof data?.error === "string" ? data.error : "Failed to regenerate invite link.")
        return
      }
      setInvite({
        joinUrl: data.joinUrl ?? data.inviteLink ?? null,
        inviteCode: data.inviteCode ?? null,
        inviteExpiresAt: data.inviteExpiresAt ?? null,
        inviteExpired: !!data.inviteExpired,
      })
    } finally {
      setRegenerating(false)
    }
  }, [base, isCommissioner])

  const sendByUsername = useCallback(async () => {
    if (!username.trim() || !isCommissioner) return
    setUsernameSending(true)
    setUsernameResult(null)
    try {
      const res = await fetch(`${base}/invite/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "username", username: username.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      setUsernameResult(
        res.ok
          ? { inviteUrl: data.inviteUrl, sentTo: data.sentTo }
          : { error: typeof data?.error === "string" ? data.error : "Unable to create username invite." }
      )
    } finally {
      setUsernameSending(false)
    }
  }, [base, username, isCommissioner])

  const sendByEmail = useCallback(async () => {
    if (!email.trim() || !isCommissioner) return
    setEmailSending(true)
    setEmailResult(null)
    try {
      const res = await fetch(`${base}/invite/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "email", email: email.trim() }),
      })
      const data = await res.json().catch(() => ({}))
      setEmailResult({
        sent: data.sent,
        inviteUrl: data.inviteUrl,
        error: data.error,
      })
      if (data.sent) setEmail("")
    } finally {
      setEmailSending(false)
    }
  }, [base, email, isCommissioner])

  const togglePublicListing = useCallback(async () => {
    if (!isCommissioner) return
    const next = !publicListing
    setPublicListingLoading(true)
    try {
      const nextVisibility = next ? "public" : publicVisibilityBase
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId)}/privacy`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visibility: nextVisibility }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok) {
        const visibility = String(data?.visibility ?? nextVisibility).toLowerCase()
        setPublicListing(visibility === "public")
        if (visibility === "private" || visibility === "invite_only" || visibility === "password_protected") {
          setPublicVisibilityBase(visibility)
        }
      }
    } finally {
      setPublicListingLoading(false)
    }
  }, [isCommissioner, publicListing, publicVisibilityBase, leagueId])

  useEffect(() => {
    if (!isCommissioner) return
    fetch(`/api/leagues/${encodeURIComponent(leagueId)}/privacy`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        const visibility = String(d?.visibility ?? "private").toLowerCase()
        const isPublic = visibility === "public"
        setPublicListing(isPublic)
        if (!isPublic && (visibility === "private" || visibility === "invite_only" || visibility === "password_protected")) {
          setPublicVisibilityBase(visibility)
        }
      })
      .catch(() => {})
  }, [isCommissioner, leagueId])

  if (!isCommissioner) return null

  return (
    <section
      className="rounded-xl border p-4 space-y-6"
      style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--panel) 50%, transparent)" }}
      data-testid="league-recruitment-tools"
    >
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2" style={{ color: "var(--text)" }}>
          <Link2 className="h-4 w-4" style={{ color: "var(--muted)" }} />
          Recruitment tools
        </h3>
        <p className="text-xs mt-0.5" style={{ color: "var(--muted)" }}>
          Invite link, username invite, email invite, and public listing.
        </p>
      </div>

      {/* Invite link */}
      <div>
        <button
          type="button"
          onClick={() => setInvitePanelOpen((prev) => !prev)}
          data-testid="league-invite-button"
          className="rounded-lg border px-3 py-2 text-sm font-medium inline-flex items-center gap-1.5"
          style={{ borderColor: "var(--border)", color: "var(--text)" }}
        >
          <Link2 className="h-4 w-4" />
          {invitePanelOpen ? "Hide invite options" : "Invite members"}
        </button>
        {invitePanelOpen && (
          <div className="space-y-2 mt-3">
            <h4 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
              Invite link
            </h4>
            {loadingInvite ? (
              <div className="flex items-center gap-2 text-sm" style={{ color: "var(--muted)" }}>
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={joinUrl ?? ""}
                    className="min-w-0 flex-1 rounded-lg border px-3 py-2 text-sm max-w-md"
                    style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
                  />
                  <button
                    type="button"
                    onClick={copyLink}
                    disabled={!joinUrl}
                    data-testid="league-copy-invite-link"
                    className="rounded-lg border px-3 py-2 text-sm font-medium inline-flex items-center gap-1.5"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                    {copied ? "Copied" : "Copy link"}
                  </button>
                  <button
                    type="button"
                    onClick={regenerate}
                    disabled={regenerating}
                    data-testid="league-regenerate-invite-link"
                    className="rounded-lg border px-3 py-2 text-sm font-medium inline-flex items-center gap-1.5"
                    style={{ borderColor: "var(--border)", color: "var(--text)" }}
                  >
                    {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    Regenerate
                  </button>
                </div>
                {joinUrl && (
                  <a
                    href={joinUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    data-testid="league-open-join-link"
                    className="inline-flex items-center gap-1.5 text-xs underline"
                    style={{ color: "var(--accent)" }}
                  >
                    Open join link preview
                  </a>
                )}
                {invite?.inviteExpiresAt && (
                  <p className="text-xs" style={{ color: inviteExpired ? "var(--destructive)" : "var(--muted)" }}>
                    Invite expires: {new Date(invite.inviteExpiresAt).toLocaleString()}
                    {inviteExpired ? " (expired)" : ""}
                  </p>
                )}
                {joinUrl && (
                  <div className="flex flex-wrap items-center gap-2">
                    <a
                      href={smsShareUrl}
                      data-testid="league-share-sms"
                      className="rounded-lg border px-2.5 py-1.5 text-xs inline-flex items-center gap-1"
                      style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      SMS
                    </a>
                    <a
                      href={emailShareUrl}
                      data-testid="league-share-email"
                      className="rounded-lg border px-2.5 py-1.5 text-xs inline-flex items-center gap-1"
                      style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    >
                      <Mail className="h-3.5 w-3.5" />
                      Email
                    </a>
                    <a
                      href={twitterShareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="league-share-twitter"
                      className="rounded-lg border px-2.5 py-1.5 text-xs"
                      style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    >
                      Twitter/X
                    </a>
                    <a
                      href={redditShareUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-testid="league-share-reddit"
                      className="rounded-lg border px-2.5 py-1.5 text-xs"
                      style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    >
                      Reddit
                    </a>
                    <button
                      type="button"
                      onClick={copyLink}
                      data-testid="league-share-discord"
                      className="rounded-lg border px-2.5 py-1.5 text-xs"
                      style={{ borderColor: "var(--border)", color: "var(--text)" }}
                    >
                      Discord (copy link)
                    </button>
                  </div>
                )}
              </div>
            )}
            {inviteError && (
              <p className="text-xs" style={{ color: "var(--destructive)" }}>
                {inviteError}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Username invite */}
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
          Username invite
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--muted)" }}>
            <AtSign className="h-4 w-4" />
          </span>
          <input
            type="text"
            placeholder="Display name or username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            data-testid="league-recruitment-username-input"
            className="rounded-lg border px-3 py-2 text-sm w-48"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          />
          <button
            type="button"
            onClick={sendByUsername}
            disabled={!username.trim() || usernameSending}
            data-testid="league-recruitment-username-send"
            className="rounded-lg px-3 py-2 text-sm font-medium inline-flex items-center gap-1.5"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            {usernameSending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Get invite link
          </button>
        </div>
        {usernameResult?.inviteUrl && (
          <p className="text-xs mt-2" style={{ color: "var(--muted)" }}>
            Share this link with {usernameResult.sentTo ? usernameResult.sentTo : "the user"}:{" "}
            <button type="button" onClick={() => navigator.clipboard?.writeText(usernameResult.inviteUrl!)} className="underline" style={{ color: "var(--accent)" }}>
              Copy link
            </button>
          </p>
        )}
        {usernameResult?.error && (
          <p className="text-xs mt-2" style={{ color: "var(--destructive)" }}>
            {usernameResult.error}
          </p>
        )}
      </div>

      {/* Email invite */}
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
          Email invite
        </h4>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 text-sm" style={{ color: "var(--muted)" }}>
            <Mail className="h-4 w-4" />
          </span>
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="league-recruitment-email-input"
            className="rounded-lg border px-3 py-2 text-sm w-48"
            style={{ borderColor: "var(--border)", background: "var(--panel)", color: "var(--text)" }}
          />
          <button
            type="button"
            onClick={sendByEmail}
            disabled={!email.trim() || emailSending}
            data-testid="league-recruitment-email-send"
            className="rounded-lg px-3 py-2 text-sm font-medium inline-flex items-center gap-1.5"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            {emailSending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Send invite
          </button>
        </div>
        {emailResult && (
          <p className="text-xs mt-2" style={{ color: emailResult.error ? "var(--destructive)" : "var(--muted)" }}>
            {emailResult.sent ? "Invite email sent." : emailResult.error ? emailResult.error : "Share this link: " + (emailResult.inviteUrl ?? "")}
          </p>
        )}
      </div>

      {/* Public listing */}
      <div>
        <h4 className="text-xs font-medium uppercase tracking-wider mb-2" style={{ color: "var(--muted)" }}>
          Public listing
        </h4>
        <label className="flex items-center gap-2 text-sm" style={{ color: "var(--text)" }}>
          <span className="inline-flex items-center gap-1.5">
            <Globe className="h-4 w-4" style={{ color: "var(--muted)" }} />
          </span>
          <input
            type="checkbox"
            checked={publicListing}
            onChange={togglePublicListing}
            disabled={publicListingLoading}
            data-testid="league-recruitment-public-listing-toggle"
            className="rounded border"
            style={{ borderColor: "var(--border)" }}
          />
          List league publicly in discovery
        </label>
        <p className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
          Public listing controls whether this league is visible in discover/join flows.
        </p>
      </div>
    </section>
  )
}
