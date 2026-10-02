"use client"

import { useState, useEffect, useCallback } from "react"
import { useSession } from "next-auth/react"
import { dispatchStateRefreshEvent } from "@/lib/state-consistency/state-events"
import type { UserProfileForSettings, ProfileUpdatePayload } from "@/lib/user-settings/types"

const REQUEST_TIMEOUT_MS = 12_000

async function fetchJsonWithTimeout(
  input: string,
  init?: RequestInit
): Promise<{ ok: boolean; data: any }> {
  const controller = new AbortController()
  const timeoutId = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(input, { ...init, signal: controller.signal })
    const data = await response.json().catch(() => ({}))
    return { ok: response.ok, data }
  } catch {
    return { ok: false, data: {} }
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

  const fetchProfile = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const settingsResult = await fetchJsonWithTimeout("/api/user/settings", {
        cache: "no-store",
      })
      if (settingsResult.ok && settingsResult.data?.profile?.userId) {
        setProfile(settingsResult.data.profile as UserProfileForSettings)
        return
      }

      const profileResult = await fetchJsonWithTimeout("/api/user/profile", {
        cache: "no-store",
      })
      if (!profileResult.ok) {
        /*
         * The profile is deliberately NOT cleared here. On a first load it is already null, so the
         * error screen still shows; on a REFETCH it is the last good copy. Connected Accounts
         * refetches on every window focus, and clearing it meant one dropped request on a phone
         * swapped the whole settings page for an error screen. The message below still shows inline.
         */
        if (!settingsResult.ok) {
          const msg =
            typeof profileResult.data?.error === "string"
              ? profileResult.data.error
              : typeof settingsResult.data?.error === "string"
                ? settingsResult.data.error
                : "Failed to load profile"
          setError(msg)
        }
        return
      }
      if (profileResult.data.userId) {
        setProfile(profileResult.data as UserProfileForSettings)
      } else {
        setProfile(null)
      }
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

  return { profile, loading, saving, error, fetchProfile, updateProfile }
}
