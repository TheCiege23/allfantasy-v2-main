"use client"

import { useCallback, useEffect, useState } from "react"
import { FEATURE_KEYS } from "@/lib/feature-toggle/constants"

type FeatureSnapshot = {
  features?: Record<string, unknown>
}

const AI_AVAILABILITY_CACHE_TTL_MS = 30_000
let cachedEnabledValue: boolean | null = null
let cachedEnabledAt = 0

export function useAIAssistantAvailability(defaultEnabled = true) {
  const [enabled, setEnabled] = useState<boolean>(defaultEnabled)
  const [loading, setLoading] = useState<boolean>(true)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const now = Date.now()
    if (cachedEnabledValue != null && now - cachedEnabledAt < AI_AVAILABILITY_CACHE_TTL_MS) {
      setEnabled(cachedEnabledValue)
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/config/features", { cache: "no-store" })
      const json = (await response.json().catch(() => ({}))) as FeatureSnapshot
      if (!response.ok) {
        throw new Error("Failed to read feature snapshot")
      }
      const raw = json?.features?.[FEATURE_KEYS.AI_ASSISTANT]
      const nextEnabled = typeof raw === "boolean" ? raw : defaultEnabled
      cachedEnabledValue = nextEnabled
      cachedEnabledAt = Date.now()
      setEnabled(nextEnabled)
    } catch (err) {
      setEnabled(defaultEnabled)
      setError(err instanceof Error ? err.message : "Failed to resolve Chimmy availability")
    } finally {
      setLoading(false)
    }
  }, [defaultEnabled])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { enabled, loading, error, refresh }
}
