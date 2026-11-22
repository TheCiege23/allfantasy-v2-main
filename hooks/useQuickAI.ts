'use client'

import { useEffect, useState } from 'react'

export function useQuickAI() {
  const [aiQuickActions, setAiQuickActions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true

    async function load() {
      try {
        const res = await fetch('/api/shared/quick-ai', { cache: 'no-store' })
        const json = await res.json().catch(() => ({}))
        if (!mounted) return
        setAiQuickActions(Array.isArray(json?.aiQuickActions) ? json.aiQuickActions : [])
        setError(null)
      } catch (err) {
        if (!mounted) return
        setError(err instanceof Error ? err.message : 'Failed to load quick Chimmy prompts')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    void load()
    const timer = setInterval(() => void load(), 60_000)
    return () => {
      mounted = false
      clearInterval(timer)
    }
  }, [])

  return { aiQuickActions, loading, error }
}
