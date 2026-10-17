'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

const MAX_MS = 5 * 60 * 1000
const WARN_MS = 4 * 60 * 1000 + 50 * 1000

type VoiceRecorderProps = {
  leagueId: string
  /**
   * A DM or huddle has no league — its composer passes `leagueId=""` — so the upload names the
   * thread instead, exactly as the composer's photo upload does. Without it every voice note in a DM
   * was refused with "leagueId or threadId required".
   */
  threadId?: string | null
  onComplete: (payload: { url: string; duration: number; mimeType: string; name: string }) => void
  onCancel: () => void
}

export function VoiceRecorder({ leagueId, threadId, onComplete, onCancel }: VoiceRecorderProps) {
  const [seconds, setSeconds] = useState(0)
  const [bars, setBars] = useState<number[]>([0, 0, 0, 0, 0, 0, 0])
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const ctxRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const rafRef = useRef<number | null>(null)
  const startRef = useRef<number>(0)
  const warnedRef = useRef(false)
  const cancelledRef = useRef(false)
  const timerRef = useRef<number | null>(null)

  const stopStreams = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close()
    ctxRef.current = null
    analyserRef.current = null
  }, [])

  useEffect(() => {
    cancelledRef.current = false
    let mounted = true

    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        if (!mounted) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const ctx = new AudioContext()
        ctxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 64
        source.connect(analyser)
        analyserRef.current = analyser

        const data = new Uint8Array(analyser.frequencyBinCount)
        const tick = () => {
          if (!analyserRef.current) return
          analyserRef.current.getByteFrequencyData(data)
          const next: number[] = []
          const step = Math.max(1, Math.floor(data.length / 7))
          for (let i = 0; i < 7; i++) {
            let sum = 0
            for (let j = 0; j < step; j++) sum += data[i * step + j] ?? 0
            next.push(sum / step / 255)
          }
          setBars(next)
          rafRef.current = requestAnimationFrame(tick)
        }
        rafRef.current = requestAnimationFrame(tick)

        const mime = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4'
        const rec = new MediaRecorder(stream, { mimeType: mime })
        mediaRecorderRef.current = rec
        chunksRef.current = []
        rec.ondataavailable = (e) => {
          if (e.data.size) chunksRef.current.push(e.data)
        }

        startRef.current = Date.now()
        timerRef.current = window.setInterval(() => {
          const elapsed = Date.now() - startRef.current
          setSeconds(Math.floor(elapsed / 1000))
          if (!warnedRef.current && elapsed >= WARN_MS) {
            warnedRef.current = true
            toast.message('Recording stops in ~10s (5 min max)')
          }
          if (elapsed >= MAX_MS) {
            rec.stop()
          }
        }, 250)

        rec.onstop = () => {
          if (timerRef.current) {
            window.clearInterval(timerRef.current)
            timerRef.current = null
          }
          stopStreams()

          if (cancelledRef.current) {
            onCancel()
            return
          }

          const blob = new Blob(chunksRef.current, { type: mime })
          const duration = Math.min(MAX_MS / 1000, (Date.now() - startRef.current) / 1000)
          void (async () => {
            const fd = new FormData()
            fd.append('file', blob, 'voice.webm')
            fd.append('type', 'voice')
            // One of the two is always present; the endpoint authorises against whichever it gets.
            if (leagueId) fd.append('leagueId', leagueId)
            if (threadId) fd.append('threadId', threadId)
            const res = await fetch('/api/chat/upload', { method: 'POST', body: fd })
            const data = (await res.json().catch(() => ({}))) as { url?: string; error?: string }
            if (!res.ok || !data.url) {
              toast.error(data.error || 'Upload failed')
              onCancel()
              return
            }
            onComplete({
              url: data.url,
              duration,
              mimeType: mime,
              name: 'Voice note',
            })
          })()
        }

        rec.start(200)
      } catch {
        toast.error('Microphone permission needed')
        onCancel()
      }
    })()

    return () => {
      mounted = false
      cancelledRef.current = true
      if (timerRef.current) {
        window.clearInterval(timerRef.current)
        timerRef.current = null
      }
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop()
      } else {
        stopStreams()
      }
    }
  }, [leagueId, threadId, onCancel, onComplete, stopStreams])

  const stop = () => {
    cancelledRef.current = false
    mediaRecorderRef.current?.stop()
  }

  const cancel = () => {
    cancelledRef.current = true
    mediaRecorderRef.current?.stop()
  }

  return (
    <div className="flex w-full flex-wrap items-center justify-between gap-2 border-t border-white/[0.06] px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="relative flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-500 opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
        </span>
        <span className="text-[11px] font-semibold uppercase tracking-wide text-rose-300">Recording</span>
        <span className="font-mono text-[11px] text-white/80">
          {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, '0')}
        </span>
      </div>
      <div className="flex h-6 items-end gap-0.5">
        {bars.map((b, i) => (
          <div
            key={i}
            className="w-1 rounded-sm bg-cyan-500/80 transition-[height] duration-75"
            style={{ height: `${8 + b * 16}px` }}
          />
        ))}
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={stop}
          className="rounded-lg bg-rose-500/20 px-2 py-1 text-[11px] font-semibold text-rose-200"
        >
          ■ Stop
        </button>
        <button
          type="button"
          onClick={cancel}
          className="rounded-lg px-2 py-1 text-[11px] text-white/50 hover:bg-white/[0.06] hover:text-white"
        >
          × Cancel
        </button>
      </div>
    </div>
  )
}
