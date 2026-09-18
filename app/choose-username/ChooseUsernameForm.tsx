"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import { signOutAndPurge } from "@/lib/pwa/signOutAndPurge"
import { useRouter } from "next/navigation"
import { validateUsername } from "@/lib/auth/username-validation"

interface Props {
  prefill: string
  callbackUrl: string
}

interface CheckResult {
  ok: boolean
  available: boolean
  reason: string
}

export default function ChooseUsernameForm({ prefill, callbackUrl }: Props) {
  const { update: updateSession } = useSession()
  const router = useRouter()

  const [username, setUsername] = useState(prefill)
  const [clientError, setClientError] = useState<string | null>(null)
  const [checkResult, setCheckResult] = useState<CheckResult | null>(null)
  const [checking, setChecking] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const checkAvailability = useCallback(async (value: string) => {
    const validation = validateUsername(value)
    if (!validation.ok) {
      setCheckResult(null)
      setSuggestion(null)
      return
    }
    setChecking(true)
    try {
      const res = await fetch(
        `/api/auth/check-username?username=${encodeURIComponent(validation.normalized)}`
      )
      if (res.ok) {
        const data: CheckResult = await res.json()
        setCheckResult(data)
        if (!data.available) {
          const sugRes = await fetch(
            `/api/auth/suggest-username?base=${encodeURIComponent(validation.normalized)}`
          )
          if (sugRes.ok) {
            const sugData = await sugRes.json()
            setSuggestion(sugData.suggestion ?? null)
          }
        } else {
          setSuggestion(null)
        }
      }
    } catch {
      // Ignore network errors on live check
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setCheckResult(null)
    setSuggestion(null)

    const validation = validateUsername(username)
    setClientError(validation.ok ? null : username.trim() ? validation.reason : null)

    if (!validation.ok) return

    debounceRef.current = setTimeout(() => {
      void checkAvailability(username)
    }, 400)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [username, checkAvailability])

  const normalized = (() => {
    const v = validateUsername(username)
    return v.ok ? v.normalized : null
  })()

  const isReady = normalized !== null && checkResult?.available === true && !checking && !saving

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isReady || !normalized) return

    setSaving(true)
    setSaveError(null)
    try {
      const res = await fetch("/api/user/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: normalized }),
      })
      const data = await res.json()
      if (!res.ok) {
        setSaveError(data.error ?? "Failed to save username")
        return
      }
      // Refresh the JWT cookie so the middleware gate sees the new username
      // without requiring a sign-out / sign-in cycle.
      await updateSession({ username: normalized })
      router.push(callbackUrl)
    } catch {
      setSaveError("Something went wrong. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  const statusIcon = checking
    ? "⏳"
    : checkResult?.available
      ? "✓"
      : checkResult
        ? "✗"
        : null

  const statusColor = checkResult?.available
    ? "text-emerald-400"
    : checkResult
      ? "text-red-400"
      : "text-slate-400"

  return (
    <div className="w-full max-w-sm rounded-2xl border border-slate-800 bg-slate-900 p-8 shadow-xl">
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-bold text-white">Choose your username</h1>
        <p className="mt-2 text-sm text-slate-400">
          This is how other players will identify you.
          <br />
          You can change it later in Settings.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div className="mb-5">
          <label
            htmlFor="username"
            className="mb-1.5 block text-sm font-medium text-slate-300"
          >
            Username
          </label>
          <div className="relative">
            <input
              id="username"
              type="text"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                setSaveError(null)
              }}
              maxLength={30}
              placeholder="your_username"
              className={[
                "w-full rounded-lg border px-4 py-2.5 pr-10 text-sm text-white",
                "placeholder:text-slate-600 focus:outline-none focus:ring-2 bg-slate-800",
                clientError || (checkResult && !checkResult.available)
                  ? "border-red-500 focus:ring-red-500"
                  : checkResult?.available
                    ? "border-emerald-500 focus:ring-emerald-500"
                    : "border-slate-700 focus:ring-cyan-500",
              ].join(" ")}
            />
            {statusIcon && (
              <span
                className={`absolute right-3 top-1/2 -translate-y-1/2 text-sm font-bold ${statusColor}`}
              >
                {statusIcon}
              </span>
            )}
          </div>

          {clientError && (
            <p className="mt-1.5 text-xs text-red-400">{clientError}</p>
          )}
          {!clientError && checkResult && !checkResult.available && (
            <p className="mt-1.5 text-xs text-red-400">
              {checkResult.reason === "taken"
                ? "That username is already taken."
                : checkResult.reason === "profanity"
                  ? "That username is not allowed."
                  : "Username is not available."}
            </p>
          )}
          {!clientError && checkResult?.available && (
            <p className="mt-1.5 text-xs text-emerald-400">Username is available!</p>
          )}
          {suggestion && !checkResult?.available && (
            <button
              type="button"
              onClick={() => setUsername(suggestion)}
              className="mt-2 text-xs text-cyan-400 underline hover:text-cyan-300"
            >
              Try <strong>{suggestion}</strong> instead
            </button>
          )}
        </div>

        {saveError && (
          <p className="mb-3 rounded-lg bg-red-900/30 px-3 py-2 text-sm text-red-400">
            {saveError}
          </p>
        )}

        <button
          type="submit"
          disabled={!isReady}
          className="w-full rounded-lg bg-gradient-to-r from-cyan-500 to-purple-600 py-2.5 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {saving ? "Saving…" : "Continue"}
        </button>
      </form>

      <div className="mt-6 text-center">
        <button
          type="button"
          onClick={() => void signOutAndPurge({ callbackUrl: "/login" })}
          className="text-xs text-slate-500 hover:text-slate-300 underline"
        >
          Sign out
        </button>
      </div>
    </div>
  )
}
