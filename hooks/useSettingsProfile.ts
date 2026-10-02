"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import { useSession } from "next-auth/react"
import { dispatchStateRefreshEvent } from "@/lib/state-consistency/state-events"
import type { UserProfileForSettings, ProfileUpdatePayload } from "@/lib/user-settings/types"

const REQUEST_TIMEOUT_MS = 12_000

async function fetchJsonWithTimeout(
  input: string,
  init?: RequestInit
): Promise<{ ok: boolean; status: number; data: any }> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    const data = await response.json().catch(() => ({}))
    return { ok: response.ok, status: response.status, data }
  } catch {
    // status 0: no response at all (offline, timeout) — distinct from a server answer.
    return { ok: false, status: 0, data: {} }
  } finally {
    window.clearTimeout(timeoutId)
  }
}

export function useSettingsProfile() {
  const { update: updateSession } = useSession()
  const [profile, setProfile] = useState<UserProfileForSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /*
   * The last profile that loaded, readable from inside fetchProfile (which is memoized once).
   * A REFETCH never replaces it with nothing: Connected Accounts refetches on window focus, and a
   * null here makes SettingsApp swap the whole page for its full-screen error. Two paths did that:
   * a failed request, and a 200 from /api/user/profile with no userId — which is what it answers a
   * signed-out session or an empty snapshot with. Now both keep the page and say why inline.
   */
  const profileRef = useRef<UserProfileForSettings | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)

  const fetchProfile = useCallback(async () => {
    setLoading(true)
    setError(null)
    const accept = (next: UserProfileForSettings) => {
      profileRef.current = next
      setProfile(next)
      setSessionExpired(false)
    }
    try {
      const settingsResult = await fetchJsonWithTimeout("/api/user/settings", {
        cache: "no-store",
      })
      if (settingsResult.ok && settingsResult.data?.profile?.userId) {
        accept(settingsResult.data.profile as UserProfileForSettings)
        return
      }

      const profileResult = await fetchJsonWithTimeout("/api/user/profile", {
        cache: "no-store",
      })
      if (profileResult.ok && profileResult.data?.userId) {
        accept(profileResult.data as UserProfileForSettings)
        return
      }

      // Nothing usable came back. /api/user/settings answers a signed-out session with 401, while
      // /api/user/profile answers it with a 200 and no user — so the 401 is the reliable signal.
      const signedOut = settingsResult.status === 401
      if (signedOut) setSessionExpired(true)

      if (profileRef.current) {
        setError(
          signedOut
            ? "Your session has expired. Sign in again to keep changing your settings."
            : "Couldn't refresh your settings just now — what you see may be out of date.",
        )
        return
      }

      // First load with nothing to keep: SettingsApp shows its full error screen.
      setProfile(null)
      const msg =
        typeof profileResult.data?.error === "string"
          ? profileResult.data.error
          : typeof settingsResult.data?.error === "string" && !signedOut
            ? settingsResult.data.error
            : signedOut
              ? "Your session has expired. Sign in again to see your settings."
              : "Failed to load profile"
      setError(msg)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchProfile()
  }, [fetchProfile])

  const updateProfile = useCallback(
    async (payload: ProfileUpdatePayload) => {
      setSaving(true)
      setError(null)
      try {
        const controller = new AbortController()
        const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
        const res = await fetch("/api/user/profile", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        }).finally(() => {
          window.clearTimeout(timeoutId)
        })
        const data = await res.json()
        if (!res.ok) {
          setError(data?.error ?? "Failed to save")
          return false
        }
        await fetchProfile()
        try {
          await updateSession?.()
        } catch {
          // Non-fatal: settings save succeeded even if session refresh fails.
        }
        dispatchStateRefreshEvent({
          domain: "auth",
          reason: "profile_update",
          source: "useSettingsProfile",
        })
        return true
      } catch {
        setError("Failed to save")
        return false
      } finally {
        setSaving(false)
      }
    },
    [fetchProfile]
  )

  return { profile, loading, saving, error, sessionExpired, fetchProfile, updateProfile }
}
