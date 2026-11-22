"use client"

import { useEffect, useCallback, useState } from "react"

interface XPProfileRow {
  profileId: string
  managerId: string
  totalXP: number
  currentTier: string
  xpToNextTier: number
  updatedAt: string
  tierBadgeColor?: string
  progressInTier?: number
}

export function useXPProfile(managerId: string | null) {
  const [profile, setProfile] = useState<XPProfileRow | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!managerId) {
      setProfile(null)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(
        `/api/xp/profile?${new URLSearchParams({ managerId })}`,
        { cache: "no-store" }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        setError(data?.error ?? "Failed to load XP profile")
        setProfile(null)
        return
      }
      setProfile({
        ...data,
        updatedAt: data.updatedAt ? new Date(data.updatedAt).toISOString() : "",
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load")
      setProfile(null)
    } finally {
      setLoading(false)
    }
  }, [managerId])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { profile, loading, error, refresh }
}
