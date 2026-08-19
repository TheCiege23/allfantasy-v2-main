'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type LegacySleeperImportPhase = 'idle' | 'importing' | 'complete' | 'failed'

const POLL_MS = 2500
// Ceiling on how long we poll a queued/running import before giving up on the UI.
// Prevents a spinner-of-death (AF_GATE0 §3.1) if the worker stalls or never completes;
// the job may still finish server-side, so the failure copy tells the user to refresh.
const MAX_POLL_MS = 150_000

type LegacyImportStatusPayload = {
  job_id?: string
  status?: string
  progress?: number
  error?: string | null
  message?: string | null
}

function normalizeJobPayload(data: unknown): LegacyImportStatusPayload | null {
  if (!data || typeof data !== 'object') return null
  const d = data as Record<string, unknown>
  const nested = d.job && typeof d.job === 'object' ? (d.job as Record<string, unknown>) : null
  const src = nested ?? d
  return {
    job_id: typeof src.job_id === 'string' ? src.job_id : typeof d.job_id === 'string' ? d.job_id : undefined,
    status: typeof src.status === 'string' ? src.status : undefined,
    progress: typeof src.progress === 'number' ? src.progress : undefined,
    error: typeof src.error === 'string' ? src.error : src.error == null ? null : String(src.error),
    message: typeof src.message === 'string' ? src.message : null,
  }
}

export function useLegacySleeperImport(options?: { importEndpoint?: string; extraBody?: Record<string, unknown> }) {
  const importEndpoint = options?.importEndpoint ?? '/api/legacy/import'
  const extraBody = options?.extraBody
  const [username, setUsername] = useState('')
  const [phase, setPhase] = useState<LegacySleeperImportPhase>('idle')
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [bootLoading, setBootLoading] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [statusMessage, setStatusMessage] = useState<string | null>(null)

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const clearPollTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const reset = useCallback(() => {
    clearPollTimer()
    setUsername('')
    setPhase('idle')
    setProgress(0)
    setError('')
    setBootLoading(false)
    setJobId(null)
    setStatusMessage(null)
  }, [clearPollTimer])

  const startImport = useCallback(
    async (uname: string) => {
      const clean = uname.trim()
      if (!clean) return
      setUsername(clean)
      setError('')
      setProgress(0)
      setStatusMessage(null)
      setBootLoading(true)

      try {
        const res = await fetch(importEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sleeper_username: clean.toLowerCase(), ...extraBody }),
        })
        const data = (await res.json()) as Record<string, unknown>
        if (!res.ok) {
          setError(typeof data.error === 'string' ? data.error : 'Failed to start import')
          setPhase('failed')
          setBootLoading(false)
          return
        }

        if (typeof data.job_id === 'string') setJobId(data.job_id)
        if (data.profile && typeof data.profile === 'object') {
          setPhase('complete')
          setProgress(100)
          setBootLoading(false)
          return
        }

        setPhase('importing')
        fetch('/api/legacy/worker/run', { method: 'GET', cache: 'no-store' }).catch(() => {})
      } catch {
        setError('Network error. Please try again.')
        setPhase('failed')
      } finally {
        setBootLoading(false)
      }
    },
    [importEndpoint, extraBody]
  )

  useEffect(() => {
    if (phase !== 'importing' || !username.trim()) return

    let cancelled = false
    const startedAt = Date.now()

    const poll = async () => {
      if (cancelled) return
      // Never poll forever — surface a clear, honest state instead of an endless spinner.
      if (Date.now() - startedAt > MAX_POLL_MS) {
        clearPollTimer()
        setError('This is taking longer than expected. Your leagues may still be importing — refresh in a moment to see your board.')
        setPhase('failed')
        return
      }
      clearPollTimer()
      try {
        const res = await fetch(
          `/api/legacy/import/status?sleeper_username=${encodeURIComponent(username.trim().toLowerCase())}`,
          { cache: 'no-store' }
        )
        const raw = await res.json()
        const job = normalizeJobPayload(raw)
        if (cancelled || !job) {
          timerRef.current = setTimeout(poll, POLL_MS)
          return
        }

        if (typeof job.progress === 'number') setProgress(Math.max(0, Math.min(100, job.progress)))
        if (job.message) setStatusMessage(job.message)

        if (job.status === 'completed') {
          setPhase('complete')
          setProgress(100)
          return
        }
        if (job.status === 'failed') {
          setError(job.error || 'Import failed')
          setPhase('failed')
          return
        }
        if (job.status === 'queued' || job.status === 'running') {
          fetch('/api/legacy/worker/run', { method: 'GET', cache: 'no-store' }).catch(() => {})
        }
      } catch {
        /* keep polling */
      }
      if (!cancelled) {
        timerRef.current = setTimeout(poll, POLL_MS)
      }
    }

    void poll()

    return () => {
      cancelled = true
      clearPollTimer()
    }
  }, [phase, username, clearPollTimer])

  return {
    username,
    setUsername,
    phase,
    progress,
    error,
    setError,
    bootLoading,
    jobId,
    statusMessage,
    startImport,
    reset,
  }
}
