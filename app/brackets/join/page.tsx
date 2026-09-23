"use client"

import { useState, useEffect, Suspense } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { ArrowLeft, Loader2, Users, Trophy } from "lucide-react"

type Preview = {
  leagueId: string
  name: string
  tournamentName: string
  tournamentSeason?: string
  memberCount: number
  maxManagers: number
  isFull: boolean
  expired: boolean
  joinCode: string
}

function JoinLeagueForm() {
  const [code, setCode] = useState("")
  const [loading, setLoading] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(true)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const sp = useSearchParams()

  useEffect(() => {
    const c = sp?.get("code")
    if (c) setCode(c.trim().toUpperCase())
  }, [sp])

  useEffect(() => {
    const c = sp?.get("code")?.trim()
    if (!c) {
      setPreviewLoading(false)
      return
    }
    setPreviewLoading(true)
    setPreviewError(null)
    setPreview(null)
    fetch(`/api/league-invite/preview?code=${encodeURIComponent(c)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.ok && data.preview) {
          setPreview(data.preview)
          setPreviewError(null)
        } else {
          setPreview(null)
          setPreviewError(
            data.error === "EXPIRED"
              ? "This invite has expired."
              : data.error === "LEAGUE_FULL"
                ? "This pool is full."
                : data.error === "ALREADY_MEMBER"
                  ? "You're already in this pool."
                  : "Invalid invite code."
          )
        }
      })
      .catch(() => {
        setPreview(null)
        setPreviewError("Could not load invite.")
      })
      .finally(() => setPreviewLoading(false))
  }, [sp])

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault()
    if (!code.trim()) return
    setError(null)
    setLoading(true)

    const normalizedCode = code.trim().toUpperCase()
    const returnTo = `/brackets/join?code=${encodeURIComponent(normalizedCode)}`

    try {
      const res = await fetch("/api/bracket/leagues/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ joinCode: normalizedCode }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (data.error === "UNAUTHENTICATED") {
          router.push(`/login?callbackUrl=${encodeURIComponent(returnTo)}`)
          return
        }
        if (data.error === "AGE_REQUIRED") {
          router.push(`/verify?error=AGE_REQUIRED&returnTo=${encodeURIComponent(returnTo)}`)
          return
        }
        if (data.error === "VERIFICATION_REQUIRED") {
          router.push(`/verify?error=VERIFICATION_REQUIRED&returnTo=${encodeURIComponent(returnTo)}`)
          return
        }
        setError(data.error ?? "Failed to join pool")
        return
      }
      router.push(`/brackets/leagues/${data.leagueId}`)
    } catch {
      setError("Something went wrong. Please try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {previewLoading && code && (
        <div className="mode-muted text-sm text-center py-2">Loading invite...</div>
      )}
      {!previewLoading && preview && !preview.expired && !preview.isFull && (
        <div
          className="rounded-xl border p-4 mb-4"
          style={{ borderColor: "var(--border)", background: "color-mix(in srgb, var(--accent) 8%, transparent)" }}
        >
          <div className="flex items-center gap-2 mb-2">
            <Trophy className="h-5 w-5" style={{ color: "var(--accent)" }} />
            <span className="font-semibold" style={{ color: "var(--text)" }}>{preview.name}</span>
          </div>
          <p className="text-sm mode-muted">
            {preview.tournamentName}
            {preview.tournamentSeason ? ` · ${preview.tournamentSeason}` : ""}
          </p>
          <p className="text-xs mode-muted mt-1">
            {preview.memberCount} / {preview.maxManagers} members
          </p>
        </div>
      )}
      {!previewLoading && previewError && (
        <div className="rounded-xl p-3 text-sm mb-4" style={{ background: "color-mix(in srgb, var(--accent-red-strong) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--accent-red-strong) 38%, transparent)", color: "var(--accent-red)" }}>
          {previewError}
        </div>
      )}
      {error && (
        <div className="rounded-xl p-3 text-sm" style={{ background: "color-mix(in srgb, var(--accent-red-strong) 14%, transparent)", border: "1px solid color-mix(in srgb, var(--accent-red-strong) 38%, transparent)", color: "var(--accent-red)" }}>
          {error}
        </div>
      )}

      <form onSubmit={handleJoin} className="space-y-4">
        <div>
          <label className="text-xs font-semibold" style={{ color: "var(--accent)" }}>Invite Code</label>
          <input
            className="mt-2 w-full bg-transparent border-b-2 pb-2 text-2xl outline-none uppercase tracking-[0.3em] text-center font-mono"
            style={{ borderColor: "var(--accent)", color: "var(--text)" }}
            placeholder="ABCD1234"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={12}
            disabled={loading}
            autoFocus
          />
          <p className="mode-muted text-xs mt-2 text-center">
            Enter the invite code your friend shared with you.
          </p>
        </div>

        <div className="fixed bottom-0 left-0 right-0 p-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:static sm:p-0">
          <button
            type="submit"
            disabled={!code.trim() || loading || (!!preview && (preview.expired || preview.isFull))}
            className="w-full rounded-xl px-4 py-3.5 text-sm font-bold uppercase tracking-wider text-black disabled:opacity-40 transition"
            style={{ background: "var(--accent)" }}
          >
            {loading ? (
              <span className="inline-flex items-center justify-center gap-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Joining...
              </span>
            ) : (
              "Join pool"
            )}
          </button>
        </div>
      </form>
    </>
  )
}

function BackButton() {
  const router = useRouter()
  return (
    <button
      onClick={() => router.back()}
      className="mode-muted flex items-center gap-2 text-sm transition"
    >
      <ArrowLeft className="w-4 h-4" />
    </button>
  )
}

export default function JoinLeaguePage() {
  return (
    <div className="mode-surface mode-readable min-h-screen">
      <div className="p-4 sm:p-6 max-w-md mx-auto space-y-6">
        <BackButton />

        <div className="text-center space-y-2">
          <div className="w-12 h-12 mx-auto rounded-xl flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)" }}>
            <Users className="w-6 h-6" style={{ color: "var(--accent)" }} />
          </div>
          <h1 className="text-xl font-bold">Join a Pool</h1>
        </div>

        <Suspense fallback={<div className="mode-muted text-sm text-center">Loading...</div>}>
          <JoinLeagueForm />
        </Suspense>
      </div>
    </div>
  )
}

