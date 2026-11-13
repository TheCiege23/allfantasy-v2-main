'use client'

import { useState, useEffect, useCallback } from 'react'

type ProviderStatus = {
  openai: boolean
  deepseek: boolean
  grok: boolean
  openclaw: boolean
  openclawGrowth: boolean
}

export function useProviderStatus(): {
  status: ProviderStatus | null
  loading: boolean
  error: boolean
  refetch: () => void
  availableCount: number
} {
  const [status, setStatus] = useState<ProviderStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const fetchStatus = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      const res = await fetch('/api/ai/providers/status', { credentials: 'include' })
      if (!res.ok) {
        setError(true)
        setStatus(null)
        return
      }
      const data = await res.json()
      setStatus({
        openai: !!data.openai,
        deepseek: !!data.deepseek,
        grok: !!data.grok,
        openclaw: !!data.openclaw,
        openclawGrowth: !!data.openclawGrowth,
      })
    } catch {
      setError(true)
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStatus()
  }, [fetchStatus])

  useEffect(() => {
    const onFocus = () => { fetchStatus() }
    const onOnline = () => { fetchStatus() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('online', onOnline)
    return () => {
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('online', onOnline)
    }
  }, [fetchStatus])

  useEffect(() => {
    const intervalMs = 60_000
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchStatus()
      }
    }, intervalMs)
    return () => window.clearInterval(id)
  }, [fetchStatus])

  const availableCount = status
    ? [status.openai, status.deepseek, status.grok, status.openclaw, status.openclawGrowth].filter(Boolean).length
    : 0

  return { status, loading, error, refetch: fetchStatus, availableCount }
}
