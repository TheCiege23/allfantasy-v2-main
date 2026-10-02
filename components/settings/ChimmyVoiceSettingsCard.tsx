'use client'

import { useEffect, useRef, useState } from 'react'
import { StopCircle, Volume2 } from 'lucide-react'
import { toast } from 'sonner'
import { useChimmyTtsVoiceSync } from '@/hooks/useChimmyTtsVoiceSync'
import {
  DEFAULT_VOICE_CONFIG,
  getVoiceConfig,
  saveVoiceConfig,
  type VoiceConfig,
} from '@/lib/chimmy-voice'
import { CHIMMY_VOICES } from '@/lib/tts/voices'

const PREVIEW_TEXT =
  "Hey! I'm Chimmy — your fantasy assistant. I'll keep your decisions clear, data-backed, and fast. Ready when you are!"

export default function ChimmyVoiceSettingsCard() {
  const { voiceId: chimmyTtsVoiceId, setVoiceId: setChimmyTtsVoiceId } = useChimmyTtsVoiceSync()
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfig>(() => getVoiceConfig())
  const [previewPlaying, setPreviewPlaying] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const previewAudioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    return () => {
      if (previewAudioRef.current) {
        previewAudioRef.current.pause()
        previewAudioRef.current = null
      }
    }
  }, [])

  const applyVoiceConfig = (patch: Partial<VoiceConfig>) => {
    setVoiceConfig((current) => {
      const next = saveVoiceConfig({ ...current, ...patch })
      return next
    })
  }

  const stopPreview = () => {
    if (previewAudioRef.current) {
      previewAudioRef.current.pause()
      previewAudioRef.current.currentTime = 0
      previewAudioRef.current = null
    }
    setPreviewPlaying(false)
    setPreviewLoading(false)
  }

  const handlePreview = async () => {
    if (previewPlaying || previewLoading) {
      stopPreview()
      return
    }

    setPreviewLoading(true)

    try {
      // Call the live TTS endpoint with the currently selected voice ID so the
      // user hears exactly what their chosen voice sounds like.
      const res = await fetch('/api/tts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: PREVIEW_TEXT,
          voiceId: chimmyTtsVoiceId,
        }),
      })

      if (res.status === 503) {
        // TTS not configured — fall back to the bundled static sample
        setPreviewLoading(false)
        const fallback = new Audio('/chimmy-voice-sample.mp3')
        fallback.volume = voiceConfig.volume
        previewAudioRef.current = fallback
        setPreviewPlaying(true)
        fallback.onended = () => { previewAudioRef.current = null; setPreviewPlaying(false) }
        fallback.onerror = () => { previewAudioRef.current = null; setPreviewPlaying(false) }
        await fallback.play().catch(() => setPreviewPlaying(false))
        return
      }

      if (!res.ok) {
        throw new Error(`TTS preview failed (${res.status})`)
      }

      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.volume = voiceConfig.volume
      previewAudioRef.current = audio
      setPreviewLoading(false)
      setPreviewPlaying(true)

      audio.onended = () => {
        URL.revokeObjectURL(url)
        previewAudioRef.current = null
        setPreviewPlaying(false)
      }
      audio.onerror = () => {
        URL.revokeObjectURL(url)
        previewAudioRef.current = null
        setPreviewPlaying(false)
      }

      await audio.play()
    } catch (err) {
      setPreviewLoading(false)
      setPreviewPlaying(false)
      const msg = err instanceof Error ? err.message : 'Voice preview failed'
      toast.error(msg)
    }
  }

  return (
    <div className="rounded-xl border p-4 space-y-4" style={{ borderColor: 'var(--border)', background: 'var(--panel2)' }}>
      <div>
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>Chimmy Voice</h3>
        <p className="mt-1 text-xs" style={{ color: 'var(--muted)' }}>
          Choose the ElevenLabs voice for spoken replies. Your choice syncs across devices when you&apos;re signed in.
        </p>
      </div>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--muted2)' }}>
          Voice character
        </span>
        <div className="flex items-center gap-2">
          <select
            value={chimmyTtsVoiceId}
            onChange={(e) => {
              // Stop any in-progress preview so the next click uses the new voice
              stopPreview()
              setChimmyTtsVoiceId(e.target.value)
            }}
            data-testid="chimmy-tts-voice-select"
            className="w-full max-w-md rounded-lg border px-3 py-2 text-sm"
            style={{ borderColor: 'var(--border)', background: 'var(--panel)', color: 'var(--text)' }}
          >
            {CHIMMY_VOICES.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name} — {v.description}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => void handlePreview()}
            disabled={previewLoading}
            title={previewPlaying ? 'Stop preview' : 'Preview this voice'}
            data-testid="chimmy-voice-preview-btn"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition-colors disabled:opacity-60"
            style={{ borderColor: 'var(--border)', color: previewPlaying ? 'var(--accent-cyan)' : 'var(--text)' }}
          >
            {previewPlaying ? (
              <><StopCircle className="h-4 w-4" /> Stop</>
            ) : previewLoading ? (
              <>Loading…</>
            ) : (
              <><Volume2 className="h-4 w-4" /> Preview</>
            )}
          </button>
        </div>
        <p className="mt-1.5 text-[11px]" style={{ color: 'var(--muted)' }}>
          Click Preview to hear your selected voice via ElevenLabs. In chat, tap Play on any reply to speak it aloud.
        </p>
      </label>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            stopPreview()
            setVoiceConfig(DEFAULT_VOICE_CONFIG)
            saveVoiceConfig(DEFAULT_VOICE_CONFIG)
          }}
          className="rounded-lg border px-3 py-2 text-xs font-medium"
          style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
        >
          Reset voice settings
        </button>
      </div>

      <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Enable voice playback</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Keeps play controls available in Chimmy chat.
          </p>
        </div>
        <input
          type="checkbox"
          role="switch"
          checked={voiceConfig.enabled}
          onChange={(event) => applyVoiceConfig({ enabled: event.target.checked })}
          className="h-4 w-4 rounded"
          style={{ accentColor: 'var(--accent-cyan)' }}
        />
      </label>

      <label className="flex items-center justify-between gap-3 rounded-lg border px-3 py-3" style={{ borderColor: 'var(--border)' }}>
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>Auto-play new responses</p>
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Off by default. When enabled, new Chimmy replies start speaking automatically.
          </p>
        </div>
        <input
          type="checkbox"
          role="switch"
          checked={voiceConfig.autoPlay}
          onChange={(event) => applyVoiceConfig({ autoPlay: event.target.checked })}
          className="h-4 w-4 rounded"
          style={{ accentColor: 'var(--accent-cyan)' }}
        />
      </label>

      <div>
        <label className="mb-2 block text-sm font-medium" style={{ color: 'var(--muted2)' }}>
          Volume: {Math.round(voiceConfig.volume * 100)}%
        </label>
        <input
          type="range"
          min={0}
          max={100}
          value={Math.round(voiceConfig.volume * 100)}
          onChange={(event) => applyVoiceConfig({ volume: Number(event.target.value) / 100 })}
          className="w-full"
          aria-label="Voice volume"
          style={{ accentColor: 'var(--accent-cyan)' }}
        />
      </div>
    </div>
  )
}
